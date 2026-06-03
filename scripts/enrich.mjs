#!/usr/bin/env node
// scripts/enrich.mjs — the hourly precompute pass.
//
// Collects the full feed (news + X + arXiv), then AI-summarizes every NEW item
// (not already cached) via NVIDIA Nemotron and writes enriched.json — a cache
// keyed by article id that the live API attaches to the feed. This keeps the
// per-request API instant (no LLM inline) while still serving AI-written
// summaries. Idempotent: re-runs only summarize items not already cached.
//
// Reads secrets from .env.local (NVIDIA_API_KEY, …). Run hourly via cron:
//   node scripts/enrich.mjs
//
// Reliability: if the LLM key is missing/invalid, summaries simply stay
// extractive (the API computes those inline) — enrich never blanks the feed.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collectArticles } from "../lib/feeds.js";
import { aiSummarize } from "../lib/summarize.js";
import { openverseMedia } from "../lib/media.js";

const ROOT = new URL("../", import.meta.url);
const OUT = fileURLToPath(new URL("enriched.json", ROOT));

// --- tiny .env.local loader (no dependency) ---------------------------------
function loadEnvLocal() {
  const p = fileURLToPath(new URL(".env.local", ROOT));
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const MAX_NEW = parseInt(process.env.ENRICH_MAX || "50", 10); // cap LLM calls/run
const CONCURRENCY = parseInt(process.env.ENRICH_CONCURRENCY || "4", 10);
const KEEP_DAYS = 10; // prune cache entries older than this

function loadCache() {
  try {
    const j = JSON.parse(readFileSync(OUT, "utf-8"));
    return j && j.items ? j : { items: {} };
  } catch { return { items: {} }; }
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

const { articles } = await collectArticles();
console.log(`Collected ${articles.length} items.`);

const cache = loadCache();
const haveKey = !!(process.env.NVIDIA_API_KEY || "").trim();
if (!haveKey) {
  console.warn("No NVIDIA_API_KEY — extractive summaries only (API computes them inline). Nothing to precompute.");
}

// Items needing an AI summary: in the current feed, not already cached.
const pending = haveKey
  ? articles.filter((a) => a.id && !(cache.items[a.id] && cache.items[a.id].ai_summary)).slice(0, MAX_NEW)
  : [];
console.log(`AI-summarizing ${pending.length} new item(s) (cap ${MAX_NEW}, concurrency ${CONCURRENCY})…`);

let done = 0, ok = 0;
await mapLimit(pending, CONCURRENCY, async (a) => {
  const summary = await aiSummarize(a);
  done++;
  if (summary) {
    cache.items[a.id] = { ai_summary: summary, title: a.title, t: Date.now() };
    ok++;
    if (ok <= 8) console.log(`  ✓ [${a.source}] ${a.title.slice(0, 60)}\n     → ${summary.slice(0, 90)}`);
  }
  if (done % 10 === 0) console.log(`  …${done}/${pending.length}`);
});

// --- Images: precompute a license-clean, CREDITED photo per article ----------
// Keyless Openverse (CC / public-domain) — legal to display with attribution.
// Throttled so we don't hammer the anonymous rate limit. Articles that already
// have a cached image are skipped; the rest fall back to the editorial poster.
const IMG_MAX = parseInt(process.env.ENRICH_IMAGE_MAX || "70", 10);
const needImg = articles
  .filter((a) => a.id && !(cache.items[a.id] && cache.items[a.id].media_url))
  .slice(0, IMG_MAX);
console.log(`Resolving ${needImg.length} license-clean image(s) via Openverse…`);
let imgOk = 0, imgDone = 0;
await mapLimit(needImg, 3, async (a) => {
  let m = null;
  try { m = await openverseMedia(a); } catch { /* keep prior / poster fallback */ }
  imgDone++;
  if (m && m.media_url) {
    const prev = cache.items[a.id] || { title: a.title, t: Date.now() };
    cache.items[a.id] = {
      ...prev,
      media_url: m.media_url,
      media_kind: m.media_kind,
      media_credit: m.media_credit,
      media_credit_url: m.media_credit_url,
      t: prev.t || Date.now(),
    };
    imgOk++;
  }
  if (imgDone % 15 === 0) console.log(`  …img ${imgDone}/${needImg.length}`);
});
console.log(`Images: +${imgOk} license-clean CC photos resolved (credited).`);

// Prune stale entries (keep recent so the cache doesn't grow unbounded).
const cutoff = Date.now() - KEEP_DAYS * 864e5;
const liveIds = new Set(articles.map((a) => a.id));
let pruned = 0;
for (const [id, v] of Object.entries(cache.items)) {
  if (!liveIds.has(id) && (v.t || 0) < cutoff) { delete cache.items[id]; pruned++; }
}

const payload = {
  generated_at: new Date().toISOString(),
  model: process.env.NVIDIA_LLM_MODEL || null,
  count: Object.keys(cache.items).length,
  items: cache.items,
};
writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`\nEnriched: +${ok} new AI summaries, ${pruned} pruned, ${payload.count} total cached → enriched.json`);
