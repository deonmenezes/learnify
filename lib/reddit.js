// lib/reddit.js — keyless Reddit collector for Learnify.
//
// Pulls the TOP posts of the week from a curated set of high-signal subreddits
// and turns the substantive ones into normalised feed items that slot into the
// same schema as the RSS/X/Bluesky articles. Unlike the tech-tuned X scorer,
// Reddit items are tagged by their SUBREDDIT's category — so niche community
// knowledge (Fitness, Skincare, Nutrition, Longevity) survives instead of being
// filtered out by a tech-news lexicon, and the "/top/?t=week" listing means we
// only ever surface posts the community already voted up.
//
// Data source: Reddit's PUBLIC Atom feed (no auth, no API key):
//   https://www.reddit.com/r/<sub>/top.rss?t=week&limit=25
// Reddit 403s its `.json` API to automated/datacenter IPs but still serves the
// `.rss` feed to a descriptive User-Agent. Like the X tier, a small CORE set is
// fetched LIVE per request (fast, rate-limit-safe) and the rest arrive via the
// snapshot cron (sequential, gentle on Reddit's per-IP limit), unioned in.

// Curated subreddits → app NewsCategory rawValue (`cat`) + finer `genre`.
// `core: true` = fetched live each request (one per major category to bound
// latency); the rest are pulled by `scripts/snapshot-reddit.mjs` and unioned in.
// These span ALL 9 app categories so every category — including Fitness &
// Skincare — gets fresh community knowledge.
export const REDDIT_SUBS = [
  // --- AI / ML ---
  { sub: "MachineLearning", cat: "AI / ML", genre: "AI & Tech", core: true },
  { sub: "LocalLLaMA",      cat: "AI / ML", genre: "AI & Tech" },
  { sub: "artificial",      cat: "AI / ML", genre: "AI & Tech" },
  { sub: "singularity",     cat: "AI / ML", genre: "AI & Tech" },
  // --- Coding & Dev Tools ---
  { sub: "programming",     cat: "Coding & Dev Tools", genre: "Coding & Dev Tools", core: true },
  // --- Science ---
  { sub: "science",         cat: "Science", genre: "Science", core: true },
  { sub: "Futurology",      cat: "Science", genre: "Science" },
  { sub: "longevity",       cat: "Science", genre: "Longevity" },
  // --- Fitness (+ nutrition rides Fitness in-app) ---
  { sub: "Fitness",            cat: "Fitness", genre: "Fitness", core: true },
  { sub: "bodyweightfitness", cat: "Fitness", genre: "Fitness" },
  { sub: "running",           cat: "Fitness", genre: "Fitness" },
  { sub: "nutrition",         cat: "Fitness", genre: "Nutrition" },
  // --- Skincare ---
  { sub: "SkincareAddiction", cat: "Skincare", genre: "Skincare", core: true },
  // --- Security ---
  { sub: "cybersecurity",  cat: "Security", genre: "Security", core: true },
  { sub: "netsec",         cat: "Security", genre: "Security" },
  // --- Hardware & Gadgets ---
  { sub: "gadgets",        cat: "Hardware & Gadgets", genre: "Hardware & Gadgets" },
  { sub: "hardware",       cat: "Hardware & Gadgets", genre: "Hardware & Gadgets" },
  // --- Robotics ---
  { sub: "robotics",       cat: "Robotics", genre: "Robotics" },
  // --- Startups & Funding (money rides here) ---
  { sub: "startups",       cat: "Startups & Funding", genre: "Finance" },
  { sub: "investing",      cat: "Startups & Funding", genre: "Finance" },
];

const UA = "Mozilla/5.0 (compatible; Learnify/1.0; +https://techscroll.app/)";
const MAX_AGE_DAYS = 14;   // "latest knowledge" window
const PER_SUB = 4;         // top posts kept per subreddit
const MERGED_MAX = 36;     // cap the Reddit tier overall

// Recurring mod/sticky/daily-thread titles that ride the "top of week" listing
// but carry no real knowledge — drop them.
const RECURRING = /\b(daily|weekly|moronic monday|victory sunday|gym story|simple questions|rate my plate|physique phriday|training tuesday|megathread|free talk|community feedback|read before posting|official discussion|what are you working on|who'?s hiring)\b/i;

function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }

async function getTextOnce(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/atom+xml, application/xml, text/xml" }, signal: ctrl.signal });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return await r.text();
  } finally { clearTimeout(t); }
}

// One gentle retry on 429 (Reddit rate-limits per-IP). Deterministic backoff.
async function getText(url, ms = 12000) {
  try { return await getTextOnce(url, ms); }
  catch (e) {
    if (e.status === 429) { await new Promise((r) => setTimeout(r, 900)); return await getTextOnce(url, ms); }
    throw e;
  }
}

const unescape = (s) => (s || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'").replace(/&#32;/g, " ").replace(/&amp;/g, "&");

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
};

// Parse a Reddit Atom feed into entry objects.
export function parseAtom(xml) {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map((e) => {
    const linkM = e.match(/<link[^>]*href="([^"]+)"/);
    const authM = e.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/);
    const content = unescape(tag(e, "content"));
    const imgM = content.match(/<img[^>]*src="([^"]+)"/);
    return {
      id: tag(e, "id"),
      title: unescape(tag(e, "title")).replace(/\s+/g, " ").trim(),
      link: linkM ? linkM[1] : "",
      published: tag(e, "published") || tag(e, "updated"),
      author: authM ? authM[1].replace(/^\/u\//, "") : "",
      image: imgM && /^https?:\/\//i.test(imgM[1]) ? imgM[1].replace(/&amp;/g, "&") : null,
      contentText: content.replace(/<[^>]+>/g, " ").replace(/\s*\bsubmitted by\b[\s\S]*$/i, "").replace(/\s+/g, " ").trim(),
    };
  });
}

