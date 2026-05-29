// TechScrollDataCach — live TechCrunch feed proxy + parser.
//
// Runs as a Vercel Serverless Function (Node runtime). Fetches TechCrunch's
// public RSS feeds server-side (avoiding browser CORS), parses them with a
// dependency-free regex pass, dedupes by URL, sorts newest-first and returns
// JSON. Cached at the edge for 10 minutes so the front page stays fresh
// without hammering the origin.

const FEEDS = [
  ["Top", "https://techcrunch.com/feed/"],
  ["AI", "https://techcrunch.com/category/artificial-intelligence/feed/"],
  ["Startups", "https://techcrunch.com/category/startups/feed/"],
  ["Security", "https://techcrunch.com/category/security/feed/"],
  ["Venture", "https://techcrunch.com/category/venture/feed/"],
  ["Apps", "https://techcrunch.com/category/apps/feed/"],
  ["Fintech", "https://techcrunch.com/category/fintech/feed/"],
  ["Enterprise", "https://techcrunch.com/category/enterprise/feed/"],
  ["Gadgets", "https://techcrunch.com/category/gadgets/feed/"],
  ["Transportation", "https://techcrunch.com/category/transportation/feed/"],
  ["Climate", "https://techcrunch.com/category/climate/feed/"],
  ["Crypto", "https://techcrunch.com/category/cryptocurrency/feed/"],
];

const UA = "Mozilla/5.0 (compatible; TechScrollDataCach/1.0; +https://vercel.com/)";

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#039;": "'", "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
  "&#8217;": "’", "&#8216;": "‘", "&#8220;": "“",
  "&#8221;": "”", "&#8211;": "–", "&#8212;": "—",
  "&#8230;": "…", "&#038;": "&", "&hellip;": "…",
};

function unescapeHtml(s) {
  if (!s) return "";
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;|&#0?39;/gi, (m) => ENTITIES[m] || m);
}

function stripCdata(s) {
  if (!s) return "";
  const m = s.trim().match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (m ? m[1] : s).trim();
}

function first(re, block) {
  const m = block.match(re);
  return m ? stripCdata(m[1]) : "";
}

function cleanText(raw, limit = 320) {
  let t = unescapeHtml(stripCdata(raw))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/The post [\s\S]*? appeared first on TechCrunch\.?$/, "")
    .trim();
  if (t.length > limit) t = t.slice(0, limit).replace(/\s+\S*$/, "") + "…";
  return t;
}

function toIso(pubDate) {
  const d = new Date(pubDate);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

function parseFeed(xml, section) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const link = unescapeHtml(first(/<link>([\s\S]*?)<\/link>/, block)).trim();
    const title = unescapeHtml(first(/<title>([\s\S]*?)<\/title>/, block)).trim();
    if (!link || !title) continue;
    const categories = [];
    const catRe = /<category>([\s\S]*?)<\/category>/g;
    let c;
    while ((c = catRe.exec(block))) categories.push(unescapeHtml(stripCdata(c[1])));
    items.push({
      title,
      link,
      author: unescapeHtml(first(/<dc:creator>([\s\S]*?)<\/dc:creator>/, block)).trim(),
      published: toIso(first(/<pubDate>([\s\S]*?)<\/pubDate>/, block)),
      categories,
      summary: cleanText(first(/<description>([\s\S]*?)<\/description>/, block)),
      section,
    });
  }
  return items;
}

async function fetchFeed(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  try {
    const results = await Promise.allSettled(
      FEEDS.map(async ([section, url]) => parseFeed(await fetchFeed(url), section))
    );
    const byLink = new Map();
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const it of r.value) {
        const existing = byLink.get(it.link);
        if (!existing) {
          byLink.set(it.link, it);
        } else {
          existing.categories = [...new Set([...existing.categories, ...it.categories])];
        }
      }
    }
    const articles = [...byLink.values()].sort(
      (a, b) => (b.published || "").localeCompare(a.published || "")
    );
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
    res.status(200).send(
      JSON.stringify({
        source: "TechCrunch RSS (live)",
        generated_at: new Date().toISOString(),
        count: articles.length,
        articles,
      })
    );
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch TechCrunch feeds", detail: String(err) });
  }
}
