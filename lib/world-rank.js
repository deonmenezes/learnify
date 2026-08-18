// lib/world-rank.js - "best research in the world" merge + ranking.
//
// The problem with every single-provider research feed is that each provider is
// biased in a knowable way:
//   OpenAlex        strict, DOI-bearing, core journals, trustworthy dates, but
//                   citation counts lag and conference/preprint work is thin.
//   Google Scholar  near-total global coverage and the freshest citation counts,
//                   but year-only dates and no license/venue guarantees.
// Neither is "best" alone. This module merges them into one list, and a paper
// that BOTH providers independently surfaced is treated as a stronger signal
// than a paper only one of them saw.
//
// The score is deliberately explainable: every component is bounded 0..1, the
// weights sum to 1, and `scoreBreakdown()` returns the parts so the UI can show
// a reader why a paper ranks where it does. No hidden magic, no black box.

const WEIGHTS = Object.freeze({
  impact: 0.42,        // citations per year, log-scaled
  recency: 0.24,       // how new the work is
  venue: 0.16,         // where it was published
  corroboration: 0.11, // how many independent providers found it
  access: 0.07,        // can a reader actually open it
});

// Citations-per-year at which a paper is treated as world-class. 150/yr is
// roughly the level of a landmark Nature/NeurIPS paper; the log curve means the
// difference between 1 and 10 matters far more than 200 vs 400, which is the
// right shape for ranking (a runaway megahit should not flatten the rest).
const CPY_CEILING = 150;

// Recency half-life in days. Two years is the app's rolling freshness window,
// so a 2-year-old paper should retain a meaningful but clearly reduced share.
const RECENCY_HALFLIFE_DAYS = 400;

// Venue prestige. This is a coarse, openly-listed heuristic, not a journal
// ranking: it exists so a predatory-journal paper with inflated citations cannot
// outrank real work, and it is only 16% of the score.
//
// Matching is WHOLE-WORD on a normalized venue string, never a bare substring.
// Substring matching is what makes these lists silently wrong: "science" as a
// substring promotes "MDPI Applied Sciences" to Nature/Science tier, "med"
// promotes half of medicine, and "cell" promotes "Excellence in ...". The
// flagship tier is exact-title only for the same reason.
const FLAGSHIP_VENUES = new Set([
  "nature", "science", "cell", "the lancet", "lancet", "jama",
  "pnas", "proceedings of the national academy of sciences",
  "new england journal of medicine", "nejm",
]);

const VENUE_TIERS = Object.freeze([
  // Nature/Science family journals and the top-tier CS conferences.
  { score: 0.85, phrases: ["nature communications", "nature medicine", "nature methods", "nature machine intelligence", "nature physics", "nature genetics", "nature biotechnology", "nature materials", "nature neuroscience", "nature energy", "nature astronomy", "nature climate change", "nature chemistry", "science advances", "science robotics", "science translational medicine", "neurips", "advances in neural information processing systems", "icml", "international conference on machine learning", "iclr", "cvpr", "iccv", "eccv", "acl", "emnlp", "naacl", "siggraph", "usenix security", "ieee symposium on security and privacy", "acm ccs", "ndss", "sosp", "osdi", "stoc", "focs", "aaai", "kdd"] },
  // Flagship society and specialty journals.
  { score: 0.75, phrases: ["ieee transactions", "acm transactions", "physical review letters", "physical review x", "journal of the american chemical society", "nucleic acids research", "the astrophysical journal", "monthly notices of the royal astronomical society", "elife", "bmj", "circulation", "journal of clinical oncology", "cell reports", "cell metabolism", "immunity", "neuron", "joule", "matter", "chem"] },
  // Major publishers and long-running journal families.
  { score: 0.62, phrases: ["ieee", "acm", "springer", "elsevier", "wiley", "oxford university press", "cambridge university press", "physical review", "journal of", "annals of", "proceedings of"] },
  // Reputable open-access journals.
  { score: 0.5, phrases: ["plos", "plos one", "frontiers in", "scientific reports", "scientific data", "patterns", "iscience", "communications biology", "communications physics"] },
  // High-volume mega-journals: legitimate, but weak as a quality signal.
  { score: 0.38, phrases: ["mdpi", "sensors", "applied sciences", "sustainability", "electronics", "ieee access", "heliyon", "cureus", "hindawi", "scirp"] },
]);

