#!/usr/bin/env node
// scripts/sync-users.mjs - mirror Supabase user data into the MongoDB archive.
//
//   node scripts/sync-users.mjs --dry-run   # counts only, writes nothing
//   node scripts/sync-users.mjs             # sync + reconcile deletions
//
// THE DELETION PROBLEM, AND WHY THIS SCRIPT IS THE ANSWER TO IT
//
// privacy.html promises "You can permanently delete your account". The iOS app
// honours that against Supabase. The moment a copy of that data also lives in
// MongoDB, the promise silently breaks: the user deletes their account and
// their reading history keeps existing in the archive.
//
// api/account-delete.js gives clients an immediate erasure call, but a promise
// that depends on every client remembering to call an endpoint is not a
// promise. So this script RECONCILES on every run: it reads the set of user ids
// that currently exist in Supabase, and purges from Mongo every user id that
// does not. Deletion therefore becomes eventually consistent by construction,
// and a client that forgets, crashes, or is an old app build cannot leave
// orphaned personal data behind.
//
// Requires SUPABASE_SERVICE_ROLE_KEY. That key bypasses Row Level Security, so
// it lives only in CI secrets and .env.local, never in anything the browser
// loads.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDb, ensureIndexes, closeMongo, hasMongo, redact as redactMongo, USER_COLLECTIONS } from "../lib/mongo.js";
import { adminSelectAll, hasServiceRole, redact as redactSb } from "../lib/supabase-admin.js";

const ROOT = new URL("../", import.meta.url);

function loadEnvLocal() {
  const path = fileURLToPath(new URL(".env.local", ROOT));
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const dryRun = process.argv.includes("--dry-run");
const runAt = new Date().toISOString();
const redact = (value) => redactSb(redactMongo(value));

// Supabase table -> Mongo collection, with the identity that makes a re-run an
// update rather than a duplicate. `source_id` is the Supabase row id, used where
// a row has no other natural key.
const TABLES = [
  { from: "ts_profiles",       to: "user_profiles",       order: "user_id", keyOf: (r) => ({ user_id: r.user_id }) },
  { from: "ts_saved_articles", to: "user_saved_articles", order: "id",      keyOf: (r) => ({ user_id: r.user_id, article_id: r.article_id }) },
  { from: "ts_read_events",    to: "user_read_events",    order: "id",      keyOf: (r) => ({ user_id: r.user_id, article_id: r.article_id, read_at: r.read_at }) },
  { from: "ts_quiz_attempts",  to: "user_quiz_attempts",  order: "id",      keyOf: (r) => ({ source_id: String(r.id) }) },
  { from: "ts_flashcards",     to: "user_flashcards",     order: "id",      keyOf: (r) => ({ source_id: String(r.id) }) },
];

console.log(`run          ${runAt}`);

if (!hasServiceRole()) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not set. It is required to read past Row Level Security.");
  console.error("Add it to .env.local locally, or the GitHub secret in CI. Never ship it to the browser.");
  process.exit(2);
}

// ---- read ------------------------------------------------------------------
const pulled = {};
try {
  for (const table of TABLES) {
    const rows = await adminSelectAll(table.from, { order: table.order });
    pulled[table.from] = rows;
    console.log(`  ${table.from.padEnd(20)} ${String(rows.length).padStart(6)} rows`);
  }
} catch (error) {
  console.error(`\nSupabase read failed: ${redact(error.message)}`);
  process.exit(1);
}

const liveUserIds = new Set();
for (const rows of Object.values(pulled)) {
  for (const row of rows) if (row?.user_id) liveUserIds.add(String(row.user_id));
}
const total = Object.values(pulled).reduce((sum, rows) => sum + rows.length, 0);
console.log(`\ntotal        ${total} rows across ${liveUserIds.size} users`);

if (dryRun) {
  console.log("\n--dry-run: nothing was written and nothing was deleted.");
  process.exit(0);
}
if (!hasMongo()) {
  console.error("\nMONGODB_URI is not set.");
  process.exit(2);
}

// ---- write + reconcile ------------------------------------------------------
try {
  const db = await getDb();
  await ensureIndexes(db, USER_COLLECTIONS);

  for (const table of TABLES) {
    const rows = pulled[table.from];
    if (!rows.length) continue;
    const operations = rows.map((row) => {
      const { id, ...rest } = row;
      return {
        updateOne: {
          filter: table.keyOf(row),
          update: {
            $set: { ...rest, source_id: String(id ?? ""), source_table: table.from, synced_at: runAt },
            $setOnInsert: { archived_at: runAt },
          },
          upsert: true,
        },
      };
    });
    const result = await db.collection(table.to).bulkWrite(operations, { ordered: false });
    console.log(`  ${table.to.padEnd(22)} ${result.upsertedCount} new, ${result.matchedCount} updated`);
  }

  // RECONCILE. Anyone in the archive who is no longer in Supabase has deleted
  // their account, so every trace of them goes now. This is what makes the
  // privacy policy's deletion promise true without depending on a client call.
  console.log("\nreconciling deletions…");
  const archived = new Set();
  for (const name of USER_COLLECTIONS) {
    for (const id of await db.collection(name).distinct("user_id")) {
      if (id) archived.add(String(id));
    }
  }
  const departed = [...archived].filter((id) => !liveUserIds.has(id));

  if (!departed.length) {
    console.log("  no departed users; archive matches Supabase");
  } else {
    // A run that pulled zero users almost certainly means a broken read, not
    // that every account was deleted. Refuse to mass-erase on that signal.
    if (!liveUserIds.size) {
      console.error(`  REFUSING to purge ${departed.length} users: Supabase returned no users at all, which looks like a failed read rather than mass deletion.`);
      process.exitCode = 1;
    } else {
      let purged = 0;
      for (const name of USER_COLLECTIONS) {
        const result = await db.collection(name).deleteMany({ user_id: { $in: departed } });
        purged += result.deletedCount;
      }
      console.log(`  purged ${purged} rows for ${departed.length} deleted account(s)`);
    }
  }

  const totals = {};
  for (const name of USER_COLLECTIONS) totals[name] = await db.collection(name).countDocuments();
  console.log(`\narchive      ${Object.entries(totals).map(([n, c]) => `${n.replace("user_", "")}=${c}`).join("  ")}`);
} catch (error) {
  console.error(`\nsync failed: ${redact(error.message)}`);
  process.exitCode = 1;
} finally {
  await closeMongo();
}
