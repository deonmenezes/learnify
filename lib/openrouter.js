// lib/openrouter.js — keyless "just released" model tier for the leaderboard.
//
// Chatbot Arena (arena.ai) only ranks a model after weeks of human votes, so
// brand-new models (e.g. Claude Opus 4.8) aren't on the ELO board yet. This
// surfaces the NEWEST models from OpenRouter's public catalog (keyless, real,
// updated continuously) as a separate "Just Released" strip — clearly NOT an
// arena ranking, just "this shipped, arena hasn't scored it yet."

const URL = "https://openrouter.ai/api/v1/models";
const UA = "Mozilla/5.0 (compatible; TechScroll/1.0; +https://techscroll.app/)";

// id prefix → friendly lab (mirrors the app's AILab where possible).
const LAB = [
  [/^anthropic\//, "Anthropic"], [/^openai\//, "OpenAI"],
  [/^google\//, "Google"], [/^meta-llama\/|^meta\//, "Meta"],
  [/^x-ai\//, "xAI"], [/^mistralai\/|^mistral\//, "Mistral"],
  [/^deepseek\//, "DeepSeek"], [/^qwen\//, "Qwen"],
  [/^minimax\//, "MiniMax"], [/^stepfun\//, "StepFun"],
  [/^moonshot/, "Moonshot"], [/^cohere\//, "Cohere"],
  [/^nvidia\//, "NVIDIA"], [/^z-ai\/|^zhipu/, "Zhipu"],
];
function labOf(id) {
  for (const [re, name] of LAB) if (re.test(id)) return name;
  return (id.split("/")[0] || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function prettyName(m) {
  // OpenRouter names look like "Anthropic: Claude Opus 4.8" — drop the lab prefix.
  return String(m.name || m.id).replace(/^[^:]+:\s*/, "").trim();
}

async function getJson(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Only surface credible, recognizable labs in the "just released" strip — keeps
// it trustworthy and skips obscure router/aggregator rows.
const MAJOR_LABS = new Set([
  "Anthropic", "OpenAI", "Google", "Meta", "xAI", "Mistral", "DeepSeek",
  "Qwen", "MiniMax", "Moonshot", "NVIDIA", "Cohere", "StepFun", "Zhipu",
]);
const baseId = (id) => id.replace(/[-:](fast|mini|nano|thinking|preview|search|high|low|free)$/i, "");

/**
 * Newest models from the major labs, freshest first. Collapses a model and its
 * "-fast"/"-mini" variants to ONE row (preferring the canonical, non-variant id),
 * and drops obscure labs. Returns [] on any failure.
 * @param {number} [limit] how many to return (default 10)
 */
export async function collectNewReleases(limit = 10) {
  let data;
  try { data = (await getJson(URL)).data || []; } catch { return []; }

  // Group by base id; for each, prefer the canonical (id === base) over a variant.
  const byBase = new Map();
  for (const m of data) {
    if (!m.created || !m.id || m.id.startsWith("~")) continue;
    if (!MAJOR_LABS.has(labOf(m.id))) continue;
    const base = baseId(m.id);
    const prev = byBase.get(base);
    const isCanonical = m.id === base;
    if (!prev || (isCanonical && prev.id !== base) || m.created > prev.created) {
      // keep canonical if available, else newest
      if (!prev || isCanonical || m.created > prev.created) byBase.set(base, m);
    }
  }

  return [...byBase.values()]
    .sort((a, b) => b.created - a.created)
    .slice(0, limit)
    .map((m) => ({
      id: m.id,
      name: prettyName(m),
      lab: labOf(m.id),
      released: new Date(m.created * 1000).toISOString().slice(0, 10),
      released_ts: m.created,
      context: m.context_length || m.top_provider?.context_length || null,
      is_new: true,
      note: "Newly released — not yet arena-ranked",
    }));
}
