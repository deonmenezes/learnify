#!/usr/bin/env node
// scripts/snapshot-scholar.mjs - rebuild scholar-snapshot.json from Google
// Scholar via Apify.
//
//   node scripts/snapshot-scholar.mjs                 # refresh within budget
//   node scripts/snapshot-scholar.mjs --topics "AI / ML,Security"
//   node scripts/snapshot-scholar.mjs --budget 0.25 --per 8
//   node scripts/snapshot-scholar.mjs --dry-run       # cost plan, no spend
//
// BUDGET IS THE POINT. The actor bills $0.0015 per paper, so a full refresh of
// all 23 topics x 2 queries x 10 papers is about $0.69. Defaults are sized for
// an Apify free plan ($5/month of credit): one full refresh per run, a $1.00
// per-run ceiling, and round-robin topic rotation so a small budget still keeps
// every topic moving instead of starving the tail.
//
// Failure is non-destructive. A run that collects nothing exits non-zero and
// leaves the previous snapshot untouched, so a bad night degrades to stale data
// rather than to an empty Research tab.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOPICS, rollingCutoff } from "../lib/topics.js";
import { fetchScholarPapers, estimateScholarCostUsd, SCHOLAR_ACTOR, SCHOLAR_USD_PER_PAPER } from "../lib/scholar.js";
import { hasApifyToken } from "../lib/apify.js";

const OUT = fileURLToPath(new URL("../scholar-snapshot.json", import.meta.url));

