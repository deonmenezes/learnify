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

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { collectArticles } from "../lib/feeds.js";
import { collectPapers } from "../lib/papers.js";
import { isRelevantRaw } from "../lib/research-shared.js";
import { aiSummarize } from "../lib/summarize.js";
import { openverseMedia, scrapeOgImage } from "../lib/media.js";

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

// --- Images: scrape og:image for items whose feed carries none ---------------
// Hacker News RSS ships zero images — each item just links an external page.
// Scrape that page's <meta og:image> here, at enrich time, so the live API
// serves a real publisher image with no request latency. HN first (it's the
// whole coverage gap), then any other image-less stragglers. Items the live
// fallback already scraped this run (image_origin === "scrape") are persisted
// too — the per-link memo makes that a free cache hit, not a refetch.
const OG_MAX = parseInt(process.env.ENRICH_OG_MAX || "60", 10);
const needOg = articles
  .filter((a) => a.id && !a.is_social && !a.is_paper
    && (!a.image || a.image_origin === "scrape")
    && /^https?:\/\//i.test(a.link || "")
    && !(cache.items[a.id] && cache.items[a.id].image))
  .sort((a, b) =>
    (b.source_id === "hackernews" ? 1 : 0) - (a.source_id === "hackernews" ? 1 : 0))
  .slice(0, OG_MAX);
console.log(`Scraping og:image for ${needOg.length} image-less item(s) (cap ${OG_MAX})…`);
let ogOk = 0, ogDone = 0;
await mapLimit(needOg, 4, async (a) => {
  let img = null;
  try { img = await scrapeOgImage(a.link); } catch { /* dead/slow page — stays imageless */ }
  ogDone++;
  if (img) {
    const prev = cache.items[a.id] || { title: a.title, t: Date.now() };
    cache.items[a.id] = { ...prev, image: img, t: prev.t || Date.now() };
    ogOk++;
    if (ogOk <= 5) console.log(`  ✓ [${a.source}] ${a.title.slice(0, 60)}\n     → ${img.slice(0, 90)}`);
  }
  if (ogDone % 15 === 0) console.log(`  …og ${ogDone}/${needOg.length}`);
});
console.log(`og:image: +${ogOk} publisher images scraped.`);

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

// ============================================================================
// PAPERS PASS — make research addictive: per-paper NVIDIA-LLM headline + hook
// and a generated Flux cover image, precomputed here and merged into
// /api/research at request time (papers-enriched.json keyed by paper id;
// covers in paper-covers/ at repo root, served as static files by Vercel).
// Idempotent like the articles pass: only papers not already cached are
// enriched. Gated by the SAME isRelevantRaw filter api/research.js uses, so we
// only pay for papers that actually ship.
// ============================================================================

const PAPERS_OUT = fileURLToPath(new URL("papers-enriched.json", ROOT));
const COVERS_DIR = fileURLToPath(new URL("paper-covers", ROOT));
const PAPERS_MAX = parseInt(process.env.PAPERS_ENRICH_MAX || "24", 10); // cap NEW enrichments/run
const PAPERS_PRUNE_OVER = 250; // prune only past this size, so feed churn doesn't thrash regeneration
const FLUX_URL = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell";

function loadPapersCache() {
  try {
    const j = JSON.parse(readFileSync(PAPERS_OUT, "utf-8"));
    return j && j.papers && typeof j.papers === "object" ? j : { papers: {} };
  } catch { return { papers: {} }; }
}

function writePapersCache(cache) {
  writeFileSync(PAPERS_OUT, JSON.stringify({
    generated_at: new Date().toISOString(),
    count: Object.keys(cache.papers).length,
    papers: cache.papers,
  }, null, 2));
}

