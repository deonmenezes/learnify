// lib/bluesky.js — keyless Bluesky (AT Protocol) social collector.
//
// Bluesky's PUBLIC API needs no key and isn't aggressively rate-limited (unlike
// X's syndication endpoint), so it's a reliable second social source. We pull
// the latest posts from active, high-signal tech voices on Bluesky, score them
// for report-worthiness + sentiment (same engine as X), and merge the newsful
// ones into the feed. Voices who are inactive here (e.g. Yann LeCun, last post
// Dec 2024 — he's on X instead) simply contribute nothing via the freshness
// window; the per-handle failure is isolated.

import { scoreTweet, fmtCount } from "./newsworthy.js";

// Curated voices that ACTUALLY post tech content on Bluesky (verified active).
export const BSKY_ACCOUNTS = [
  { handle: "simonwillison.net",        name: "Simon Willison", org: "—",     weight: 7 }, // LLM/dev, very active
  { handle: "emilymbender.bsky.social", name: "Emily Bender",   org: "—",     weight: 5 }, // NLP / AI ethics
  { handle: "garymarcus.bsky.social",   name: "Gary Marcus",    org: "—",     weight: 4 }, // AI critique
  { handle: "karpathy.bsky.social",     name: "Andrej Karpathy", org: "—",    weight: 6 },
  { handle: "ylecun.bsky.social",       name: "Yann LeCun",     org: "Meta",  weight: 5 },
];

const API = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
const UA = "Mozilla/5.0 (compatible; TechScroll/1.0; +https://techscroll.app/)";
const MAX_AGE_DAYS = 21;
const PER_ACCOUNT = 5;

async function getJson(url, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function postUrl(handle, uri) {
  const rkey = (uri || "").split("/").pop();
  return rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : `https://bsky.app/profile/${handle}`;
}

function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }

function toArticle(item, acct, nowMs) {
  const post = item.post || {};
  const rec = post.record || {};
  const text = (rec.text || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const created = rec.createdAt ? new Date(rec.createdAt) : null;
  if (!created || isNaN(created.getTime())) return null;
  if (nowMs && nowMs - created.getTime() > MAX_AGE_DAYS * 864e5) return null;

  const isRepost = !!item.reason; // reposts have a `reason`
  const isReply = !!item.reply || !!rec.reply || /^@?\w[\w.-]*\s/.test(text) && /^(@|replying)/i.test(text);
  const urls = [];
  const emb = post.embed || rec.embed;
  if (emb?.external?.uri) urls.push(emb.external.uri);

  const likes = post.likeCount || 0, reposts = post.repostCount || 0, replies = post.replyCount || 0;
  const verdict = scoreTweet(text, {
    isReply, isRetweet: isRepost, lang: rec.langs?.[0] || "en",
    likes, retweets: reposts, replies, urls, hasMedia: !!emb?.images,
    accountWeight: acct.weight || 0,
  });
  if (!verdict.report_worthy) return null;

  const link = postUrl(acct.handle, post.uri);
  const title = text.length > 200 ? text.slice(0, 200).replace(/\s+\S*$/, "") + "…" : text;
  return {
    id: "bsky_" + djb2(post.uri || link),
    title, link,
    source: "Bluesky", source_id: "bluesky",
    region: "Social", focus: "Tech voices on Bluesky",
    content_type: "post",
    author: `${acct.name} · @${acct.handle}`,
    handle: acct.handle, org: acct.org, platform: "bluesky",
    published: created.toISOString(),
    image: null, thumbnail: null,
    section: verdict.category,
    categories: [...new Set(["Bluesky", acct.org, verdict.category].filter((c) => c && c !== "—"))].slice(0, 8),
    summary: text,
    is_social: true,
    report_worthy: verdict.report_worthy,
    worthiness_score: verdict.score,
    sentiment: verdict.sentiment,
    sentiment_score: verdict.sentiment_score,
    reasons: verdict.reasons,
    engagement: likes + reposts * 2 + replies,
    metrics: { likes, retweets: reposts, replies, likes_h: fmtCount(likes) },
  };
}

async function collectAccount(acct, nowMs) {
  const j = await getJson(`${API}?actor=${encodeURIComponent(acct.handle)}&limit=20&filter=posts_no_replies`);
  const arts = [];
  for (const item of j.feed || []) {
    const a = toArticle(item, acct, nowMs);
    if (a) arts.push(a);
  }
  arts.sort((a, b) => b.published.localeCompare(a.published));
  return arts.slice(0, PER_ACCOUNT);
}

/** Collect report-worthy posts from tech voices on Bluesky. Keyless + reliable. */
export async function collectBluesky(nowMs = Date.now()) {
  const results = await Promise.allSettled(BSKY_ACCOUNTS.map((a) => collectAccount(a, nowMs)));
  const ok = [];
  const byId = new Map();
  results.forEach((r, i) => {
    if (r.status !== "fulfilled" || !r.value.length) return;
    ok.push(BSKY_ACCOUNTS[i].handle);
    for (const a of r.value) if (!byId.has(a.id)) byId.set(a.id, a);
  });
  const articles = [...byId.values()].sort((a, b) => b.published.localeCompare(a.published));
  return { ok, articles };
}
