// GET /api/keywords — source, region, section & keyword tallies for filter UIs.
//
// Query params (optional):
//   limit   max keywords to return (default 100)
//
// Response: {
//   generated_at, total_articles,
//   sources:[{id,name,region,focus,count}],
//   regions:[{name,count}],
//   sections:[{name,count}],
//   keywords:[{keyword,count}]
// }
// Pass any value back to /api/articles (?source=, ?region=, ?keyword=).

import { collectArticles, SOURCES } from "../lib/feeds.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const { articles } = await collectArticles();
    const limit = parseInt(req.query?.limit, 10) || 100;

    const kw = new Map(), sec = new Map(), reg = new Map(), src = new Map();
    for (const a of articles) {
      sec.set(a.section, (sec.get(a.section) || 0) + 1);
      reg.set(a.region, (reg.get(a.region) || 0) + 1);
      src.set(a.source_id, (src.get(a.source_id) || 0) + 1);
      for (const c of a.categories || []) kw.set(c, (kw.get(c) || 0) + 1);
    }
    const tally = (m) => [...m.entries()].sort((x, y) => y[1] - x[1]);
    const meta = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
    res.status(200).send(JSON.stringify({
      generated_at: new Date().toISOString(),
      total_articles: articles.length,
      sources: tally(src).map(([id, count]) => ({
        id, name: meta[id]?.name || id, region: meta[id]?.region, focus: meta[id]?.focus, count,
      })),
      regions: tally(reg).map(([name, count]) => ({ name, count })),
      sections: tally(sec).map(([name, count]) => ({ name, count })),
      keywords: tally(kw).slice(0, limit).map(([keyword, count]) => ({ keyword, count })),
    }));
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(502).json({ error: "Failed to fetch feeds", detail: String(err) });
  }
}
