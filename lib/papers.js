// lib/papers.js — keyless research-paper collector for Learnify.
//
// Two scholarly sources, both keyless and reliable, merged into the feed-item
// schema (so research shows up inline + in the Research view):
//   • arXiv  — newest AI/ML preprints (Atom API)
//   • OpenAlex — Scholar-grade index of published works across every field
//     (Google Scholar has NO public API and blocks scraping, so OpenAlex is the
//     reliable open stand-in: 250M+ works, polite-pool access, no key).
// The abstract becomes the summary; the abstract/DOI page is the link-out.

import {
  findTopic,
  isWithinRollingWindow,
  matchesTopicText,
  parsePublicationDate,
  rollingCutoff,
} from "./topics.js";
import { openAlexRightsMetadata } from "./content-rights.js";

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
  // Genre breadth (Learnify is a general learning app, not tech-only)
  "q-bio.NC",          // Neuroscience & Cognition
  "q-fin.GN",          // General Finance
  "q-fin.PM",          // Portfolio Management
  "econ.GN",           // General Economics
  "astro-ph.EP",       // Planets & Exoplanets
];
const MAX = 170; // raised from 120: the deeper credible/topical tiers (incl. the
// new peer-reviewed "science discovery" picks) must not crowd arXiv preprints out
// of the cap. arXiv returns relevance-ordered (often older-dated) results, so a
// tight cap sorted newest-first was starving them; 170 keeps arXiv breadth + the
// credible OpenAlex tiers. Downstream (api/research.js, the app) apply their own limits.
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
  "q-bio.NC": "Neuroscience",
  "q-fin.GN": "Finance",
  "q-fin.PM": "Investing",
  "econ.GN": "Economics",
  "astro-ph.EP": "Space & Planets",
  "q-bio.GN": "Genomics",
  "physics.med-ph": "Medical Physics",
  "q-bio.PE": "Evolution & Populations",
  "physics.chem-ph": "Chemical Physics",
  "astro-ph.GA": "Astrophysics",
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
export function mapOAWork(w, { trending = false, topic = null } = {}) {
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
  const rights = openAlexRightsMetadata(w, {
    canonicalUrl: link,
    source: venue ? `${venue} metadata indexed by OpenAlex` : "Metadata indexed by OpenAlex",
  });
  return {
    id: "oa_" + shortId(link),
    title, link,
    source: "OpenAlex", source_id: "openalex",
    region: "Research", focus: "Scholarly research (OpenAlex)",
    content_type: "paper",
    author: author || venue || "OpenAlex",
    published: d && !isNaN(d.getTime()) ? d.toISOString() : "",
    image: null, thumbnail: null,
    section: topic || (trending ? "Trending research" : (cats[0] || "Research")),
    categories: [...(topic ? [topic] : []), ...(trending ? ["Research", "Trending"] : ["Research"]), ...cats].slice(0, 8),
    summary,
    is_paper: true,
    trending,
    citations,
    metrics: { citations },
    topic,
    provider: "OpenAlex",
    publisher: venue || null,
    source_label: venue ? venue + " · indexed by OpenAlex" : "OpenAlex",
    content_type_label: "Research paper",
    ...rights,
  };
}

