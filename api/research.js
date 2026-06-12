// GET /api/research — LIVE trending/top research papers for the Learnify app.
//
// Sources real papers from lib/papers.js (arXiv newest across cs.AI/LG/CL/CV +
// OpenAlex recent + OpenAlex most-cited "trending"), de-duplicated, mapped to the
// app's research schema. Link-out only — links to the canonical source.
//
// Query params (optional):
//   category  filter by app category value (e.g. "AI / ML", "Science")
//   genre     filter by fine-grained genre (e.g. "Fitness", "Skincare",
//             "Finance", "Nutrition", "Mind & Psychology", "Space")
//   limit     max papers (default all)
//   sort      "trending" (default, by momentum) | "citations" | "recent"
//
// Response: { generated_at, count, papers: [
//   { id, title, org, category, genre, summary, citations, trend, url,
//     original_title, image } ] }
// `genre` is ADDITIVE (the iOS app ignores unknown fields); `category` still
// maps every paper into the app's fixed NewsCategory set.
// `title`/`summary` are the precomputed addictive headline + hook from
// papers-enriched.json (scripts/enrich.mjs) when available — falling back to
// the raw arXiv/OpenAlex title + abstract. `original_title` always carries the
// raw title; `image` is the absolute URL of the generated Flux cover (or null).
//
// CORS open. Edge-cached ~30m with stale-while-revalidate so it stays fresh + fast.

import { readFileSync } from "node:fs";
import { collectPapers } from "../lib/papers.js";
import { isRelevantRaw } from "../lib/research-shared.js";

// Precomputed per-paper enrichment (headline/hook/cover) from scripts/enrich.mjs.
// Same readFileSync-try/catch convention as the enriched.json article cache —
// a missing/corrupt file just means raw titles/abstracts (never a 500).
function loadPapersEnriched() {
  try {
    const j = JSON.parse(readFileSync(new URL("../papers-enriched.json", import.meta.url), "utf-8"));
    return j && j.papers && typeof j.papers === "object" ? j.papers : {};
  } catch { return {}; }
}

// The app DROPS any paper whose `category` is not one of these exact NewsCategory
// rawValues: "AI / ML", "Robotics", "Coding & Dev Tools", "Startups & Funding",
// "Hardware & Gadgets", "Security", "Science", "Fitness", "Skincare".
// ("Fitness"/"Skincare" are NEW — the iOS side is adding matching enum cases;
// old app builds silently drop them, which is the intended safe degradation.)
// Papers now span all categories via arXiv breadth (cs.RO, cs.CR, cs.SE, cs.PL,
// cs.AR, cs.HC, eess.SY, cond-mat.mtrl-sci, q-bio.BM, physics.app-ph) and
// OpenAlex concepts. Classifier order: most-specific first, AI/ML last as default.
// RELEVANCE GATE — isRelevantRaw/looksLikeJunk now live in lib/research-shared.js
// (shared with scripts/enrich.mjs so we only enrich papers that actually ship).

// The app DROPS any paper whose `category` is not one of these exact NewsCategory
// rawValues: "AI / ML", "Robotics", "Coding & Dev Tools", "Startups & Funding",
// "Hardware & Gadgets", "Security", "Science", "Fitness", "Skincare".
// Classifier order: most-specific first; life/physical-science (incl. medicine)
// goes BEFORE the Coding bucket so force-tagged medical papers route to Science,
// AI/ML last as default.
// Force-tagged genre sections (lib/papers.js OA_TOPICS) → app category.
// Fitness + Skincare route to NEW app-category rawValues ("Fitness"/"Skincare")
// — the iOS side is adding matching NewsCategory enum cases; older app builds
// silently drop unknown categories (intended safe degradation). The remaining
// human-science genres still ride the app's "Science" bucket; money rides
// "Startups & Funding". The fine-grained genre also ships in the additive
// `genre` field below.
const TAG_TO_APP = {
  "fitness exercise": "Fitness",
  "skincare dermatology": "Skincare",
  "nutrition diet": "Science",
  "psychology mind": "Science",
  "longevity health": "Science",
  "finance investing": "Startups & Funding",
};

