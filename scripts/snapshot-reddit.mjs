#!/usr/bin/env node
// scripts/snapshot-reddit.mjs — regenerate reddit-snapshot.json (the Reddit-tier
// baseline). Reddit serves its `.rss` feed to a descriptive UA but rate-limits a
// burst of parallel fetches, so the broad coverage across ALL curated subreddits
// is gathered sequentially here (cron) and committed; the live API then fetches
// only a small CORE set per request and unions it on top.
//
//   node scripts/snapshot-reddit.mjs
//
// Reuses the exact same collector the live API uses, so the snapshot is identical
// in shape to a live response.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collectReddit } from "../lib/reddit.js";

const OUT = fileURLToPath(new URL("../reddit-snapshot.json", import.meta.url));

// Sequential + spaced so a CI runner's IP isn't 429'd by Reddit. 6s spacing
// across the curated subs (~2 min/run) — gentle enough that more subs succeed
// per pass. The collector unions fresh posts over the EXISTING snapshot, so each
// run ACCUMULATES coverage; entries age out of the 14-day window on their own.
const { ok, articles } = await collectReddit(Date.now(), { sequential: true, delayMs: 6000 });
if (!articles.length) {
  console.error("No Reddit posts collected (rate-limited?). Snapshot NOT overwritten.");
  process.exit(1);
}

const byCat = {};
for (const a of articles) byCat[a.category] = (byCat[a.category] || 0) + 1;

const payload = {
  generated_at: new Date().toISOString(),
  subs: ok,
  count: articles.length,
  by_category: byCat,
  articles,
};
writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`Wrote ${articles.length} posts from ${ok.length} subs → reddit-snapshot.json`);
console.log("by category:", JSON.stringify(byCat));
for (const a of articles.slice(0, 12)) {
  console.log(`  [${a.category.padEnd(18)}] r/${a.handle.padEnd(16)} ${a.title.slice(0, 70)}`);
}
