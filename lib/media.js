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

async function fetchTimeout(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// CC / public-domain photo matched to the article's topic. Keyless (rate-limited);
// intended for use with a small `limit` or a scrape-time cache, not 400/request.
async function openverseMedia(a) {
  const q = (a.categories && a.categories[0]) || a.section ||
    (a.title || "").split(/\s+/).slice(0, 3).join(" ");
  if (!q) return null;
  const url = "https://api.openverse.org/v1/images/?" + new URLSearchParams({
    q, license_type: "commercial,modification", page_size: "1", mature: "false",
  });
  const r = await fetchTimeout(url, 4500, { headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  const j = await r.json();
  const it = j.results && j.results[0];
  if (!it || !it.url) return null;
  const lic = it.license ? `${String(it.license).toUpperCase()}${it.license_version ? " " + it.license_version : ""}` : "";
  const credit = `Photo: ${it.creator || "Unknown"}${lic ? " / " + lic : ""} via ${it.provider || "Openverse"}`;
  return { media_url: it.url, media_kind: "stock", media_credit: credit };
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
  } catch { /* fall through to poster */ }
  return posterMedia(a, base);
}

// Attach { media_url, media_kind, media_credit } to each article. Poster tier is
// pure local work; external tiers are capped at AI_MAX/request to protect the
// function budget (the rest get the poster). Idempotent + cache-friendly.
export async function attachMedia(list, base = "") {
  const usesExternal = MODE.includes("ai") || MODE.includes("openverse");
  if (!usesExternal) return list.map((a) => ({ ...a, ...posterMedia(a, base) }));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    out.push({ ...a, ...(await resolveMedia(a, i < AI_MAX, base)) });
  }
  return out;
}

export { resolveMedia, posterMedia };
