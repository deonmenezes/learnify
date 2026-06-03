// lib/papers.js — keyless research-paper collector for TechScroll.
//
// Two scholarly sources, both keyless and reliable, merged into the feed-item
// schema (so research shows up inline + in the Research view):
//   • arXiv  — newest AI/ML preprints (Atom API)
//   • OpenAlex — Scholar-grade index of published works across every field
//     (Google Scholar has NO public API and blocks scraping, so OpenAlex is the
//     reliable open stand-in: 250M+ works, polite-pool access, no key).
// The abstract becomes the summary; the abstract/DOI page is the link-out.

const CATS = [
  // Original AI/ML
  "cs.AI", "cs.LG", "cs.CL", "cs.CV", "stat.ML",
  // Breadth additions
  "cs.RO",             // Robotics
  "cs.CR",             // Security & Cryptography
  "cs.SE",             // Software Engineering
  "cs.PL",             // Programming Languages
  "cs.AR",             // Hardware Architecture
  "cs.HC",             // Human-Computer Interaction
  "eess.SY",           // Systems & Control
  "cond-mat.mtrl-sci", // Materials Science
  "q-bio.BM",          // Biomolecules
  "physics.app-ph",    // Applied Physics
];
const MAX = 80;
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
  // Original
  "cs.AI": "Artificial Intelligence", "cs.LG": "Machine Learning",
  "cs.CL": "NLP", "cs.CV": "Computer Vision", "stat.ML": "ML Theory",
  "cs.RO": "Robotics", "cs.NE": "Neural & Evolutionary",
  // New additions
  "cs.CR": "Security & Cryptography",
  "cs.SE": "Software Engineering",
  "cs.PL": "Programming Languages",
  "cs.AR": "Hardware Architecture",
  "cs.HC": "Human-Computer Interaction",
  "eess.SY": "Systems & Control",
  "cond-mat.mtrl-sci": "Materials Science",
  "q-bio.BM": "Biomolecules",
  "physics.app-ph": "Applied Physics",
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
    while ((cm = cr.exec(b))) {
      const lbl = SUBJECTS[cm[1]] || cm[1];
      if (!cats.includes(lbl)) cats.push(lbl);
      // Also store the raw code so the classifier in research.js can match it
      if (!cats.includes(cm[1])) cats.push(cm[1]);
    }

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
      categories: ["Research", ...cats].slice(0, 12),
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
// AI + ML + deep learning + NLP + computer vision. Deliberately NOT the broad
// "Computer science" concept (C154945302) — it dragged in finance/linguistics
// papers. These keep the research tier genuinely AI/tech-focused.
const OA_CONCEPTS = ["C50644808", "C119857082", "C108583219", "C204321447", "C31972630"];
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

// Map one OpenAlex work → feed item. `trending` flags the most-cited tier.
function mapOAWork(w, { trending = false } = {}) {
  const title = clean(w.title || w.display_name || "", 240);
  if (!title || title.split(" ").length < 3) return null; // skip junk/dataset rows
  const link = (w.doi || w.primary_location?.landing_page_url || w.id || "").trim();
  if (!link) return null;
  const authors = (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean);
  const author = authors.length > 2 ? `${authors[0]} +${authors.length - 1}` : authors.join(", ");
  const venue = w.primary_location?.source?.display_name || "";
  const cats = (w.concepts || []).filter((c) => (c.score || 0) > 0.3).map((c) => c.display_name).slice(0, 4);
  const d = w.publication_date ? new Date(w.publication_date) : null;
  const citations = w.cited_by_count || 0;
  let summary = clean(fromInverted(w.abstract_inverted_index), 360);
  if (!summary && venue) summary = `Published in ${venue}.`;
  return {
    id: "oa_" + shortId(link),
    title, link,
    source: "OpenAlex", source_id: "openalex",
    region: "Research", focus: "Scholarly research (OpenAlex)",
    content_type: "paper",
    author: author || venue || "OpenAlex",
    published: d && !isNaN(d.getTime()) ? d.toISOString() : "",
    image: null, thumbnail: null,
    section: trending ? "Trending research" : (cats[0] || "Research"),
    categories: [...(trending ? ["Research", "Trending"] : ["Research"]), ...cats].slice(0, 8),
    summary,
    is_paper: true,
    trending,
    citations,
    metrics: { citations },
  };
}

