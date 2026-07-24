// lib/summarize.js - article summaries for Learnify.
//
// Extractive summaries are assembled from complete publisher sentences. AI
// summaries use the same deterministic quality gate before they can be cached
// or shown, so a missing summary is preferable to a headline echo or ad copy.

const URL = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|org|net|io|ai|co|app|dev)(?:[/?#]\S*)?(?=[.!?,;:]?\s*$)/i;
const HTML = /<\/?[a-z][^>]*>/i;
const BOILERPLATE = [
  /\bread (?:more|the (?:full|original) article)\b/i,
  /\bcontinue reading\b/i,
  /\bthe post\b[\s\S]*\bappeared first on\b/i,
  /\bclick here\b/i,
  /\bsubscribe\b(?:[\s\S]*\bnewsletter\b)?/i,
  /\bsign up for (?:our|the) newsletter\b/i,
  /\b(?:article|comments) url\s*:/i,
  /\bpoints\s*:\s*\d+/i,
  /\ball rights reserved\b/i,
  /\bfollow us (?:on|for)\b/i,
  /\boriginally (?:appeared|published) (?:at|in|on)\b/i,
];
const PROMOTIONAL = [
  /\b(?:sponsored content|sponsored post|sponsored by|sponsor message|paid content|paid post|paid partnership|advertorial|advertisement|affiliate links?|buy now|shop now|order now|free credits?|use code|promo code|coupon code|discount code|limited[- ]time offer|sign up now|sign up today|sign up for free|subscribe now|brought to you by)\b/i,
  /\b(?:sponsored (?:content|post)|paid (?:content|post|partnership)|advertorial|advertisement|affiliate links?)\b|^sponsored by\b/i,
  /\b(?:buy|shop|order) now\b/i,
  /\b(?:claim|redeem) (?:your|the|these)?\s*(?:free|offer|discount|credits?)\b/i,
  /\b(?:promo|coupon|discount) code\b/i,
  /\blimited[- ]time offer\b/i,
  /\b(?:sign|get) up (?:now|today|for free)\b/i,
  /\btry (?:it|this|\w+) (?:for )?free\b/i,
  /\bget \d+ (?:in )?free credits?\b/i,
  /\bbrought to you by\b/i,
];
const VAGUE = [
  /^(?:discover|explore|learn|find out|unlock|experience|reimagine|supercharge)\b/i,
  /^(?:this (?:article|post|story)|in this (?:article|post|story)|we (?:explore|explain|take a look))\b/i,
  /\b(?:everything|all|what) you need to know\b/i,
  /\b(?:the future is here|game[- ]changer|one \w+ at a time)\b/i,
  /\bworth (?:a look|checking out|reading)\b/i,
];
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by",
  "for", "from", "has", "have", "how", "in", "into", "is", "it", "its", "of",
  "on", "or", "that", "the", "their", "this", "to", "was", "were", "what", "when",
  "where", "which", "who", "why", "will", "with",
]);

