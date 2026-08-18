import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apifyToken, hasApifyToken, redact, runActorSync, ApifyError } from "../lib/apify.js";
import { parsePublicationInfo, normalizeScholarPaper, estimateScholarCostUsd, SCHOLAR_USD_PER_PAPER } from "../lib/scholar.js";
import { venueScore, worldScore, scoreBreakdown, paperKey, mergePapers, rankWorld, scoringDate, RANK_WEIGHTS } from "../lib/world-rank.js";
import { scholarPapersForTopic, loadScholarSnapshot } from "../lib/scholar-snapshot.js";
import { TOPIC_NAMES, rollingCutoff } from "../lib/topics.js";

const NOW = new Date("2026-08-17T12:00:00.000Z");
const CUTOFF_YEAR = rollingCutoff(NOW).getUTCFullYear(); // 2024

function scholarRow(overrides = {}) {
  return {
    searchTerm: "large language model reasoning",
    position: 1,
    title: "Toward large reasoning models: A survey of reinforced reasoning",
    link: "https://www.cell.com/patterns/fulltext/S2666-3899(25)00218-1",
    publicationInfo: "F Xu, Q Hao, C Shao, Z Zong, Y Li… - Patterns, 2025 - cell.com",
    snippet: "We explain how automated construction of reasoning data and process-level reward models advance the frontier of AI reasoning.",
    year: 2025,
    citedBy: 246,
    pdfUrl: "https://www.cell.com/patterns/pdf/S2666-3899(25)00218-1.pdf",
    id: "e4dTRPAtLz8J",
    ...overrides,
  };
}

test("the Apify credential is env-only, shape-checked, and never echoed", () => {
  assert.equal(apifyToken({ APIFY_TOKEN: "apify_api_" + "A".repeat(30) }), "apify_api_" + "A".repeat(30));
  assert.equal(apifyToken({ APIFY_API_TOKEN: "apify_api_" + "B".repeat(30) }), "apify_api_" + "B".repeat(30));
  // Anything that is not a well-formed token is treated as absent, never sent.
  assert.equal(apifyToken({ APIFY_TOKEN: "not-a-token" }), null);
  assert.equal(apifyToken({ APIFY_TOKEN: "apify_api_short" }), null);
  assert.equal(apifyToken({}), null);
  assert.equal(hasApifyToken({}), false);
  const leaked = `failed with token apify_api_${"C".repeat(30)} and proxy apify_proxy_${"D".repeat(20)}`;
  assert.ok(!redact(leaked).includes("C".repeat(30)));
  assert.ok(!redact(leaked).includes("D".repeat(20)));
  assert.equal(redact(leaked).match(/apify_\*\*\*/g).length, 2);
});

test("actor runs fail closed on an untrusted actor id or a missing credential", async () => {
  await assert.rejects(() => runActorSync("../../evil", {}, { env: { APIFY_TOKEN: "apify_api_" + "A".repeat(30) } }), ApifyError);
  await assert.rejects(() => runActorSync("user~actor", {}, { env: {} }), (error) => {
    assert.ok(error instanceof ApifyError);
    assert.match(error.message, /token is not configured/);
    return true;
  });
});

test("Scholar publication strings split into authors, venue, year and host", () => {
  assert.deepEqual(parsePublicationInfo("F Xu, Q Hao… - Patterns, 2025 - cell.com"), {
    authors: "F Xu, Q Hao…", venue: "Patterns", year: 2025, domain: "cell.com",
  });
  assert.deepEqual(parsePublicationInfo("I Mutambik - Sensors, 2025 - mdpi.com"), {
    authors: "I Mutambik", venue: "Sensors", year: 2025, domain: "mdpi.com",
  });
  // Degrades to nulls instead of guessing when Scholar gives a bare host.
  assert.deepEqual(parsePublicationInfo("books.google.com"), { authors: null, venue: null, year: null, domain: "books.google.com" });
  assert.deepEqual(parsePublicationInfo(""), { authors: null, venue: null, year: null, domain: null });
});

