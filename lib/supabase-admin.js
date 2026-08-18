// lib/supabase-admin.js - service-role reader for the user-data archive.
//
// SEPARATE FROM lib/supabase.js ON PURPOSE. That module uses the public anon
// key against a privacy-safe view and is safe to reach from a page. This one
// carries the SERVICE ROLE key, which bypasses Row Level Security entirely and
// can read every user's rows. Keeping them in different files makes it obvious
// at the import site which one a caller is reaching for.
//
// The service-role key must NEVER reach the browser. Nothing in app/ imports
// this, and the only consumers are scripts/sync-users.mjs (CI) and
// api/account-delete.js (server-side, and only after verifying the caller owns
// the account being deleted).

const SUPABASE_URL = process.env.SUPABASE_URL || "https://bzvmrwdutrmouzbokxds.supabase.co";
const KEY_RE = /^(eyJ[A-Za-z0-9._-]{40,}|sb_secret_[A-Za-z0-9._-]{20,})$/;

export class SupabaseAdminError extends Error {
  constructor(message, { status = 0 } = {}) { super(message); this.name = "SupabaseAdminError"; this.status = status; }
}

export function serviceRoleKey(env = process.env) {
  const raw = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || "").trim();
  return KEY_RE.test(raw) ? raw : null;
}

export function hasServiceRole(env = process.env) {
  return serviceRoleKey(env) !== null;
}

// JWTs and secret keys are long and distinctive; never let one reach a log.
export function redact(value) {
  return String(value == null ? "" : value)
    .replace(/eyJ[A-Za-z0-9._-]{40,}/g, "eyJ***")
    .replace(/sb_secret_[A-Za-z0-9._-]{20,}/g, "sb_secret_***");
}

function adminHeaders(env) {
  const key = serviceRoleKey(env);
  if (!key) throw new SupabaseAdminError("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
}

// PostgREST caps a response; anything user-scale must be paged or rows are
// silently dropped, which in an archive looks like data loss rather than a bug.
const PAGE_SIZE = 1000;

/**
 * Read every row of a table with the service-role key, following pages.
 *
 * `order` must be a stable column or paging can repeat and skip rows.
 */
export async function adminSelectAll(table, { select = "*", order = "id", env = process.env, maxRows = 200_000, timeoutMs = 20_000 } = {}) {
  if (!/^[a-z0-9_]+$/.test(String(table))) throw new SupabaseAdminError("Invalid table name");
  const headers = adminHeaders(env);
  const rows = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set("select", select);
    if (order) url.searchParams.set("order", order);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        headers: { ...headers, Range: `${from}-${from + PAGE_SIZE - 1}`, "Range-Unit": "items" },
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new SupabaseAdminError(error?.name === "AbortError" ? `Timed out reading ${table}` : `Network error reading ${table}`);
    }
    clearTimeout(timer);
    if (!response.ok) {
      throw new SupabaseAdminError(`Supabase returned HTTP ${response.status} for ${table}`, { status: response.status });
    }
    const page = await response.json();
    if (!Array.isArray(page)) throw new SupabaseAdminError(`Unexpected payload for ${table}`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Resolve an access token to its user id.
 *
 * This is how a delete request proves it owns the account. Supabase validates
 * the token itself, so no JWT secret is needed here and an expired or forged
 * token simply fails. Returns null rather than throwing on any rejection: the
 * caller must treat "no id" as "not authorised", never as "allow".
 */
export async function userIdFromAccessToken(accessToken, { env = process.env, timeoutMs = 10_000 } = {}) {
  const token = String(accessToken || "").trim();
  if (!/^ey[A-Za-z0-9._-]{20,}$/.test(token)) return null;
  const anonKey = env.SUPABASE_ANON_KEY || serviceRoleKey(env);
  if (!anonKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const user = await response.json();
    return typeof user?.id === "string" && user.id ? user.id : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export { SUPABASE_URL };
