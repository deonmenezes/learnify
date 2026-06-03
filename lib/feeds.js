// Multi-source TechScroll collector — Silicon Valley / SF tech news.
//
// Aggregates several outlets into one normalised, fully-labelled feed. Every
// article carries: source, source_id, region, focus, content_type, id, plus
// title/link/author/published/image/thumbnail/section/categories/summary.
//
// WordPress outlets are pulled from their REST API (`_fields`-trimmed) so each
// post is tiny and arrives with its featured image + keyword slugs. RSS/Atom
// outlets are parsed directly with image extraction (media:content,
// media:thumbnail, enclosure, or first <img> in the content). No scraping
// platform, no API keys.

// Vetted, reliable tech sources across every field — startups/VC, consumer
// gadgets, AI, enterprise, Apple/Android, deep tech, science, dev/HN, and
// global. Each was health-checked (HTTP 200 + parseable items). WordPress
// outlets come through their REST API (richer: featured image + category
// slugs); everyone else through RSS/Atom. All fetched in parallel; any single
// outlet failing never sinks the feed.
export const SOURCES = [
  // --- startups / VC / Valley ---
  { id: "techcrunch",   name: "TechCrunch",        region: "SF Bay Area",    focus: "Startups & VC",
    type: "wp",  url: "https://techcrunch.com/wp-json/wp/v2/posts", pages: 2 },
  { id: "siliconvalley", name: "SiliconValley.com", region: "Silicon Valley", focus: "Valley business & tech",
    type: "wp",  url: "https://www.siliconvalley.com/wp-json/wp/v2/posts", pages: 1 },
  { id: "venturebeat",  name: "VentureBeat",       region: "National",       focus: "Enterprise & AI",
    type: "rss", url: "https://venturebeat.com/feed/" },
  { id: "thenextweb",   name: "The Next Web",      region: "Global",         focus: "Startups & tech culture",
    type: "rss", url: "https://thenextweb.com/feed" },
  // --- consumer tech / gadgets ---
  { id: "wired",        name: "Wired",             region: "San Francisco",  focus: "Tech, science & culture",
    type: "rss", url: "https://www.wired.com/feed/rss" },
  { id: "theverge",     name: "The Verge",         region: "National",       focus: "Consumer tech",
    type: "rss", url: "https://www.theverge.com/rss/index.xml" },
  { id: "engadget",     name: "Engadget",          region: "National",       focus: "Consumer electronics",
    type: "rss", url: "https://www.engadget.com/rss.xml" },
  { id: "techradar",    name: "TechRadar",         region: "Global",         focus: "Reviews & buying",
    type: "rss", url: "https://www.techradar.com/rss" },
  { id: "gizmodo",      name: "Gizmodo",           region: "National",       focus: "Tech & science",
    type: "rss", url: "https://gizmodo.com/rss" },
  // --- deep tech / policy / AI ---
  { id: "arstechnica",  name: "Ars Technica",      region: "National",       focus: "Deep tech & policy",
    type: "rss", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { id: "mittech",      name: "MIT Tech Review",   region: "National",       focus: "Deep tech & AI",
    type: "rss", url: "https://www.technologyreview.com/feed/" },
  { id: "ieee",         name: "IEEE Spectrum",     region: "National",       focus: "Engineering & research",
    type: "rss", url: "https://spectrum.ieee.org/feeds/feed.rss" },
  // --- platforms: Apple / Android ---
  { id: "9to5mac",      name: "9to5Mac",           region: "National",       focus: "Apple",
    type: "rss", url: "https://9to5mac.com/feed/" },
  { id: "macrumors",    name: "MacRumors",         region: "National",       focus: "Apple",
    type: "rss", url: "https://feeds.macrumors.com/MacRumors-All" },
  { id: "androidpolice", name: "Android Police",   region: "National",       focus: "Android",
    type: "rss", url: "https://www.androidpolice.com/feed/" },
  // --- dev / breaking / global / science ---
  { id: "hackernews",   name: "Hacker News",       region: "Global",         focus: "Dev & breaking",
    type: "rss", url: "https://hnrss.org/frontpage" },
  { id: "restofworld",  name: "Rest of World",     region: "Global",         focus: "Global tech",
    type: "rss", url: "https://restofworld.org/feed/latest/" },
  { id: "quanta",       name: "Quanta",            region: "National",       focus: "Science & math",
    type: "rss", url: "https://www.quantamagazine.org/feed/" },
  { id: "sciencedaily", name: "ScienceDaily",      region: "National",       focus: "Computing research",
    type: "rss", url: "https://www.sciencedaily.com/rss/computers_math.xml" },
];

const WP_FIELDS = "id,date_gmt,link,title,excerpt,jetpack_featured_media_url,class_list,yoast_head_json";
const WP_PER_PAGE = 100;
const RSS_MAX = 30;
const UA = "Mozilla/5.0 (compatible; TechScroll/1.0; +https://techscroll.app/)";

// ---- label / text helpers --------------------------------------------------
const ACRONYMS = new Set([
  "ai","api","ar","vr","xr","ev","evs","ipo","ico","saas","gpu","cpu","ml",
  "llm","llms","ux","ui","us","usa","uk","eu","uae","ceo","cto","cfo","ftc",
  "sec","fcc","nasa","ces","b2b","b2c","sdk","vc","vcs","nft","nfts","5g",
  "6g","aws","roi","iot","vpn",
]);
const BRANDS = {
  openai:"OpenAI", chatgpt:"ChatGPT", github:"GitHub", youtube:"YouTube",
  tiktok:"TikTok", iphone:"iPhone", ipad:"iPad", macos:"macOS", ios:"iOS",
  deepmind:"DeepMind", paypal:"PayPal", linkedin:"LinkedIn", wechat:"WeChat",
  spacex:"SpaceX", whatsapp:"WhatsApp", deepseek:"DeepSeek", xai:"xAI",
  anthropic:"Anthropic", nvidia:"Nvidia",
};
export function prettify(slug) {
  if (BRANDS[slug]) return BRANDS[slug];
  return slug.split("-").map((w) => {
    if (/^\d+$/.test(w)) return "";
    if (BRANDS[w]) return BRANDS[w];
    if (ACRONYMS.has(w)) return w.toUpperCase();
    return w ? w[0].toUpperCase() + w.slice(1) : "";
  }).filter(Boolean).join(" ");
}

const ENTITIES = {
  "&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#039;":"'","&#39;":"'",
  "&apos;":"'","&nbsp;":" ","&#8217;":"’","&#8216;":"‘","&#8220;":"“",
  "&#8221;":"”","&#8211;":"–","&#8212;":"—","&#8230;":"…","&#038;":"&","&hellip;":"…",
};
function unescapeHtml(s) {
  if (!s) return "";
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;|&#0?39;/gi, (m) => ENTITIES[m] || m);
}
function stripCdata(s) {
  const m = (s || "").trim().match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (m ? m[1] : s || "").trim();
}
function cleanText(raw, limit = 320) {
  let t = unescapeHtml(stripCdata(raw || "")).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  t = t.replace(/Read full article[\s\S]*$/i, "").replace(/Comments$/i, "").trim();
  if (t.length > limit) t = t.slice(0, limit).replace(/\s+\S*$/, "") + "…";
  return t;
}

// Card-sized crop. Harmless on CDNs that ignore unknown query params; resizes on
// Photon/imgix-style CDNs (TechCrunch, SiliconValley, Verge, Wired).
export function thumbnail(url, w = 420, h = 260) {
  if (!url) return null;
  return url + (url.includes("?") ? "&" : "?") + `w=${w}&h=${h}&crop=1`;
}
function contentType(link) {
  if (/\/video[\/-]/.test(link)) return "video";
  if (/\/podcast|\/episode/.test(link)) return "podcast";
  return "article";
}
function shortId(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function label(src, art) {
  art.source = src.name;
  art.source_id = src.id;
  art.region = src.region;
  art.focus = src.focus;
  art.id = shortId(art.link);
  art.content_type = contentType(art.link);
  art.thumbnail = thumbnail(art.image);
  if (!art.section) art.section = (art.categories && art.categories[0]) || src.focus;
  return art;
}

// ---- fetch -----------------------------------------------------------------
async function getJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
async function getText(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

// ---- WordPress REST --------------------------------------------------------
function parseWpPost(p, src) {
  const link = (p.link || "").trim();
  const title = cleanText(p.title?.rendered || "", 300);
  if (!link || !title) return null;
  const yoast = p.yoast_head_json || {};
  let image = (p.jetpack_featured_media_url || "").trim();
  if (!image && Array.isArray(yoast.og_image) && yoast.og_image[0]?.url) {
    image = yoast.og_image[0].url.split("?")[0];
  }
  const cats = [], tags = [];
  for (const c of p.class_list || []) {
    if (c.startsWith("category-")) cats.push(prettify(c.slice(9)));
    else if (c.startsWith("tag-")) tags.push(prettify(c.slice(4)));
  }
  let published = "";
  if (p.date_gmt) {
    const d = new Date(p.date_gmt + "Z");
    if (!isNaN(d.getTime())) published = d.toISOString();
  }
  return label(src, {
    title, link,
    author: (yoast.author || "").trim(),
    published,
    image: image || null,
    section: cats[0] || "",
    categories: [...new Set([...cats, ...tags])].filter(Boolean),
    summary: cleanText(p.excerpt?.rendered || ""),
  });
}
async function collectWp(src) {
  const pages = await Promise.allSettled(
    Array.from({ length: src.pages || 1 }, (_, i) =>
      getJson(`${src.url}?per_page=${WP_PER_PAGE}&page=${i + 1}&_fields=${encodeURIComponent(WP_FIELDS)}&orderby=date&order=desc`))
  );
  const out = [];
  for (const r of pages) {
    if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
    for (const p of r.value) { const a = parseWpPost(p, src); if (a) out.push(a); }
  }
  return out;
}

// ---- RSS / Atom ------------------------------------------------------------
function extractImage(block) {
  let m = block.match(/<media:content[^>]*\burl="([^"]+)"/i);
  if (m && /\.(jpe?g|png|webp|gif|avif)/i.test(m[1])) return m[1];
  m = block.match(/<media:thumbnail[^>]*\burl="([^"]+)"/i);
  if (m) return m[1];
  m = block.match(/<enclosure[^>]*\burl="([^"]+)"[^>]*type="image[^"]*"/i)
   || block.match(/<enclosure[^>]*type="image[^"]*"[^>]*\burl="([^"]+)"/i);
  if (m) return m[1];
  const html =
    (block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i) || [])[1] ||
    (block.match(/<content\b[^>]*>([\s\S]*?)<\/content>/i) || [])[1] ||
    (block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] ||
    (block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i) || [])[1] || "";
  m = unescapeHtml(stripCdata(html)).match(/<img[^>]*\bsrc="([^"]+)"/i);
  return m ? m[1] : null;
}
function parseFeed(xml, src) {
  const isAtom = /<entry[\s>]/.test(xml) && !/<item[\s>]/.test(xml);
  const blockRe = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/g : /<item[\s>][\s\S]*?<\/item>/g;
  const blocks = xml.match(blockRe) || [];
  const out = [];
  for (const b of blocks.slice(0, RSS_MAX)) {
    const f = (re) => { const m = b.match(re); return m ? stripCdata(m[1]) : ""; };
    const title = unescapeHtml(f(/<title\b[^>]*>([\s\S]*?)<\/title>/)).trim();
    let link;
    if (isAtom) {
      link = (b.match(/<link[^>]*\brel="alternate"[^>]*\bhref="([^"]+)"/i)
           || b.match(/<link[^>]*\bhref="([^"]+)"/i) || [])[1] || "";
    } else {
      link = f(/<link>([\s\S]*?)<\/link>/);
    }
    link = unescapeHtml(link).trim();
    if (!title || !link) continue;
    const author = unescapeHtml(
      f(/<dc:creator>([\s\S]*?)<\/dc:creator>/) ||
      (b.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/i) || [])[1] ||
      f(/<author>([\s\S]*?)<\/author>/)
    ).trim();
    const categories = [];
    if (isAtom) {
      let m; const cr = /<category[^>]*\bterm="([^"]+)"/gi;
      while ((m = cr.exec(b))) categories.push(unescapeHtml(m[1]));
    } else {
      let m; const cr = /<category>([\s\S]*?)<\/category>/g;
      while ((m = cr.exec(b))) categories.push(unescapeHtml(stripCdata(m[1])));
    }
    const dateRaw = f(/<pubDate>([\s\S]*?)<\/pubDate>/) ||
      f(/<published>([\s\S]*?)<\/published>/) || f(/<updated>([\s\S]*?)<\/updated>/);
    const d = new Date(dateRaw);
    const summaryRaw = f(/<description>([\s\S]*?)<\/description>/) ||
      f(/<summary\b[^>]*>([\s\S]*?)<\/summary>/) || f(/<content\b[^>]*>([\s\S]*?)<\/content>/);
    out.push(label(src, {
      title, link, author,
      published: isNaN(d.getTime()) ? "" : d.toISOString(),
      image: extractImage(b),
      section: categories[0] || "",
      categories: [...new Set(categories)].slice(0, 12),
      summary: cleanText(summaryRaw),
    }));
  }
  return out;
}
async function collectFeed(src) {
  return parseFeed(await getText(src.url), src);
}

