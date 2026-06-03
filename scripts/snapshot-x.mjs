#!/usr/bin/env node
// scripts/snapshot-x.mjs — regenerate x-snapshot.json (the social-tier fallback).
//
// Pulls the latest report-worthy posts from the curated X voices and writes a
// committed snapshot the serverless collector falls back to when X rate-limits
// the function IP. Run periodically (cron / before deploy):
//
//   node scripts/snapshot-x.mjs
//
// It reuses the exact same collector + newsworthiness scorer the live API uses,
// so the snapshot is identical in shape to a live response.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collectX } from "../lib/x.js";

const OUT = fileURLToPath(new URL("../x-snapshot.json", import.meta.url));

// Sequential + spaced so a CI runner's IP isn't rate-limited (429) by X. Slower,
// but latency doesn't matter for a cron. Unions any fresh live posts on top of
// the existing snapshot (entries age out of the 21-day window on their own).
// 6s spacing across the 18 voices (~2 min/run) — gentle enough on X's per-IP
// rate limit that more handles succeed per pass; the union accumulates them.
const { ok, articles } = await collectX(Date.now(), { sequential: true, delayMs: 6000 });
if (!articles.length) {
  console.error("No report-worthy posts collected (rate-limited?). Snapshot NOT overwritten.");
  process.exit(1);
}

const payload = {
  generated_at: new Date().toISOString(),
  handles: ok,
  count: articles.length,
  articles,
};
writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`Wrote ${articles.length} report-worthy posts from ${ok.length} voices → x-snapshot.json`);
for (const a of articles.slice(0, 10)) {
  console.log(`  [${a.worthiness_score}] ${a.sentiment.padEnd(8)} @${a.handle.padEnd(13)} ${a.title.slice(0, 80)}`);
}
