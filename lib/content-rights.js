const EUROPE_PMC_API_HOST = "www.ebi.ac.uk";
const EUROPE_PMC_WEB_HOST = "europepmc.org";

const LICENSES = [
  { id: "CC0-1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/", path: /\/publicdomain\/zero\/1\.0\/?$/i, text: /\bcc\s*0\s*(?:1\.0)?\b/i },
  { id: "PDM-1.0", url: "https://creativecommons.org/publicdomain/mark/1.0/", path: /\/publicdomain\/mark\/1\.0\/?$/i, text: /\bpublic\s+domain(?:\s+mark)?\s*(?:1\.0)?\b/i },
  { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/", path: /\/licenses\/by\/4\.0\/?$/i, text: /\bcc\s*[- ]?by\s*4\.0\b/i },
  { id: "CC-BY-3.0", url: "https://creativecommons.org/licenses/by/3.0/", path: /\/licenses\/by\/3\.0\/?$/i, text: /\bcc\s*[- ]?by\s*3\.0\b/i },
];

const UNSAFE_XML = /<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

export class ContentPolicyError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = "ContentPolicyError";
    this.code = code;
    this.status = status;
  }
}

export function normalizePmcid(value) {
  const match = String(value || "").toUpperCase().match(/(?:^|\/)PMC(\d+)(?:\/|$)/);
  return match ? `PMC${match[1]}` : null;
}

export function normalizePmid(value) {
  const match = String(value || "").match(/(?:^|\/)(\d{5,12})(?:\/|$)/);
  return match ? match[1] : null;
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

export function europePmcApiUrl(pmcid) {
  const id = normalizePmcid(pmcid);
  if (!id) return null;
  return `https://${EUROPE_PMC_API_HOST}/europepmc/webservices/rest/${id}/fullTextXML`;
}

export function europePmcSearchUrl(pmid) {
  const id = normalizePmid(pmid);
  if (!id) return null;
  const url = new URL(`https://${EUROPE_PMC_API_HOST}/europepmc/webservices/rest/search`);
  url.searchParams.set("query", `EXT_ID:${id} AND SRC:MED`);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", "1");
  return url.toString();
}

export function isAllowedBodySourceUrl(value) {
  const url = safeUrl(value);
  return Boolean(url && url.hostname === EUROPE_PMC_API_HOST &&
    /^\/europepmc\/webservices\/rest\/PMC\d+\/fullTextXML$/i.test(url.pathname) && !url.search && !url.hash);
}

export function isAllowedMetadataSourceUrl(value) {
  const url = safeUrl(value);
  if (!url || url.hostname !== EUROPE_PMC_API_HOST || url.pathname !== "/europepmc/webservices/rest/search" || url.hash) return false;
  return /^EXT_ID:\d{5,12} AND SRC:MED$/.test(url.searchParams.get("query") || "") &&
    url.searchParams.get("format") === "json" && url.searchParams.get("pageSize") === "1" && [...url.searchParams.keys()].length === 3;
}

export function isAllowedCanonicalUrl(value) {
  const url = safeUrl(value);
  return Boolean(url && ((url.hostname === EUROPE_PMC_WEB_HOST && /^\/articles\/PMC\d+\/?$/i.test(url.pathname)) ||
    url.hostname === "doi.org"));
}

function licenseFromUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || !/(^|\.)creativecommons\.org$/i.test(url.hostname)) return null;
  return LICENSES.find((license) => license.path.test(url.pathname)) || null;
}

export function normalizeLicense(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const fromUrl = licenseFromUrl(raw);
  if (fromUrl) return { id: fromUrl.id, url: fromUrl.url };
  const exactId = LICENSES.find((license) => license.id.toLowerCase() === raw.toLowerCase());
  if (exactId) return { id: exactId.id, url: exactId.url };
  const fromText = LICENSES.find((license) => license.text.test(raw));
  return fromText ? { id: fromText.id, url: fromText.url } : null;
}

function xmlAttributeValues(value, name) {
  const out = [];
  const re = new RegExp(`\\b(?:[a-z]+:)?${name}\\s*=\\s*(["'])(.*?)\\1`, "gi");
  for (const match of String(value || "").matchAll(re)) out.push(match[2]);
  return out;
}

export function licenseFromXml(xml) {
  const front = (String(xml || "").match(/<front\b[^>]*>([\s\S]*?)<\/front\s*>/i) || [null, ""])[1];
  const blocks = front.match(/<license\b[^>]*>[\s\S]*?<\/license\s*>/gi) || [];
  const found = [];
  for (const block of blocks) {
    const hrefs = xmlAttributeValues(block, "href");
    if (!hrefs.length) return null;
    for (const href of hrefs) {
      const license = licenseFromUrl(decodeXml(href));
      if (!license) return null;
      found.push(license);
    }
  }
  if (!found.length || found.some((license) => license.id !== found[0].id)) return null;
  return { id: found[0].id, url: found[0].url };
}

function validCodePoint(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
    ? String.fromCodePoint(number)
    : " ";
}

export function decodeXml(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => validCodePoint(parseInt(number, 16)))
    .replace(/&#(\d+);/g, (_, number) => validCodePoint(Number(number)))
    .replace(/&([a-z]+);/gi, (_, name) => named[name.toLowerCase()] ?? " ");
}

export function sanitizeText(value, max = 12000) {
  const withoutUnsafe = String(value || "").replace(UNSAFE_XML, " ").replace(/<!--[\s\S]*?-->/g, " ");
  return decodeXml(withoutUnsafe.replace(/<[^>]*>/g, " "))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim()
    .slice(0, max);
}

