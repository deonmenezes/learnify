// POST /api/account-delete — erase a user's data from the MongoDB archive.
//
// WHY THIS EXISTS
// privacy.html promises "You can permanently delete your account". Supabase
// honours that for the primary store. Once a copy also lives in the archive,
// the promise is only true if the archive is erased too, so this is the call a
// client makes as part of its delete flow.
//
// It is NOT the only guarantee. scripts/sync-users.mjs reconciles on every run
// and purges anyone who no longer exists in Supabase, so a client that fails to
// call this — an old app build, a crash mid-delete, a network drop — still
// cannot leave orphaned personal data behind. This endpoint makes erasure
// immediate; the reconciler makes it certain.
//
// AUTHORISATION
// The caller sends its Supabase access token as `Authorization: Bearer <jwt>`.
// The token is resolved to a user id BY SUPABASE, so a forged or expired token
// simply fails and no JWT secret is needed here. A user id is never accepted
// from the request body: that would let anyone erase anyone.
//
// Request:  POST, header Authorization: Bearer <supabase access token>
// Response: 200 { ok: true, deleted: { <collection>: <count> } }
//           401 when the token is missing, expired or not resolvable
//           503 when the archive is unreachable (nothing was deleted; retry)

import { getDb, hasMongo, deleteUserData, redact } from "../lib/mongo.js";
import { userIdFromAccessToken } from "../lib/supabase-admin.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  // An erasure must never be served from a cache.
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method_not_allowed" }); return; }

  const header = String(req.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return res.status(401).json({ ok: false, error: "missing_token" });

  const userId = await userIdFromAccessToken(match[1]);
  if (!userId) return res.status(401).json({ ok: false, error: "invalid_token" });

  // No archive configured means there is no copy to erase, which is a success
  // for the caller: after this call, no archived data for them exists.
  if (!hasMongo()) return res.status(200).json({ ok: true, deleted: {}, note: "no archive configured" });

  try {
    const db = await getDb();
    const deleted = await deleteUserData(db, userId);
    // Deliberately logs the COUNTS and not the id, so an erasure is auditable
    // without the log itself becoming a record of who was deleted.
    console.log("account-delete", JSON.stringify(deleted));
    return res.status(200).json({ ok: true, deleted });
  } catch (error) {
    // 503, not 500: nothing was deleted and the caller should retry. Reporting
    // success here would tell a user their data is gone when it is not.
    console.error("account-delete failed", redact(error.message));
    return res.status(503).json({ ok: false, error: "archive_unavailable" });
  }
}
