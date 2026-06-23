// lib/supabase.js — minimal keyless reader for the public leaderboard view.
//
// The user leaderboard + public profiles are read through the `ts_leaderboard`
// view (migration 0004), which is owned by postgres and so bypasses ts_profiles'
// per-row RLS while exposing ONLY non-PII public columns. The view is granted to
// `anon`, so the project's anon key (already public, shipped in the web client)
// is enough — no service-role key required.
//
// Env (with safe public fallbacks to the same Supabase project the app uses):
//   SUPABASE_URL, SUPABASE_ANON_KEY

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://bzvmrwdutrmouzbokxds.supabase.co";
const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6dm1yd2R1dHJtb3V6Ym9reGRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwOTkyMjksImV4cCI6MjA5NTY3NTIyOX0.5kw8SgbuX4hiHGUluf8cvuK-_0zKErPWLf_O5sgRe-0";

/**
 * GET rows from a PostgREST table/view with the anon key.
 * @param {string} path  e.g. "ts_leaderboard"
 * @param {Record<string,string>} query  PostgREST query params (select, order, limit, eq filters…)
 * @returns {Promise<any[]>} rows (empty array on any failure — never throws)
 */
export async function sbSelect(path, query = {}, ms = 9000) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export { SUPABASE_URL };
