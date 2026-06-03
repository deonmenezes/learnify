// lib/media.js — license-clean image resolution for the TechScroll feed.
//
// Decouples the displayed image from the publisher (PRD §4.0/§6): instead of
// hotlinking a publisher's copyrighted photo, every article is given a
// `media_url` WE control. Tiers (best → always-works):
//   1. AI illustration   (opt-in: TECHSCROLL_IMAGE_MODE includes "ai" + OPENAI_API_KEY)
//   2. Free-stock / CC    (opt-in: TECHSCROLL_IMAGE_MODE includes "openverse")
//   3. Editorial poster   (default, keyless, zero-cost, zero legal exposure) → /api/og
//
// Default mode is "poster": pure string-building, NO external calls — instant
// and safe at any scale. The publisher `image`/`thumbnail` are left in the
// payload for fidelity but are NEVER what the UI renders.

// Default tier is now keyless AI illustration ("gen"): a Pollinations image URL
// built per article. It's pure string-building (no call during the API request)
// — the client loads the URL and Pollinations generates+caches it — so it's as
// cheap/scalable as the poster but yields a real, license-clean image.
// Default fallback for articles WITHOUT a precomputed image: the keyless, instant,
// license-clean editorial poster. (The old "gen"/Pollinations tier is dead — it now
// returns HTTP 402.) Real CC photos are precomputed at scrape time by enrich.mjs and
// merged in feeds.js; this poster only covers the not-yet-enriched newest items.
const MODE = (process.env.TECHSCROLL_IMAGE_MODE || "poster").toLowerCase();
const AI_MAX = parseInt(process.env.TECHSCROLL_IMAGE_MAX || "40", 10); // cap external calls/request

function posterUrl(a, base = "") {
  const p = new URLSearchParams({ t: a.title || "", s: a.source || "" });
  if (a.content_type && a.content_type !== "article") p.set("k", a.content_type);
  return `${base}/api/og?${p.toString()}`;
}
function posterMedia(a, base = "") {
  return { media_url: posterUrl(a, base), media_kind: "poster", media_credit: null };
}

// Stable 0…99999 seed so an article always maps to the same generated image.
function stableSeed(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
  return h % 100000;
}

// Keyless AI illustration via Pollinations. Guardrails in the prompt (no real
// people/events, no text/logos). Returns a generated, license-clean image URL.
function genUrl(a) {
  const topic = (a.categories && a.categories[0]) || a.section || "technology";
  const prompt =
    `Editorial conceptual illustration for a ${topic} news card about "${a.title}". ` +
    `Modern flat vector, abstract and iconographic, deep green and near-black palette, ` +
    `soft glow, minimal. No text, no logos, no real or identifiable people, not a photo.`;
  const q = new URLSearchParams({
    // "turbo" generates much faster than "flux" — better for a feed of cards
    // (lower first-gen latency, fewer rate-limit misses); still cached by seed.
    width: "512", height: "320", nologo: "true", model: "turbo",
    seed: String(stableSeed(a.id || a.link || a.title)),
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 360))}?${q.toString()}`;
}
function genMedia(a) {
  return { media_url: genUrl(a), media_kind: "ai", media_credit: "AI-generated · TechScroll" };
}

// The default (no external call) media for an article — generated illustration
// unless explicitly forced to the text poster via TECHSCROLL_IMAGE_MODE=poster.
function defaultMedia(a, base = "") {
  return MODE.includes("poster") ? posterMedia(a, base) : genMedia(a);
}

async function fetchTimeout(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// CC / public-domain photo matched to the article's topic. Keyless (rate-limited);
// intended for use with a small `limit` or a scrape-time cache, not 400/request.
async function ovSearch(q) {
  if (!q) return [];
  const url = "https://api.openverse.org/v1/images/?" + new URLSearchParams({
    q, license_type: "commercial,modification", page_size: "12", mature: "false",
  });
  try {
    const r = await fetchTimeout(url, 5000, { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results || []).filter((x) => x && x.url);
  } catch { return []; }
}

async function openverseMedia(a) {
  const stop = new Set(["the","a","an","to","of","in","on","for","and","is","are","with","this","that","new","your","you","how","why","what","its","be","at","as","by","from","will","has","have"]);
  const kw = (a.title || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !stop.has(w)).slice(0, 2).join(" ");
  const topic = (a.categories && a.categories[0]) || a.section || "technology";
  // Specific (title keyword) first for variety+relevance; fall back to the broad
  // topic (high coverage) so most articles still get a real photo. The CC corpus
  // is thin for niche phrases, so the fallback matters.
  let results = await ovSearch(kw ? `${kw} ${topic}` : topic);
  if (results.length < 2) results = await ovSearch(topic);
  if (!results.length) return null;
  // Deterministically vary which result an article gets (stable per article).
  const it = results[stableSeed(a.id || a.link || a.title) % results.length];
  if (!it || !it.url) return null;
  const lic = it.license ? `${String(it.license).toUpperCase()}${it.license_version ? " " + it.license_version : ""}` : "";
  const credit = `Photo: ${it.creator || "Unknown"}${lic ? " / " + lic : ""} via ${it.provider || "Openverse"}`;
  // Prefer the larger source image; link credit to the canonical work page.
  return {
    media_url: it.url,
    media_kind: "stock",
    media_credit: credit,
    media_credit_url: it.foreign_landing_url || it.license_url || it.url,
  };
}

// AI editorial illustration. IR1 guardrails baked into the prompt (no real
// people/events, no text/logos). Opt-in. Returns a hosted URL when the provider
// gives one; if it only returns base64 (and no blob store is wired) we fall
// through to the next tier rather than inline a huge data URI.
async function aiMedia(a) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const prompt =
    `Editorial conceptual illustration for a technology news card. Theme: "${a.title}". ` +
    `Modern flat vector, dark moody palette, abstract and iconographic. ` +
    `No text, no logos, no real or identifiable people, not a photo of a real event.`;
  const r = await fetchTimeout("https://api.openai.com/v1/images/generations", 25000, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024", n: 1 }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const d = j.data && j.data[0];
  if (d && d.url) return { media_url: d.url, media_kind: "ai", media_credit: null };
  return null; // base64-only without blob storage → defer to stock/poster
}

async function resolveMedia(a, useExternal, base = "") {
  try {
    if (useExternal && MODE.includes("ai")) { const m = await aiMedia(a); if (m) return m; }
    if (useExternal && MODE.includes("openverse")) { const m = await openverseMedia(a); if (m) return m; }
  } catch { /* fall through to the default generated image */ }
  return defaultMedia(a, base);
}

// Attach { media_url, media_kind, media_credit } to each article. Poster tier is
// pure local work; external tiers are capped at AI_MAX/request to protect the
// function budget (the rest get the poster). Idempotent + cache-friendly.
export async function attachMedia(list, base = "") {
  const usesExternal = MODE.includes("ai") || MODE.includes("openverse");
  // Articles that already carry a precomputed image (real CC photo + credit from
  // enrich.mjs, merged in feeds.js) are kept as-is — never overwrite it.
  const hasMedia = (a) => typeof a.media_url === "string" && a.media_url.length > 0;
  if (!usesExternal) {
    return list.map((a) => (hasMedia(a) ? a : { ...a, ...defaultMedia(a, base) }));
  }
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    out.push(hasMedia(a) ? a : { ...a, ...(await resolveMedia(a, i < AI_MAX, base)) });
  }
  return out;
}

export { resolveMedia, posterMedia, openverseMedia };