async function queryOpenAlex(sort, extraDays = 21) {
  const filter = [
    `concepts.id:${OA_CONCEPTS.join("|")}`, // OR across AI/ML concepts
    "type:article",
    "is_retracted:false",  // credibility: never surface retracted work
    "is_paratext:false",   // drop front-matter / errata / non-research rows
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
async function collectOpenAlexTrending() { return queryOpenAlex("cited_by_count:desc", 90); }

// Topical OpenAlex searches that GUARANTEE the non-AI app categories get papers
// (arXiv's per-category limits are unreliable). OpenAlex has no such rate limit.
// Each result is force-tagged with `tag` so api/research.js's classifier bins it
// into the right app category regardless of OpenAlex's own concept labels.
const OA_TOPICS = [
  { term: "robotics manipulation", tag: "robotics" },
  { term: "computer security cryptography", tag: "security cryptography" },
  { term: "software engineering programming", tag: "software engineering" },
  // NOTE: dropped the "startup venture funding" topic — OpenAlex returned
  // business/econ + non-English humanities papers, not tech knowledge. Startup
  // *news* is well covered by the home feed; research Startups stays sparse.
  // Genre breadth — Learnify is a general learning app; research spans
  // fitness, skincare, nutrition, finance, psychology and hard science too.
  // Each tag is whitelisted in lib/research-shared.js TOPIC_TAGS and binned
  // by api/research.js into an app category + fine-grained `genre`.
  //
  // CONSUMER-HEALTH domains (Fitness + Skincare) override the default query
  // strategy: a wider ~1-year window with DEFAULT (relevance) ordering instead
  // of cited_by_count:desc. Exercise-science / dermatology papers accrue
  // citations slowly, so cited-desc surfaces a thin, stale set dominated by
  // off-topic clinical reviews ("Mitophagy in disease", "Standards of Care in
  // Diabetes"); relevance over a year returns engaging, on-topic consumer
  // research (muscle hypertrophy, HIIT, retinoids, sunscreen, skin microbiome) —
  // verified by running the queries against the OpenAlex API. `n` caps each at
  // ~5 so the two domains together stay ~8-10 papers and don't swamp the tech
  // core. Routed to NEW app categories "Fitness"/"Skincare" in api/research.js.
  { term: "resistance training muscle hypertrophy exercise", tag: "fitness exercise", sort: "relevance", days: 365, n: 5 },
  { term: "high intensity interval training endurance fitness", tag: "fitness exercise", sort: "relevance", days: 365, n: 5 },
  { term: "retinoid sunscreen skin aging dermatology", tag: "skincare dermatology", sort: "relevance", days: 365, n: 5 },
  { term: "skin barrier microbiome cosmetic science", tag: "skincare dermatology", sort: "relevance", days: 365, n: 5 },
  { term: "diet nutrition protein metabolism human health", tag: "nutrition diet" },
  { term: "intermittent fasting gut microbiome dietary intervention", tag: "nutrition diet", n: 4 },
  { term: "household finance investing behavioral asset returns", tag: "finance investing" },
  { term: "sleep cognition memory psychology behavior", tag: "psychology mind" },
  { term: "longevity aging healthspan exercise intervention", tag: "longevity health" },
  // Credible, peer-reviewed SCIENCE tier — the Science niche otherwise rides only
  // arXiv preprints (un-reviewed). These cited OpenAlex picks add the most-credible
  // published science across physics, biology, chemistry, climate and space. The
  // "science discovery" tag is whitelisted in research-shared.js and binned to the
  // app's "Science" category + genre by api/research.js.
  { term: "physics chemistry materials breakthrough discovery", tag: "science discovery", n: 5 },
  { term: "biology genetics CRISPR genome cell", tag: "science discovery", n: 4 },
  { term: "climate change environment earth science", tag: "science discovery", n: 4 },
  { term: "astronomy cosmology exoplanet telescope universe", tag: "science discovery", n: 4 },
];
async function queryOpenAlexTopic(term, tag, { sort = "cited_by_count:desc", days = 210, n = 6 } = {}) {
  // ~7-month window (default) so force-tagged topical papers stay RECENT (the old
  // 900-day window + cited-desc surfaced ancient, mega-cited off-topic papers
  // that got mis-binned). Relevance/categorization in api/research.js is the
  // final guard. Consumer-health domains pass sort:"relevance"/days:365 — OpenAlex
  // uses its relevance_score ranking when the `sort` param is omitted.
  const filter = ["type:article", "is_retracted:false", "is_paratext:false", `from_publication_date:${daysAgoISO(days)}`].join(",");
  const sortParam = sort === "relevance" ? "" : `&sort=${sort}`;
  const url = `${OPENALEX}?search=${encodeURIComponent(term)}&filter=${encodeURIComponent(filter)}${sortParam}&per_page=${n}&mailto=support@techscroll.app`;
  try {
    const j = JSON.parse(await getText(url, 10000));
    return (j.results || []).map((w) => {
      const m = mapOAWork(w, { trending: sort !== "relevance" });
      if (m) { m.categories = [tag, ...(m.categories || [])]; m.section = tag; m.topical = true; }
      return m;
    }).filter(Boolean);
  } catch { return []; }
}

function openAlexTopicText(work) {
  const labels = [
    work.title, work.display_name,
    work.primary_topic?.display_name,
    ...(work.topics || []).map((item) => item?.display_name),
    ...(work.keywords || []).map((item) => item?.display_name),
    ...(work.concepts || []).map((item) => item?.display_name),
  ];
  return labels.filter(Boolean).join(" ");
}

// Trusted normalization boundary for exact-topic feeds. OpenAlex's date filters
// reduce payload, but only this predicate decides whether a record may ship.
export function mapOpenAlexTopicWork(work, { topicName, now = new Date() } = {}) {
  const topic = findTopic(topicName);
  if (!topic || !work || work.type !== "article" || work.is_retracted === true || work.is_paratext === true) return null;
  const source = work?.primary_location?.source;
  const doi = String(work?.doi || "");
  if (!/^https:\/\/doi\.org\//i.test(doi) || source?.type !== "journal" || source?.is_core !== true || !source?.display_name) return null;
  if (!parsePublicationDate(work.publication_date) || !isWithinRollingWindow(work.publication_date, now)) return null;
  if (!matchesTopicText(topic, openAlexTopicText(work))) return null;

  const paper = mapOAWork(work, { topic: topic.name });
  if (!paper) return null;
  return {
    ...paper,
    published: parsePublicationDate(work.publication_date).toISOString(),
    canonical_url: paper.link,
    freshness_verified: true,
  };
}

export function buildOpenAlexTopicUrls(topicName, { now = new Date(), pageSize = 50 } = {}) {
  const topic = findTopic(topicName);
  if (!topic) return null;
  const anchor = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(anchor.getTime())) throw new TypeError("Invalid topic request anchor");
  const lower = rollingCutoff(anchor).toISOString().slice(0, 10);
  const upper = anchor.toISOString().slice(0, 10);
  const perPage = Math.max(1, Math.min(50, Number(pageSize) || 50));

  return topic.queries.map((query) => {
    const url = new URL(OPENALEX);
    url.searchParams.set("search", query);
    url.searchParams.set("filter", [
      "type:article", "has_doi:true", "is_retracted:false", "is_paratext:false",
      "primary_location.source.type:journal", "primary_location.source.is_core:true",
      `from_publication_date:${lower}`, `to_publication_date:${upper}`,
    ].join(","));
    url.searchParams.set("sort", "relevance_score:desc");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("mailto", process.env.OPENALEX_MAILTO || "support@techscroll.app");
    if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
    return url.toString();
  });
}

export async function collectTopicPapers(topicName, { now = new Date(), limit = 24 } = {}) {
  const topic = findTopic(topicName);
  if (!topic) return null;
  const maxItems = Math.max(1, Math.min(50, Number(limit) || 24));
  const urls = buildOpenAlexTopicUrls(topic.name, { now, pageSize: Math.min(50, Math.max(24, maxItems * 2)) });
  const responses = await Promise.allSettled(urls.map((url) => getText(url, 12000)));
  const payloads = [];
  for (const result of responses) {
    if (result.status !== "fulfilled") continue;
    try {
      const payload = JSON.parse(result.value);
      if (Array.isArray(payload.results)) payloads.push(payload);
    } catch {}
  }
  if (!payloads.length) throw new Error("OpenAlex provider unavailable");

  const byLink = new Map();
  for (const payload of payloads) {
    for (const work of payload.results) {
      const paper = mapOpenAlexTopicWork(work, { topicName: topic.name, now });
      if (paper && !byLink.has(shortIdKey(paper.link))) byLink.set(shortIdKey(paper.link), paper);
    }
  }
  const papers = [...byLink.values()]
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, maxItems);
  return { papers, providerStatus: payloads.length === urls.length ? "ok" : "partial" };
}

async function collectOpenAlexTopics() {
  const groups = await Promise.all(
    OA_TOPICS.map((t) => queryOpenAlexTopic(t.term, t.tag, { sort: t.sort, days: t.days, n: t.n }))
  );
  return groups.flat();
}

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
  // Physical & life sciences, mind, money, space → Science / Finance genres
  ["cond-mat.mtrl-sci", "q-bio.BM", "physics.app-ph", "q-bio.NC", "q-fin.GN", "q-fin.PM", "econ.GN", "astro-ph.EP",
   // breadth: genomics, medical physics, evolution, chemical physics, general astrophysics
   "q-bio.GN", "physics.med-ph", "q-bio.PE", "physics.chem-ph", "astro-ph.GA"],
];

