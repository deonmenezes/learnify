// lib/x.js — keyless "X / social" collector for TechScroll.
//
// Pulls the latest posts from a curated set of major tech voices (Sam Altman,
// Anthropic, Claude, NVIDIA, Claude devs) and turns the *report-worthy* ones
// into normalised feed items that slot into the same schema as the RSS/WP
// articles. Every item is run through lib/newsworthy.js so banter, replies and
// "gm" never reach the news feed — only posts that read like actual news.
//
// Data source: Twitter/X's public **syndication timeline** endpoint
// (`syndication.twitter.com/srv/timeline-profile/screen-name/<handle>`). This
// is the same no-auth widget feed embeds use — no API keys, no scraping
// platform, no login. We parse the `__NEXT_DATA__` JSON it ships. If a handle
// is unavailable the rest still load (Promise.allSettled).

import { scoreTweet, fmtCount } from "./newsworthy.js";
import { readFileSync } from "node:fs";

// Curated top tech voices on X. `weight` nudges the newsworthiness baseline
// (org accounts post real news more reliably than a personal account's stray
// musings). `core: true` = fetched LIVE on every request (a small, fast,
// rate-limit-safe set of the most newsful orgs); the rest are pulled by the
// hourly snapshot cron (sequential, gentle on X's per-IP limit) and unioned in,
// so the feed gets broad "top voices" coverage without 18 live fetches/request.
export const X_ACCOUNTS = [
  // --- core (fetched live) ---
  { handle: "AnthropicAI",  name: "Anthropic",        org: "Anthropic", weight: 10, core: true },
  { handle: "claudeai",     name: "Claude",           org: "Anthropic", weight: 10, core: true },
  { handle: "OpenAI",       name: "OpenAI",           org: "OpenAI",    weight: 10, core: true },
  { handle: "nvidia",       name: "NVIDIA",           org: "NVIDIA",    weight: 9,  core: true },
  { handle: "GoogleDeepMind", name: "Google DeepMind", org: "Google",   weight: 9,  core: true },
  { handle: "sama",         name: "Sam Altman",       org: "OpenAI",    weight: 5,  core: true },
  // --- extended top voices (via hourly snapshot, unioned in) ---
  { handle: "elonmusk",     name: "Elon Musk",        org: "xAI/Tesla", weight: 3 },
  { handle: "sundarpichai", name: "Sundar Pichai",    org: "Google",    weight: 6 },
  { handle: "satyanadella", name: "Satya Nadella",    org: "Microsoft", weight: 7 },
  { handle: "demishassabis", name: "Demis Hassabis",  org: "Google",    weight: 7 },
  { handle: "ylecun",       name: "Yann LeCun",       org: "Meta",      weight: 5 },
  { handle: "karpathy",     name: "Andrej Karpathy",  org: "—",         weight: 6 },
  { handle: "gdb",          name: "Greg Brockman",    org: "OpenAI",    weight: 6 },
  { handle: "AIatMeta",     name: "AI at Meta",       org: "Meta",      weight: 8 },
  { handle: "googleresearch", name: "Google Research", org: "Google",   weight: 8 },
  { handle: "OfficialLoganK", name: "Logan Kilpatrick", org: "Google",  weight: 5 },
  { handle: "NVIDIAAI",     name: "NVIDIA AI",        org: "NVIDIA",    weight: 9 },
  { handle: "alexalbert__", name: "Alex Albert",      org: "Anthropic", weight: 5 },
];

const SYND = "https://syndication.twitter.com/srv/timeline-profile/screen-name/";
const UA = "Mozilla/5.0 (compatible; TechScroll/1.0; +https://techscroll.app/)";
const MAX_AGE_DAYS = 21;      // "latest news" window; drops pinned/old tweets
const PER_ACCOUNT = 6;        // most-recent report-worthy posts kept per voice
const NOW_MS_DEFAULT = null;  // resolved per-request; see collectX(nowMs)

async function getHtmlOnce(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: ctrl.signal,
    });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
    return await res.text();
  } finally { clearTimeout(t); }
}

// One gentle retry on 429 (X rate-limits per-IP). Deterministic backoff (no
// Math.random) so behaviour is reproducible.
async function getHtml(url, ms = 12000) {
  try {
    return await getHtmlOnce(url, ms);
  } catch (e) {
    if (e.status === 429) {
      await new Promise((r) => setTimeout(r, 800));
      return await getHtmlOnce(url, ms);
    }
    throw e;
  }
}

