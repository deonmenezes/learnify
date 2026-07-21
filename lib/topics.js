// Canonical Learnify topic registry. User-facing labels are API/UI contracts.
// Provider queries deliberately use focused phrases; the include/exclude terms
// are applied again after OpenAlex responds to reduce obvious false positives.

function topic(name, queries, includeTerms, excludeTerms = []) {
  return Object.freeze({
    name,
    queries: Object.freeze(queries),
    includeTerms: Object.freeze(includeTerms),
    excludeTerms: Object.freeze(excludeTerms),
  });
}

export const TOPICS = Object.freeze([
  topic("AI / ML", ["artificial intelligence machine learning", "large language model deep learning"], ["artificial intelligence", "machine learning", "large language model", "deep learning", "neural network"], ["artificial insemination"]),
  topic("Robotics", ["robotics autonomous manipulation", "robot locomotion human robot interaction"], ["robot", "robotic", "robotics", "autonomous manipulation", "human-robot interaction"], ["robotic process automation"]),
  topic("Coding & Dev Tools", ["software engineering developer tools", "programming languages compiler debugging"], ["software engineering", "developer tool", "programming language", "compiler", "debugging", "code generation", "software development"], ["genetic programming"]),
  topic("Hardware & Gadgets", ["semiconductor processor integrated circuit", "consumer electronics wearable device"], ["semiconductor", "processor", "microprocessor", "consumer electronics", "wearable device", "integrated circuit", "computer chip"], ["orthopedic hardware", "hardware removal"]),
  topic("Security", ["cybersecurity malware vulnerability", "information security network cryptography"], ["cybersecurity", "information security", "computer security", "network security", "malware", "vulnerability", "cryptography", "ransomware"], ["food security", "social security", "energy security", "health security", "national security"]),
  topic("Crypto / Web3", ["blockchain cryptocurrency smart contract", "decentralized finance web3 tokenomics"], ["blockchain", "cryptocurrency", "smart contract", "decentralized finance", "web3", "tokenomics", "cryptoasset"], ["cryptosporidium"]),
  topic("Big Tech", ["big tech antitrust platform regulation", "Google Apple Amazon Meta Microsoft competition"], ["big tech", "digital platform", "platform governance", "technology company", "platform regulation", "antitrust", "google", "amazon", "microsoft", "meta platforms"], ["platform trial", "assay platform", "apple fruit"]),
  topic("Physics & Space", ["astrophysics cosmology astronomy", "quantum particle physics space science"], ["physics", "astrophysics", "cosmology", "astronomy", "space science", "quantum", "particle physics", "exoplanet"], ["physical activity", "physical education"]),
  topic("Biology & Life Sciences", ["molecular cell biology genetics", "genomics ecology life sciences"], ["biology", "biological", "molecular biology", "cell biology", "genetics", "genomics", "ecology", "life science"], ["biological parent"]),
  topic("Chemistry & Materials", ["chemistry catalysis polymer", "materials science nanomaterials"], ["chemistry", "chemical", "catalysis", "polymer", "materials science", "nanomaterial", "electrochemistry"], ["material deprivation", "teaching material"]),
  topic("Neuroscience", ["neuroscience brain neural circuit", "cognitive neuroscience neuroimaging"], ["neuroscience", "neural circuit", "brain", "neuroimaging", "neuron", "cognitive neuroscience"], ["brain drain"]),
  topic("Medicine & Health", ["clinical medicine disease treatment", "public health healthcare outcomes"], ["medicine", "medical", "clinical", "disease", "treatment", "public health", "healthcare", "patient"], ["medical education"]),
  topic("Climate & Environment", ["climate change biodiversity environment", "pollution conservation ecosystem"], ["climate change", "global warming", "biodiversity", "pollution", "conservation", "ecosystem", "environmental"], ["organizational climate", "investment climate", "classroom environment", "business environment"]),
  topic("Earth Sciences", ["geology geophysics earth science", "oceanography seismology geochemistry"], ["geology", "geophysics", "earth science", "oceanography", "seismology", "geochemistry", "tectonic"], ["google earth"]),
  topic("Mathematics", ["mathematics theorem algebra topology", "applied mathematics geometry analysis"], ["mathematics", "mathematical", "theorem", "algebra", "topology", "geometry", "number theory"], ["mathematics education", "mathematics anxiety"]),
  topic("Psychology", ["psychology behavior cognition", "mental health psychological wellbeing"], ["psychology", "psychological", "behavior", "behaviour", "cognition", "mental health", "wellbeing"], ["price behavior", "consumer price"]),
  topic("Economics", ["economics macroeconomic monetary policy", "labor market economic growth"], ["economics", "economic", "macroeconomic", "microeconomic", "monetary policy", "labor market", "labour market"], ["energy economics"]),
  topic("Social Sciences", ["sociology political science inequality", "social science governance society"], ["sociology", "political science", "social science", "social inequality", "governance", "social policy"], ["social media marketing"]),
  topic("Energy", ["renewable energy battery solar", "power grid hydrogen energy storage"], ["renewable energy", "energy storage", "battery", "solar energy", "wind energy", "power grid", "hydrogen energy"], ["energy intake", "energy expenditure", "binding energy"]),
  topic("Startups & Funding", ["startup venture capital financing", "seed funding entrepreneurial finance"], ["startup", "start-up", "venture capital", "seed funding", "innovation financing", "entrepreneurial finance", "startup funding"], ["venture capital of the world"]),
  topic("Learning & Career", ["career development workforce skills", "learning science vocational education"], ["learning science", "workforce skill", "career development", "skill development", "professional development", "vocational education", "higher education"], ["machine learning", "deep learning", "reinforcement learning"]),
  topic("Fitness", ["exercise fitness resistance training", "endurance physical activity muscle"], ["exercise", "fitness", "resistance training", "endurance", "physical activity", "muscle strength", "aerobic"], ["fitness function", "evolutionary fitness", "ecological fitness", "darwinian fitness"]),
  topic("Skincare", ["dermatology skincare skin barrier", "sunscreen retinoid cosmetic dermatology"], ["dermatology", "skincare", "skin care", "skin barrier", "sunscreen", "retinoid", "cosmetic dermatology"], ["animal skin", "fruit skin"]),
]);

