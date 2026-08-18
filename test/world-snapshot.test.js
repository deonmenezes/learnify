import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadWorldSnapshot, worldPapersForTopic } from "../lib/world-snapshot.js";
import { TOPIC_NAMES, rollingCutoff } from "../lib/topics.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const CUTOFF_YEAR = rollingCutoff(NOW).getUTCFullYear();

function snapshotWith(papers, generatedAt = NOW.toISOString()) {
  return {
    generated_at: generatedAt,
    topics: { "AI / ML": { refreshed_at: generatedAt, provider_status: "ok", sources: [{ provider: "OpenAlex", count: 40 }], papers } },
  };
}

test("a fresh snapshot serves the topic without touching a provider", () => {
  const result = worldPapersForTopic("AI / ML", {
    now: NOW,
    snapshot: snapshotWith([
      { title: "Dated and inside the window", published: "2026-01-05T00:00:00.000Z" },
      { title: "Year-precision and inside the window", published_year: CUTOFF_YEAR },
    ]),
  });
  assert.equal(result.papers.length, 2);
  assert.equal(result.providerStatus, "ok");
  assert.equal(result.sources[0].snapshot_at, NOW.toISOString());
});

test("freshness is re-checked on read, not trusted from snapshot time", () => {
  // The snapshot was written when these were valid; today they are not. A
  // stale snapshot must shrink honestly rather than ship aged-out papers.
  const result = worldPapersForTopic("AI / ML", {
    now: NOW,
    snapshot: snapshotWith([
      { title: "Still inside the window", published: "2026-01-05T00:00:00.000Z" },
      { title: "Aged out since the snapshot", published: "2023-01-05T00:00:00.000Z" },
      { title: "Year aged out", published_year: CUTOFF_YEAR - 1 },
      { title: "Impossible future", published_year: 2099 },
      { title: "No date at all" },
      { published: "2026-01-05T00:00:00.000Z" },
    ]),
  });
  assert.deepEqual(result.papers.map((paper) => paper.title), ["Still inside the window"]);
});

test("a stale, empty or missing snapshot falls through to the live path", () => {
  const old = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
  // Older than the max age: better a slow correct answer than a confident stale one.
  assert.equal(worldPapersForTopic("AI / ML", { now: NOW, snapshot: snapshotWith([{ title: "x", published_year: 2026 }], old) }), null);
  assert.equal(worldPapersForTopic("AI / ML", { now: NOW, snapshot: snapshotWith([]) }), null);
  // Every paper aging out is the same as having none.
  assert.equal(worldPapersForTopic("AI / ML", { now: NOW, snapshot: snapshotWith([{ title: "old", published_year: 2000 }]) }), null);
  assert.equal(worldPapersForTopic("Nope", { now: NOW, snapshot: snapshotWith([{ title: "x", published_year: 2026 }]) }), null);
  assert.equal(worldPapersForTopic("AI / ML", { now: NOW, snapshot: null }), null);
  assert.equal(worldPapersForTopic("AI / ML", { now: NOW, snapshot: { topics: {} } }), null);
});

test("the committed snapshot covers the canonical topics and carries no credential", () => {
  const snapshot = loadWorldSnapshot({ reload: true });
  if (!snapshot) return; // absent snapshot is a supported state
  for (const topicName of Object.keys(snapshot.topics)) {
    assert.ok(TOPIC_NAMES.includes(topicName), `unknown topic: ${topicName}`);
    const entry = snapshot.topics[topicName];
    assert.ok(Array.isArray(entry.papers) && entry.papers.length, topicName);
    for (const paper of entry.papers) {
      assert.equal(paper.content_type, "paper");
      assert.ok(paper.title && (paper.link || paper.canonical_url), topicName);
      // The ranking must already be applied; the API must not have to re-sort.
      assert.ok(Number.isFinite(paper.world_score), `${topicName} paper missing world_score`);
    }
    // Ranked descending, or the "fast path" would serve a different order than
    // the live path for the same data.
    const scores = entry.papers.map((paper) => paper.world_score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), `${topicName} is not ranked`);
  }
  const raw = readFileSync(new URL("../world-snapshot.json", import.meta.url), "utf8");
  assert.ok(!/apify_api_|sk_[A-Za-z0-9]{20,}/.test(raw));
});

test("the API declares which path served the request", async () => {
  const { default: handler } = await import("../api/research.js");
  const res = {
    headers: {}, setHeader(n, v) { this.headers[n] = v; },
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; },
  };
  await handler({ query: { topic: "AI / ML", rank: "world", limit: "5" }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.world_ranked, true);
  // served_from makes the fast path observable instead of a silent behaviour change.
  assert.ok(["snapshot", "live"].includes(res.body.served_from));
  if (res.body.served_from === "snapshot") assert.ok(res.body.ranked_at);
});