// Pull the embedded Next.js data blob and dig out the timeline tweets.
export function parseTimeline(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  const entries = data?.props?.pageProps?.timeline?.entries;
  if (!Array.isArray(entries)) return [];
  const tweets = [];
  for (const e of entries) {
    const tw = e?.content?.tweet;
    if (tw && tw.id_str) tweets.push(tw);
  }
  return tweets;
}

function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Twitter ships "Mon Feb 10 21:11:04 +0000 2025" — Date can parse it directly.
function parseDate(s) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Strip the trailing t.co media/quote link and collapse whitespace so the text
// reads like a headline, then expand t.co links to their display form.
function cleanTweetText(tw) {
  let text = tw.full_text || tw.text || "";
  const urls = (tw.entities && tw.entities.urls) || [];
  for (const u of urls) {
    if (u.url && u.display_url) text = text.split(u.url).join(u.expanded_url || `https://${u.display_url}`);
  }
  // Drop a dangling media link (pic.twitter / t.co at the very end).
  text = text.replace(/\s*https?:\/\/t\.co\/\w+\s*$/i, "");
  text = text.replace(/\s*pic\.twitter\.com\/\w+\s*$/i, "");
  return text.replace(/\s+/g, " ").trim();
}

// A tweet → a feed "article" (or null if not report-worthy / too old).
export function toArticle(tw, acct, nowMs) {
  const created = parseDate(tw.created_at);
  if (!created) return null;
  if (nowMs && nowMs - created.getTime() > MAX_AGE_DAYS * 864e5) return null;

  const isReply = !!(tw.in_reply_to_screen_name || tw.in_reply_to_status_id_str ||
    /^@\w/.test(tw.full_text || tw.text || ""));
  const isRetweet = /^RT @/.test(tw.full_text || tw.text || "") || !!tw.retweeted_status;
  const isQuote = !!tw.quoted_tweet || !!tw.is_quote_status;
  const urls = ((tw.entities && tw.entities.urls) || []).map((u) => u.expanded_url || u.url).filter(Boolean);
  const hasMedia = !!(tw.entities && tw.entities.media && tw.entities.media.length) ||
    !!(tw.extended_entities && tw.extended_entities.media);

  const text = cleanTweetText(tw);
  if (!text) return null;

  const verdict = scoreTweet(text, {
    isReply, isRetweet, isQuote,
    lang: tw.lang,
    likes: tw.favorite_count || 0,
    retweets: tw.retweet_count || 0,
    replies: tw.reply_count || 0,
    urls, hasMedia,
    accountWeight: acct.weight || 0,
  });

  if (!verdict.report_worthy) return null;

  const handle = acct.handle;
  const link = `https://x.com/${handle}/status/${tw.id_str}`;
  // Headline-style title: keep it tight, sentence-cased source attribution.
  const title = text.length > 200 ? text.slice(0, 200).replace(/\s+\S*$/, "") + "…" : text;

  const cats = ["X", acct.org, verdict.category].filter(Boolean);
  // surface a couple of hashtags as keywords too
  for (const h of (tw.entities && tw.entities.hashtags) || []) {
    if (h.text) cats.push(h.text);
  }

  return {
    id: "x_" + tw.id_str,
    title,
    link,
    source: "X",
    source_id: "x",
    region: "Social",
    focus: "Tech personalities on X",
    content_type: "post",
    author: `${acct.name} · @${handle}`,
    handle,
    org: acct.org,
    published: created.toISOString(),
    image: null,
    thumbnail: null,
    section: verdict.category,
    categories: [...new Set(cats)].slice(0, 10),
    summary: text,
    // social / newsworthiness metadata (consumed by the UI)
    is_social: true,
    report_worthy: verdict.report_worthy,
    worthiness_score: verdict.score,
    sentiment: verdict.sentiment,
    sentiment_score: verdict.sentiment_score,
    reasons: verdict.reasons,
    metrics: {
      likes: tw.favorite_count || 0,
      retweets: tw.retweet_count || 0,
      replies: tw.reply_count || 0,
      likes_h: fmtCount(tw.favorite_count || 0),
    },
  };
}