// Fine-grained genre for the website/genre filters — ADDITIVE field, the iOS
// app ignores it (decoders are Optional). Force-tag first, then arXiv subject
// codes, then keyword fallback; defaults to the app category.
const TAG_TO_GENRE = {
  "fitness exercise": "Fitness",
  "skincare dermatology": "Skincare",
  "nutrition diet": "Nutrition",
  "psychology mind": "Mind & Psychology",
  "longevity health": "Longevity",
  "finance investing": "Finance",
  "robotics": "Robotics",
  "security cryptography": "Security",
  "software engineering": "Coding & Dev Tools",
};
function toGenre(p, appCategory) {
  if (TAG_TO_GENRE[p.section]) return TAG_TO_GENRE[p.section];
  const hay = `${p.section || ""} ${(p.categories || []).join(" ")} ${p.title || ""}`.toLowerCase();
  if (/q-fin|econ\.gn|\bfinance\b|investing|portfolio|asset pricing|household finance|stock market/.test(hay)) return "Finance";
  if (/q-bio\.nc|neurosci|cognit|\bsleep\b|psycholog|memory consolidation|\bbrain\b/.test(hay)) return "Mind & Psychology";
  if (/astro-ph|exoplanet|\bplanet\b|cosmolog|telescope|\bspace\b/.test(hay)) return "Space";
  if (/exercise|resistance training|muscle|endurance|athlet|\bvo2\b/.test(hay)) return "Fitness";
  if (/dermatolog|\bskin\b|sunscreen|cosmetic/.test(hay)) return "Skincare";
  if (/nutrition|\bdiet\b|dietary|protein intake|metabolism/.test(hay)) return "Nutrition";
  if (/longevity|aging|healthspan|lifespan/.test(hay)) return "Longevity";
  return appCategory;
}

function toAppCategory(p) {
  const hay = `${p.section || ""} ${(p.categories || []).join(" ")} ${p.id || ""} ${p.title || ""}`.toLowerCase();
  const title = (p.title || "").toLowerCase();

  // Force-tagged genre picks route directly (before any keyword heuristics)
  if (TAG_TO_APP[p.section]) return TAG_TO_APP[p.section];

  // Robotics — specific enough to go first
  if (/\brobot|locomotion|quadruped|manipulation|\bcs\.ro\b/.test(hay)) return "Robotics";

  // Security / Cryptography
  if (/secur|cryptograph|adversarial|malware|vulnerab|\bcs\.cr\b/.test(hay)) return "Security";

  // Life / physical sciences & medicine → Science (judged on the TITLE, before
  // the Coding bucket, so a force-tagged "software engineering" medical paper
  // can't masquerade as Coding & Dev Tools).
  if (/disease|clinical|patient|cancer|tumou?r|oncolog|epidemiolog|mortalit|metaboli|metabolom|cytometr|genom|protein|biomarker|therap|diagnos|vaccine|\bcell\b|molecul|chemi|materials|cond-mat|\bphysics\b|astro|\btelescope\b|interferometr|exoplanet|radial[- ]velocity|cosmolog|climate|neurosci|q-bio|biolog|supercond|\bquantum\b/.test(title)) return "Science";

  // Coding & Dev Tools — software eng + PL before generic CS catch-alls
  if (/software engineering|programming language|compiler|\bcode\b|developer|debug|\bcs\.se\b|\bcs\.pl\b|static analysis|software dev/.test(hay)) return "Coding & Dev Tools";

  // Hardware & Gadgets — silicon, chips, architecture, photonics, systems
  if (/semiconduct|\bhardware\b|fpga|circuit|photonic|\bgpu\b|accelerator|\bchip\b|\basic\b|\bcs\.ar\b|applied physics|\beess\b/.test(hay)) return "Hardware & Gadgets";

  // Science — materials, physics, bio, chemistry, earth sciences (from any field)
  if (/supercond|materials|cond-mat|physics|biolog|chemi|astro|quantum|genom|protein|climate|neurosci|q-bio|biomolecul/.test(hay)) return "Science";

  // Startups & Funding — light signal; only if nothing more specific matched
  if (/venture|startup|fundrais|business model|q-fin|econ\.gn|market dynamics/.test(hay)) return "Startups & Funding";

  return "AI / ML"; // arXiv cs.AI/LG/CL/CV + OpenAlex AI concepts default to AI/ML
}