const sentenceSegmenter = typeof Intl?.Segmenter === "function"
  ? new Intl.Segmenter("en", { granularity: "sentence" })
  : null;

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function words(text) {
  return normalize(text).match(/[a-z0-9]+(?:['\u2019][a-z0-9]+)*/gi) || [];
}

function stem(token) {
  let value = token.toLowerCase().replace(/['\u2019]s$/, "");
  if (value.length > 5 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 5 && value.endsWith("ing")) value = value.slice(0, -3);
  else if (value.length > 4 && value.endsWith("ed")) value = value.slice(0, -2);
  else if (value.length > 4 && value.endsWith("es")) value = value.slice(0, -2);
  else if (value.length > 3 && value.endsWith("s")) value = value.slice(0, -1);
  return value;
}

function contentTokens(text) {
  return new Set(words(text)
    .map((word) => word.toLowerCase().replace(/['\u2019]s$/, ""))
    .filter((word) => !STOP_WORDS.has(word))
    .map(stem)
    .filter((word) => word.length > 1));
}

function titleFrom(articleOrTitle) {
  return typeof articleOrTitle === "string"
    ? articleOrTitle
    : articleOrTitle?.title || "";
}

function echoesTitle(summary, articleOrTitle) {
  const title = normalize(titleFrom(articleOrTitle));
  if (!title) return false;

  const comparable = (value) => normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (comparable(summary) === comparable(title)) return true;

  const titleTokens = contentTokens(title);
  const summaryTokens = contentTokens(summary);
  if (titleTokens.size < 3 || !summaryTokens.size) return false;

  let shared = 0;
  for (const token of titleTokens) if (summaryTokens.has(token)) shared += 1;
  const coverage = shared / titleTokens.size;
  const union = new Set([...titleTokens, ...summaryTokens]).size;
  const jaccard = union ? shared / union : 0;
  const extra = summaryTokens.size - shared;
  return coverage >= 0.8 && (jaccard >= 0.78 || extra <= 1);
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isComplete(text) {
  const value = normalize(text);
  if (!value || /(?:\.\.\.|\u2026)["'\u2019\u201d)\]]*$/.test(value)) return false;
  const sentence = value.replace(/["'\u2019\u201d)\]]+$/, "");
  if (!/[.!?]$/.test(sentence)) return false;
  return !/\s[a-z]\.$/.test(sentence);
}

function isNoise(text) {
  return URL.test(text)
    || HTML.test(text)
    || hasAny(text, BOILERPLATE)
    || hasAny(text, PROMOTIONAL);
}

/**
 * Deterministic gate for summaries shown in the feed.
 *
 * Rejects headline echoes, ads/boilerplate, URLs, slogans, vague blurbs, and
 * clipped output. The article argument may be an article object or a title.
 */
export function isSummaryUseful(summary, article = {}) {
  const text = normalize(summary);
  const allWords = words(text);
  if ([...text].length < 55 || allWords.length < 10 || contentTokens(text).size < 5) return false;
  if (!isComplete(text) || isNoise(text) || hasAny(text, VAGUE)) return false;
  return !echoesTitle(text, article);
}

function completeSentences(text) {
  const value = normalize(text);
  if (!value) return [];
  if (sentenceSegmenter) {
    return [...sentenceSegmenter.segment(value)]
      .map(({ segment }) => normalize(segment))
      .filter(isComplete);
  }
  return value.match(/.*?[.!?]+(?:["'\u2019\u201d)\]]+)?(?=\s+[A-Z0-9"'(]|$)/g)?.map(normalize) || [];
}

/**
 * Build a concise summary from complete, useful publisher sentences.
 * Returns an empty string when the excerpt has no trustworthy information.
 */
export function streamline(article) {
  const cap = article?.is_paper ? 360 : 300;
  const selected = [];

  for (const sentence of completeSentences(article?.summary)) {
    if (isNoise(sentence) || hasAny(sentence, VAGUE) || echoesTitle(sentence, article)) continue;
    if (words(sentence).length < 5) continue;

    const candidate = [...selected, sentence].join(" ");
    if (candidate.length > cap) {
      if (selected.length) break;
      continue;
    }
    selected.push(sentence);
    if (selected.length === 2) break;
  }

  const result = selected.join(" ");
  return isSummaryUseful(result, article) ? result : "";
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
          { role: "system", content: "You are a sharp tech-news editor. Given a headline and excerpt, reply with ONLY a punchy, factual 2-sentence summary for a fast news feed. No preamble, no markdown, no hashtags, no emojis. Do not repeat the headline, use promotional language, include links, or invent facts. Finish every sentence." },
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
    const raw = (j?.choices?.[0]?.message?.content || "")
      .replace(/^\s*(summary|here'?s.*?:)\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const summary = streamline({ ...article, summary: raw });
    return summary || null;
  } catch {
    return null;
  } finally { clearTimeout(t); }
}
