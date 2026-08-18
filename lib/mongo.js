// lib/mongo.js - the single connection point for the Learnify archive.
//
// WHAT MONGO IS FOR HERE, AND WHAT IT IS NOT
//
// It is NOT the read path. Measured on production, serving the ranked feed from
// a committed JSON file costs 0-7ms; a round trip to Atlas costs tens of
// milliseconds warm and far worse on a cold serverless connection. Putting
// Mongo in front of a page view would make the site slower, not faster.
//
// It IS the durable archive, which is the thing a snapshot genuinely cannot be:
//   * papers            every paper ever ranked, not just today's top 24
//   * paper_citations   one dated reading per paper per day, so citation growth
//                       becomes a time series instead of a value that is
//                       overwritten and lost every morning
//   * briefings         full transcript and chapters for every briefing, beyond
//                       the 7 MP3s the repo keeps
//   * articles          the news feed, which currently only exists as a rolling
//                       snapshot
//   * subscribers       newsletter opt-ins, which had no real home at all
//
// Credential rules match lib/apify.js and lib/elevenlabs.js: environment only,
// never logged, and redacted out of anything this module reports.

import { MongoClient } from "mongodb";

const URI_RE = /^mongodb(\+srv)?:\/\/\S+$/;

export class MongoConfigError extends Error {
  constructor(message) { super(message); this.name = "MongoConfigError"; }
}

export function mongoUri(env = process.env) {
  const raw = String(env.MONGODB_URI || env.MONGO_URL || "").trim();
  return URI_RE.test(raw) ? raw : null;
}

export function hasMongo(env = process.env) {
  return mongoUri(env) !== null;
}

export const DB_NAME = process.env.MONGODB_DB || "learnify";

// A connection string embeds the password. Never let one reach a log line.
export function redact(value) {
  return String(value == null ? "" : value)
    .replace(/mongodb(\+srv)?:\/\/[^:@\s]+:[^@\s]+@/g, "mongodb$1://***:***@");
}

let client = null;
let connecting = null;

/**
 * A pooled client, reused across calls.
 *
 * Serverless invocations reuse the module scope, so caching the promise (not
 * just the client) means concurrent cold calls share one handshake instead of
 * opening a connection each. `serverSelectionTimeoutMS` is deliberately short:
 * if Atlas is unreachable the caller must fall back quickly, never hang a
 * request.
 */
export async function getMongo(env = process.env) {
  const uri = mongoUri(env);
  if (!uri) throw new MongoConfigError("MONGODB_URI is not configured");
  if (client) return client;
  if (!connecting) {
    connecting = MongoClient.connect(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      maxPoolSize: 5,
      retryWrites: true,
      appName: "learnify",
    }).then((connected) => { client = connected; connecting = null; return connected; })
      .catch((error) => { connecting = null; throw new Error(redact(error.message)); });
  }
  return connecting;
}

export async function getDb(env = process.env) {
  return (await getMongo(env)).db(env.MONGODB_DB || DB_NAME);
}

export async function closeMongo() {
  if (client) { await client.close(); client = null; }
}

/**
 * Indexes, declared once and applied idempotently.
 *
 * The unique keys are what make every writer safe to re-run: a day's sync can
 * be repeated without duplicating a paper, a citation reading, or a briefing.
 */
export const INDEXES = Object.freeze({
  papers: [
    { key: { key: 1 }, unique: true },
    { key: { topic: 1, world_score: -1 } },
    { key: { last_seen_at: -1 } },
  ],
  // One reading per paper per UTC day. Re-running a sync overwrites that day's
  // reading instead of appending a duplicate point to the series.
  paper_citations: [
    { key: { key: 1, date: 1 }, unique: true },
    { key: { key: 1, date: -1 } },
  ],
  briefings: [
    { key: { date: 1 }, unique: true },
  ],
  articles: [
    { key: { id: 1 }, unique: true },
    { key: { published: -1 } },
  ],
  subscribers: [
    { key: { email: 1 }, unique: true },
    { key: { created_at: -1 } },
  ],
  // User data, mirrored from Supabase. Every collection is keyed by user_id so
  // an account deletion is a single indexed delete per collection rather than a
  // scan, which is what makes the erasure path fast enough to be reliable.
  user_profiles: [
    { key: { user_id: 1 }, unique: true },
    { key: { synced_at: -1 } },
  ],
  user_saved_articles: [
    { key: { user_id: 1, article_id: 1 }, unique: true },
    { key: { user_id: 1 } },
  ],
  user_read_events: [
    { key: { user_id: 1, article_id: 1, read_at: 1 }, unique: true },
    { key: { user_id: 1 } },
  ],
  user_quiz_attempts: [
    { key: { source_id: 1 }, unique: true },
    { key: { user_id: 1 } },
  ],
  user_flashcards: [
    { key: { source_id: 1 }, unique: true },
    { key: { user_id: 1 } },
  ],
});

// Everything that holds personal data. Account deletion must clear every one of
// these, so the list lives HERE, next to the schema, rather than being spelled
// out again at each call site where it could drift out of date.
export const USER_COLLECTIONS = Object.freeze([
  "user_profiles",
  "user_saved_articles",
  "user_read_events",
  "user_quiz_attempts",
  "user_flashcards",
]);

/**
 * Erase every trace of one user from the archive.
 *
 * Returns a per-collection count so a deletion can be audited and, if a caller
 * needs it, proven. Never partially reports success: a throw from any
 * collection propagates, because a half-deleted account is worse than a failed
 * delete that can be retried.
 */
export async function deleteUserData(db, userId) {
  const id = String(userId || "").trim();
  if (!id) throw new Error("deleteUserData requires a user id");
  const deleted = {};
  for (const name of USER_COLLECTIONS) {
    const result = await db.collection(name).deleteMany({ user_id: id });
    deleted[name] = result.deletedCount;
  }
  return deleted;
}

export async function ensureIndexes(db, only = null) {
  const results = {};
  for (const [name, specs] of Object.entries(INDEXES)) {
    if (only && !only.includes(name)) continue;
    const collection = db.collection(name);
    for (const spec of specs) {
      // createIndex is idempotent; an identical index is a no-op.
      await collection.createIndex(spec.key, spec.unique ? { unique: true } : {});
    }
    results[name] = specs.length;
  }
  return results;
}