test("Scholar normalization keeps a real paper and reports year precision honestly", () => {
  const paper = normalizeScholarPaper(scholarRow(), { topic: "AI / ML", now: NOW });
  assert.equal(paper.title, "Toward large reasoning models: A survey of reinforced reasoning");
  assert.equal(paper.provider, "Google Scholar");
  assert.equal(paper.provider_via, "Apify");
  assert.equal(paper.content_type, "paper");
  assert.equal(paper.citations, 246);
  assert.equal(paper.venue, "Patterns");
  assert.equal(paper.published_year, 2025);
  // Scholar reports a YEAR. The record must not invent a day, and must not
  // claim the day-precision freshness verification the OpenAlex tier earns.
  assert.equal(paper.published, "");
  assert.equal(paper.date_precision, "year");
  assert.equal(paper.freshness_verified, false);
  // Scholar is a metadata index: it can never grant redistribution rights.
  assert.equal(paper.rights_status, "unknown_or_restricted");
  assert.equal(paper.full_text_available, false);
  assert.equal(paper.canonical_url, paper.link);
});

test("Scholar normalization rejects every unusable or out-of-window row", () => {
  const reject = (overrides, why) =>
    assert.equal(normalizeScholarPaper(scholarRow(overrides), { topic: "AI / ML", now: NOW }), null, why);
  reject({ title: "" }, "no title");
  reject({ title: "Ω-42 kernel" }, "junk title");
  reject({ link: "" }, "no link");
  reject({ link: "ftp://example.com/paper" }, "non-http scheme");
  reject({ link: "https://scholar.google.com/scholar?cluster=123" }, "Scholar interstitial, not a source");
  reject({ year: null, publicationInfo: "A Author - somewhere.com" }, "no year anywhere");
  reject({ year: CUTOFF_YEAR - 1 }, "older than the rolling window");
  reject({ year: NOW.getUTCFullYear() + 5 }, "implausible future year");
  assert.equal(normalizeScholarPaper(null, { now: NOW }), null);
});

test("cost is predictable before a single dollar is spent", () => {
  assert.equal(SCHOLAR_USD_PER_PAPER, 0.0015);
  assert.equal(estimateScholarCostUsd(46, 10), 0.69); // all 23 topics, 2 queries each
  assert.equal(estimateScholarCostUsd(0, 10), 0);
});

test("venue prestige is a bounded, openly-listed heuristic", () => {
  assert.ok(venueScore("Nature") > venueScore("IEEE Transactions on Robotics"));
  assert.ok(venueScore("IEEE Transactions on Robotics") > venueScore("Sensors (MDPI)"));
  assert.ok(venueScore("arXiv preprint") > venueScore("MDPI Applied Sciences"));
  assert.equal(venueScore(""), 0.45); // unknown is neutral, not punished
  for (const venue of ["Nature", "", "arXiv", "Some Unlisted Journal"]) {
    const score = venueScore(venue);
    assert.ok(score >= 0 && score <= 1, venue);
  }
});

test("the world score is bounded, weighted to 1, and moves the way a reader expects", () => {
  const total = Object.values(RANK_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "weights must sum to 1");

  const base = { citations: 100, published_year: 2025, venue: "Patterns" };
  const cited = worldScore({ ...base, citations: 1000 }, { now: NOW });
  assert.ok(cited > worldScore(base, { now: NOW }), "more citations must rank higher");

  const older = worldScore({ ...base, published_year: CUTOFF_YEAR }, { now: NOW });
  assert.ok(older < worldScore(base, { now: NOW }), "older work must rank lower at equal citations");

  const prestigious = worldScore({ ...base, venue: "Nature" }, { now: NOW });
  assert.ok(prestigious > worldScore({ ...base, venue: "MDPI Sensors" }, { now: NOW }));

  const corroborated = worldScore({ ...base, providers: ["OpenAlex", "Google Scholar"] }, { now: NOW });
  assert.ok(corroborated > worldScore(base, { now: NOW }), "two independent providers beat one");

  const open = worldScore({ ...base, open_access_pdf: "https://example.org/p.pdf" }, { now: NOW });
  assert.ok(open > worldScore(base, { now: NOW }), "a readable paper beats an unreadable one");

  for (const paper of [{}, { citations: 1e9, published_year: 2026 }, { citations: -5 }]) {
    const score = worldScore(paper, { now: NOW });
    assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, JSON.stringify(paper));
  }
});

