import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import researchHandler from "../api/research.js";
import {
  buildOpenAlexTopicUrls,
  collectTopicPapers,
  mapOpenAlexTopicWork,
} from "../lib/papers.js";
import {
  TOPICS,
  TOPIC_NAMES,
  findTopic,
  isWithinRollingWindow,
  matchesTopicText,
  parsePublicationDate,
  rollingCutoff,
} from "../lib/topics.js";

const EXPECTED_TOPICS = [
  "AI / ML", "Robotics", "Coding & Dev Tools", "Hardware & Gadgets", "Security",
  "Crypto / Web3", "Big Tech", "Physics & Space", "Biology & Life Sciences",
  "Chemistry & Materials", "Neuroscience", "Medicine & Health",
  "Climate & Environment", "Earth Sciences", "Mathematics", "Psychology",
  "Economics", "Social Sciences", "Energy", "Startups & Funding",
  "Learning & Career", "Fitness", "Skincare",
];

const NOW = new Date("2026-07-21T12:00:00.000Z");

function work(overrides = {}) {
  return {
    id: "https://openalex.org/W123",
    doi: "https://doi.org/10.1000/example",
    type: "article",
    is_retracted: false,
    is_paratext: false,
    title: "Resistance training improves muscle strength and fitness",
    publication_date: "2024-07-21",
    cited_by_count: 12,
    primary_location: { source: { display_name: "Journal of Exercise Science", type: "journal", is_core: true } },
    authorships: [{ author: { display_name: "Ada Researcher" } }],
    abstract_inverted_index: { Exercise: [0], improves: [1], fitness: [2] },
    concepts: [{ display_name: "Physical activity", score: 0.9 }],
    topics: [],
    keywords: [],
    ...overrides,
  };
}

test("topic registry exposes every exact requested label exactly once", () => {
  assert.deepEqual(TOPIC_NAMES, EXPECTED_TOPICS);
  assert.equal(TOPICS.length, 23);
  assert.equal(new Set(TOPIC_NAMES).size, 23);
  for (const name of EXPECTED_TOPICS) {
    assert.equal(findTopic(name)?.name, name);
    assert.equal(findTopic(name.toLowerCase())?.name, name);
  }
  assert.equal(findTopic("not a topic"), null);
});

test("all topic mappings are complete, bounded, and unique", () => {
  const queries = [];
  for (const topic of TOPICS) {
    assert.equal(topic.queries.length, 2, topic.name);
    assert.ok(topic.includeTerms.length >= 5, topic.name);
    assert.ok(Array.isArray(topic.excludeTerms), topic.name);
    assert.ok(topic.queries.every((query) => query.trim().split(/\s+/).length >= 3), topic.name);
    queries.push(...topic.queries);
  }
  assert.equal(new Set(queries).size, queries.length);
  assert.equal(matchesTopicText("Security", "A cybersecurity malware detection study"), true);
  assert.equal(matchesTopicText("Security", "Food security and agricultural markets"), false);
  assert.equal(matchesTopicText("Fitness", "Evolutionary fitness function optimization"), false);
});

test("rolling cutoff includes the UTC boundary and rejects stale, invalid, missing, and future dates", () => {
  assert.equal(rollingCutoff(NOW).toISOString(), "2024-07-21T00:00:00.000Z");
  assert.equal(rollingCutoff(new Date("2024-02-29T12:00:00.000Z")).toISOString(), "2022-02-28T00:00:00.000Z");
  assert.equal(isWithinRollingWindow("2024-07-21", NOW), true);
  assert.equal(isWithinRollingWindow("2024-07-21T00:00:00.000Z", NOW), true);
  assert.equal(isWithinRollingWindow("2024-07-20T23:59:59.999Z", NOW), false);
  assert.equal(isWithinRollingWindow("2026-07-21T12:00:00.001Z", NOW), false);
  assert.equal(isWithinRollingWindow("2026-07-22", NOW), false);
  assert.equal(isWithinRollingWindow("2024-02-30", NOW), false);
  assert.equal(isWithinRollingWindow("not-a-date", NOW), false);
  assert.equal(isWithinRollingWindow("", NOW), false);
  assert.equal(isWithinRollingWindow(null, NOW), false);
  assert.equal(parsePublicationDate("2025-01-01T00:00:00+01:00"), null);
});