function firstText(xml, tag, max) {
  const match = String(xml || "").match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i"));
  return match ? sanitizeText(match[1], max) : "";
}

function extractAuthors(xml) {
  const authors = [];
  const front = (String(xml || "").match(/<front\b[^>]*>([\s\S]*?)<\/front\s*>/i) || [null, ""])[1];
  for (const match of front.matchAll(/<contrib\b[^>]*contrib-type\s*=\s*["']author["'][^>]*>([\s\S]*?)<\/contrib\s*>/gi)) {
    const given = firstText(match[1], "given-names", 100);
    const surname = firstText(match[1], "surname", 100);
    const name = `${given} ${surname}`.trim() || firstText(match[1], "collab", 160);
    if (name && !authors.includes(name)) authors.push(name);
    if (authors.length >= 12) break;
  }
  return authors;
}

export function extractLicensedContent(xml, { maxBlocks = 160, maxCharacters = 120000 } = {}) {
  const source = String(xml || "");
  const license = licenseFromXml(source);
  if (!license) return { allowed: false, license: null, title: "", authors: [], blocks: [] };
  const body = (source.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i) || [null, ""])[1];
  const blocks = [];
  let total = 0;
  let truncated = false;
  if (body) {
    const blockPattern = /<(title|p)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
    for (const match of body.matchAll(blockPattern)) {
      const text = sanitizeText(match[3], match[1].toLowerCase() === "title" ? 500 : 8000);
      if (text.length < 2) continue;
      if (total + text.length > maxCharacters) { truncated = true; break; }
      const isCitation = /\b(?:content-type|specific-use)\s*=\s*["'](?:citation|reference)["']/i.test(match[2]);
      blocks.push({ type: match[1].toLowerCase() === "title" ? "heading" : (isCitation ? "citation" : "paragraph"), text });
      total += text.length;
      if (blocks.length >= maxBlocks) { truncated = true; break; }
    }
  }
  return {
    allowed: true,
    license,
    title: firstText(source, "article-title", 500),
    authors: extractAuthors(source),
    copyrightNotice: firstText(source, "copyright-statement", 1000),
    truncated,
    blocks,
  };
}

function openAlexLicenseHint(work) {
  const locations = [work?.best_oa_location, work?.primary_location, ...(Array.isArray(work?.locations) ? work.locations : [])];
  for (const location of locations) {
    const license = normalizeLicense(location?.license);
    if (license) return license;
  }
  return null;
}

export function defaultRightsMetadata({ canonicalUrl = "", source = "", checkedAt = new Date().toISOString() } = {}) {
  return {
    rights_status: "unknown_or_restricted",
    full_text_status: "unknown",
    full_text_available: false,
    license_id: null,
    license_url: null,
    canonical_url: String(canonicalUrl || ""),
    attribution: source ? `Source: ${source}` : "",
    body_source: null,
    body_source_url: null,
    rights_provenance_at: checkedAt,
    content_endpoint: null,
  };
}

export function normalizedRightsMetadata(record, { checkedAt = new Date().toISOString() } = {}) {
  const fallback = defaultRightsMetadata({ canonicalUrl: record?.link || record?.canonical_url, source: record?.source, checkedAt });
  const pmcid = normalizePmcid(record?.pmcid);
  const pmid = normalizePmid(record?.pmid);
  if (record?.source_id !== "openalex" || (!pmcid && !pmid) || record?.rights_status !== "verification_required") return fallback;
  const license = normalizeLicense(record?.license_id);
  return {
    ...fallback,
    rights_status: "verification_required",
    full_text_status: "unchecked",
    license_id: license?.id || null,
    license_url: license?.url || null,
    attribution: record?.attribution || `${fallback.attribution}; full-text rights must be verified by Europe PMC`,
    body_source: "Europe PMC",
    body_source_url: pmcid ? europePmcApiUrl(pmcid) : europePmcSearchUrl(pmid),
    content_endpoint: pmcid ? `/api/content?pmcid=${encodeURIComponent(pmcid)}` : `/api/content?pmid=${encodeURIComponent(pmid)}`,
    pmcid: pmcid || null,
    pmid: pmid || null,
  };
}

export function openAlexRightsMetadata(work, { canonicalUrl = "", source = "OpenAlex", checkedAt = new Date().toISOString() } = {}) {
  const base = defaultRightsMetadata({ canonicalUrl, source, checkedAt });
  const pmcid = normalizePmcid(work?.ids?.pmcid);
  const pmid = normalizePmid(work?.ids?.pmid);
  const hint = openAlexLicenseHint(work);
  if (!pmcid && !pmid) return base;
  return {
    ...base,
    rights_status: "verification_required",
    full_text_status: "unchecked",
    license_id: hint?.id || null,
    license_url: hint?.url || null,
    attribution: `${base.attribution}; full-text rights must be verified by Europe PMC`,
    body_source: "Europe PMC",
    body_source_url: pmcid ? europePmcApiUrl(pmcid) : europePmcSearchUrl(pmid),
    content_endpoint: pmcid ? `/api/content?pmcid=${encodeURIComponent(pmcid)}` : `/api/content?pmid=${encodeURIComponent(pmid)}`,
    pmcid: pmcid || null,
    pmid: pmid || null,
  };
}

export async function readTextWithLimit(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ContentPolicyError("response_too_large", "Provider response exceeded the size limit", 413);
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new ContentPolicyError("response_too_large", "Provider response exceeded the size limit", 413);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ContentPolicyError("response_too_large", "Provider response exceeded the size limit", 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
