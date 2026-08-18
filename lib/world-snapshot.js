// lib/world-snapshot.js - read side of the precomputed world-ranked feed.
//
// Serving rank=world from disk turns a 700-1200ms cold request (four live
// OpenAlex queries) into a local read. Ranking by impact is not a real-time
// question - a paper's citation count does not change between two page views -
// so the ranked feed is computed daily by scripts/snapshot-world.mjs.
//
// The "Newest first" lane is NOT backed by this and stays live, because that
// one genuinely is a real-time question.
//
// Reads fail SOFT: a missing or stale snapshot just means the request falls
// through to the live path it used before.

import { readFileSync } from "node:fs";
import { isWithinRollingWindow, rollingCutoff } from "./topics.js";

const SNAPSHOT_URL = new URL("../world-snapshot.json", import.meta.url);

// A snapshot older than this is ignored rather than served. The daily job keeps
// it hours old; three days means something has been broken for a while, and a
// slow-but-correct response beats a confidently stale one.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

let cached; // undefined = not loaded, null = unavailable

export function loadWorldSnapshot({ reload = false } = {}) {
  if (!reload && cached !== undefined) return cached;
  try {
    const parsed = JSON.parse(readFileSync(SNAPSHOT_URL, "utf-8"));
    cached = parsed && parsed.topics && typeof parsed.topics === "object" ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
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
export function worldPapersForTopic(topicName, { now = new Date(), limit = 24, snapshot = loadWorldSnapshot() } = {}) {
  if (!snapshot) return null;
  const anchor = now instanceof Date ? now : new Date(now);
  const generatedAt = Date.parse(snapshot.generated_at || "");
  if (!Number.isFinite(generatedAt) || anchor.getTime() - generatedAt > MAX_AGE_MS) return null;

  const entry = snapshot.topics[topicName];
  const papers = Array.isArray(entry?.papers) ? entry.papers : null;
  if (!papers || !papers.length) return null;

  const cutoffYear = rollingCutoff(anchor).getUTCFullYear();
  const maxYear = anchor.getUTCFullYear() + 1;
  const fresh = papers.filter((paper) => {
    if (!paper || !paper.title) return false;
    if (paper.published) return isWithinRollingWindow(paper.published, anchor);
    return Number.isInteger(paper.published_year)
      && paper.published_year >= cutoffYear
      && paper.published_year <= maxYear;
  });
  if (!fresh.length) return null;

  return {
    papers: fresh.slice(0, Math.max(0, limit)),
    providerStatus: entry.provider_status || "ok",
    sources: (entry.sources || []).map((source) => ({ ...source, snapshot_at: entry.refreshed_at || snapshot.generated_at })),
    refreshedAt: entry.refreshed_at || snapshot.generated_at,
  };
}