async function collectAccount(acct, nowMs) {
  const tweets = parseTimeline(await getHtml(SYND + encodeURIComponent(acct.handle)));
  const arts = [];
  for (const tw of tweets) {
    const a = toArticle(tw, acct, nowMs);
    if (a) arts.push(a);
  }
  // newest first, keep the top few report-worthy per voice
  arts.sort((a, b) => b.published.localeCompare(a.published));
  return arts.slice(0, PER_ACCOUNT);
}

// Committed snapshot so the social tier degrades gracefully when X rate-limits
// (429) the function IP. Regenerate with `node scripts/snapshot-x.mjs`.
function readSnapshot(nowMs) {
  try {
    const raw = readFileSync(new URL("../x-snapshot.json", import.meta.url), "utf-8");
    const j = JSON.parse(raw);
    const arts = Array.isArray(j.articles) ? j.articles : [];
    return arts.filter((a) => a && a.published &&
      (!nowMs || nowMs - new Date(a.published).getTime() <= MAX_AGE_DAYS * 864e5));
  } catch { return []; }
}

const MERGED_MAX = 32; // cap the social tier (broader voice set → a bit higher)

/**
 * Collect report-worthy posts across all curated voices.
 *
 * Live syndication is unioned on top of the committed snapshot (live wins per
 * tweet id). This means a *partial* live success (X often rate-limits the
 * function IP and only a couple of handles get through) is never worse than the
 * snapshot — we keep the snapshot's coverage and layer any fresher posts on
 * top. `stale` is true only when live contributed nothing.
 *
 * @param {number} [nowMs] current epoch ms (for the freshness window). Defaults to Date.now().
 * @param {object} [opts]  { sequential, delayMs } — fetch handles one-by-one with
 *   a delay instead of all at once. Gentler on X's per-IP rate limit; used by the
 *   snapshot cron (CI) where latency doesn't matter. Live API stays concurrent.
 * @returns {Promise<{ ok:string[], articles:object[], stale:boolean }>}
 */
export async function collectX(nowMs = (NOW_MS_DEFAULT ?? Date.now()), opts = {}) {
  const live = [];
  const liveHandles = [];

  if (opts.sequential) {
    // Snapshot cron: fetch ALL voices one-by-one (broad coverage, no 429).
    const delay = opts.delayMs ?? 2500;
    for (let i = 0; i < X_ACCOUNTS.length; i++) {
      const acct = X_ACCOUNTS[i];
      try {
        const arts = await collectAccount(acct, nowMs);
        if (arts.length) { liveHandles.push(acct.handle); live.push(...arts); }
      } catch { /* skip this handle, keep going */ }
      if (i < X_ACCOUNTS.length - 1) await new Promise((r) => setTimeout(r, delay));
    }
  } else {
    // Live request: only the core orgs (fast + rate-limit-safe). The rest of the
    // top voices arrive via the hourly snapshot, unioned below.
    const coreAccts = X_ACCOUNTS.filter((a) => a.core);
    const results = await Promise.allSettled(coreAccts.map((a) => collectAccount(a, nowMs)));
    results.forEach((r, i) => {
      if (r.status !== "fulfilled" || !r.value.length) return;
      liveHandles.push(coreAccts[i].handle);
      live.push(...r.value);
    });
  }

  // Snapshot is the baseline; live overrides/extends it by tweet id.
  const byId = new Map();
  for (const a of readSnapshot(nowMs)) byId.set(a.id, a);
  for (const a of live) byId.set(a.id, a);

  // "Hot" = highest engagement. Tag the top posts so the UI/API can surface the
  // hottest tech news on X regardless of recency, and attach an engagement score.
  const all = [...byId.values()].map((a) => ({
    ...a,
    engagement: (a.metrics?.likes || 0) + (a.metrics?.retweets || 0) * 2 + (a.metrics?.replies || 0),
  }));
  const hotIds = new Set([...all].sort((a, b) => b.engagement - a.engagement).slice(0, 8).map((a) => a.id));
  const articles = all
    .map((a) => ({ ...a, hot: hotIds.has(a.id) }))
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, MERGED_MAX);
  const ok = [...new Set([...liveHandles, ...articles.map((a) => a.handle)])].filter(Boolean);
  return { ok, articles, stale: live.length === 0 };
}