const PREPRINT_VENUES = ["arxiv", "biorxiv", "medrxiv", "ssrn", "preprint", "preprints", "chemrxiv", "psyarxiv", "osf"];

export function normalizeVenue(venue) {
  return String(venue || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPhrase(normalized, phrase) {
  if (!normalized || !phrase) return false;
  if (normalized === phrase) return true;
  return normalized.startsWith(`${phrase} `)
    || normalized.endsWith(` ${phrase}`)
    || normalized.includes(` ${phrase} `);
}

export function venueScore(venue) {
  const text = normalizeVenue(venue);
  if (!text) return 0.45; // unknown venue is neither rewarded nor punished
  if (FLAGSHIP_VENUES.has(text)) return 1;
  if (PREPRINT_VENUES.some((phrase) => hasPhrase(text, phrase))) return 0.55;
  for (const tier of VENUE_TIERS) {
    if (tier.phrases.some((phrase) => hasPhrase(text, phrase))) return tier.score;
  }
  return 0.45;
}

// A publication instant for scoring only. OpenAlex gives an exact date; Scholar
// gives a year, which is treated as mid-year so a year-precision paper is never
// systematically flattered or penalised against a dated one.
export function scoringDate(paper) {
  if (paper?.published) {
    const exact = new Date(paper.published);
    if (!Number.isNaN(exact.getTime())) return exact;
  }
  if (Number.isInteger(paper?.published_year)) return new Date(Date.UTC(paper.published_year, 5, 30));
  return null;
}

export function scoreBreakdown(paper, { now = new Date() } = {}) {
  const anchor = now instanceof Date ? now : new Date(now);
  const published = scoringDate(paper);
  const ageDays = published ? Math.max(0, (anchor.getTime() - published.getTime()) / 86_400_000) : null;
  // Floor the age at ONE YEAR. With a 0.25-year floor a paper published last
  // month with 38 citations scores 152 citations/year and outranks a Nature
  // paper, which is an artefact of the divisor, not a signal about the work.
  const ageYears = ageDays === null ? null : Math.max(1, ageDays / 365.25);

  const citations = Number.isFinite(paper?.citations) ? Math.max(0, paper.citations) : 0;
  const perYear = ageYears === null ? 0 : citations / ageYears;
  const impact = Math.min(1, Math.log10(1 + perYear) / Math.log10(1 + CPY_CEILING));

  // Undated work cannot be ranked on recency; give it the neutral midpoint
  // rather than a zero that would bury it for a metadata gap it did not cause.
  const recency = ageDays === null ? 0.5 : Math.pow(0.5, ageDays / RECENCY_HALFLIFE_DAYS);

  const venue = venueScore(paper?.venue || paper?.publisher);

  const providerCount = Array.isArray(paper?.providers) ? paper.providers.length : 1;
  const corroboration = providerCount >= 3 ? 1 : providerCount === 2 ? 0.78 : 0.4;

  const access = paper?.open_access_pdf ? 1 : paper?.full_text_available === true ? 0.85 : paper?.rights_status === "verified_open_access" ? 0.85 : 0.35;

  return {
    impact: Number(impact.toFixed(4)),
    recency: Number(recency.toFixed(4)),
    venue: Number(venue.toFixed(4)),
    corroboration: Number(corroboration.toFixed(4)),
    access: Number(access.toFixed(4)),
    citations_per_year: Number(perYear.toFixed(2)),
  };
}

export function worldScore(paper, { now = new Date() } = {}) {
  const parts = scoreBreakdown(paper, { now });
  const raw = WEIGHTS.impact * parts.impact
    + WEIGHTS.recency * parts.recency
    + WEIGHTS.venue * parts.venue
    + WEIGHTS.corroboration * parts.corroboration
    + WEIGHTS.access * parts.access;
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

// Dedup key: a DOI when both records carry one, otherwise a normalized title.
// Titles are normalized aggressively (case, punctuation, accents, whitespace)
// because the same paper reaches us as "Toward Large Reasoning Models: A
// Survey…" from one provider and "Toward large reasoning models: a survey…"
// from the other.
export function doiKey(paper) {
  const doi = String(paper?.doi || paper?.canonical_url || paper?.link || "")
    .toLowerCase()
    .match(/10\.\d{4,9}\/[^\s"'<>]+/);
  return doi ? `doi:${doi[0].replace(/[.,;]+$/, "")}` : null;
}

export function titleKey(paper) {
  const title = String(paper?.title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return title ? `title:${title}` : null;
}

// The identity a paper is filed under. A DOI is authoritative when present, but
// it is NOT sufficient on its own: OpenAlex links by DOI while Scholar links to
// the publisher's own URL, so the same paper carries a DOI key from one provider
// and only a title key from the other. mergePapers therefore files every record
// under BOTH keys and treats a hit on either as the same work.
export function paperKey(paper) {
  return doiKey(paper) || titleKey(paper) || `id:${paper?.id || "unknown"}`;
}

function providerName(paper) {
  return String(paper?.provider || paper?.source || "Unknown");
}

/**
 * Merge provider lists into one deduplicated set.
 *
 * Field-level merge rules, chosen so the merged record is never WORSE than
 * either input:
 *   citations       max (Scholar usually leads, OpenAlex sometimes does)
 *   published       prefer an exact date over a year
 *   summary         prefer the longer abstract
 *   venue/publisher prefer a non-empty value
 *   rights          prefer the record that actually verified a license
 *   providers       union, in first-seen order
 * The FIRST list passed wins on identity fields (id, link) so callers control
 * which provider owns the canonical link. Pass the strict provider first.
 */
export function mergePapers(lists, { now = new Date() } = {}) {
  const records = [];
  const index = new Map(); // every alias key -> position in `records`
  const keysOf = (paper) => [doiKey(paper), titleKey(paper)].filter(Boolean);

  for (const list of lists) {
    for (const paper of Array.isArray(list) ? list : []) {
      if (!paper || !paper.title) continue;
      const keys = keysOf(paper);
      const lookup = keys.length ? keys : [paperKey(paper)];
      let position = -1;
      for (const key of lookup) {
        if (index.has(key)) { position = index.get(key); break; }
      }
      if (position === -1) {
        position = records.push({ ...paper, providers: [providerName(paper)] }) - 1;
        for (const key of lookup) if (!index.has(key)) index.set(key, position);
        continue;
      }
      // Alias the incoming record's keys onto the record it just merged into, so
      // a third provider matching EITHER identity lands on the same paper.
      for (const key of lookup) if (!index.has(key)) index.set(key, position);
      const existing = records[position];
      const providers = existing.providers.includes(providerName(paper))
        ? existing.providers
        : [...existing.providers, providerName(paper)];
      const merged = { ...existing, providers };
      merged.citations = Math.max(Number(existing.citations) || 0, Number(paper.citations) || 0);
      merged.metrics = { citations: merged.citations };
      if (!existing.published && paper.published) merged.published = paper.published;
      if (!Number.isInteger(existing.published_year) && Number.isInteger(paper.published_year)) merged.published_year = paper.published_year;
      if ((paper.summary || "").length > (existing.summary || "").length) merged.summary = paper.summary;
      if (!existing.venue && paper.venue) merged.venue = paper.venue;
      if (!existing.publisher && paper.publisher) merged.publisher = paper.publisher;
      if (!existing.open_access_pdf && paper.open_access_pdf) merged.open_access_pdf = paper.open_access_pdf;
      if (existing.rights_status !== "verified_open_access" && paper.rights_status === "verified_open_access") {
        merged.rights_status = paper.rights_status;
        merged.full_text_status = paper.full_text_status;
        merged.full_text_available = paper.full_text_available;
        merged.license_id = paper.license_id;
        merged.license_url = paper.license_url;
        merged.content_endpoint = paper.content_endpoint;
      }
      records[position] = merged;
    }
  }
  return records;
}

/**
 * Score and order a merged list, best first.
 *
 * Ties break on citations, then on title, so the ordering is total and stable
 * across requests (an unstable "top research" list looks broken to a reader who
 * refreshes).
 */
export function rankWorld(papers, { now = new Date() } = {}) {
  return papers
    .map((paper) => ({
      ...paper,
      world_score: worldScore(paper, { now }),
      score_breakdown: scoreBreakdown(paper, { now }),
    }))
    .sort((a, b) =>
      b.world_score - a.world_score
      || (Number(b.citations) || 0) - (Number(a.citations) || 0)
      || String(a.title).localeCompare(String(b.title)))
    .map((paper, index) => ({ ...paper, world_rank: index + 1 }));
}

export const RANK_WEIGHTS = WEIGHTS;