// ---- de-duplication --------------------------------------------------------
// "No repeated articles": two outlets routinely run the same wire story under
// near-identical headlines. We collapse them with a title fingerprint — strip
// to significant words so "Apple unveils M5 chip" and "Apple Unveils the M5
// Chip!" map to the same key — on top of the exact-link/id key.
const STOP = new Set([
  "the","a","an","of","to","in","on","for","and","or","with","at","by","is",
  "are","this","that","its","it","as","from","how","why","what","new","report",
]);
// "Streamlined to tech": some outlets (esp. Wired) pump affiliate commerce —
// coupon roundups, promo codes, "deals" listicles, horoscopes — through the
// same RSS feed. None of it is tech news, so we drop it before it reaches the
// feed. Matches title patterns + commerce categories.
const JUNK_TITLE = /\b(coupons?|promo ?codes?|discount ?codes?|voucher ?codes?|deals?:|\d+% off|deal of the day|gift guide|best deals|horoscopes?|crosswords?|wordle|today'?s deals)\b/i;
const JUNK_CATS = new Set(["coupons", "deals", "gear / deals", "shopping", "commerce", "affiliate", "horoscopes"]);
function isJunk(a) {
  if (JUNK_TITLE.test(a.title || "")) return true;
  for (const c of a.categories || []) if (JUNK_CATS.has((c || "").toLowerCase())) return true;
  return false;
}

function titleFingerprint(title) {
  const words = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  if (words.length < 3) return ""; // too short to fingerprint safely
  return [...new Set(words)].sort().slice(0, 8).join(" ");
}

// ---- enrichment cache ------------------------------------------------------
// scripts/enrich.mjs precomputes AI summaries (+ AI images) keyed by article id
// and writes enriched.json. We attach them to the live feed by id so requests
// stay instant while still serving AI-written summaries. New articles show the
// extractive summary until the next hourly enrich pass picks them up.
import { readFileSync } from "node:fs";
import { streamline } from "./summarize.js";

function loadEnriched() {
  try {
    const j = JSON.parse(readFileSync(new URL("../enriched.json", import.meta.url), "utf-8"));
    return j && j.items && typeof j.items === "object" ? j.items : {};
  } catch { return {}; }
}

// ---- public API ------------------------------------------------------------
/**
 * Collect newest items across all RSS/WP outlets, the X social tier, AND arXiv
 * research papers — de-duplicated (exact link/id + title fingerprint),
 * newest-first, each carrying a streamlined `ai_summary` (+ AI image when the
 * enrich cache has one). Returns { sources, articles, social }.
 */
export async function collectArticles() {
  const [feedResults, xResult, papers, bskyResult] = await Promise.all([
    Promise.allSettled(SOURCES.map((s) => (s.type === "wp" ? collectWp(s) : collectFeed(s)))),
    // X + arXiv + Bluesky are isolated modules; never let one failing tier sink the feed.
    import("./x.js").then((m) => m.collectX()).catch(() => ({ ok: [], articles: [] })),
    import("./papers.js").then((m) => m.collectPapers()).catch(() => []),
    import("./bluesky.js").then((m) => m.collectBluesky()).catch(() => ({ ok: [], articles: [] })),
  ]);

  const byKey = new Map();   // exact link / id
  const byFp = new Set();    // title fingerprints already seen
  const okSources = [];

  const add = (a) => {
    if (!a.is_social && !a.is_paper && isJunk(a)) return false; // streamlined to tech
    const key = (a.link || a.id || "").replace(/\/$/, "");
    if (!key || byKey.has(key)) return false;
    const fp = titleFingerprint(a.title);
    if (fp && byFp.has(fp)) return false; // duplicate story under a different headline
    byKey.set(key, a);
    if (fp) byFp.add(fp);
    return true;
  };

  // Articles first (publisher stories), then social, then papers — so an
  // outlet's own write-up of an announcement wins the fingerprint over a tweet.
  feedResults.forEach((r, i) => {
    if (r.status !== "fulfilled" || !r.value.length) return;
    okSources.push(SOURCES[i].name);
    for (const a of r.value) add(a);
  });

  const social = xResult.ok || [];
  if (social.length) okSources.push("X");
  for (const a of xResult.articles || []) add(a);

  const bsky = bskyResult.ok || [];
  if (bsky.length) okSources.push("Bluesky");
  for (const a of bskyResult.articles || []) add(a);

  if (papers.length) okSources.push("arXiv");
  for (const a of papers) add(a);

  // Attach streamlined summaries: extractive inline (always), AI override from
  // the precompute cache when available. Also guard against bad timestamps:
  // some scholarly records (OpenAlex) carry FUTURE publication dates that would
  // otherwise rocket to the top of a newest-first feed and bury real breaking
  // news. Clamp any future date (allow ~2h clock skew) so the top of the feed
  // is always the genuinely-latest news.
  const nowMs = Date.now();
  const FUTURE_SKEW = 2 * 3600 * 1000;
  const enriched = loadEnriched();
  const articles = [...byKey.values()].map((a) => {
    const cached = enriched[a.id];
    let published = a.published || "";
    const t = published ? Date.parse(published) : NaN;
    if (!Number.isNaN(t) && t > nowMs + FUTURE_SKEW) published = ""; // future date → undated (sorts last)
    return {
      ...a,
      published,
      ai_summary: (cached && cached.ai_summary) || streamline(a),
      ai_summary_kind: cached && cached.ai_summary ? "ai" : "extractive",
      ...(cached && cached.ai_image ? { ai_image: cached.ai_image } : {}),
      // Precomputed license-clean image + attribution (enrich.mjs → Openverse CC).
      // attachMedia() won't overwrite an article that already has a media_url.
      ...(cached && cached.media_url
        ? {
            media_url: cached.media_url,
            media_kind: cached.media_kind || "stock",
            media_credit: cached.media_credit || null,
            media_credit_url: cached.media_credit_url || null,
          }
        : {}),
    };
  }).sort((a, b) => (b.published || "").localeCompare(a.published || ""));

  return { sources: okSources, articles, social };
}