export const TOPIC_NAMES = Object.freeze(TOPICS.map(({ name }) => name));
const TOPIC_BY_NAME = new Map(TOPICS.map((item) => [item.name.toLowerCase(), item]));

export function findTopic(value) {
  return TOPIC_BY_NAME.get(String(value || "").trim().toLowerCase()) || null;
}

function validAnchor(now) {
  const anchor = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(anchor.getTime())) throw new TypeError("Invalid freshness anchor");
  return anchor;
}

// Freshness is based on UTC publication dates. On 2026-07-21, the inclusive
// lower date is 2024-07-21 (00:00:00Z), regardless of the current time of day.
export function rollingCutoff(now = new Date(), years = 2) {
  const anchor = validAnchor(now);
  const targetYear = anchor.getUTCFullYear() - years;
  const month = anchor.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  const day = Math.min(anchor.getUTCDate(), lastDay);
  return new Date(Date.UTC(targetYear, month, day));
}

export function parsePublicationDate(value) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z)?$/);
  if (!match) return null;
  const date = new Date(input.length === 10 ? `${input}T00:00:00.000Z` : input);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== input.slice(0, 10)) return null;
  return date;
}

export function isWithinRollingWindow(value, now = new Date(), years = 2) {
  const date = parsePublicationDate(value);
  if (!date) return false;
  const anchor = validAnchor(now);
  return date.getTime() >= rollingCutoff(anchor, years).getTime() && date.getTime() <= anchor.getTime();
}

export function matchesTopicText(topicValue, value) {
  const selected = typeof topicValue === "object" ? topicValue : findTopic(topicValue);
  if (!selected) return false;
  const text = String(value || "").toLowerCase().replace(/\s+/g, " ");
  if (!selected.includeTerms.some((term) => text.includes(term))) return false;
  return !selected.excludeTerms.some((term) => text.includes(term));
}