function arxivGroupURL(cats, n) {
  const q = cats.map((c) => `cat:${c}`).join("+OR+");
  // NOTE: deliberately NO `sortBy=submittedDate` — arXiv's sorted multi-category
  // OR queries are pathologically slow and time out (whole groups drop). Default
  // (relevance) order returns fast; collectPapers re-sorts newest-first by the
  // parsed publish date client-side, so we still surface recent papers.
  return `${ARXIV}?search_query=${q}&max_results=${n}`;
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
  const groupSizes = [14, 30, 34]; // AI core, CS breadth, sciences+mind+money+space (group 3 widened for the added science cats)
  const arxivPromises = ARXIV_GROUPS.map((cats, i) =>
    getText(arxivGroupURL(cats, groupSizes[i]), 13000)
      .then(parseArxiv)
      .catch(() => [])
  );

  const [arxivGroups, oaRecent, oaTrending, oaTopics] = await Promise.all([
    Promise.all(arxivPromises),
    collectOpenAlex(),
    collectOpenAlexTrending(),
    collectOpenAlexTopics(), // guarantees Robotics/Security/Coding/Startups
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

  // Merge arXiv + OpenAlex (incl. topical) + dedup by canonical link key.
  const byKey = new Map();
  for (const p of [...arxivMerged, ...oaTopics, ...oaRecent, ...oaTrending]) {
    const k = shortIdKey(p.link);
    const existing = byKey.get(k);
    if (!existing) byKey.set(k, p);
    // if a paper shows up in both recent + trending, keep the trending flag + citations
    else if (p.trending && !existing.trending) byKey.set(k, { ...existing, trending: true, citations: p.citations, metrics: p.metrics });
  }

  // Force-tagged topical papers (the per-genre guarantees) are cited-desc, so
  // they're often older than the fresh preprints — exempt them from the
  // newest-first cap or whole genres silently vanish.
  const all = [...byKey.values()].sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const topical = all.filter((p) => p.topical);
  const rest = all.filter((p) => !p.topical).slice(0, Math.max(0, MAX - topical.length));
  return [...topical, ...rest]
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""));
}
