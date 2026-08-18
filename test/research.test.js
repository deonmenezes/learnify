import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import researchHandler, { sortRecentPapers } from "../api/research.js";
import {
  arxivGroupURL,
  buildOpenAlexTopicUrls,
  collectTopicPapers,
  mapOAWork,
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
  const topic = findTopic("Robotics");
  const urls = buildOpenAlexTopicUrls("Robotics", { now: NOW, pageSize: 999 });
  assert.equal(urls.length, topic.queries.length * 2);
  assert.deepEqual(
    urls.map((value) => new URL(value).searchParams.get("search")),
    topic.queries.flatMap((query) => [query, query]),
  );
  assert.deepEqual(
    urls.map((value) => new URL(value).searchParams.get("sort")),
    topic.queries.flatMap(() => ["publication_date:desc", "relevance_score:desc"]),
  );
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
  }
});

test("broad arXiv requests explicitly ask the provider for newest submissions", () => {
  const url = new URL(arxivGroupURL(["cs.AI", "cs.LG"], 12));
  assert.equal(url.searchParams.get("search_query"), "cat:cs.AI OR cat:cs.LG");
  assert.equal(url.searchParams.get("max_results"), "12");
  assert.equal(url.searchParams.get("sortBy"), "submittedDate");
  assert.equal(url.searchParams.get("sortOrder"), "descending");
});

test("broad OpenAlex normalization rejects future dates before they can rank", () => {
  assert.equal(
    mapOAWork(work({ publication_date: "2026-07-21" }), { now: NOW })?.published,
    "2026-07-21T00:00:00.000Z",
  );
  assert.equal(mapOAWork(work({ publication_date: "2030-01-01" }), { now: NOW }), null);
  assert.equal(mapOAWork(work({ publication_date: "2026-02-30" }), { now: NOW })?.published, "");
});

test("recent ordering is strict, newest-first, undated-last, and stable on ties", () => {
  const papers = [
    { id: "missing-first", published: null },
    { id: "newest-a", published: "2026-07-20T12:00:00.000Z" },
    { id: "invalid", published: "2026-02-30" },
    { id: "older", published: "2025-03-10" },
    { id: "newest-b", published: "2026-07-20T12:00:00.000Z" },
    { id: "missing-last" },
  ];
  assert.deepEqual(sortRecentPapers(papers).map(({ id }) => id), [
    "newest-a", "newest-b", "older", "missing-first", "invalid", "missing-last",
  ]);
  assert.deepEqual(papers.map(({ id }) => id), [
    "missing-first", "newest-a", "invalid", "older", "newest-b", "missing-last",
  ]);
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
  assert.equal(paper.rights_status, "unknown_or_restricted");
  assert.equal(paper.full_text_status, "unknown");
  assert.equal(paper.full_text_available, false);
});

test("PMCID-bearing OpenAlex records expose only an unverified fixed-provider candidate", () => {
  const paper = mapOpenAlexTopicWork(work({
    ids: { pmcid: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC777" },
    best_oa_location: { license: "cc-by-4.0" },
  }), { topicName: "Fitness", now: NOW });
  assert.equal(paper.rights_status, "verification_required");
  assert.equal(paper.full_text_status, "unchecked");
  assert.equal(paper.full_text_available, false);
  assert.equal(paper.license_id, "CC-BY-4.0");
  assert.equal(paper.body_source, "Europe PMC");
  assert.equal(paper.content_endpoint, "/api/content?pmcid=PMC777");
});

test("PubMed identifiers expose a bounded Europe PMC resolution candidate", () => {
  const paper = mapOpenAlexTopicWork(work({ ids: { pmid: "https://pubmed.ncbi.nlm.nih.gov/39966355" } }), { topicName: "Fitness", now: NOW });
  assert.equal(paper.rights_status, "verification_required");
  assert.equal(paper.full_text_status, "unchecked");
  assert.equal(paper.full_text_available, false);
  assert.equal(paper.pmid, "39966355");
  assert.equal(paper.pmcid, null);
  assert.equal(paper.content_endpoint, "/api/content?pmid=39966355");
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

test("topic collection merges newest and relevance pools, validates, deduplicates, and sorts", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const sort = new URL(url).searchParams.get("sort");
    const results = sort === "publication_date:desc"
      ? [
          work({ id: "Wnewest", doi: "https://doi.org/newest", publication_date: "2026-07-20" }),
          work(),
        ]
      : [
          work(),
          work({ id: "Wrelevant", doi: "https://doi.org/relevant", publication_date: "2025-03-10" }),
          work({ id: "Wfuture", doi: "https://doi.org/future", publication_date: "2030-01-01" }),
        ];
    return {
      ok: true,
      async text() { return JSON.stringify({ results }); },
    };
  };
  try {
    const result = await collectTopicPapers("Fitness", { now: NOW, limit: 10 });
    assert.equal(calls.length, 4);
    assert.deepEqual(
      calls.map((value) => new URL(value).searchParams.get("sort")),
      ["publication_date:desc", "relevance_score:desc", "publication_date:desc", "relevance_score:desc"],
    );
    assert.equal(result.providerStatus, "ok");
    assert.deepEqual(result.papers.map(({ link }) => link), [
      "https://doi.org/newest", "https://doi.org/relevant", "https://doi.org/10.1000/example",
    ]);
    assert.ok(result.papers.every(({ freshness_verified }) => freshness_verified === true));
  } finally {
    global.fetch = originalFetch;
  }
});

test("topic collection reports partial provider coverage when one candidate pool fails", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (value) => {
    calls += 1;
    const url = new URL(value);
    if (url.searchParams.get("search") === findTopic("Fitness").queries[0]
      && url.searchParams.get("sort") === "relevance_score:desc") {
      return { ok: false, status: 503, async text() { return ""; } };
    }
    return { ok: true, async text() { return JSON.stringify({ results: [work()] }); } };
  };
  try {
    const result = await collectTopicPapers("Fitness", { now: NOW, limit: 10 });
    assert.equal(calls, 4);
    assert.equal(result.providerStatus, "partial");
    assert.equal(result.papers.length, 1);
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

test("research UI exposes honest states and routes papers through the in-app detail view", () => {
  const html = readFileSync(new URL("../app/research.html", import.meta.url), "utf8");
  for (const phrase of ["Loading recent papers", "Research could not be loaded", "No recent papers found", "Read in Learnify"]) {
    assert.ok(html.includes(phrase), phrase);
  }
  assert.ok(html.includes("TOPIC_NAMES"));
  assert.ok(html.includes("isWithinRollingWindow"));
  assert.ok(html.includes("/api/research?topic="));
  assert.ok(!html.includes("/api/content"));
  assert.ok(html.includes("article.html?paper"));

  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.ok(app.includes("[\"Research\", \"/app/research.html\"]"));
  const home = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
  assert.ok(home.includes("/api/research?topic=AI%20%2F%20ML"));
  assert.ok(!home.includes("arXiv · ${T.timeAgo(a.published)"));
});
