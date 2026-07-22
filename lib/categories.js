// Canonical Learnify taxonomy. Keep raw and short labels in lockstep with
// TechScroll/Models/NewsCategory.swift so the API and iOS client agree.
export const APP_CATEGORIES = Object.freeze([
  Object.freeze({ raw: "AI / ML", short: "AI" }),
  Object.freeze({ raw: "Robotics", short: "Robotics" }),
  Object.freeze({ raw: "Coding & Dev Tools", short: "Coding" }),
  Object.freeze({ raw: "Startups & Funding", short: "Startups" }),
  Object.freeze({ raw: "Hardware & Gadgets", short: "Hardware" }),
  Object.freeze({ raw: "Learning & Career", short: "Learning" }),
  Object.freeze({ raw: "Security", short: "Security" }),
  Object.freeze({ raw: "Crypto / Web3", short: "Crypto" }),
  Object.freeze({ raw: "Science", short: "Science" }),
  Object.freeze({ raw: "Big Tech", short: "Big Tech" }),
  Object.freeze({ raw: "Fitness", short: "Fitness" }),
  Object.freeze({ raw: "Skincare", short: "Skincare" }),
]);

export const APP_CATEGORY_VALUES = Object.freeze(APP_CATEGORIES.map((category) => category.raw));

const normalize = (value) => (value || "")
  .toString()
  .normalize("NFKC")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, " ");

const queryLabels = new Map();
const rawLabels = new Set(APP_CATEGORY_VALUES);
for (const category of APP_CATEGORIES) {
  queryLabels.set(normalize(category.raw), category.raw);
  queryLabels.set(normalize(category.short), category.raw);
}

/**
 * Parse a comma-separated category query into canonical NewsCategory raw
 * values. Raw labels and their short iOS chip labels are accepted
 * case-insensitively; unknown labels are ignored.
 */
export function parseCategoryQuery(value) {
  const values = Array.isArray(value) ? value : [value];
  const resolved = values
    .flatMap((item) => (item || "").toString().split(","))
    .map((item) => queryLabels.get(normalize(item)))
    .filter(Boolean);
  return [...new Set(resolved)];
}

/** Mirrors APIFeedService.classify so server-side filtering and iOS agree. */
export function classifyArticle(article = {}) {
  const categories = Array.isArray(article.categories) ? article.categories : [];

  // Backend source hints use an exact canonical raw value. Short query labels
  // are deliberately not hints: matching them here would diverge from iOS.
  for (const category of categories) {
    if (rawLabels.has(category)) return category;
  }

  const section = (article.section || "").toString();
  const tokens = [section, ...categories].map(normalize);
  const has = (needles) => tokens.some((token) => needles.some((needle) => token.includes(needle)));
  const isResearch = normalize(article.region) === "research";

  if (has(["crypto", "blockchain", "bitcoin", "web3", "ethereum"])) return "Crypto / Web3";
  if (has(["robot", "drone"])) return "Robotics";
  if (has(["fitness", "workout", "exercise", "sports science", "nutrition", "diet",
    "muscle", "strength training", "cardio", "endurance", "wellness"])) return "Fitness";
  if (has(["skincare", "skin care", "dermatolog", "sunscreen", "retinoid",
    "cosmetic", "beauty science", "acne"])) return "Skincare";

  switch (normalize(section)) {
    case "artificial intelligence": return "AI / ML";
    case "security": return "Security";
    case "startups":
    case "fundraising":
    case "venture":
    case "fintech": return "Startups & Funding";
    case "space":
    case "climate":
    case "biotech health":
    case "science": return "Science";
    case "hardware":
    case "gadgets":
    case "gear":
    case "computex": return "Hardware & Gadgets";
    case "transportation":
    case "cars": return "Robotics";
    default: break;
  }

  if (has(["open source", "developer", "programming", "devops", "kubernetes", "github", "software engineering"])) {
    return "Coding & Dev Tools";
  }
  if (has(["evergreen", "glossary", "explainer", "tutorial", "how-to", "how to", "career", "roadmap"])) {
    return "Learning & Career";
  }
  if (has(["cybersecurity", "security", "hacker", "breach", "privacy", "ransomware", "malware"])) return "Security";
  if (has(["space", "spacex", "climate", "biotech", "health", "energy", "quantum", "science"])) return "Science";
  if (has(["hardware", "gadget", "wearable", "laptop", "smartphone"])) return "Hardware & Gadgets";
  if (has(["startup", "venture", "fundrais", "seed", "series ", "ipo", "acquisition", "fintech"])) return "Startups & Funding";
  if (has(["artificial intelligence", "machine learning", "openai", "anthropic", "llm", "chatbot",
    "genai", "ai agents", "xai", "gemini", " ai "])) return "AI / ML";
  if (has(["developer", "api", "sdk", "framework"])) return "Coding & Dev Tools";
  if (isResearch) return "Science";
  return "Big Tech";
}

export function withAppCategory(article) {
  return { ...article, app_category: classifyArticle(article) };
}

/** Apply the API's comma-OR category contract without changing absent queries. */
export function filterByCategoryQuery(articles, value) {
  const values = Array.isArray(value) ? value : [value];
  const hasQuery = values.some((item) => (item || "").toString().trim());
  if (!hasQuery) return articles;

  const requested = new Set(parseCategoryQuery(value));
  return articles.filter((article) => requested.has(article.app_category || classifyArticle(article)));
}

/**
 * Round-robin category queues inside strict freshness cohorts while preserving
 * input order within every category. A niche day-old item can therefore add
 * diversity among other day-old items, but can never jump ahead of an item
 * published in the last six hours merely to fill a category slot.
 */
export function balanceByCategory(articles, now = new Date()) {
  const nowMs = new Date(now).getTime();
  const freshnessCohort = (article) => {
    const publishedMs = new Date(article.published || "").getTime();
    if (!Number.isFinite(publishedMs) || !Number.isFinite(nowMs)) return 4;
    const age = Math.max(0, nowMs - publishedMs);
    if (age < 6 * 60 * 60 * 1000) return 0;
    if (age < 24 * 60 * 60 * 1000) return 1;
    if (age < 72 * 60 * 60 * 1000) return 2;
    if (age < 7 * 24 * 60 * 60 * 1000) return 3;
    return 4;
  };

  const cohorts = [[], [], [], [], []];
  for (const article of articles) cohorts[freshnessCohort(article)].push(article);

  const balanceCohort = (cohort) => {
  const groups = new Map();
    cohort.forEach((article, index) => {
    const category = article.app_category || classifyArticle(article);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ article, index });
  });

  const output = [];
  let active = [...groups.values()];
  while (active.length) {
    active.sort((left, right) => left[0].index - right[0].index);
    for (const queue of active) output.push(queue.shift().article);
    active = active.filter((queue) => queue.length);
  }
  return output;
  };

  return cohorts.flatMap(balanceCohort);
}