// Same dependency-free .env.local loader scripts/enrich.mjs uses, so a local run
// picks up APIFY_TOKEN without exporting it into the shell history.
function loadEnvLocal() {
  const path = fileURLToPath(new URL("../.env.local", import.meta.url));
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const dryRun = arg("dry-run", false) !== false;
const perSearch = Math.max(1, Math.min(50, Number(arg("per", process.env.SCHOLAR_MAX_PER_SEARCH || 10))));
const budgetUsd = Math.max(0.01, Number(arg("budget", process.env.SCHOLAR_BUDGET_USD || 1.0)));
const topicFilter = String(arg("topics", process.env.SCHOLAR_TOPICS || "") || "")
  .split(",").map((value) => value.trim()).filter(Boolean);

const now = new Date();
const cutoffYear = rollingCutoff(now).getUTCFullYear();

// Load the previous snapshot so a partial (budget-limited) run UNIONS onto it
// instead of replacing it. Topics this run cannot afford keep their last data.
let previous = { topics: {} };
try { previous = JSON.parse(readFileSync(OUT, "utf-8")); } catch { /* first run */ }
if (!previous || typeof previous.topics !== "object" || !previous.topics) previous = { topics: {} };

const selected = topicFilter.length
  ? TOPICS.filter((topic) => topicFilter.some((name) => name.toLowerCase() === topic.name.toLowerCase()))
  : [...TOPICS];
if (!selected.length) {
  console.error(`No topics matched ${JSON.stringify(topicFilter)}.`);
  process.exit(2);
}

// Rotate least-recently-refreshed first so a repeated small budget still covers
// every topic over a few runs rather than re-refreshing the same head each time.
selected.sort((a, b) => {
  const at = Date.parse(previous.topics[a.name]?.refreshed_at || "") || 0;
  const bt = Date.parse(previous.topics[b.name]?.refreshed_at || "") || 0;
  return at - bt;
});

// One search term per topic query. Scholar's own relevance ranking is strong,
// so two focused phrases per topic beat one broad phrase at the same cost.
const plan = [];
for (const topic of selected) {
  for (const query of topic.queries) plan.push({ topic: topic.name, term: query });
}
const affordable = Math.max(0, Math.floor(budgetUsd / (perSearch * SCHOLAR_USD_PER_PAPER)));
const runPlan = plan.slice(0, affordable);
const deferred = plan.slice(affordable);
const projected = estimateScholarCostUsd(runPlan.length, perSearch);

console.log(`actor        ${SCHOLAR_ACTOR}`);
console.log(`topics       ${selected.length} of ${TOPICS.length}`);
console.log(`queries      ${runPlan.length} run, ${deferred.length} deferred to the next run`);
console.log(`per search   ${perSearch} papers`);
console.log(`budget       $${budgetUsd.toFixed(2)}  projected max $${projected.toFixed(4)}`);
console.log(`freshness    publication year >= ${cutoffYear}`);

if (dryRun) {
  console.log("\n--dry-run: nothing was spent and nothing was written.");
  process.exit(0);
}
if (!hasApifyToken()) {
  console.error("\nAPIFY_TOKEN is not set. Add it to .env.local (local) or the Vercel/GitHub secret (CI).");
  process.exit(2);
}
if (!runPlan.length) {
  console.error("\nBudget is too small for even one query. Raise --budget or lower --per.");
  process.exit(2);
}

const topicOfTerm = new Map(runPlan.map((item) => [item.term, item.topic]));

let result;
try {
  result = await fetchScholarPapers(runPlan.map((item) => item.term), {
    maxPerSearch: perSearch,
    yearFrom: cutoffYear,
    budgetUsd,
    now,
    topicOf: (term) => topicOfTerm.get(term) || null,
    onProgress: ({ batch, rows }) => console.log(`  batch of ${batch.length} queries -> ${rows} rows`),
  });
} catch (error) {
  console.error(`\nScholar fetch failed: ${error.message}. Previous snapshot kept.`);
  process.exit(1);
}

if (!result.papers.length) {
  console.error("\nNo eligible Scholar papers collected. Previous snapshot NOT overwritten.");
  process.exit(1);
}

// Group, dedupe within a topic by link, and keep the highest-cited first so a
// truncated topic list is still the best part of that topic.
const refreshedAt = new Date().toISOString();
const topics = { ...previous.topics };
const grouped = new Map();
for (const paper of result.papers) {
  if (!paper.topic) continue;
  if (!grouped.has(paper.topic)) grouped.set(paper.topic, new Map());
  const byLink = grouped.get(paper.topic);
  const existing = byLink.get(paper.link);
  if (!existing || (paper.citations || 0) > (existing.citations || 0)) byLink.set(paper.link, paper);
}
for (const [topicName, byLink] of grouped) {
  const papers = [...byLink.values()].sort((a, b) => (b.citations || 0) - (a.citations || 0));
  topics[topicName] = { refreshed_at: refreshedAt, count: papers.length, papers };
}

const count = Object.values(topics).reduce((total, entry) => total + (entry.papers?.length || 0), 0);
const payload = {
  generated_at: refreshedAt,
  actor: SCHOLAR_ACTOR,
  provider: "Google Scholar",
  provider_via: "Apify",
  cutoff_year: cutoffYear,
  max_per_search: perSearch,
  refreshed_topics: [...grouped.keys()].sort(),
  deferred_queries: deferred.length,
  estimated_cost_usd: result.estimatedCostUsd,
  topic_count: Object.keys(topics).length,
  count,
  topics,
};
writeFileSync(OUT, JSON.stringify(payload, null, 2));

console.log(`\nrefreshed    ${grouped.size} topics, ${result.papers.length} eligible papers of ${result.itemCount} rows`);
console.log(`snapshot     ${count} papers across ${payload.topic_count} topics -> scholar-snapshot.json`);
console.log(`spent        ~$${result.estimatedCostUsd.toFixed(4)}`);
for (const [topicName, byLink] of [...grouped].slice(0, 8)) {
  const top = [...byLink.values()].sort((a, b) => (b.citations || 0) - (a.citations || 0))[0];
  console.log(`  ${topicName.padEnd(26)} ${String(byLink.size).padStart(3)} papers  top: ${top.citations} cites  ${top.title.slice(0, 60)}`);
}