// Nemotron may wrap the JSON in prose or a reasoning trace — drop <think> blocks
// then pull the first balanced {...} block out of whatever is left.
function stripReasoning(s) {
  return String(s || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
function extractJsonBlock(s) {
  const text = String(s || "");
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function clampText(s, max) {
  let t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return t;
}
function clampHeadline(s) {
  let t = String(s || "").replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”.]+$/g, "");
  if (t.length > 72) t = t.slice(0, 72).replace(/\s+\S*$/, "").replace(/[\s,;:\-–—]+$/, "");
  return t;
}
function validateTeaser(o) {
  if (!o || typeof o !== "object") return null;
  const headline = clampHeadline(o.headline);
  const hook = clampText(o.hook, 600);
  const visual = clampText(o.visual, 200);
  if (headline.length < 8 || hook.length < 40) return null; // junk → retry, then skip
  return { headline, hook, visual: visual || null };
}

// Stable per-paper seed (same djb2 family as lib/papers.js shortId) so a
// regenerated cover for the same paper is the same image.
function paperSeed(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h;
}

const TEASER_SYSTEM = [
  'You write irresistible but strictly accurate research-paper teasers for a tech news app.',
  'Reply with ONLY strict JSON, no markdown, no commentary: {"headline": "...", "hook": "...", "visual": "..."}.',
  'headline: at most 72 characters, concrete and curiosity-driven, accurate to the abstract, no fabricated claims or numbers,',
  'never start with "Scientists discover", no clickbait lies, Title Case (never ALL CAPS).',
  'hook: 2-3 plain-English sentences a smart 20-year-old would actually want to read — what was done, why it matters, the wow.',
  'No jargon walls, never "In this paper".',
  'visual: ONE vivid CONCRETE visual subject for a cover image — an object or scene',
  '(e.g. "a quadruped robot mid-leap over broken terrain"), never an abstract concept word like "innovation".',
].join(" ");

// ONE chat call → {"headline","hook","visual"} for a paper. Same NVIDIA chat
// endpoint/model conventions as lib/summarize.js (thinking trace disabled).
// Throws on HTTP error/timeout so the caller can retry once. 90s timeout:
// Nemotron runs ~30s/call even with thinking off, and concurrent calls queue.
async function paperTeaserOnce(p, { timeoutMs = 90000 } = {}) {
  const key = (process.env.NVIDIA_API_KEY || "").trim();
  const base = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").trim();
  const model = (process.env.NVIDIA_LLM_MODEL || "nvidia/nemotron-3-super-120b-a12b").trim();
  const abstract = String(p.summary || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: TEASER_SYSTEM },
          { role: "user", content: `Title: ${p.title}\n\nAbstract: ${abstract || "(no abstract available — go on the title alone, claim nothing it doesn't support)"}` },
        ],
        max_tokens: 2048,
        temperature: 0.6,
        top_p: 0.95,
        // nemotron-3-super: disable the long reasoning trace for speed
        extra_body: { chat_template_kwargs: { enable_thinking: false } },
      }),
    });
    if (!res.ok) throw new Error(`chat HTTP ${res.status}`);
    const j = await res.json();
    return j?.choices?.[0]?.message?.content || "";
  } finally { clearTimeout(t); }
}

// One Flux Schnell generation → { buf, ext }. Throws on non-200/timeout/bad
// payload so the caller can retry once. Magic-byte sniff picks the extension.
async function fluxCoverOnce(visual, seed, { timeoutMs = 20000 } = {}) {
  const key = (process.env.NVIDIA_API_KEY || "").trim();
  const prompt = `Cinematic minimal 3D render on a near-black background, one centered hero subject: ${visual}. Dark glass and brushed graphite materials, soft spring-green glow accents, gentle rim lighting, shallow depth of field, premium editorial style. No text, no letters, no logos, no watermark.`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(FLUX_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({ prompt, mode: "base", width: 1024, height: 1024, steps: 4, seed }),
    });
    if (!res.ok) throw new Error(`flux HTTP ${res.status}`);
    const j = await res.json();
    const b64 = j?.artifacts?.[0]?.base64;
    if (!b64) throw new Error("flux: no artifact");
    const buf = Buffer.from(b64, "base64");
    if (buf[0] === 0xff && buf[1] === 0xd8) return { buf, ext: "jpg" }; // JPEG magic
    if (buf[0] === 0x89 && buf[1] === 0x50) return { buf, ext: "png" }; // PNG magic
    throw new Error("flux: unknown image magic");
  } finally { clearTimeout(t); }
}

