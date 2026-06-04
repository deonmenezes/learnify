// GET /api/paper-image — a topical, license-clean photo for a research paper,
// sourced from Pexels (Pexels License: free for commercial use, no attribution
// required). The PEXELS_API_KEY lives ONLY in the Vercel env — never in the app
// binary or git. Returns { url: null } gracefully when there's no key or no
// match, so the app falls back to its own generated cover art.
//
// Params:
//   q    = search query (paper keywords / field), e.g. "robotics locomotion"
//   seed = stable per-paper integer so each paper gets a different but
//          consistent photo (picks results[seed % count]).
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const key = process.env.PEXELS_API_KEY;
  const q = (req.query.q || "").toString().trim().slice(0, 120) || "technology";
  const seed = Math.abs(parseInt((req.query.seed || "0").toString(), 10) || 0);

  if (!key) { res.status(200).json({ url: null, reason: "no_key" }); return; }

  async function search(query) {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=20`;
    const r = await fetch(url, { headers: { Authorization: key } });
    if (!r.ok) return { error: `pexels_${r.status}` };
    const data = await r.json();
    return { photos: Array.isArray(data.photos) ? data.photos : [] };
  }

  try {
    // Try the specific query; if it's too niche to match, broaden to the first
    // word (usually the field) before giving up.
    let { photos = [], error } = await search(q);
    if ((!photos || !photos.length) && q.includes(" ")) {
      ({ photos = [] } = await search(q.split(/\s+/)[0]));
    }
    if (error && !photos.length) { res.status(200).json({ url: null, reason: error, q }); return; }
    if (!photos.length) { res.status(200).json({ url: null, reason: "no_results", q }); return; }

    const photo = photos[seed % photos.length];
    // Same paper (same q+seed) → same photo, so cache hard at the edge.
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
    res.status(200).json({
      url: photo.src?.large || photo.src?.medium || photo.src?.original || null,
      thumb: photo.src?.medium || null,
      photographer: photo.photographer || null,
      photographer_url: photo.photographer_url || null,
      alt: photo.alt || q,
      q,
    });
  } catch (err) {
    res.status(200).json({ url: null, reason: "error", detail: String(err) });
  }
}
