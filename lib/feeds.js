// Multi-source TechScrollDataCach collector — Silicon Valley / SF tech news.
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

export const SOURCES = [
  { id: "techcrunch",   name: "TechCrunch",        region: "SF Bay Area",    focus: "Startups & VC",
    type: "wp",  url: "https://techcrunch.com/wp-json/wp/v2/posts", pages: 2 },
  { id: "siliconvalley", name: "SiliconValley.com", region: "Silicon Valley", focus: "Valley business & tech",
    type: "wp",  url: "https://www.siliconvalley.com/wp-json/wp/v2/posts", pages: 1 },
  { id: "wired",        name: "Wired",             region: "San Francisco",  focus: "Tech, science & culture",
    type: "rss", url: "https://www.wired.com/feed/rss" },
  { id: "theverge",     name: "The Verge",         region: "National",       focus: "Consumer tech",
    type: "rss", url: "https://www.theverge.com/rss/index.xml" },
  { id: "arstechnica",  name: "Ars Technica",      region: "National",       focus: "Deep tech & policy",
    type: "rss", url: "https://feeds.arstechnica.com/arstechnica/index" },
];

const WP_FIELDS = "id,date_gmt,link,title,excerpt,jetpack_featured_media_url,class_list,yoast_head_json";
const WP_PER_PAGE = 100;
const RSS_MAX = 30;
const UA = "Mozilla/5.0 (compatible; TechScrollDataCach/1.0; +https://vercel.com/)";

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

// ---- public API ------------------------------------------------------------
/** Collect newest articles across all sources. Returns { sources, articles } newest-first. */
export async function collectArticles() {
  const results = await Promise.allSettled(
    SOURCES.map((s) => (s.type === "wp" ? collectWp(s) : collectFeed(s)))
  );
  const byLink = new Map();
  const okSources = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled" || !r.value.length) return;
    okSources.push(SOURCES[i].name);
    for (const a of r.value) {
      const key = a.link.replace(/\/$/, "");
      if (!byLink.has(key)) byLink.set(key, a);
    }
  });
  const articles = [...byLink.values()]
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  return { sources: okSources, articles };
}
