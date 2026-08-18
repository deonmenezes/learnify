// lib/world-snapshot.js - read side of the precomputed world-ranked feed.
//
// Serving rank=world from disk turns a 700-1200ms cold request (four live
// OpenAlex queries) into a local read. Ranking by impact is not a real-time
// question - a paper's citation count does not change between two page views -
// so the ranked feed is computed daily by scripts/snapshot-world.mjs.
//
// It also spares OpenAlex's daily budget, which now returns
// "429 Insufficient budget ... Resets at midnight UTC" once spent. A live
// per-request path burns that on traffic; a once-a-day snapshot does not.
//
// The "Newest first" lane is NOT backed by this and stays live, because that
// one genuinely is a real-time question.
//
// STORAGE SHAPE: one small index plus ONE FILE PER TOPIC. A single combined
// file was 987 KB, and every cold serverless instance paid to parse all of it
// to answer for one topic. Per-topic files cost ~40 KB instead.
//
// Reads fail SOFT: a missing or stale snapshot falls through to the live path.

import { readFileSync } from "node:fs";
import { isWithinRollingWindow, rollingCutoff } from "./topics.js";

const INDEX_URL = new URL("../world-snapshot.json", import.meta.url);

// A snapshot older than this is ignored rather than served. The daily job keeps
// it hours old; three days means something has been broken for a while, and a
// slow-but-correct response beats a confidently stale one.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

let cachedIndex;                 // undefined = not loaded, null = unavailable
const cachedTopics = new Map();  // slug -> parsed entry, or null

/**
 * Filename for a topic. Derived ONLY from a canonical topic label that the
 * caller has already validated with findTopic(), and further constrained to
 * [a-z0-9-] here, so a request parameter can never become a path.
 */
export function topicSlug(topicName) {
  return String(topicName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function loadWorldIndex({ reload = false } = {}) {
  if (!reload && cachedIndex !== undefined) return cachedIndex;
  try {
    const parsed = JSON.parse(readFileSync(INDEX_URL, "utf-8"));
    cachedIndex = parsed && parsed.topics && typeof parsed.topics === "object" ? parsed : null;
  } catch {
    cachedIndex = null;
  }
  return cachedIndex;
}

function loadTopicFile(slug, { reload = false } = {}) {
  if (!reload && cachedTopics.has(slug)) return cachedTopics.get(slug);
  let entry = null;
  if (/^[a-z0-9-]{1,60}$/.test(slug)) {
    try {
      const parsed = JSON.parse(readFileSync(new URL(`../world/${slug}.json`, import.meta.url), "utf-8"));
      entry = Array.isArray(parsed?.papers) ? parsed : null;
    } catch { entry = null; }
  }
  cachedTopics.set(slug, entry);
  return entry;
}

/**
 * Precomputed papers for one topic, or null to fall through to the live path.
 *
 * Freshness is re-checked HERE against the current rolling window rather than
 * trusted from snapshot time: OpenAlex papers carry an exact date and must
 * still be inside the window today; Scholar papers carry a year and must be at
 * or after the current cutoff year. A snapshot that ages therefore shrinks
 * honestly instead of shipping papers that have since aged out.
 */
export function worldPapersForTopic(topicName, { now = new Date(), limit = 24, index = loadWorldIndex(), load = loadTopicFile } = {}) {
  if (!index) return null;
  const anchor = now instanceof Date ? now : new Date(now);
  const generatedAt = Date.parse(index.generated_at || "");
  if (!Number.isFinite(generatedAt) || anchor.getTime() - generatedAt > MAX_AGE_MS) return null;

  const meta = index.topics[topicName];
  if (!meta) return null;
  const entry = load(meta.slug || topicSlug(topicName));
  if (!entry || !entry.papers.length) return null;

  const cutoffYear = rollingCutoff(anchor).getUTCFullYear();
  const maxYear = anchor.getUTCFullYear() + 1;
  const fresh = entry.papers.filter((paper) => {
    if (!paper || !paper.title) return false;
    if (paper.published) return isWithinRollingWindow(paper.published, anchor);
    return Number.isInteger(paper.published_year)
      && paper.published_year >= cutoffYear
      && paper.published_year <= maxYear;
  });
  if (!fresh.length) return null;

  const refreshedAt = meta.refreshed_at || index.generated_at;
  return {
    papers: fresh.slice(0, Math.max(0, limit)),
    providerStatus: meta.provider_status || "ok",
    sources: (meta.sources || []).map((source) => ({ ...source, snapshot_at: refreshedAt })),
    refreshedAt,
  };
}
