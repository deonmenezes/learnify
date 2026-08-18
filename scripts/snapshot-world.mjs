#!/usr/bin/env node
// scripts/snapshot-world.mjs - precompute the world-ranked feed for every topic.
//
//   node scripts/snapshot-world.mjs
//   node scripts/snapshot-world.mjs --per 24 --topics "AI / ML,Security"
//
// WHY: a cold /api/research?rank=world request fans out to four live OpenAlex
// queries and costs 700-1200ms. That is the difference between a page that
// feels instant and one that visibly waits. Ranking by impact is not a
// real-time question - a paper's citation count does not move between two page
// views - so the ranked feed is computed once a day and served from disk.
//
// The "Newest first" lane stays live, because THAT one genuinely is a
// real-time question. This snapshot only backs rank=world.
//
// Costs nothing: OpenAlex is keyless and the Scholar tier is read from the
// existing scholar-snapshot.json. No Apify run, no credential required.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOPICS, rollingCutoff } from "../lib/topics.js";
import { collectWorldPapers } from "../lib/world-feed.js";

const OUT = fileURLToPath(new URL("../world-snapshot.json", import.meta.url));

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const perTopic = Math.max(1, Math.min(50, Number(arg("per", process.env.WORLD_PER_TOPIC || 24))));
const filter = String(arg("topics", "") || "").split(",").map((v) => v.trim()).filter(Boolean);
const selected = filter.length
  ? TOPICS.filter((topic) => filter.some((name) => name.toLowerCase() === topic.name.toLowerCase()))
  : [...TOPICS];

const now = new Date();

// Start from the PREVIOUS snapshot, not from empty.
//
// OpenAlex enforces a daily budget and answers 429 once it is spent, so a run
// can legitimately come back thinner than the last one. Rebuilding from scratch
// would then replace good data with degraded data - which is exactly what
// happened the first time this script ran twice in one day. A topic is only
// overwritten by a result that is actually better.
let previous = { topics: {} };
try { previous = JSON.parse(readFileSync(OUT, "utf-8")); } catch { /* first run */ }
if (!previous || typeof previous.topics !== "object" || !previous.topics) previous = { topics: {} };
const topics = { ...previous.topics };
let failures = 0;
let improved = 0;
let kept = 0;

// A fresh result replaces the stored one when it is cleaner, or as full and
// newer. A thinner, still-degraded result is discarded.
function isBetter(next, current) {
  if (!current) return true;
  if (next.provider_status === "ok" && current.provider_status !== "ok") return true;
  if (next.provider_status !== "ok" && current.provider_status === "ok") return false;
  return next.count >= current.count;
}

// Each topic is already FOUR OpenAlex requests. Running four topics at once
// meant sixteen concurrent requests against a free public index, and OpenAlex
// shed enough of them that most topics recorded provider_status "partial" -
// which the UI then reported to every reader all day. Two at a time (eight in
// flight) comes back clean. This job has all night; it does not need to race.
const CONCURRENCY = 2;

async function snapshotTopic(topic) {
  const world = await collectWorldPapers(topic.name, { now, limit: perTopic, poolSize: 50 });
  if (!world.ok || !world.papers.length) return null;
  return {
    refreshed_at: new Date().toISOString(),
    provider_status: world.providerStatus,
    sources: world.sources,
    count: world.papers.length,
    papers: world.papers,
  };
}

const queue = [...selected];
const retry = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const topic = queue.shift();
    if (!topic) break;
    try {
      const entry = await snapshotTopic(topic);
      if (!entry) { failures += 1; continue; }
      if (isBetter(entry, topics[topic.name])) {
        topics[topic.name] = entry;
        improved += 1;
        console.log(`  ${topic.name.padEnd(26)} ${String(entry.count).padStart(3)} papers  ${entry.provider_status}`);
      } else {
        kept += 1;
        console.log(`  ${topic.name.padEnd(26)} ${String(entry.count).padStart(3)} papers  ${entry.provider_status}  (kept previous: ${topics[topic.name].count} ${topics[topic.name].provider_status})`);
      }
      // A partial pool means OpenAlex dropped or refused one of the four
      // queries, not that the topic is thin. Worth one more try.
      if (entry.provider_status !== "ok") retry.push(topic);
    } catch (error) {
      failures += 1;
      console.warn(`  ${topic.name.padEnd(26)} failed: ${error.message}`);
    }
  }
}));

for (const topic of retry) {
  try {
    const entry = await snapshotTopic(topic);
    if (entry && isBetter(entry, topics[topic.name])) {
      topics[topic.name] = entry;
      console.log(`  retry ${topic.name.padEnd(20)} ${String(entry.count).padStart(3)} papers  ${entry.provider_status}`);
    }
  } catch { /* keep the first result */ }
}

// Never replace a good snapshot with a broken run.
if (!Object.keys(topics).length) {
  console.error("\nNo topic produced papers. Previous snapshot kept.");
  process.exit(1);
}

const payload = {
  generated_at: new Date().toISOString(),
  cutoff: rollingCutoff(now).toISOString(),
  per_topic: perTopic,
  topic_count: Object.keys(topics).length,
  count: Object.values(topics).reduce((total, entry) => total + entry.papers.length, 0),
  topics,
};
writeFileSync(OUT, JSON.stringify(payload));

console.log(`\nsnapshot     ${payload.count} papers across ${payload.topic_count}/${selected.length} topics -> world-snapshot.json`);
console.log(`updated      ${improved} topic(s) improved, ${kept} kept their previous (better) data`);
if (failures) console.log(`failures     ${failures} topic(s) returned nothing and kept whatever was already stored`);
const degraded = Object.values(topics).filter((entry) => entry.provider_status !== "ok").length;
if (degraded) console.log(`degraded     ${degraded} topic(s) still hold a partial provider response`);