async function queryOpenAlex(sort, extraDays = 21) {
  const filter = [
    `concepts.id:${OA_CONCEPTS.join("|")}`, // OR across AI/ML concepts
    "type:article",
    `from_publication_date:${daysAgoISO(extraDays)}`,
  ].join(",");
  const url = `${OPENALEX}?filter=${encodeURIComponent(filter)}&sort=${sort}&per_page=${OA_MAX}&mailto=support@techscroll.app`;
  try {
    const j = JSON.parse(await getText(url, 10000));
    return (j.results || []).map((w) => mapOAWork(w, { trending: sort.startsWith("cited") })).filter(Boolean);
  } catch { return []; }
}

// Recent-by-date scholarly works.
async function collectOpenAlex() { return queryOpenAlex("publication_date:desc", 21); }

// "Trending / top" = most-cited works from the last ~18 months (the papers the
// field is actually building on — Google-Scholar-style "top results").
async function collectOpenAlexTrending() { return queryOpenAlex("cited_by_count:desc", 540); }

// arXiv enforces ~1 request / 3s per IP, so we CANNOT fire one request per
// category (15 parallel = "Rate exceeded" and whole categories silently drop).
// Instead, batch categories into a few GROUPED `OR` queries — each group is ONE
// request that returns papers spanning all its categories. 3 arXiv requests +
// 2 OpenAlex stays comfortably under the limit. parseArxiv keeps each entry's
// raw subject code, so the api/research.js classifier still bins them per app
// category. OpenAlex covers AI/ML breadth on its own.
const ARXIV_GROUPS = [
  // AI/ML core (fresh preprints; OpenAlex also supplies AI breadth)
  ["cs.AI", "cs.LG", "cs.CL", "cs.CV", "stat.ML"],
  // CS breadth → Robotics, Security, Coding & Dev Tools, Hardware
  ["cs.RO", "cs.CR", "cs.SE", "cs.PL", "cs.AR", "cs.HC", "eess.SY"],
  // Physical & life sciences → Science
  ["cond-mat.mtrl-sci", "q-bio.BM", "physics.app-ph"],
];

function arxivGroupURL(cats, n) {
  const q = cats.map((c) => `cat:${c}`).join("+OR+");
  return `${ARXIV}?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=${n}`;
}

/**
 * Collect papers from arXiv (a few GROUPED category queries) + OpenAlex.
 *
 * arXiv is queried as 3 grouped `OR` requests (NOT one-per-category — that trips
 * arXiv's rate limit). Group results are interleaved ROUND-ROBIN so the AI group
 * can't crowd out the breadth/science groups. OpenAlex recent + trending append
 * after. Dedup by canonical link key; newest-first. Returns a flat array (may be
 * empty — research is a bonus tier that never sinks the feed). Spans all app
 * categories: AI/ML, Robotics, Security, Coding & Dev Tools, Hardware, Science.
 */
export async function collectPapers() {
  const groupSizes = [14, 30, 14]; // AI core, CS breadth, sciences
  const arxivPromises = ARXIV_GROUPS.map((cats, i) =>
    getText(arxivGroupURL(cats, groupSizes[i]), 13000)
      .then(parseArxiv)
      .catch(() => [])
  );

  const [arxivGroups, oaRecent, oaTrending] = await Promise.all([
    Promise.all(arxivPromises),
    collectOpenAlex(),
    collectOpenAlexTrending(),
  ]);

  // Round-robin across the 3 group arrays so breadth/science survive the cap.
  const queues = arxivGroups.map((arr) => arr.slice());
  const arxivMerged = [];
  let active = true;
  while (active) {
    active = false;
    for (const q of queues) {
      if (q.length > 0) {
        arxivMerged.push(q.shift());
        active = true;
      }
    }
  }

  // Merge arXiv + OpenAlex, dedup by canonical link key.
  const byKey = new Map();
  for (const p of [...arxivMerged, ...oaRecent, ...oaTrending]) {
    const k = shortIdKey(p.link);
    const existing = byKey.get(k);
    if (!existing) byKey.set(k, p);
    // if a paper shows up in both recent + trending, keep the trending flag + citations
    else if (p.trending && !existing.trending) byKey.set(k, { ...existing, trending: true, citations: p.citations, metrics: p.metrics });
  }

  return [...byKey.values()]
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .slice(0, MAX);
}
