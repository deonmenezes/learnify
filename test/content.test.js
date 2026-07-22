import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import contentHandler, { allowRequest, fetchEuropePmcXml, resolveEuropePmcId } from "../api/content.js";
import {
  ContentPolicyError,
  defaultRightsMetadata,
  extractLicensedContent,
  isAllowedBodySourceUrl,
  isAllowedMetadataSourceUrl,
  licenseFromXml,
  normalizeLicense,
  normalizePmid,
  normalizedRightsMetadata,
  openAlexRightsMetadata,
  readTextWithLimit,
  sanitizeText,
} from "../lib/content-rights.js";

const LICENSE = '<license xlink:href="http://creativecommons.org/licenses/by/4.0/">CC BY 4.0</license>';
const XML = `<?xml version="1.0"?><article><front><article-meta><title-group><article-title>Safe open paper</article-title></title-group><copyright-statement>© 2026 Authors</copyright-statement>${LICENSE}<contrib-group><contrib contrib-type="author"><name><given-names>Ada</given-names><surname>Lovelace</surname></name></contrib></contrib-group></article-meta></front><body><sec><title>Results</title><p>Useful <italic>research</italic> with <xref ref-type="bibr">[1]</xref>.</p></sec></body></article>`;

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

function xmlResponse(body, { status = 200, type = "application/xml", length } = {}) {
  return new Response(body, { status, headers: { "content-type": type, ...(length ? { "content-length": String(length) } : {}) } });
}

function jsonResponse(body, { status = 200, type = "application/json" } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": type } });
}

