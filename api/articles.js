// GET /api/articles — mobile-friendly TechCrunch feed (JSON).
//
// Query params (all optional):
//   q        full-text search across title, summary, keywords, author
//   keyword  filter by keyword/tag (case-insensitive). Comma-separated = AND.
//            (alias: `tag`)
//   section  filter by section (e.g. "Artificial Intelligence")
//   limit    max articles to return  (1–200, default: all)
//   page     1-based page number used with `limit`
//   offset   alternative to `page` (0-based)
//
// Response: { source, generated_at, total, count, limit, offset, with_images, articles }
// Each article: { title, link, author, published(ISO8601), image, thumbnail, section, categories[], summary }
//
// CORS is open (`*`) so any client — web preview or native app — can call it.
// Edge-cached 10 min; cache key includes the query string.

import { collectArticles, thumbnail } from "../lib/techcrunch.js";

function pickInt(v, dflt, min, max) {
  const n = parseInt(Array.isArray(v) ? v[0] : v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
function str(v) {
  return (Array.isArray(v) ? v[0] : v || "").toString().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const { source, articles: all } = await collectArticles();

    // ---- filter -----------------------------------------------------------
    const q = str(req.query?.q).toLowerCase();
    const section = str(req.query?.section).toLowerCase();
    const kwRaw = str(req.query?.keyword) || str(req.query?.tag);
    const kws = kwRaw ? kwRaw.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean) : [];

    let filtered = all.filter((a) => {
      if (section && (a.section || "").toLowerCase() !== section) return false;
      if (kws.length) {
        const cats = (a.categories || []).map((c) => c.toLowerCase());
        for (const k of kws) if (!cats.includes(k)) return false;
      }
      if (q) {
        const hay = (a.title + " " + a.summary + " " + (a.categories || []).join(" ") + " " + a.author).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const total = filtered.length;

    // ---- paginate ---------------------------------------------------------
    const limit = pickInt(req.query?.limit, total || 0, 1, 200);
    let offset = pickInt(req.query?.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const page = pickInt(req.query?.page, 0, 1, Number.MAX_SAFE_INTEGER);
    if (page && !req.query?.offset) offset = (page - 1) * limit;

    const slice = filtered.slice(offset, offset + (limit || total));

    // ---- shape for clients (add ready-to-use thumbnail) -------------------
    const out = slice.map((a) => ({ ...a, thumbnail: thumbnail(a.image) }));

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
    res.status(200).send(JSON.stringify({
      source,
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
    res.status(502).json({ error: "Failed to fetch TechCrunch", detail: String(err) });
  }
}
