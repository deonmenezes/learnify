// lib/scholar-snapshot.js - read side of the committed Google Scholar snapshot.
//
// The API never calls Apify on a page view. Apify bills per result, so a
// per-request call would tie a stranger's refresh button to the account's
// credit balance. Instead scripts/snapshot-scholar.mjs runs on a schedule,
// writes scholar-snapshot.json, and the commit triggers a Vercel redeploy - the
// exact pattern the repo already uses for x-snapshot.json and reddit-snapshot.json.
//
// Reads fail SOFT: a missing, unreadable or corrupt snapshot means the world
// lane simply has no Scholar tier that request, and the keyless OpenAlex path
// still answers. It never 500s and it never fabricates.

import { readFileSync } from "node:fs";
import { rollingCutoff } from "./topics.js";

const SNAPSHOT_URL = new URL("../scholar-snapshot.json", import.meta.url);

let cached; // undefined = not loaded yet, null = load failed

export function loadScholarSnapshot({ reload = false } = {}) {
  if (!reload && cached !== undefined) return cached;
  try {
    const parsed = JSON.parse(readFileSync(SNAPSHOT_URL, "utf-8"));
    cached = parsed && typeof parsed.topics === "object" && parsed.topics ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Scholar papers for one exact topic label.
 *
 * Re-checks the publication year against the CURRENT rolling cutoff rather than
 * trusting the cutoff baked in at snapshot time. A snapshot that goes stale for
 * a few weeks therefore shrinks honestly instead of shipping papers that have
 * since aged out of the window.
 */
export function scholarPapersForTopic(topicName, { now = new Date(), limit = 50, snapshot = loadScholarSnapshot() } = {}) {
  if (!snapshot) return [];
  const entry = snapshot.topics?.[topicName];
  const papers = Array.isArray(entry?.papers) ? entry.papers : Array.isArray(entry) ? entry : [];
  if (!papers.length) return [];

  const anchor = now instanceof Date ? now : new Date(now);
  const cutoffYear = rollingCutoff(anchor).getUTCFullYear();
  const maxYear = anchor.getUTCFullYear() + 1;

  return papers
    .filter((paper) =>
      paper && typeof paper.title === "string" && typeof paper.link === "string"
      && Number.isInteger(paper.published_year)
      && paper.published_year >= cutoffYear && paper.published_year <= maxYear)
    .map((paper) => ({ ...paper, topic: topicName }))
    .slice(0, Math.max(0, limit));
}

export function scholarSnapshotMeta(snapshot = loadScholarSnapshot()) {
  if (!snapshot) return null;
  return {
    generated_at: snapshot.generated_at || null,
    actor: snapshot.actor || null,
    count: Number(snapshot.count) || 0,
    topic_count: Object.keys(snapshot.topics || {}).length,
  };
}
