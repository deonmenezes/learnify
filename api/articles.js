// GET /api/articles — mobile-friendly multi-source Learnify feed (JSON).
//
// Query params (all optional):
//   q        full-text search across title, summary, keywords, author, source
//   keyword  filter by keyword/tag (case-insensitive). Comma-separated = AND.
//            (alias: `tag`)
//   source   filter by source id or name (e.g. "techcrunch", "Wired", "x"). Comma = OR.
//   region   filter by region (e.g. "Silicon Valley", "San Francisco"). Comma = OR.
//   section  filter by section
//   social   "only" → just X posts · "exclude" → hide X posts (default: include)
//   min_score  keep social posts with worthiness_score >= n (0–100)
//   limit    max articles to return  (1–400, default: all)
//   page     1-based page number used with `limit`
//   offset   alternative to `page` (0-based)
//
// Response: { sources, social, generated_at, total, count, limit, offset, with_images, articles }
// Each article: { id, title, link, source, source_id, region, focus, content_type,
//                 author, published(ISO8601), image, thumbnail, section, categories[], summary }
// Social (X) items additionally carry: is_social, report_worthy, worthiness_score,
//   sentiment, sentiment_score, reasons[], handle, org, metrics{likes,retweets,replies}.
//
// CORS is open (`*`). Near-real-time: edge-cached ~90s with stale-while-revalidate
// so reads stay instant while fresh data is pulled in the background. Cache key
// includes the query string.

import { collectArticles } from "../lib/feeds.js";
import { attachMedia } from "../lib/media.js";
import { normalizedRightsMetadata } from "../lib/content-rights.js";

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
    const { sources, articles: all, social } = await collectArticles();

    // ---- filter -----------------------------------------------------------
    const q = str(req.query?.q).toLowerCase();
    const section = str(req.query?.section).toLowerCase();
    const kws = csv(req.query?.keyword).length ? csv(req.query?.keyword) : csv(req.query?.tag);
    const srcs = csv(req.query?.source);
    const regions = csv(req.query?.region);
    const socialMode = str(req.query?.social).toLowerCase(); // "only"|"hot"|"top"|"exclude"|""
    const minScore = pickInt(req.query?.min_score, 0, 0, 100);
    const papersMode = str(req.query?.papers).toLowerCase(); // "only" | "trending" | "exclude" | ""
    const socialOnly = ["only", "hot", "top"].includes(socialMode);

    const filtered = all.filter((a) => {
      if (papersMode === "only" && !a.is_paper) return false;
      if (papersMode === "trending" && !a.trending) return false;
      if (papersMode === "exclude" && a.is_paper) return false;
      if (socialOnly && !a.is_social) return false;
      if (socialMode === "exclude" && a.is_social) return false;
      if (a.is_social && minScore && (a.worthiness_score || 0) < minScore) return false;
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

    // Trending papers are ranked by citations (the "top" sort), not recency.
    if (papersMode === "trending") filtered.sort((a, b) => (b.citations || 0) - (a.citations || 0));
    // Hot/top tech on X = ranked by engagement (likes/retweets), not recency.
    if (socialMode === "hot" || socialMode === "top") filtered.sort((a, b) => (b.engagement || 0) - (a.engagement || 0));

    const total = filtered.length;
    const limit = pickInt(req.query?.limit, total || 0, 1, 400);
    let offset = pickInt(req.query?.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const page = pickInt(req.query?.page, 0, 1, Number.MAX_SAFE_INTEGER);
    if (page && !req.query?.offset) offset = (page - 1) * limit;

    const slice = filtered.slice(offset, offset + (limit || total));
    const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const host = req.headers["x-forwarded-host"] || req.headers.host || "";
    const base = host ? `${proto}://${host}` : "";
    const withMedia = await attachMedia(slice, base); // license-clean media_url per article (PRD §6)
    const rightsProvenanceAt = new Date().toISOString();
    const out = withMedia.map((article) => ({
      ...article,
      ...normalizedRightsMetadata(article, { checkedAt: rightsProvenanceAt }),
    }));

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // Near-real-time: serve instantly from edge, refresh in the background.
    res.setHeader("Cache-Control", "public, s-maxage=90, stale-while-revalidate=600");
    res.status(200).send(JSON.stringify({
      sources,
      social: social || [],
      generated_at: new Date().toISOString(),
      total,
      count: out.length,
      limit: limit || total,
      offset,
      with_images: out.filter((a) => a.media_url).length,
      articles: out,
    }));
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(502).json({ error: "Failed to fetch feeds", detail: String(err) });
  }
}