// One Reddit entry → a feed "article" (or null if recurring/too old/too thin).
export function toArticle(entry, acct, nowMs) {
  const title = entry.title;
  if (!title || title.length < 15) return null;
  if (RECURRING.test(title)) return null;

  const created = entry.published ? new Date(entry.published) : null;
  if (!created || isNaN(created.getTime())) return null;
  if (nowMs && nowMs - created.getTime() > MAX_AGE_DAYS * 864e5) return null;

  const link = entry.link || `https://www.reddit.com/r/${acct.sub}`;
  const body = entry.contentText && entry.contentText.length > 30 ? entry.contentText : "";
  const summary = body ? (body.length > 320 ? body.slice(0, 320).replace(/\s+\S*$/, "") + "…" : body) : title;

  return {
    id: "reddit_" + (entry.id?.replace(/^t3_/, "") || djb2(link)),
    title,
    link,
    source: "Reddit",
    source_id: "reddit",
    region: "Community",
    focus: `r/${acct.sub} · community knowledge`,
    content_type: "post",
    author: `u/${entry.author || "reddit"} · r/${acct.sub}`,
    handle: acct.sub,
    org: `r/${acct.sub}`,
    platform: "reddit",
    published: created.toISOString(),
    image: entry.image,
    thumbnail: entry.image,
    // Category routing: the app NewsCategory rawValue + a finer genre.
    section: acct.cat,
    category: acct.cat,
    genre: acct.genre,
    categories: [...new Set(["Reddit", acct.cat, acct.genre, `r/${acct.sub}`].filter(Boolean))].slice(0, 8),
    summary,
    is_social: true,
    report_worthy: true,           // "top of week" ⇒ community already vetted it
    worthiness_score: 62,          // steady tier; ordering within a sub is by rank
    sentiment: "neutral",
    sentiment_score: 0,
    reasons: [`top of r/${acct.sub} this week`],
    metrics: { likes: 0, retweets: 0, replies: 0 },
  };
}

async function collectSub(acct, nowMs) {
  const xml = await getText(`https://www.reddit.com/r/${acct.sub}/top.rss?t=week&limit=25`);
  const arts = [];
  for (const entry of parseAtom(xml)) {
    const a = toArticle(entry, acct, nowMs);
    if (a) arts.push(a);
    if (arts.length >= PER_SUB) break; // RSS is already top-ranked order
  }
  return arts;
}

import { readFileSync } from "node:fs";

// Committed snapshot so the Reddit tier has broad coverage without 20 live
// fetches/request. Regenerate with `node scripts/snapshot-reddit.mjs`.
function readSnapshot(nowMs) {
  try {
    const j = JSON.parse(readFileSync(new URL("../reddit-snapshot.json", import.meta.url), "utf-8"));
    const arts = Array.isArray(j.articles) ? j.articles : [];
    return arts.filter((a) => a && a.published &&
      (!nowMs || nowMs - new Date(a.published).getTime() <= MAX_AGE_DAYS * 864e5));
  } catch { return []; }
}

/**
 * Collect top posts across the curated subreddits. Keyless + isolated: a sub
 * that 403s/times out contributes nothing and never sinks the tier.
 * @param {number} [nowMs] current epoch ms (freshness window). Defaults to Date.now().
 * @param {object} [opts]  { sequential, delayMs } — fetch ALL subs one-by-one
 *   (broad coverage, gentle on Reddit's per-IP limit); used by the snapshot cron.
 * @returns {Promise<{ ok:string[], articles:object[], stale:boolean }>}
 */
export async function collectReddit(nowMs = Date.now(), opts = {}) {
  const live = [];
  const okSubs = [];

  if (opts.sequential) {
    const delay = opts.delayMs ?? 1500;
    for (let i = 0; i < REDDIT_SUBS.length; i++) {
      const acct = REDDIT_SUBS[i];
      try {
        const arts = await collectSub(acct, nowMs);
        if (arts.length) { okSubs.push(acct.sub); live.push(...arts); }
      } catch { /* skip this sub, keep going */ }
      if (i < REDDIT_SUBS.length - 1) await new Promise((r) => setTimeout(r, delay));
    }
  } else {
    // Live request: only the core subs. Reddit 429s a burst of parallel fetches,
    // so go in small batches (concurrency 2) with a short stagger — fast enough
    // for a cached endpoint, gentle enough that most core subs get through. The
    // rest of the subreddits arrive via the snapshot cron, unioned below.
    const coreSubs = REDDIT_SUBS.filter((a) => a.core);
    for (let i = 0; i < coreSubs.length; i += 2) {
      const batch = coreSubs.slice(i, i + 2);
      const results = await Promise.allSettled(batch.map((a) => collectSub(a, nowMs)));
      results.forEach((r, j) => {
        if (r.status !== "fulfilled" || !r.value.length) return;
        okSubs.push(batch[j].sub);
        live.push(...r.value);
      });
      if (i + 2 < coreSubs.length) await new Promise((r) => setTimeout(r, 350));
    }
  }

  // Snapshot is the baseline; live overrides/extends it by post id.
  const byId = new Map();
  for (const a of readSnapshot(nowMs)) byId.set(a.id, a);
  for (const a of live) byId.set(a.id, a);

  const articles = [...byId.values()]
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, MERGED_MAX);
  const ok = [...new Set([...okSubs, ...articles.map((a) => a.handle)])].filter(Boolean);
  return { ok, articles, stale: live.length === 0 };
}
