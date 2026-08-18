#!/usr/bin/env node
// scripts/sync-mongo.mjs - push the Learnify corpus into the MongoDB archive.
//
//   node scripts/sync-mongo.mjs --dry-run    # counts only, writes nothing
//   node scripts/sync-mongo.mjs              # sync everything
//   node scripts/sync-mongo.mjs --only papers,briefings
//
// This is an ARCHIVE writer, not a read path. The site keeps serving from the
// committed snapshots because a local file read is 0-7ms and an Atlas round trip
// is not. What Mongo adds is everything the snapshots structurally cannot hold:
// papers that have fallen out of today's top 24, a citation reading per paper
// per day, briefings older than the 7 MP3s kept in git, and subscribers.
//
// Every write is an idempotent upsert keyed on a unique index, so re-running a
// sync (or running it twice in a day) corrects data instead of duplicating it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDb, ensureIndexes, closeMongo, hasMongo, redact } from "../lib/mongo.js";
import { paperKey } from "../lib/world-rank.js";
import { TOPICS } from "../lib/topics.js";
import { topicSlug } from "../lib/world-snapshot.js";

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

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}
const dryRun = arg("dry-run", false) !== false;
const only = String(arg("only", "") || "").split(",").map((v) => v.trim()).filter(Boolean);
const wants = (name) => !only.length || only.includes(name);

function readJson(relative) {
  try { return JSON.parse(readFileSync(fileURLToPath(new URL(relative, ROOT)), "utf-8")); }
  catch { return null; }
}

const now = new Date();
const runAt = now.toISOString();
const today = runAt.slice(0, 10);

// ---- gather -----------------------------------------------------------------

// Papers come from every per-topic world file plus the Scholar snapshot, so the
// archive keeps papers that never reached a topic's visible top 24.
function gatherPapers() {
  const byKey = new Map();
  const add = (paper, topic, tier) => {
    if (!paper?.title) return;
    const key = paperKey(paper);
    const existing = byKey.get(key);
    const record = existing || {
      key,
      title: paper.title,
      topics: [],
      tiers: [],
      first_seen_at: runAt,
    };
    if (topic && !record.topics.includes(topic)) record.topics.push(topic);
    if (tier && !record.tiers.includes(tier)) record.tiers.push(tier);
    // Keep the strongest value seen for each field across tiers.
    record.citations = Math.max(Number(record.citations) || 0, Number(paper.citations) || 0);
    record.world_score = Math.max(Number(record.world_score) || 0, Number(paper.world_score) || 0);
    if (paper.score_breakdown) record.score_breakdown = paper.score_breakdown;
    if (!record.published && paper.published) record.published = paper.published;
    if (!record.published_year && Number.isInteger(paper.published_year)) record.published_year = paper.published_year;
    if ((paper.summary || "").length > (record.summary || "").length) record.summary = paper.summary;
    record.venue = record.venue || paper.venue || paper.publisher || null;
    record.authors = record.authors || paper.authors || paper.author || null;
    record.url = record.url || paper.canonical_url || paper.link || paper.url || null;
    record.open_access_pdf = record.open_access_pdf || paper.open_access_pdf || null;
    record.providers = [...new Set([...(record.providers || []), ...(paper.providers || [paper.provider].filter(Boolean))])];
    record.date_precision = record.date_precision || paper.date_precision || (paper.published ? "day" : null);
    record.last_seen_at = runAt;
    byKey.set(key, record);
  };

  for (const topic of TOPICS) {
    const world = readJson(`world/${topicSlug(topic.name)}.json`);
    for (const paper of world?.papers || []) add(paper, topic.name, "world");
  }
  const scholar = readJson("scholar-snapshot.json");
  for (const [topicName, entry] of Object.entries(scholar?.topics || {})) {
    for (const paper of entry?.papers || []) add(paper, topicName, "scholar");
  }
  return [...byKey.values()];
}

// One reading per paper per UTC day. This is the series a JSON snapshot cannot
// keep: the snapshot overwrites today's citation count every morning and the
// previous value is gone.
function citationReadings(papers) {
  return papers
    .filter((paper) => Number.isFinite(paper.citations))
    .map((paper) => ({
      key: paper.key,
      date: today,
      recorded_at: runAt,
      citations: paper.citations,
      world_score: paper.world_score ?? null,
      title: paper.title,
    }));
}

