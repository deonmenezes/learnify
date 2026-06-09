// lib/summarize.js — streamlined article summaries for Learnify.
//
// Two tiers, mirroring the media pipeline (lib/media.js):
//   1. EXTRACTIVE (default, keyless, instant) — `streamline()` cleans the
//      existing excerpt into a tight 2-sentence blurb. Pure string work, runs
//      inline in the API for EVERY item, so something always shows.
//   2. AI (opt-in, via NVIDIA Nemotron) — `aiSummarize()` rewrites it into a
//      crisp editorial summary. Slow (~10s/call) + needs a key, so it runs in
//      the hourly precompute (scripts/enrich.mjs), NOT inline. Results are
//      cached by id and attached to the live feed.
//
// Both tiers ALWAYS keep the original article link — the summary is a teaser,
// the headline + link-out go to the real source.

// ---- extractive (inline, keyless) ------------------------------------------

const BOILER = [
  /^read more[:.]?/i, /^the post .* appeared first on .*$/i,
  /\bclick here\b/i, /\bsubscribe\b.*\bnewsletter\b/i,
];

function firstSentences(text, max = 2, cap = 240) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const parts = t.match(/[^.!?]+[.!?]+/g) || [t];
  let out = "";
  for (const p of parts) {
    if (out && (out.length + p.length) > cap) break;
    out += p;
    if (out.split(/[.!?]+/).filter((s) => s.trim()).length >= max) break;
  }
  out = (out || t).trim();
  if (out.length > cap) out = out.slice(0, cap).replace(/\s+\S*$/, "") + "…";
  return out;
}

/**
 * Fast, deterministic streamlined summary from whatever text we already have.
 * @returns {string} 1–2 clean sentences (never the raw publisher HTML).
 */
export function streamline(article) {
  let base = (article.summary || "").trim();
  for (const re of BOILER) base = base.replace(re, "").trim();
  // arXiv abstracts and tweets are already prose; news excerpts may be terse.
  let s = firstSentences(base, 2, article.is_paper ? 300 : 240);
  if (!s || s.length < 30) {
    // fall back to the headline as a one-liner so the field is never empty
    s = (article.title || "").trim();
  }
  return s;
}

// ---- AI tier (precompute only) ---------------------------------------------

function env(k, d) { return (process.env[k] || d || "").trim(); }

/**
 * Rewrite an article into a crisp 2-sentence editorial summary via NVIDIA
 * Nemotron. Returns null on any failure (caller keeps the extractive version).
 * Reads NVIDIA_API_KEY / NVIDIA_BASE_URL / NVIDIA_LLM_MODEL from env.
 */
export async function aiSummarize(article, { timeoutMs = 45000 } = {}) {
  const key = env("NVIDIA_API_KEY");
  if (!key) return null;
  const base = env("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1");
  const model = env("NVIDIA_LLM_MODEL", "nvidia/nemotron-3-super-120b-a12b");

  const src = [article.title, article.summary].filter(Boolean).join(". ").slice(0, 1200);
  if (!src) return null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a sharp tech-news editor. Given a headline and excerpt, reply with ONLY a punchy, factual 2-sentence summary for a fast news feed. No preamble, no markdown, no hashtags, no emojis. Do not invent facts." },
          { role: "user", content: `Headline + excerpt:\n${src}` },
        ],
        max_tokens: 4096,
        temperature: 0.4,
        top_p: 0.95,
        // nemotron-3-super: disable the long reasoning trace for speed
        extra_body: { chat_template_kwargs: { enable_thinking: false } },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    let out = j?.choices?.[0]?.message?.content || "";
    out = out.replace(/^\s*(summary|here'?s.*?:)\s*/i, "").replace(/\s+/g, " ").trim();
    if (out.length < 30) return null;
    if (out.length > 360) out = out.slice(0, 360).replace(/\s+\S*$/, "") + "…";
    return out;
  } catch {
    return null;
  } finally { clearTimeout(t); }
}
