// TechScrollDataCach — live TechCrunch scraper (no Apify, no hosted service).
//
// Runs as a Vercel Serverless Function (Node runtime). Pulls the newest posts
// from TechCrunch's own WordPress REST API with `_fields` so each post is tiny
// and arrives WITH its featured image, keyword slugs, author and excerpt — no
// per-article scraping and no third-party scraping platform. Falls back to the
// public RSS feeds (no images) if the REST API is unreachable. Edge-cached for
// 10 min so the page stays fresh without hammering the origin.

const WP_API = "https://techcrunch.com/wp-json/wp/v2/posts";
const WP_FIELDS = "id,date_gmt,link,title,excerpt,jetpack_featured_media_url,class_list,yoast_head_json";
const PAGES = 2;       // 100 posts/page -> ~200 newest articles
const PER_PAGE = 100;

const RSS_FEEDS = [
  ["Top", "https://techcrunch.com/feed/"],
  ["AI", "https://techcrunch.com/category/artificial-intelligence/feed/"],
  ["Startups", "https://techcrunch.com/category/startups/feed/"],
  ["Security", "https://techcrunch.com/category/security/feed/"],
  ["Venture", "https://techcrunch.com/category/venture/feed/"],
  ["Fintech", "https://techcrunch.com/category/fintech/feed/"],
];

const UA = "Mozilla/5.0 (compatible; TechScrollDataCach/1.0; +https://vercel.com/)";

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

function prettify(slug) {
  if (BRANDS[slug]) return BRANDS[slug];
  return slug.split("-").map((w) => {
    if (/^\d+$/.test(w)) return "";          // drop WP dedup suffixes like "...-2"
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
function cleanText(raw, limit = 320) {
  let t = unescapeHtml(raw || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (t.length > limit) t = t.slice(0, limit).replace(/\s+\S*$/, "") + "…";
  return t;
}

async function getJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function parseWpPost(p) {
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
  const keywords = [...new Set([...cats, ...tags])];
  let published = "";
  if (p.date_gmt) {
    const d = new Date(p.date_gmt + "Z");
    if (!isNaN(d.getTime())) published = d.toISOString();
  }
  return {
    title, link,
    author: (yoast.author || "").trim(),
    published,
    image: image || null,
    section: cats[0] || "TechCrunch",
    categories: keywords,
    summary: cleanText(p.excerpt?.rendered || ""),
  };
}

async function collectWp() {
  const pages = await Promise.allSettled(
    Array.from({ length: PAGES }, (_, i) =>
      getJson(`${WP_API}?per_page=${PER_PAGE}&page=${i + 1}&_fields=${encodeURIComponent(WP_FIELDS)}&orderby=date&order=desc`))
  );
  const byLink = new Map();
  for (const r of pages) {
    if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
    for (const p of r.value) {
      const a = parseWpPost(p);
      if (a && !byLink.has(a.link)) byLink.set(a.link, a);
    }
  }
  return [...byLink.values()];
}

// ---- RSS fallback (no images) ---------------------------------------------
function stripCdata(s) {
  const m = (s || "").trim().match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (m ? m[1] : s || "").trim();
}
function parseRss(xml, section) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const b = m[1];
    const f = (re) => { const x = b.match(re); return x ? stripCdata(x[1]) : ""; };
    const link = unescapeHtml(f(/<link>([\s\S]*?)<\/link>/)).trim();
    const title = unescapeHtml(f(/<title>([\s\S]*?)<\/title>/)).trim();
    if (!link || !title) continue;
    const categories = [];
    const cr = /<category>([\s\S]*?)<\/category>/g;
    let c;
    while ((c = cr.exec(b))) categories.push(unescapeHtml(stripCdata(c[1])));
    const d = new Date(f(/<pubDate>([\s\S]*?)<\/pubDate>/));
    items.push({
      title, link,
      author: unescapeHtml(f(/<dc:creator>([\s\S]*?)<\/dc:creator>/)).trim(),
      published: isNaN(d.getTime()) ? "" : d.toISOString(),
      image: null, section, categories,
      summary: cleanText(f(/<description>([\s\S]*?)<\/description>/)),
    });
  }
  return items;
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
async function collectRss() {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async ([section, url]) => parseRss(await getText(url), section)));
  const byLink = new Map();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const it of r.value) if (!byLink.has(it.link)) byLink.set(it.link, it);
  }
  return [...byLink.values()];
}

export default async function handler(req, res) {
  try {
    let source = "TechCrunch WP REST API (live)";
    let articles = await collectWp();
    if (!articles.length) {
      source = "TechCrunch RSS (fallback, live)";
      articles = await collectRss();
    }
    articles.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
    res.status(200).send(JSON.stringify({
      source,
      generated_at: new Date().toISOString(),
      count: articles.length,
      with_images: articles.filter((a) => a.image).length,
      articles,
    }));
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch TechCrunch", detail: String(err) });
  }
}