test("the score is inspectable: every component ships with the paper", () => {
  const parts = scoreBreakdown({ citations: 200, published_year: 2025, venue: "Nature", open_access_pdf: "x" }, { now: NOW });
  assert.deepEqual(Object.keys(parts).sort(), ["access", "citations_per_year", "corroboration", "impact", "recency", "venue"]);
  for (const key of ["impact", "recency", "venue", "corroboration", "access"]) {
    assert.ok(parts[key] >= 0 && parts[key] <= 1, key);
  }
  // A year-precision paper is scored from mid-year, so it is neither flattered
  // nor penalised against a same-year paper with an exact date.
  assert.equal(scoringDate({ published_year: 2025 }).toISOString().slice(0, 7), "2025-06");
  assert.equal(scoringDate({ published: "2025-03-04T00:00:00.000Z" }).toISOString().slice(0, 10), "2025-03-04");
  assert.equal(scoringDate({}), null);
});

test("the same paper from two providers collapses into one stronger record", () => {
  const fromOpenAlex = {
    title: "Toward Large Reasoning Models: A Survey",
    link: "https://doi.org/10.1016/j.patter.2025.101218",
    canonical_url: "https://doi.org/10.1016/j.patter.2025.101218",
    provider: "OpenAlex", citations: 180, published: "2025-01-20T00:00:00.000Z",
    summary: "A short OpenAlex abstract.", publisher: "Patterns",
    freshness_verified: true, rights_status: "unknown_or_restricted",
  };
  const fromScholar = {
    title: "toward large reasoning models  a survey",
    link: "https://www.cell.com/patterns/fulltext/S2666-3899(25)00218-1",
    provider: "Google Scholar", citations: 246, published_year: 2025,
    summary: "A noticeably longer Google Scholar snippet that carries more of the paper's actual argument than the other one does.",
    venue: "Patterns", open_access_pdf: "https://www.cell.com/patterns/pdf/x.pdf",
  };
  const [merged] = mergePapers([[fromOpenAlex], [fromScholar]], { now: NOW });
  assert.deepEqual(merged.providers, ["OpenAlex", "Google Scholar"]);
  // Identity comes from the strict provider passed first.
  assert.equal(merged.link, fromOpenAlex.link);
  assert.equal(merged.freshness_verified, true);
  // Every field takes the better of the two.
  assert.equal(merged.citations, 246);
  assert.equal(merged.summary, fromScholar.summary);
  assert.equal(merged.open_access_pdf, fromScholar.open_access_pdf);
  assert.equal(merged.published, fromOpenAlex.published);
  assert.equal(merged.published_year, 2025);
});

test("dedup keys survive casing, punctuation, accents and DOI formatting", () => {
  assert.equal(paperKey({ title: "Toward Large Reasoning Models: A Survey!" }), paperKey({ title: "toward   large reasoning models a survey" }));
  assert.equal(paperKey({ link: "https://doi.org/10.1016/j.patter.2025.101218" }), "doi:10.1016/j.patter.2025.101218");
  assert.equal(paperKey({ canonical_url: "HTTPS://DOI.ORG/10.1016/J.PATTER.2025.101218" }), "doi:10.1016/j.patter.2025.101218");
  assert.equal(paperKey({ title: "Résumé Café Naïve" }), paperKey({ title: "Resume Cafe Naive" }));
  // A DOI-less pair with different titles must NOT collapse.
  assert.notEqual(paperKey({ title: "Attention is all you need" }), paperKey({ title: "Attention is not all you need" }));
});

