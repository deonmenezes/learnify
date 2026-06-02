// lib/papers.js — keyless research-paper collector for TechScroll.
//
// Two scholarly sources, both keyless and reliable, merged into the feed-item
// schema (so research shows up inline + in the Research view):
//   • arXiv  — newest AI/ML preprints (Atom API)
//   • OpenAlex — Scholar-grade index of published works across every field
//     (Google Scholar has NO public API and blocks scraping, so OpenAlex is the
//     reliable open stand-in: 250M+ works, polite-pool access, no key).
// The abstract becomes the summary; the abstract/DOI page is the link-out.

const CATS = ["cs.AI", "cs.LG", "cs.CL", "cs.CV", "stat.ML"]; // top AI/ML categories
const MAX = 30;
const UA = "Mozilla/5.0 (compatible; TechScroll/1.0; +https://techscroll.app/)";
const ARXIV = "https://export.arxiv.org/api/query";

async function getText(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

function stripCdata(s) {
  const m = (s || "").trim().match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (m ? m[1] : s || "").trim();
}
function clean(raw, limit = 360) {
  let t = stripCdata(raw || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (t.length > limit) t = t.slice(0, limit).replace(/\s+\S*$/, "") + "…";
  return t;
}
function shortId(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Map an arXiv subject code to a friendly label.
const SUBJECTS = {
  "cs.AI": "Artificial Intelligence", "cs.LG": "Machine Learning",
  "cs.CL": "NLP", "cs.CV": "Computer Vision", "stat.ML": "ML Theory",
  "cs.RO": "Robotics", "cs.NE": "Neural & Evolutionary",
};

function parseArxiv(xml) {
  const blocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) || [];
  const out = [];
  for (const b of blocks) {
    const f = (re) => { const m = b.match(re); return m ? m[1] : ""; };
    const title = clean(f(/<title\b[^>]*>([\s\S]*?)<\/title>/), 240);
    // <id> is the canonical abstract URL; prefer the alternate link if present.
    let link = (b.match(/<link[^>]*\brel="alternate"[^>]*\bhref="([^"]+)"/i) || [])[1]
      || clean(f(/<id>([\s\S]*?)<\/id>/), 400);
    link = (link || "").trim();
    if (!title || !link) continue;

    const authors = [];
    let m; const ar = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
    while ((m = ar.exec(b)) && authors.length < 6) authors.push(clean(m[1], 60));
    const author = authors.length > 2 ? `${authors[0]} +${authors.length - 1}` : authors.join(", ");

    const cats = [];
    let cm; const cr = /<category[^>]*\bterm="([^"]+)"/gi;
    while ((cm = cr.exec(b))) { const lbl = SUBJECTS[cm[1]] || cm[1]; if (!cats.includes(lbl)) cats.push(lbl); }

    const dateRaw = f(/<published>([\s\S]*?)<\/published>/) || f(/<updated>([\s\S]*?)<\/updated>/);
    const d = new Date(dateRaw);
    const summary = clean(f(/<summary\b[^>]*>([\s\S]*?)<\/summary>/));

    out.push({
      id: "arxiv_" + shortId(link),
      title,
      link,
      source: "arXiv",
      source_id: "arxiv",
      region: "Research",
      focus: "AI / ML research papers",
      content_type: "paper",
      author: author || "arXiv",
      published: isNaN(d.getTime()) ? "" : d.toISOString(),
      image: null,
      thumbnail: null,
      section: cats[0] || "Research",
      categories: ["Research", ...cats].slice(0, 8),
      summary,
      is_paper: true,
    });
  }
  return out;
}

function shortIdKey(link) {
  return (link || "").replace(/v\d+$/, "").replace(/\/$/, ""); // ignore version suffix
}

// ---- OpenAlex (Scholar-grade, keyless) -------------------------------------
const OPENALEX = "https://api.openalex.org/works";
const OA_CONCEPTS = ["C154945302", "C50644808", "C119857082"]; // CS, AI, ML
const OA_MAX = 20;

// OpenAlex stores abstracts as an inverted index {word: [positions]}. Rebuild.
function fromInverted(inv) {
  if (!inv || typeof inv !== "object") return "";
  const arr = [];
  for (const [w, ps] of Object.entries(inv)) for (const p of ps) arr[p] = w;
  return arr.join(" ").replace(/\s+/g, " ").trim();
}
function daysAgoISO(n) {
  const d = new Date(Date.now() - n * 864e5);
  return d.toISOString().slice(0, 10);
}

async function collectOpenAlex() {
  const filter = [
    `concepts.id:${OA_CONCEPTS.join("|")}`, // OR across CS/AI/ML
    "type:article",
    `from_publication_date:${daysAgoISO(21)}`,
  ].join(",");
  const url = `${OPENALEX}?filter=${encodeURIComponent(filter)}&sort=publication_date:desc&per_page=${OA_MAX}&mailto=support@techscroll.app`;
  let j;
  try { j = JSON.parse(await getText(url, 10000)); } catch { return []; }
  const out = [];
  for (const w of j.results || []) {
    const title = clean(w.title || w.display_name || "", 240);
    if (!title || title.split(" ").length < 3) continue; // skip junk/dataset rows
    const link = (w.doi || w.primary_location?.landing_page_url || w.id || "").trim();
    if (!link) continue;
    const authors = (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean);
    const author = authors.length > 2 ? `${authors[0]} +${authors.length - 1}` : authors.join(", ");
    const venue = w.primary_location?.source?.display_name || "";
    const cats = (w.concepts || []).filter((c) => (c.score || 0) > 0.3).map((c) => c.display_name).slice(0, 4);
    const d = w.publication_date ? new Date(w.publication_date) : null;
    let summary = clean(fromInverted(w.abstract_inverted_index), 360);
    if (!summary && venue) summary = `Published in ${venue}.`;
    out.push({
      id: "oa_" + shortId(link),
      title, link,
      source: "OpenAlex", source_id: "openalex",
      region: "Research", focus: "Scholarly research (OpenAlex)",
      content_type: "paper",
      author: author || venue || "OpenAlex",
      published: d && !isNaN(d.getTime()) ? d.toISOString() : "",
      image: null, thumbnail: null,
      section: cats[0] || "Research",
      categories: ["Research", ...cats].slice(0, 8),
      summary,
      is_paper: true,
    });
  }
  return out;
}

/**
 * Collect newest AI/ML papers from arXiv. Queries each category SEPARATELY in
 * parallel — arXiv's sorted multi-category `OR` queries are pathologically slow
 * (they time out), while single-category queries return fast. Merge + dedup +
 * newest-first. Returns array of feed items (may be empty; research is a bonus
 * tier that never sinks the feed).
 */
export async function collectPapers() {
  const per = Math.max(8, Math.ceil(MAX / CATS.length) + 4);
  const results = await Promise.allSettled([
    ...CATS.map((c) =>
      getText(`${ARXIV}?search_query=cat:${c}&sortBy=submittedDate&sortOrder=descending&max_results=${per}`, 9000)
        .then(parseArxiv)),
    collectOpenAlex(), // Scholar-grade breadth alongside arXiv
  ]);
  const byKey = new Map();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const p of r.value) {
      const k = shortIdKey(p.link);
      if (!byKey.has(k)) byKey.set(k, p);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .slice(0, MAX + OA_MAX);
}