test("provider requests carry both dynamic date bounds and each mapped query", () => {
  const urls = buildOpenAlexTopicUrls("Robotics", { now: NOW, pageSize: 999 });
  assert.equal(urls.length, 2);
  for (const value of urls) {
    const url = new URL(value);
    assert.equal(url.origin, "https://api.openalex.org");
    assert.equal(url.searchParams.get("per_page"), "50");
    const filter = url.searchParams.get("filter");
    assert.match(filter, /from_publication_date:2024-07-21/);
    assert.match(filter, /to_publication_date:2026-07-21/);
    assert.match(filter, /is_retracted:false/);
    assert.match(filter, /is_paratext:false/);
    assert.match(filter, /has_doi:true/);
    assert.match(filter, /primary_location\.source\.type:journal/);
    assert.match(filter, /primary_location\.source\.is_core:true/);
    assert.equal(url.searchParams.get("sort"), "relevance_score:desc");
  }
});

test("representative OpenAlex normalization labels the paper/provider/publisher and verifies freshness", () => {
  const paper = mapOpenAlexTopicWork(work(), { topicName: "Fitness", now: NOW });
  assert.ok(paper);
  assert.equal(paper.topic, "Fitness");
  assert.equal(paper.content_type, "paper");
  assert.equal(paper.content_type_label, "Research paper");
  assert.equal(paper.provider, "OpenAlex");
  assert.equal(paper.publisher, "Journal of Exercise Science");
  assert.equal(paper.source_label, "Journal of Exercise Science · indexed by OpenAlex");
  assert.equal(paper.canonical_url, "https://doi.org/10.1000/example");
  assert.equal(paper.published, "2024-07-21T00:00:00.000Z");
  assert.equal(paper.freshness_verified, true);
});

test("trusted normalization rejects every unverifiable or ineligible provider record", () => {
  const rejected = [
    work({ publication_date: undefined }),
    work({ publication_date: "2024-02-30" }),
    work({ publication_date: "2024-07-20" }),
    work({ publication_date: "2026-07-22" }),
    work({ is_retracted: true }),
    work({ is_paratext: true }),
    work({ type: "dataset" }),
    work({ doi: null }),
    work({ primary_location: { source: { display_name: "Repository", type: "repository", is_core: false } } }),
    work({ title: "A completely unrelated accounting paper", abstract_inverted_index: {}, concepts: [] }),
    work({ title: "Evolutionary fitness function optimization", abstract_inverted_index: {} }),
  ];
  for (const item of rejected) assert.equal(mapOpenAlexTopicWork(item, { topicName: "Fitness", now: NOW }), null);
});

test("topic collection normalizes provider results and deduplicates across mapped queries", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      async text() { return JSON.stringify({ results: [work(), work({ id: "Wfuture", doi: "https://doi.org/future", publication_date: "2030-01-01" })] }); },
    };
  };
  try {
    const result = await collectTopicPapers("Fitness", { now: NOW, limit: 10 });
    assert.equal(calls.length, 2);
    assert.equal(result.providerStatus, "ok");
    assert.equal(result.papers.length, 1);
    assert.equal(result.papers[0].freshness_verified, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("unknown topic API requests fail closed with the complete canonical list", async () => {
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
  await researchHandler({ query: { topic: "Unknown" }, headers: {} }, response);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body.topics, EXPECTED_TOPICS);
});

test("research UI exposes honest states and no in-app full-text route", () => {
  const html = readFileSync(new URL("../app/research.html", import.meta.url), "utf8");
  for (const phrase of ["Loading recent papers", "Research could not be loaded", "No recent papers found", "Open paper at source"]) {
    assert.ok(html.includes(phrase), phrase);
  }
  assert.ok(html.includes("TOPIC_NAMES"));
  assert.ok(html.includes("isWithinRollingWindow"));
  assert.ok(html.includes("/api/research?topic="));
  assert.ok(!html.includes("/api/content"));
  assert.ok(!html.includes("article.html?paper"));

  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.ok(app.includes("[\"Research\", \"/app/research.html\"]"));
  const home = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
  assert.ok(home.includes("/api/research?topic=AI%20%2F%20ML"));
  assert.ok(!home.includes("arXiv · ${T.timeAgo(a.published)"));
});
