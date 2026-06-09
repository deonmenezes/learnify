// GET /api/research — LIVE trending/top research papers for the Learnify app.
//
// Sources real papers from lib/papers.js (arXiv newest across cs.AI/LG/CL/CV +
// OpenAlex recent + OpenAlex most-cited "trending"), de-duplicated, mapped to the
// app's research schema. Link-out only — links to the canonical source.
//
// Query params (optional):
//   category  filter by app category value (e.g. "AI / ML", "Science")
//   limit     max papers (default all)
//   sort      "trending" (default, by momentum) | "citations" | "recent"
//
// Response: { generated_at, count, papers: [
//   { id, title, org, category, summary, citations, trend, url } ] }
//
// CORS open. Edge-cached ~30m with stale-while-revalidate so it stays fresh + fast.

import { collectPapers } from "../lib/papers.js";

// The app DROPS any paper whose `category` is not one of these exact NewsCategory
// rawValues: "AI / ML", "Robotics", "Coding & Dev Tools", "Startups & Funding",
// "Hardware & Gadgets", "Security", "Science".
// Papers now span all categories via arXiv breadth (cs.RO, cs.CR, cs.SE, cs.PL,
// cs.AR, cs.HC, eess.SY, cond-mat.mtrl-sci, q-bio.BM, physics.app-ph) and
// OpenAlex concepts. Classifier order: most-specific first, AI/ML last as default.
// RELEVANCE GATE — this is an AI/tech/science reader, NOT a med/social-science
// digest. OpenAlex's "recent AI" tier floods with applied-ML papers from clinical
// medicine, epidemiology, psychology, education and pure social science; those
// bury the genuine CS/AI/eng work from arXiv. Drop a paper that reads off-topic
// UNLESS it also carries a hard CS/AI/engineering signal (e.g. a real ML-systems
// paper that happens to mention "clinical").
const OFFTOPIC = /\b(disease|clinical|patient|cancer|tumou?rs?|oncolog\w*|epidemiolog\w*|mortalit\w*|prevalence|incidence|comorbid\w*|disabilit\w*|metaboli\w*|metabolom\w*|cytometr\w*|genome-wide|gwas|biomarker\w*|therapeutic\w*|\btherapy\b|diagnos\w*|surgery|surgical|nursing|psycholog\w*|psychiatr\w*|learner aptitude|second[- ]language|institutional distance|drug discovery|pharmac\w*|vaccine\w*|antibod\w*|cohort study|randomi[sz]ed controlled|public health|clinical trial|\bpedagog\w*)\b/i;
const TECHSIG = /\b(algorithm|neural network|transformer|\bllm\b|large language model|\bgpu\b|robot\w*|autonomous|software|compiler|programming|cryptograph\w*|encryption|semiconductor|quantum comput\w*|reinforcement learning|computer vision|benchmark|inference|fine[- ]tun\w*|diffusion model|graph neural|\bfpga\b|chip design|distributed system|operating system|database system|kubernetes|\bcs\.[a-z]{2}\b)\b/i;

// Sections that lib/papers.js force-tags onto curated topical OpenAlex picks
// (these are intentionally on-topic even without a lexical tech signal — e.g.
// startup/funding papers).
const TOPIC_TAGS = new Set([
  "robotics", "security cryptography", "software engineering",
  "startup venture funding business model",
]);

// Runs on a RAW paper (has source/section), so we can trust arXiv wholesale and
// hold OpenAlex to a higher bar. Keeps: all arXiv (curated CS/AI/science), the
// curated topical picks, and OpenAlex papers with a real tech signal. Drops:
// clinical/med/psych/social-science noise and "applied-ML-to-random-field".
// Crackpot / non-English / garbage preprint guard. A real paper title is mostly
// Latin script, a reasonable length, and doesn't lead with a math-symbol token
// (e.g. "SΔϕ-62 — World Model Kernel").
function looksLikeJunk(title) {
  const t = String(title || "").trim();
  if (t.length < 14) return true;
  const ascii = (t.match(/[\x20-\x7E]/g) || []).length / t.length;
  if (ascii < 0.9) return true;              // mostly non-Latin → non-English / garbage
  if (/^[^A-Za-z0-9"'(]/.test(t)) return true; // leads with a symbol → odd
  return false;
}

function isRelevantRaw(p) {
  const hay = `${p.title || ""} ${p.summary || ""}`.toLowerCase();
  if (looksLikeJunk(p.title)) return false;
  if (OFFTOPIC.test(hay) && !TECHSIG.test(hay)) return false;
  if (p.source_id === "arxiv" || p.source === "arXiv") return true;
  if (TOPIC_TAGS.has(p.section)) return true;
  return TECHSIG.test(hay);
}

// The app DROPS any paper whose `category` is not one of these exact NewsCategory
// rawValues: "AI / ML", "Robotics", "Coding & Dev Tools", "Startups & Funding",
// "Hardware & Gadgets", "Security", "Science".
// Classifier order: most-specific first; life/physical-science (incl. medicine)
// goes BEFORE the Coding bucket so force-tagged medical papers route to Science,
// AI/ML last as default.
function toAppCategory(p) {
  const hay = `${p.section || ""} ${(p.categories || []).join(" ")} ${p.id || ""} ${p.title || ""}`.toLowerCase();
  const title = (p.title || "").toLowerCase();

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

function toResearch(p) {
  const org = String(p.author || p.source || "Research").slice(0, 80);
  const summary = (p.summary && p.summary.trim()) || `Recent ${p.source || "research"} paper.`;
  return {
    id: p.id || idFor(String(p.title || "")),
    title: String(p.title || "").trim(),
    org,
    category: toAppCategory(p),
    summary,
    citations: Number.isFinite(p.citations) ? p.citations : 0,
    trend: trendScore(p),
    url: String(p.link || "").trim(),
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
  // Default to FRESH (newest-first). The app requests sort=recent; "trending"
  // (most-cited) is opt-in only, since most-cited skews old + medical.
  const sort = str(req.query?.sort) || "recent";
  const limit = parseInt(str(req.query?.limit), 10);

  let papers = [];
  try {
    const raw = await collectPapers();
    papers = raw.filter(isRelevantRaw).map(toResearch).filter((p) => p.title && p.url);
  } catch (err) {
    // Never 500 the tab — the app has its own bundled-sample fallback.
    return res.status(200).json({ generated_at: new Date().toISOString(), count: 0, papers: [], error: String(err) });
  }

  if (category) papers = papers.filter((p) => p.category.toLowerCase() === category);
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