function gatherBriefings() {
  const manifest = readJson("briefing.json");
  if (!manifest?.date) return [];
  return [{
    date: manifest.date,
    date_label: manifest.date_label,
    title: manifest.title,
    audio_url: manifest.audio_url,
    audio_bytes: manifest.audio_bytes,
    duration_seconds: manifest.duration_seconds,
    provider: manifest.provider,
    voice_id: manifest.voice_id,
    model_id: manifest.model_id,
    characters: manifest.characters,
    transcript: manifest.transcript,
    chapters: manifest.chapters,
    generated_at: manifest.generated_at,
    archived_at: runAt,
  }];
}

function gatherArticles() {
  const payload = readJson("articles.json");
  const articles = Array.isArray(payload?.articles) ? payload.articles : [];
  return articles.filter((article) => article?.id && article?.title).map((article) => ({
    ...article,
    archived_at: runAt,
  }));
}

// ---- write ------------------------------------------------------------------

async function upsertMany(db, name, docs, keyOf) {
  if (!docs.length) return { matched: 0, upserted: 0 };
  const operations = docs.map((doc) => ({
    updateOne: {
      filter: keyOf(doc),
      // first_seen_at must survive later syncs, so it is set only on insert.
      update: { $set: { ...doc, first_seen_at: undefined }, $setOnInsert: { first_seen_at: doc.first_seen_at || runAt } },
      upsert: true,
    },
  }));
  // Strip the undefined placeholder so it is not written as a null field.
  for (const op of operations) delete op.updateOne.update.$set.first_seen_at;
  const result = await db.collection(name).bulkWrite(operations, { ordered: false });
  return { matched: result.matchedCount, upserted: result.upsertedCount };
}

const papers = wants("papers") ? gatherPapers() : [];
const readings = wants("papers") ? citationReadings(papers) : [];
const briefings = wants("briefings") ? gatherBriefings() : [];
const articles = wants("articles") ? gatherArticles() : [];

console.log(`run          ${runAt}`);
console.log(`papers       ${papers.length}`);
console.log(`readings     ${readings.length} (one per paper for ${today})`);
console.log(`briefings    ${briefings.length}`);
console.log(`articles     ${articles.length}`);

if (dryRun) {
  console.log("\n--dry-run: nothing was written.");
  process.exit(0);
}
if (!hasMongo()) {
  console.error("\nMONGODB_URI is not set. Add it to .env.local (local) or the GitHub secret (CI).");
  process.exit(2);
}

try {
  const db = await getDb();
  const indexes = await ensureIndexes(db);
  console.log(`\nindexes      ${Object.entries(indexes).map(([n, c]) => `${n}:${c}`).join(" ")}`);

  if (papers.length) {
    const result = await upsertMany(db, "papers", papers, (doc) => ({ key: doc.key }));
    console.log(`papers       ${result.upserted} new, ${result.matched} updated`);
  }
  if (readings.length) {
    const result = await upsertMany(db, "paper_citations", readings, (doc) => ({ key: doc.key, date: doc.date }));
    console.log(`readings     ${result.upserted} new, ${result.matched} rewritten for today`);
  }
  if (briefings.length) {
    const result = await upsertMany(db, "briefings", briefings, (doc) => ({ date: doc.date }));
    console.log(`briefings    ${result.upserted} new, ${result.matched} updated`);
  }
  if (articles.length) {
    const result = await upsertMany(db, "articles", articles, (doc) => ({ id: doc.id }));
    console.log(`articles     ${result.upserted} new, ${result.matched} updated`);
  }

  const totals = {};
  for (const name of ["papers", "paper_citations", "briefings", "articles", "subscribers"]) {
    totals[name] = await db.collection(name).countDocuments();
  }
  console.log(`\narchive      ${Object.entries(totals).map(([n, c]) => `${n}=${c}`).join("  ")}`);
} catch (error) {
  console.error(`\nsync failed: ${redact(error.message)}`);
  process.exitCode = 1;
} finally {
  await closeMongo();
}
