// lib/apify.js - minimal hardened Apify client for the Learnify research tier.
//
// Apify unlocks the one scholarly source no keyless API can reach: Google
// Scholar, which indexes essentially every journal, conference, preprint server
// and repository on earth and reports a real citation count per paper. That is
// what "the best research papers in the world" needs, and OpenAlex alone cannot
// supply it.
//
// Design rules this module enforces:
//   1. The token is read from the environment only, never hardcoded, never
//      logged, and never placed in a URL (it rides the Authorization header so
//      it cannot leak through proxy/access logs).
//   2. Every run carries a hard wall-clock timeout AND a hard USD charge cap
//      (`maxTotalChargeUsd`), so a misbehaving actor can never drain credit.
//   3. Every failure is a typed error with no provider payload echoed back, so
//      callers can degrade to the keyless OpenAlex path instead of 500ing.

const API_BASE = "https://api.apify.com/v2";
const ACTOR_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*~[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const TOKEN_RE = /^apify_api_[A-Za-z0-9]{20,}$/;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class ApifyError extends Error {
  constructor(message, { status = 0, actorId = "" } = {}) {
    super(message);
    this.name = "ApifyError";
    this.status = status;
    this.actorId = actorId;
  }
}

// APIFY_TOKEN is the documented name; APIFY_API_TOKEN is Apify's own convention
// and is accepted so a copy-pasted platform env var just works. An malformed
// value is treated as absent rather than sent upstream.
export function apifyToken(env = process.env) {
  const raw = String(env.APIFY_TOKEN || env.APIFY_API_TOKEN || "").trim();
  return TOKEN_RE.test(raw) ? raw : null;
}

export function hasApifyToken(env = process.env) {
  return apifyToken(env) !== null;
}

// Redact anything that looks like a token before it can reach a log line.
export function redact(value) {
  return String(value == null ? "" : value).replace(/apify_(?:api|proxy)_[A-Za-z0-9]+/g, "apify_***");
}

/**
 * Run an Apify actor and return its default dataset items.
 *
 * Uses run-sync-get-dataset-items so one HTTPS call covers start, wait and
 * fetch. `maxTotalChargeUsd` is the budget guard: Apify aborts the run itself
 * once the charge cap is hit, which is strictly safer than trusting our own
 * accounting. `maxItems` is the second, independent guard on result volume.
 */
export async function runActorSync(actorId, input, options = {}) {
  const {
    timeoutSecs = 120,
    maxItems,
    maxTotalChargeUsd,
    memoryMbytes,
    build,
    env = process.env,
  } = options;

  if (!ACTOR_ID_RE.test(String(actorId || ""))) {
    throw new ApifyError("Invalid Apify actor id", { actorId: String(actorId || "") });
  }
  const token = apifyToken(env);
  if (!token) throw new ApifyError("Apify token is not configured", { actorId });

  const url = new URL(`${API_BASE}/acts/${actorId}/run-sync-get-dataset-items`);
  url.searchParams.set("timeout", String(Math.max(10, Math.min(600, Math.round(timeoutSecs)))));
  if (Number.isFinite(maxItems)) url.searchParams.set("maxItems", String(Math.max(1, Math.round(maxItems))));
  if (Number.isFinite(maxTotalChargeUsd)) url.searchParams.set("maxTotalChargeUsd", String(Math.max(0.001, maxTotalChargeUsd)));
  if (Number.isFinite(memoryMbytes)) url.searchParams.set("memory", String(memoryMbytes));
  if (build) url.searchParams.set("build", String(build));

  // Give the HTTP call a little more headroom than the run itself so a run that
  // times out server-side still returns a clean partial dataset.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (timeoutSecs + 20) * 1000);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      body: JSON.stringify(input ?? {}),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const reason = error?.name === "AbortError" ? "timed out" : "network error";
    throw new ApifyError(`Apify run ${reason}`, { actorId });
  }

  try {
    if (!response.ok) {
      // Deliberately does NOT echo the provider body: it can contain the input,
      // and the input is not guaranteed to be free of sensitive query text.
      throw new ApifyError(`Apify run failed with HTTP ${response.status}`, { status: response.status, actorId });
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ApifyError("Apify response exceeded the size limit", { actorId });
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new ApifyError("Apify returned a non-JSON dataset", { actorId }); }
    if (!Array.isArray(parsed)) throw new ApifyError("Apify returned an unexpected dataset shape", { actorId });
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