test("ranking is total, stable and numbered", () => {
  const papers = [
    { title: "B paper", citations: 10, published_year: 2025 },
    { title: "A landmark", citations: 5000, published_year: 2025, venue: "Nature", providers: ["OpenAlex", "Google Scholar"] },
    { title: "A paper", citations: 10, published_year: 2025 },
  ];
  const ranked = rankWorld(papers, { now: NOW });
  assert.equal(ranked[0].title, "A landmark");
  assert.deepEqual(ranked.map((paper) => paper.world_rank), [1, 2, 3]);
  // Identical scores and citations break on title, so a refresh cannot reshuffle.
  assert.deepEqual(ranked.slice(1).map((paper) => paper.title), ["A paper", "B paper"]);
  assert.deepEqual(rankWorld(papers, { now: NOW }).map((p) => p.title), ranked.map((p) => p.title));
  assert.deepEqual(rankWorld([], { now: NOW }), []);
});

test("the Scholar snapshot is re-validated on read, not trusted", () => {
  const snapshot = {
    generated_at: "2026-08-18T00:00:00.000Z",
    topics: {
      "AI / ML": {
        papers: [
          { title: "Fresh enough", link: "https://example.org/a", published_year: CUTOFF_YEAR },
          { title: "Aged out since the snapshot was written", link: "https://example.org/b", published_year: CUTOFF_YEAR - 1 },
          { title: "Impossible future", link: "https://example.org/c", published_year: 2099 },
          { title: "No year at all", link: "https://example.org/d" },
          { title: "No link", published_year: 2025 },
        ],
      },
    },
  };
  const papers = scholarPapersForTopic("AI / ML", { now: NOW, snapshot });
  assert.deepEqual(papers.map((paper) => paper.title), ["Fresh enough"]);
  assert.equal(papers[0].topic, "AI / ML");
  // Unknown topic and a missing snapshot are empty lists, never a throw.
  assert.deepEqual(scholarPapersForTopic("Nope", { now: NOW, snapshot }), []);
  assert.deepEqual(scholarPapersForTopic("AI / ML", { now: NOW, snapshot: null }), []);
});

test("the committed snapshot matches the canonical topic registry and the paper contract", () => {
  const snapshot = loadScholarSnapshot({ reload: true });
  if (!snapshot) return; // absent snapshot is a supported state, not a failure
  assert.equal(snapshot.provider, "Google Scholar");
  assert.equal(snapshot.provider_via, "Apify");
  for (const topicName of Object.keys(snapshot.topics)) {
    assert.ok(TOPIC_NAMES.includes(topicName), `unknown topic in snapshot: ${topicName}`);
    for (const paper of snapshot.topics[topicName].papers) {
      assert.equal(paper.content_type, "paper");
      assert.equal(paper.provider, "Google Scholar");
      assert.equal(paper.freshness_verified, false);
      assert.equal(paper.full_text_available, false);
      assert.ok(/^https?:\/\//.test(paper.link), paper.link);
      assert.ok(!/scholar\.google\./.test(paper.link), paper.link);
      assert.ok(Number.isInteger(paper.published_year));
    }
  }
  // The snapshot must never carry a credential of any kind.
  const raw = readFileSync(new URL("../scholar-snapshot.json", import.meta.url), "utf8");
  assert.ok(!/apify_api_/.test(raw));
});

test("the research UI and detail route carry the world lane end to end", () => {
  const html = readFileSync(new URL("../app/research.html", import.meta.url), "utf8");
  assert.ok(html.includes('rank=world'), "research view must request the world lane");
  assert.ok(html.includes("Best in the world"));
  assert.ok(html.includes("published_year"), "year-precision papers need their own freshness check");
  assert.ok(html.includes("rollingCutoff"), "the client must recompute the cutoff, not trust the server");
  assert.ok(html.includes("world_score"));
  // A paper that only exists in the world lane must still open in the reader.
  const article = readFileSync(new URL("../app/article.html", import.meta.url), "utf8");
  assert.ok(article.includes("paperRank"));
  assert.ok(article.includes("rank=world"));
});

test("no Apify credential is hardcoded anywhere in the shipped source", () => {
  for (const file of ["../lib/apify.js", "../lib/scholar.js", "../lib/scholar-snapshot.js", "../lib/world-rank.js", "../api/research.js", "../scripts/snapshot-scholar.mjs", "../.env.example"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/apify_api_[A-Za-z0-9]{20,}/.test(source), `credential-shaped literal in ${file}`);
  }
});