async function runPapersPass() {
  console.log("\n— Papers pass: addictive headlines + hooks + Flux covers —");
  const papersCache = loadPapersCache();
  if (!haveKey) {
    console.warn("No NVIDIA_API_KEY — skipping paper enrichment (cache kept as-is).");
    writePapersCache(papersCache);
    return;
  }

  const collected = await collectPapers();
  const relevant = collected.filter(isRelevantRaw); // same gate as /api/research
  // Most-cited (trending) papers lead; ties (arXiv has no citations) break
  // newest-first — so the budget goes to what tops the app's research tab.
  const ranked = relevant.slice().sort((a, b) =>
    (b.citations || 0) - (a.citations || 0) || (b.published || "").localeCompare(a.published || ""));
  const pendingPapers = ranked.filter((p) => p.id && !papersCache.papers[p.id]).slice(0, PAPERS_MAX);
  console.log(`Papers: ${collected.length} collected, ${relevant.length} relevant, enriching ${pendingPapers.length} (cap ${PAPERS_MAX}, concurrency ${CONCURRENCY}).`);

  // Phase 1 — teasers (text), same concurrency as the articles pass.
  // One attempt + one retry per paper (parse failure OR HTTP/timeout), then skip.
  let teaserOk = 0;
  const freshly = [];
  await mapLimit(pendingPapers, CONCURRENCY, async (p) => {
    let teaser = null;
    for (let attempt = 0; attempt < 2 && !teaser; attempt++) {
      try {
        teaser = validateTeaser(extractJsonBlock(stripReasoning(await paperTeaserOnce(p))));
      } catch { /* HTTP error / timeout — counts as a failed attempt */ }
    }
    if (!teaser) { console.warn(`  ✗ teaser failed, skipping: ${String(p.title).slice(0, 60)}`); return; }
    papersCache.papers[p.id] = { ...teaser, cover: null, enriched_at: new Date().toISOString() };
    freshly.push(p);
    teaserOk++;
    if (teaserOk <= 6) console.log(`  ✓ ${teaser.headline}\n     → ${teaser.hook.slice(0, 90)}`);
  });

  // Phase 2 — Flux covers for the freshly enriched, max 2 generations in
  // flight. One attempt + one retry; a paper whose image fails still keeps its
  // headline + hook (cover stays null).
  mkdirSync(COVERS_DIR, { recursive: true });
  let coverOk = 0;
  await mapLimit(freshly, 2, async (p) => {
    const entry = papersCache.papers[p.id];
    if (!entry || !entry.visual) return;
    let img = null;
    for (let attempt = 0; attempt < 2 && !img; attempt++) {
      try { img = await fluxCoverOnce(entry.visual, paperSeed(p.id)); } catch { /* non-200/timeout — one retry */ }
    }
    if (!img) { console.warn(`  ✗ cover failed (keeps headline+hook): ${entry.headline.slice(0, 60)}`); return; }
    const file = `${p.id}.${img.ext}`;
    writeFileSync(join(COVERS_DIR, file), img.buf);
    entry.cover = `/paper-covers/${file}`;
    coverOk++;
  });

  // Prune ids absent from this run's collectPapers() set (and delete their
  // cover files) — but only once the cache outgrows PAPERS_PRUNE_OVER, so
  // transient feed churn doesn't force expensive regeneration.
  let papersPruned = 0;
  const cachedIds = Object.keys(papersCache.papers);
  if (cachedIds.length > PAPERS_PRUNE_OVER) {
    const liveSet = new Set(collected.map((p) => p.id));
    for (const id of cachedIds) {
      if (liveSet.has(id)) continue;
      const cover = papersCache.papers[id]?.cover;
      if (cover && /^\/paper-covers\/[\w.-]+$/.test(cover)) {
        try { unlinkSync(join(COVERS_DIR, cover.split("/").pop())); } catch { /* already gone */ }
      }
      delete papersCache.papers[id];
      papersPruned++;
    }
  }

  writePapersCache(papersCache);
  console.log(`Papers: +${teaserOk} headlines/hooks, +${coverOk} covers, ${papersPruned} pruned, ${Object.keys(papersCache.papers).length} total cached → papers-enriched.json`);
}

// The papers pass is a bonus tier: any throw is logged and NEVER fails the run
// (the articles pass above already wrote enriched.json).
try {
  await runPapersPass();
} catch (err) {
  console.error(`Papers pass failed (articles pass unaffected): ${err?.message || err}`);
}
