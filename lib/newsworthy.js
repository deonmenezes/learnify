// lib/newsworthy.js — keyless "is this tweet report-worthy?" + sentiment scorer.
//
// Learnify pulls posts from a handful of major tech personalities/orgs
// (Sam Altman, Anthropic, Claude, NVIDIA, Claude devs…). Most of what they
// post is banter, replies, or "gm" — NOT news. Before a post is surfaced as a
// news item we score it: is it actually report-worthy, what's the tone, and
// what kind of story is it (launch / funding / research / commentary…).
//
// Pure, deterministic, zero external calls and zero API keys — runs inline in
// the serverless feed collector so the social tier stays "fast af". The result
// is intentionally explainable: every verdict ships the reasons that produced
// it, so the UI (and a human) can see *why* a tweet was deemed news.

// ---- lexicons --------------------------------------------------------------

// High-signal "something happened" verbs/phrases — the backbone of an announcement.
const ANNOUNCE = [
  "introducing", "announcing", "announced", "we're announcing", "today we",
  "today we're", "excited to announce", "excited to share", "thrilled to",
  "launching", "launched", "we launched", "now available", "available now",
  "available today", "generally available", "general availability", "rolling out",
  "rolled out", "now live", "is live", "go live", "shipping", "we shipped",
  "shipped", "release", "released", "releasing", "unveil", "unveiled", "debut",
  "debuts", "out now", "starting today", "coming soon", "early access",
  "public beta", "waitlist", "sign up", "you can now", "we just",
];

// Domain nouns that make a post substantive tech news.
const TECH_TERMS = [
  "model", "models", "gpt", "claude", "gemini", "llama", "grok", "nemotron",
  "opus", "sonnet", "haiku", "api", "sdk", "agent", "agents", "open source",
  "open-source", "open weights", "weights", "benchmark", "benchmarks", "sota",
  "state of the art", "state-of-the-art", "research", "paper", "preprint",
  "context window", "tokens", "inference", "training", "fine-tune", "fine-tuning",
  "gpu", "gpus", "chip", "chips", "blackwell", "hopper", "cuda", "datacenter",
  "data center", "robotics", "autonomy", "multimodal", "reasoning", "voice mode",
  "feature", "features", "update", "version", "v2", "v3", "platform", "integration",
];

// Business / money signals.
const BUSINESS = [
  "raised", "raises", "funding", "series a", "series b", "series c", "seed round",
  "valuation", "valued at", "billion", "million", "$", "ipo", "acquire", "acquired",
  "acquisition", "acquires", "merger", "partnership", "partner with", "partnering",
  "deal", "contract", "customers", "enterprise", "revenue", "arr",
  "ipo", "s-1", "s1", "registration statement", "going public", "public offering",
  "stake", "investment", "invests", "buyout",
];

// Words that signal personal banter / non-news (drag the score down).
const BANTER = [
  "gm", "good morning", "lol", "lmao", "haha", "congrats", "congratulations",
  "thank you", "thanks", "thx", "happy birthday", "rip", "love this", "love it",
  "so true", "this", "agree", "agreed", "100%", "based", "vibes", "fyi", "btw",
  "hot take", "unpopular opinion", "wow", "amazing", "incredible", "beautiful",
  "see you", "let's go", "lets go", "lfg", "gn", "good night",
  // event / booth / merch chatter — common from org accounts at conferences,
  // reads upbeat but is not news.
  "gear store", "merch", "swag", "stop by", "come by", "say hi", "see you at",
  "join us at", "booth", "get your", "great food", "grab a", "on the ground",
  "live from", "happening now at", "this week at",
];

// Sentiment lexicons (compact, tech-news tuned).
const POS = [
  "excited", "thrilled", "great", "amazing", "incredible", "best", "love",
  "proud", "huge", "massive", "breakthrough", "win", "wins", "success", "powerful",
  "fast", "faster", "better", "improved", "improvement", "milestone", "record",
  "launch", "available", "free", "open", "grateful", "delighted", "stoked",
];
const NEG = [
  "down", "outage", "delay", "delayed", "issue", "issues", "bug", "broken",
  "sorry", "apolog", "concern", "concerned", "risk", "dangerous", "threat",
  "lawsuit", "sue", "ban", "banned", "shut", "shutdown", "layoff", "layoffs",
  "loss", "fail", "failed", "failure", "problem", "wrong", "bad", "worse",
  "disappointed", "unfortunately", "warning", "hack", "breach", "leak",
];

// ---- helpers ---------------------------------------------------------------

