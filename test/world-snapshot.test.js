import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadWorldIndex, worldPapersForTopic, topicSlug } from "../lib/world-snapshot.js";
import { TOPIC_NAMES, rollingCutoff } from "../lib/topics.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const CUTOFF_YEAR = rollingCutoff(NOW).getUTCFullYear();

// The index carries metadata only; papers live in one file per topic, injected
// here through the `load` seam so these tests never touch the filesystem.
function snapshotWith(papers, generatedAt = NOW.toISOString()) {
  return {
    index: {
      generated_at: generatedAt,
      topics: { "AI / ML": { slug: "ai-ml", refreshed_at: generatedAt, provider_status: "ok", sources: [{ provider: "OpenAlex", count: 40 }], count: papers.length } },
    },
    load: (slug) => (slug === "ai-ml" ? { topic: "AI / ML", papers } : null),
  };
}

test("a fresh snapshot serves the topic without touching a provider", () => {
  const result = worldPapersForTopic("AI / ML", {
    now: NOW,
    ...snapshotWith([
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
    ...snapshotWith([
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
  assert.equal(worldPapersForTopic("AI / ML", { now: NOW, ...snapshotWith([{ title: "x", published_year: 2026 }], old) }), null);
  assert.equal(worldPapersForTopic("AI / ML", { now: NOW, ...snapshotWith([]) }), null);
  // Every paper aging out is the same as having none.
  assert.equal(worldPapersForTopic("AI / ML", { now: NOW, ...snapshotWith([{ title: "old", published_year: 2000 }]) }), null);
  assert.equal(worldPapersForTopic("Nope", { now: NOW, ...snapshotWith([{ title: "x", published_year: 2026 }]) }), null);
  assert.equal(worldPapersForTopic("AI / ML", { now: NOW, index: null }), null);
  assert.equal(worldPapersForTopic("AI / ML", { now: NOW, index: { generated_at: NOW.toISOString(), topics: {} } }), null);
});

test("slugs are filename-safe and stable for every canonical topic", () => {
  const seen = new Set();
  for (const name of TOPIC_NAMES) {
    const slug = topicSlug(name);
    assert.match(slug, /^[a-z0-9-]{1,60}$/, name);
    assert.ok(!seen.has(slug), `slug collision: ${slug}`);
    seen.add(slug);
  }
  // A request parameter can never climb out of the world/ directory.
  assert.match(topicSlug("../../etc/passwd"), /^[a-z0-9-]*$/);
  assert.ok(!topicSlug("../../etc/passwd").includes("."));
});

test("every indexed topic has a real, ranked, credential-free file on disk", () => {
  const index = loadWorldIndex({ reload: true });
  if (!index) return; // absent snapshot is a supported state
  for (const topicName of Object.keys(index.topics)) {
    assert.ok(TOPIC_NAMES.includes(topicName), `unknown topic: ${topicName}`);
    const slug = index.topics[topicName].slug;
    const raw = readFileSync(new URL(`../world/${slug}.json`, import.meta.url), "utf8");
    assert.ok(!/apify_api_|sk_[A-Za-z0-9]{20,}/.test(raw), `credential in ${slug}.json`);
    const entry = JSON.parse(raw);
    assert.ok(Array.isArray(entry.papers) && entry.papers.length, topicName);
    for (const paper of entry.papers) {
      assert.equal(paper.content_type, "paper");
      assert.ok(paper.title && (paper.link || paper.canonical_url), topicName);
      // The ranking must already be applied; the API must not have to re-sort.
      assert.ok(Number.isFinite(paper.world_score), `${topicName} paper missing world_score`);
    }
    // Ranked descending, or the fast path would serve a different order than
    // the live path for the same data.
    const scores = entry.papers.map((paper) => paper.world_score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), `${topicName} is not ranked`);
  }
  // The index must stay small: it is parsed on every cold serverless start.
  const indexBytes = readFileSync(new URL("../world-snapshot.json", import.meta.url), "utf8").length;
  assert.ok(indexBytes < 64 * 1024, `index grew to ${indexBytes} bytes; it must stay metadata-only`);
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
