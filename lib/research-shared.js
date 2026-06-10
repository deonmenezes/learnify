// lib/research-shared.js — the research relevance gate, shared between the live
// API (api/research.js) and the precompute pass (scripts/enrich.mjs).
//
// Extracted so enrich.mjs can apply the EXACT same gating before paying for
// LLM headlines/hooks + Flux covers — we only enrich papers that will actually
// ship through /api/research. api/research.js imports these unchanged; its
// response shape is identical.

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

// Crackpot / non-English / garbage preprint guard. A real paper title is mostly
// Latin script, a reasonable length, and doesn't lead with a math-symbol token
// (e.g. "SΔϕ-62 — World Model Kernel").
export function looksLikeJunk(title) {
  const t = String(title || "").trim();
  if (t.length < 14) return true;
  const ascii = (t.match(/[\x20-\x7E]/g) || []).length / t.length;
  if (ascii < 0.9) return true;              // mostly non-Latin → non-English / garbage
  if (/^[^A-Za-z0-9"'(]/.test(t)) return true; // leads with a symbol → odd
  return false;
}

// Runs on a RAW paper (has source/section), so we can trust arXiv wholesale and
// hold OpenAlex to a higher bar. Keeps: all arXiv (curated CS/AI/science), the
// curated topical picks, and OpenAlex papers with a real tech signal. Drops:
// clinical/med/psych/social-science noise and "applied-ML-to-random-field".
export function isRelevantRaw(p) {
  const hay = `${p.title || ""} ${p.summary || ""}`.toLowerCase();
  if (looksLikeJunk(p.title)) return false;
  if (OFFTOPIC.test(hay) && !TECHSIG.test(hay)) return false;
  if (p.source_id === "arxiv" || p.source === "arXiv") return true;
  if (TOPIC_TAGS.has(p.section)) return true;
  return TECHSIG.test(hay);
}