function norm(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Count how many phrases from `list` appear in `text` (whole-word where possible).
function hits(text, list) {
  let n = 0;
  const found = [];
  for (const term of list) {
    if (!term) continue;
    // Multi-word or punctuation terms: plain substring. Single words: word-boundary.
    const isWord = /^[a-z0-9$]+$/.test(term);
    const ok = isWord
      ? new RegExp(`(^|[^a-z0-9])${term.replace(/[$]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text)
      : text.includes(term);
    if (ok) { n++; found.push(term); }
  }
  return { n, found };
}

// ---- public ----------------------------------------------------------------

/**
 * Score a single post for report-worthiness + sentiment.
 *
 * @param {string} rawText  the post text
 * @param {object} meta     { isReply, isRetweet, isQuote, lang, likes, retweets,
 *                            replies, urls, hasMedia, accountWeight }
 * @returns {{ report_worthy:boolean, score:number, sentiment:string,
 *             sentiment_score:number, category:string, reasons:string[] }}
 */
export function scoreTweet(rawText, meta = {}) {
  const text = norm(rawText);
  const words = text ? text.split(" ").filter(Boolean) : [];
  const reasons = [];
  let score = 30; // neutral baseline; needs evidence to become "news"

  // Hard disqualifiers ------------------------------------------------------
  if (meta.isRetweet) {
    return verdict(false, 0, "neutral", 0, "Commentary", ["retweet — not original reporting"]);
  }
  if (meta.lang && meta.lang !== "en") {
    reasons.push(`non-English (${meta.lang})`);
    score -= 25;
  }

  // Replies are usually conversation, not announcements — heavy penalty, but a
  // substantive reply with a link can still climb back.
  if (meta.isReply) { score -= 28; reasons.push("reply / conversation"); }

  // Length: one-liners and emoji blasts are rarely news.
  const len = rawText ? rawText.trim().length : 0;
  if (len < 25) { score -= 22; reasons.push("very short"); }
  else if (len > 90) { score += 6; }

  // Banter knocks it down hard.
  const banter = hits(text, BANTER);
  if (banter.n) {
    // pure banter (short + banter word, no substance) → kill it
    score -= 12 * Math.min(banter.n, 3);
    reasons.push(`casual tone (${banter.found.slice(0, 3).join(", ")})`);
  }

  // Announcement language is the strongest positive signal.
  const ann = hits(text, ANNOUNCE);
  if (ann.n) {
    score += 22 + 8 * Math.min(ann.n - 1, 3);
    reasons.push(`announcement language (${ann.found.slice(0, 3).join(", ")})`);
  }

  // Substantive tech nouns.
  const tech = hits(text, TECH_TERMS);
  if (tech.n) {
    score += 10 + 5 * Math.min(tech.n - 1, 4);
    reasons.push(`tech substance (${tech.found.slice(0, 3).join(", ")})`);
  }

  // Business / money.
  const biz = hits(text, BUSINESS);
  if (biz.n) {
    score += 14 + 6 * Math.min(biz.n - 1, 3);
    reasons.push(`business signal (${biz.found.slice(0, 3).join(", ")})`);
  }

  // A linked blog/announcement usually means there's a real story behind it.
  const urlN = (meta.urls && meta.urls.length) || 0;
  if (urlN) { score += 10; reasons.push("links to a source"); }
  if (meta.hasMedia) { score += 4; }

  // Engagement — the crowd already decided this matters. Log-scaled so a viral
  // post helps but can't single-handedly make banter "news".
  const likes = meta.likes || 0;
  const rts = meta.retweets || 0;
  const eng = likes + rts * 3;
  if (eng > 0) {
    const bump = Math.min(18, Math.round(Math.log10(eng + 1) * 6));
    if (bump > 0) { score += bump; if (eng >= 1000) reasons.push(`high engagement (${fmt(likes)} likes)`); }
  }

  // Numbers/metrics in the text ("40% faster", "1M tokens", "$2B") read as news.
  if (/\b\d[\d,.]*\s?(%|x|b|m|k|billion|million|tokens?|gpus?|params?|days?|hours?)\b/i.test(rawText || "")) {
    score += 8; reasons.push("concrete metrics");
  }

  // Account weight: orgs (Anthropic, NVIDIA) post news more reliably than a
  // personal account's stray musings — but only reward the *account* when the
  // post itself carries substance. Otherwise an org's booth/merch banter would
  // ride the org bonus over the line.
  const hasSubstance = (ann.n + tech.n + biz.n) > 0;
  if (typeof meta.accountWeight === "number") {
    score += hasSubstance ? meta.accountWeight : Math.min(2, meta.accountWeight);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // ---- sentiment ----------------------------------------------------------
  const pos = hits(text, POS).n;
  const neg = hits(text, NEG).n;
  let sentiment = "neutral";
  let sentiment_score = 0;
  if (pos || neg) {
    sentiment_score = Math.max(-1, Math.min(1, (pos - neg) / Math.max(2, pos + neg)));
    sentiment = sentiment_score > 0.15 ? "positive" : sentiment_score < -0.15 ? "negative" : "neutral";
  }

  // ---- category -----------------------------------------------------------
  let category = "Commentary";
  if (biz.n && /\b(rais|fund|valuation|ipo|acqui|million|billion|\$)\b/i.test(text)) category = "Funding & deals";
  else if (/\b(research|paper|preprint|benchmark|sota|reasoning|training)\b/i.test(text)) category = "Research";
  else if (ann.n && tech.n) category = "Product launch";
  else if (ann.n) category = "Announcement";
  else if (tech.n) category = "Product";

  const report_worthy = score >= 55;
  if (report_worthy) reasons.unshift("report-worthy");

  return verdict(report_worthy, score, sentiment, sentiment_score, category, reasons);
}

function verdict(report_worthy, score, sentiment, sentiment_score, category, reasons) {
  return { report_worthy, score, sentiment, sentiment_score, category, reasons };
}

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export { fmt as fmtCount };
