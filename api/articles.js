// GET /api/articles — mobile-friendly multi-source tech feed (JSON).
//
// Query params (all optional):
//   q        full-text search across title, summary, keywords, author, source
//   keyword  filter by keyword/tag (case-insensitive). Comma-separated = AND.
//            (alias: `tag`)
//   source   filter by source id or name (e.g. "techcrunch", "Wired"). Comma = OR.
//   region   filter by region (e.g. "Silicon Valley", "San Francisco"). Comma = OR.
//   section  filter by section
//   limit    max articles to return  (1–400, default: all)
//   page     1-based page number used with `limit`
//   offset   alternative to `page` (0-based)
//
// Response: { sources, generated_at, total, count, limit, offset, with_images, articles }
// Each article: { id, title, link, source, source_id, region, focus, content_type,
//                 author, published(ISO8601), image, thumbnail, section, categories[], summary }
//
// CORS is open (`*`). Edge-cached 10 min; cache key includes the query string.

import { collectArticles } from "../lib/feeds.js";

function pickInt(v, dflt, min, max) {
  const n = parseInt(Array.isArray(v) ? v[0] : v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
function str(v) { return (Array.isArray(v) ? v[0] : v || "").toString().trim(); }
function csv(v) { return str(v).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean); }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const { sources, articles: all } = await collectArticles();

    // ---- filter -----------------------------------------------------------
    const q = str(req.query?.q).toLowerCase();
    const section = str(req.query?.section).toLowerCase();
    const kws = csv(req.query?.keyword).length ? csv(req.query?.keyword) : csv(req.query?.tag);
    const srcs = csv(req.query?.source);
    const regions = csv(req.query?.region);

    const filtered = all.filter((a) => {
      if (srcs.length && !srcs.includes(a.source_id) && !srcs.includes((a.source || "").toLowerCase())) return false;
      if (regions.length && !regions.includes((a.region || "").toLowerCase())) return false;
      if (section && (a.section || "").toLowerCase() !== section) return false;
      if (kws.length) {
        const cats = (a.categories || []).map((c) => c.toLowerCase());
        for (const k of kws) if (!cats.includes(k)) return false;
      }
      if (q) {
        const hay = (a.title + " " + a.summary + " " + (a.categories || []).join(" ") + " " + a.author + " " + a.source).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const total = filtered.length;
    const limit = pickInt(req.query?.limit, total || 0, 1, 400);
    let offset = pickInt(req.query?.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const page = pickInt(req.query?.page, 0, 1, Number.MAX_SAFE_INTEGER);
    if (page && !req.query?.offset) offset = (page - 1) * limit;

    const out = filtered.slice(offset, offset + (limit || total));

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
    res.status(200).send(JSON.stringify({
      sources,
      generated_at: new Date().toISOString(),
      total,
      count: out.length,
      limit: limit || total,
      offset,
      with_images: out.filter((a) => a.image).length,
      articles: out,
    }));
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(502).json({ error: "Failed to fetch feeds", detail: String(err) });
  }
}
