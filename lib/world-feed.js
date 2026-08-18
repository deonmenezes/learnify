// lib/world-feed.js - the one place the world-ranked topic feed is assembled.
//
// api/research.js (per request) and scripts/daily-briefing.mjs (once a day)
// must agree exactly on what "the best research in the world" means for a
// topic; if they drift, the audio briefing starts describing papers the app
// does not show. Both call this.

import { collectTopicPapers } from "./papers.js";
import { scholarPapersForTopic, scholarSnapshotMeta } from "./scholar-snapshot.js";
import { mergePapers, rankWorld } from "./world-rank.js";

/**
 * Merge and rank one topic.
 *
 * The Scholar tier is read FIRST because it is a synchronous local read that
 * cannot fail; if OpenAlex is unreachable the lane still has an answer instead
 * of an error page. `ok` is false only when BOTH tiers came back empty.
 */
export async function collectWorldPapers(topicName, { now = new Date(), limit = 24, poolSize } = {}) {
  const scholarPapers = scholarPapersForTopic(topicName, { now, limit: 60 });
  const pool = Math.min(50, Math.max(Number(poolSize) || limit, 40));

  let openAlexPapers = [];
  let openAlexFailed = false;
  let providerStatus = "ok";
  try {
    const result = await collectTopicPapers(topicName, { now, limit: pool });
    providerStatus = result.providerStatus;
    openAlexPapers = result.papers;
  } catch {
    openAlexFailed = true;
    providerStatus = "partial";
  }

  // OpenAlex is merged first so a paper both providers found keeps the
  // DOI-verified identity, canonical link and rights metadata.
  const ranked = rankWorld(mergePapers([openAlexPapers, scholarPapers], { now }), { now });
  const snapshot = scholarSnapshotMeta();

  return {
    ok: !(openAlexFailed && scholarPapers.length === 0),
    papers: ranked.slice(0, Math.max(0, limit)),
    providerStatus,
    openAlexFailed,
    scholarSnapshot: snapshot,
    sources: [
      ...(openAlexPapers.length ? [{ provider: "OpenAlex", via: "direct", count: openAlexPapers.length }] : []),
      ...(scholarPapers.length ? [{ provider: "Google Scholar", via: "Apify", count: scholarPapers.length, snapshot_at: snapshot?.generated_at || null }] : []),
    ],
  };
}
