import {
  ContentPolicyError,
  europePmcApiUrl,
  europePmcSearchUrl,
  extractLicensedContent,
  isAllowedBodySourceUrl,
  isAllowedMetadataSourceUrl,
  normalizePmcid,
  normalizePmid,
  readTextWithLimit,
} from "../lib/content-rights.js";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_PROVIDER_BYTES = 6 * 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const rateBuckets = new Map();
const contentCache = new Map();

function str(value) {
  return (Array.isArray(value) ? value[0] : value || "").toString().trim();
}

export function allowRequest(key, now = Date.now()) {
  if (rateBuckets.size > 1000) {
    for (const [client, value] of rateBuckets) {
      if (now - value.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(client);
    }
  }
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT;
}

function getCached(pmcid, now = Date.now()) {
  const entry = contentCache.get(pmcid);
  if (!entry || now - entry.storedAt >= CACHE_TTL_MS) {
    contentCache.delete(pmcid);
    return null;
  }
  return entry.value;
}

function setCached(pmcid, value, now = Date.now()) {
  if (contentCache.size >= MAX_CACHE_ENTRIES) contentCache.delete(contentCache.keys().next().value);
  contentCache.set(pmcid, { storedAt: now, value });
}

export async function resolveEuropePmcId(pmid, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const id = normalizePmid(pmid);
  const url = europePmcSearchUrl(id);
  if (!id || !url || !isAllowedMetadataSourceUrl(url)) throw new ContentPolicyError("provider_not_allowed", "Metadata provider is not allowed", 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "Learnify/1.0 (support@techscroll.app)" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new ContentPolicyError("provider_unavailable", "Provider metadata is unavailable", response.status === 404 ? 404 : 502);
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    if (!/^application\/json(?:;|$)/.test(contentType)) throw new ContentPolicyError("invalid_content_type", "Provider returned an unsupported metadata type", 415);
    let payload;
    try { payload = JSON.parse(await readTextWithLimit(response, MAX_METADATA_BYTES)); }
    catch (error) {
      if (error instanceof ContentPolicyError) throw error;
      throw new ContentPolicyError("invalid_provider_response", "Provider metadata could not be parsed", 502);
    }
    const match = (payload?.resultList?.result || []).find((item) => String(item?.pmid || "") === id);
    const pmcid = normalizePmcid(match?.pmcid);
    if (!pmcid) throw new ContentPolicyError("body_unavailable", "Europe PMC has no full-text identifier for this record", 404);
    return pmcid;
  } catch (error) {
    if (error?.name === "AbortError") throw new ContentPolicyError("provider_timeout", "Metadata provider timed out", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchEuropePmcXml(pmcid, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const url = europePmcApiUrl(pmcid);
  if (!url || !isAllowedBodySourceUrl(url)) throw new ContentPolicyError("provider_not_allowed", "Full-text provider is not allowed", 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/xml, text/xml;q=0.9", "User-Agent": "Learnify/1.0 (support@techscroll.app)" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new ContentPolicyError("provider_unavailable", "Provider full text is unavailable", response.status === 404 ? 404 : 502);
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    if (!/^(application|text)\/xml(?:;|$)/.test(contentType)) {
      throw new ContentPolicyError("invalid_content_type", "Provider returned an unsupported content type", 415);
    }
    return await readTextWithLimit(response, MAX_PROVIDER_BYTES);
  } catch (error) {
    if (error?.name === "AbortError") throw new ContentPolicyError("provider_timeout", "Full-text provider timed out", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method && req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const rawPmcid = str(req.query?.pmcid);
  const rawPmid = str(req.query?.pmid);
  const pmcid = normalizePmcid(rawPmcid);
  const pmid = normalizePmid(rawPmid);
  const invalid = Boolean(rawPmcid) === Boolean(rawPmid) ||
    (rawPmcid && (!pmcid || pmcid !== rawPmcid.toUpperCase())) ||
    (rawPmid && (!pmid || pmid !== rawPmid));
  if (invalid) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ error: "invalid_identifier" });
  }
  const client = str(req.headers?.["x-forwarded-for"]).split(",")[0] || "anonymous";
  if (!allowRequest(client)) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "rate_limited" });
  }

  try {
    const requestKey = pmcid || `PMID:${pmid}`;
    let payload = getCached(requestKey);
    let resolvedPmcid = pmcid;
    if (!payload && !resolvedPmcid) {
      resolvedPmcid = await resolveEuropePmcId(pmid);
      payload = getCached(resolvedPmcid);
    }
    if (!payload) {
      const xml = await fetchEuropePmcXml(resolvedPmcid);
      const content = extractLicensedContent(xml);
      if (!content.allowed) {
        res.setHeader("Cache-Control", "no-store");
        return res.status(403).json({ error: "rights_not_verified", full_text_status: "restricted" });
      }
      if (!content.blocks.length) {
        res.setHeader("Cache-Control", "no-store");
        return res.status(404).json({ error: "body_unavailable", full_text_status: "unavailable" });
      }
      const checkedAt = new Date().toISOString();
      const authors = content.authors.length > 3 ? `${content.authors[0]} et al` : content.authors.join(", ");
      const workLabel = content.title || `Article ${resolvedPmcid}`;
      payload = {
        content_type: "paper",
        rights_status: "verified_open_access",
        full_text_status: "available",
        full_text_available: true,
        pmcid: resolvedPmcid,
        pmid: pmid || null,
        title: content.title || null,
        authors: content.authors,
        license_id: content.license.id,
        license_url: content.license.url,
        canonical_url: `https://europepmc.org/articles/${resolvedPmcid}`,
        attribution: `${workLabel}${authors ? ` — ${authors}` : ""}. Full text provided by Europe PMC under ${content.license.id}.`,
        copyright_notice: content.copyrightNotice || null,
        adaptation_notice: "Formatted into structured plain text by Learnify; figures, tables, and non-text media may be omitted.",
        body_source: "Europe PMC",
        body_source_url: europePmcApiUrl(resolvedPmcid),
        rights_provenance_at: checkedAt,
        content_format: "structured_plain_text",
        content_truncated: content.truncated,
        blocks: content.blocks,
      };
      setCached(resolvedPmcid, payload);
      if (pmid) setCached(requestKey, payload);
    }
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json(payload);
  } catch (error) {
    const policyError = error instanceof ContentPolicyError ? error : null;
    res.setHeader("Cache-Control", "no-store");
    return res.status(policyError?.status || 502).json({
      error: policyError?.code || "provider_request_failed",
      full_text_status: "unavailable",
    });
  }
}