// A 0…99 momentum score: most-cited "trending" papers scale by citations; fresh
// papers score by recency so the newest work still surfaces near the top.
function trendScore(p) {
  if (p.trending && p.citations) return Math.min(99, Math.max(20, Math.round(p.citations / 25)));
  if (p.published) {
    // Clamp days to >= 0 so future-dated items can't blow the score up.
    const days = Math.max(0, (Date.now() - new Date(p.published).getTime()) / 86_400_000);
    if (!Number.isNaN(days)) return Math.max(1, Math.min(70, Math.round(45 - days)));
  }
  return p.citations ? Math.min(60, Math.round(p.citations / 40)) : 5;
}

function idFor(title) {
  let h = 0;
  for (let i = 0; i < title.length; i++) { h = (h * 31 + title.charCodeAt(i)) >>> 0; }
  return `p_${h.toString(16)}`;
}

// `enr` is the precomputed papers-enriched.json entry for this paper (may be
// undefined); `base` is the absolute origin ("https://host") for cover URLs.
// Enriched papers ship the addictive headline as `title` and the hook as
// `summary` (raw title/abstract are the fallbacks); `original_title` always
// carries the raw title, `image` the generated Flux cover (or null).
function toResearch(p, enr, base) {
  const org = String(p.author || p.source || "Research").slice(0, 80);
  const rawTitle = String(p.title || "").trim();
  const rawSummary = (p.summary && p.summary.trim()) || `Recent ${p.source || "research"} paper.`;
  const headline = (enr && typeof enr.headline === "string" && enr.headline.trim()) || "";
  const hook = (enr && typeof enr.hook === "string" && enr.hook.trim()) || "";
  const cover = (enr && typeof enr.cover === "string" && enr.cover.startsWith("/paper-covers/")) ? enr.cover : null;
  const appCategory = toAppCategory(p);
  return {
    id: p.id || idFor(rawTitle),
    title: headline || rawTitle,
    org,
    category: appCategory,
    genre: toGenre(p, appCategory),
    summary: hook || rawSummary,
    citations: Number.isFinite(p.citations) ? p.citations : 0,
    trend: trendScore(p),
    url: String(p.link || "").trim(),
    original_title: rawTitle,
    image: cover ? `${base}${cover}` : null,
  };
}

function str(v) { return (Array.isArray(v) ? v[0] : v || "").toString().trim(); }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const category = str(req.query?.category).toLowerCase();
  const genre = str(req.query?.genre).toLowerCase();
  // Default to FRESH (newest-first). The app requests sort=recent; "trending"
  // (most-cited) is opt-in only, since most-cited skews old + medical.
  const sort = str(req.query?.sort) || "recent";
  const limit = parseInt(str(req.query?.limit), 10);

  // Absolute origin for cover-image URLs — built exactly like api/articles.js.
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const base = host ? `${proto}://${host}` : "";

  let papers = [];
  try {
    const raw = await collectPapers();
    const enriched = loadPapersEnriched();
    papers = raw.filter(isRelevantRaw).map((p) => toResearch(p, enriched[p.id], base)).filter((p) => p.title && p.url);
  } catch (err) {
    // Never 500 the tab — the app has its own bundled-sample fallback.
    return res.status(200).json({ generated_at: new Date().toISOString(), count: 0, papers: [], error: String(err) });
  }

  if (category) papers = papers.filter((p) => p.category.toLowerCase() === category);
  if (genre) papers = papers.filter((p) => (p.genre || "").toLowerCase() === genre);
  papers.sort((a, b) => {
    if (sort === "citations") return b.citations - a.citations;
    if (sort === "trending") return b.trend - a.trend;
    return 0; // "recent"/"fresh" (default): collectPapers already newest-first
  });
  if (!Number.isNaN(limit)) papers = papers.slice(0, Math.max(0, limit));

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    count: papers.length,
    papers,
  });
}