test("license policy accepts only exact supported identifiers or license URLs", () => {
  assert.deepEqual(normalizeLicense("CC-BY-4.0"), { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" });
  assert.deepEqual(licenseFromXml(XML), { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" });
  assert.equal(licenseFromXml('<license xlink:href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC</license>'), null);
  assert.equal(licenseFromXml("<license>This is not public domain and has no redistribution grant.</license>"), null);
  assert.equal(licenseFromXml("<article><body><p>CC BY 4.0 appears in body text.</p></body></article>"), null);
  assert.equal(licenseFromXml(`<article><front>${LICENSE}<license xlink:href="https://creativecommons.org/licenses/by-nc/4.0/">Restricted</license></front></article>`), null);
  assert.equal(licenseFromXml(`<article><body>${LICENSE}<p>Not metadata</p></body></article>`), null);
});

test("rights metadata defaults unknown/restricted and treats a PMCID only as unverified", () => {
  const unknown = defaultRightsMetadata({ canonicalUrl: "https://publisher.example/item", source: "Publisher", checkedAt: "2026-07-21T00:00:00.000Z" });
  assert.equal(unknown.rights_status, "unknown_or_restricted");
  assert.equal(unknown.full_text_status, "unknown");
  assert.equal(unknown.full_text_available, false);
  assert.equal(unknown.content_endpoint, null);

  const candidate = openAlexRightsMetadata({ ids: { pmcid: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12345" }, best_oa_location: { license: "cc-by" } }, { canonicalUrl: "https://doi.org/10.1/example", checkedAt: "2026-07-21T00:00:00.000Z" });
  assert.equal(candidate.rights_status, "verification_required");
  assert.equal(candidate.full_text_status, "unchecked");
  assert.equal(candidate.full_text_available, false);
  assert.equal(candidate.license_id, null);
  assert.equal(candidate.content_endpoint, "/api/content?pmcid=PMC12345");

  const pmidCandidate = openAlexRightsMetadata({ ids: { pmid: "https://pubmed.ncbi.nlm.nih.gov/39966355" } }, { canonicalUrl: "https://doi.org/10.1/pmid", checkedAt: "2026-07-21T00:00:00.000Z" });
  assert.equal(normalizePmid("https://pubmed.ncbi.nlm.nih.gov/39966355"), "39966355");
  assert.equal(pmidCandidate.pmid, "39966355");
  assert.equal(pmidCandidate.pmcid, null);
  assert.equal(pmidCandidate.content_endpoint, "/api/content?pmid=39966355");

  const mixedFeedCandidate = normalizedRightsMetadata({ ...candidate, source_id: "openalex", source: "OpenAlex", link: "https://doi.org/10.1/example" }, { checkedAt: "2026-07-21T00:00:00.000Z" });
  assert.equal(mixedFeedCandidate.full_text_status, "unchecked");
  assert.equal(mixedFeedCandidate.content_endpoint, "/api/content?pmcid=PMC12345");
  assert.equal(normalizedRightsMetadata({ ...candidate, source_id: "publisher" }).full_text_status, "unknown");
});

test("provider and host allowlists reject arbitrary, credentialed, redirected, and malformed targets", () => {
  assert.equal(isAllowedBodySourceUrl("https://www.ebi.ac.uk/europepmc/webservices/rest/PMC123/fullTextXML"), true);
  assert.equal(isAllowedBodySourceUrl("https://evil.example/europepmc/webservices/rest/PMC123/fullTextXML"), false);
  assert.equal(isAllowedBodySourceUrl("https://www.ebi.ac.uk/europepmc/webservices/rest/PMC123/fullTextXML?url=https://evil.example"), false);
  assert.equal(isAllowedBodySourceUrl("https://user:pass@www.ebi.ac.uk/europepmc/webservices/rest/PMC123/fullTextXML"), false);
  assert.equal(isAllowedBodySourceUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedMetadataSourceUrl("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID%3A39966355+AND+SRC%3AMED&format=json&pageSize=1"), true);
  assert.equal(isAllowedMetadataSourceUrl("https://evil.example/europepmc/webservices/rest/search?query=EXT_ID%3A39966355+AND+SRC%3AMED&format=json&pageSize=1"), false);
  assert.equal(isAllowedMetadataSourceUrl("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=malicious&format=json&pageSize=1"), false);
});

test("sanitization strips XSS markup, attributes, unsafe URLs, comments, and controls", () => {
  const attack = '<p onclick="steal()">Hello<script>alert(1)</script><iframe src="javascript:alert(1)">bad</iframe><a href="data:text/html,bad">world</a><!--secret-->\u0000</p>';
  assert.equal(sanitizeText(attack), "Hello world");
  const content = extractLicensedContent(XML.replace("Useful <italic>research</italic>", attack));
  assert.equal(content.allowed, true);
  assert.ok(content.blocks.every((block) => !/[<>]|javascript:|data:|onclick|alert\(/i.test(block.text)));
});

test("licensed XML yields bounded structured plain text and canonical attribution fields", () => {
  const content = extractLicensedContent(XML, { maxBlocks: 2, maxCharacters: 1000 });
  assert.equal(content.allowed, true);
  assert.equal(content.title, "Safe open paper");
  assert.deepEqual(content.authors, ["Ada Lovelace"]);
  assert.equal(content.copyrightNotice, "© 2026 Authors");
  assert.deepEqual(content.blocks, [
    { type: "heading", text: "Results" },
    { type: "paragraph", text: "Useful research with [1]." },
  ]);
});

test("provider fetch validates content type, size, and timeout", async () => {
  await assert.rejects(() => fetchEuropePmcXml("PMC1", { fetchImpl: async () => xmlResponse("<html></html>", { type: "text/html" }) }), (error) => error instanceof ContentPolicyError && error.code === "invalid_content_type" && error.status === 415);
  await assert.rejects(() => fetchEuropePmcXml("PMC2", { fetchImpl: async () => xmlResponse("x", { length: 7 * 1024 * 1024 }) }), (error) => error.code === "response_too_large" && error.status === 413);
  await assert.rejects(() => fetchEuropePmcXml("PMC3", {
    timeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  }), (error) => error.code === "provider_timeout" && error.status === 504);
});

test("PMID resolver requires matching bounded Europe PMC JSON with a PMCID", async () => {
  const pmcid = await resolveEuropePmcId("39966355", { fetchImpl: async () => jsonResponse({ resultList: { result: [{ pmid: "39966355", pmcid: "PMC11836418" }] } }) });
  assert.equal(pmcid, "PMC11836418");
  await assert.rejects(() => resolveEuropePmcId("39966355", { fetchImpl: async () => jsonResponse({ resultList: { result: [{ pmid: "other", pmcid: "PMC1" }] } }) }), (error) => error.code === "body_unavailable" && error.status === 404);
  await assert.rejects(() => resolveEuropePmcId("39966355", { fetchImpl: async () => jsonResponse({}, { type: "text/html" }) }), (error) => error.code === "invalid_content_type" && error.status === 415);
});

test("stream reader enforces the byte cap when content-length is absent", async () => {
  const result = xmlResponse("123456", { type: "application/xml" });
  await assert.rejects(() => readTextWithLimit(result, 5), (error) => error.code === "response_too_large");
});

test("per-client rate limiting allows twenty requests and rejects the next one", () => {
  const now = Date.now();
  const client = `rate-test-${now}`;
  for (let index = 0; index < 20; index += 1) assert.equal(allowRequest(client, now), true);
  assert.equal(allowRequest(client, now), false);
  assert.equal(allowRequest(client, now + 60_000), true);
});

test("content endpoint fails closed for invalid/unlicensed bodies and returns licensed structured text", async () => {
  const invalid = response();
  await contentHandler({ method: "GET", query: { pmcid: "https://evil.example" }, headers: {} }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.headers["Cache-Control"], "no-store");

  const originalFetch = global.fetch;
  try {
    global.fetch = async () => xmlResponse("<article><front><license>All rights reserved</license></front><body><p>Secret</p></body></article>");
    const restricted = response();
    await contentHandler({ method: "GET", query: { pmcid: "PMC90001" }, headers: { "x-forwarded-for": "rights-test" } }, restricted);
    assert.equal(restricted.statusCode, 403);
    assert.equal(restricted.body.full_text_status, "restricted");
    assert.equal(restricted.headers["Cache-Control"], "no-store");

    global.fetch = async () => xmlResponse(XML);
    const allowed = response();
    await contentHandler({ method: "GET", query: { pmcid: "PMC90002" }, headers: { "x-forwarded-for": "allowed-test" } }, allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.body.rights_status, "verified_open_access");
    assert.equal(allowed.body.full_text_available, true);
    assert.equal(allowed.body.license_id, "CC-BY-4.0");
    assert.equal(allowed.body.copyright_notice, "© 2026 Authors");
    assert.match(allowed.body.adaptation_notice, /structured plain text/);
    assert.equal(allowed.body.canonical_url, "https://europepmc.org/articles/PMC90002");
    assert.match(allowed.body.attribution, /Safe open paper — Ada Lovelace.*Europe PMC.*CC-BY-4\.0/);
    assert.ok(allowed.body.blocks.every((block) => ["heading", "paragraph", "citation"].includes(block.type)));
    let providerCalls = 0;
    global.fetch = async (url) => {
      providerCalls += 1;
      return String(url).includes("/search?")
        ? jsonResponse({ resultList: { result: [{ pmid: "39966355", pmcid: "PMC11836418" }] } })
        : xmlResponse(XML);
    };
    const resolved = response();
    await contentHandler({ method: "GET", query: { pmid: "39966355" }, headers: { "x-forwarded-for": "pmid-test" } }, resolved);
    assert.equal(resolved.statusCode, 200);
    assert.equal(resolved.body.pmid, "39966355");
    assert.equal(resolved.body.pmcid, "PMC11836418");
    assert.equal(providerCalls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("detail UI preserves source CTA, honest fallback, and textContent-only body rendering", () => {
  const html = readFileSync(new URL("../app/article.html", import.meta.url), "utf8");
  for (const phrase of ["AI Summary", "Read in Learnify", "Read on", "redistribution permission was not verified", "Licensed full text could not be verified or loaded", "Canonical copy"]) assert.ok(html.includes(phrase), phrase);
  assert.ok(html.includes("node.textContent = block.text"));
  assert.ok(!html.includes("content.innerHTML"));
  assert.ok(html.indexOf('id="reader"') > html.indexOf("AI Summary"));
  assert.ok(html.includes("/api/content?pmcid="));
});
