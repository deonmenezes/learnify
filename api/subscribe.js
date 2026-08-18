// POST /api/subscribe — opt-in marketing capture for Learnify.
//
// Body (JSON): { email, phone?, optedIn:true, source? }
//
// Storage, in order of preference:
//   1. MongoDB (MONGODB_URI)      — the real home; unique index on email, so a
//                                   repeat signup updates rather than duplicates
//   2. Upstash/Vercel KV          — the previous behaviour, kept as a fallback
//   3. Function logs              — last resort, so a signup is never silently lost
//
// Compliance: only stores records where optedIn === true (explicit opt-in).
// The response reports WHERE it landed, so a misconfigured deploy is visible
// rather than quietly degrading to logs nobody reads.

import { getDb, hasMongo, redact } from "../lib/mongo.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method_not_allowed" }); return; }

  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const email = String(body.email || "").trim().toLowerCase();
    const phone = body.phone ? String(body.phone).trim() : null;
    const optedIn = body.optedIn === true || body.optedIn === "true";

    if (!optedIn) { res.status(400).json({ ok: false, error: "opt_in_required" }); return; }
    if (!EMAIL_RE.test(email)) { res.status(400).json({ ok: false, error: "invalid_email" }); return; }

    const record = {
      email,
      phone,
      optedIn: true,
      source: String(body.source || "ios-signup"),
      optedInAt: new Date().toISOString(),
    };

    let stored = "log";

    if (hasMongo()) {
      try {
        const db = await getDb();
        // Upsert on the unique email index: signing up twice updates the record
        // instead of creating a second one, and re-subscribing after an
        // unsubscribe is a normal, non-destructive path.
        await db.collection("subscribers").updateOne(
          { email },
          {
            $set: { ...record, updated_at: new Date().toISOString() },
            $setOnInsert: { created_at: new Date().toISOString() },
          },
          { upsert: true },
        );
        stored = "mongodb";
      } catch (error) {
        // Never fail a signup because the archive is unreachable; fall through
        // to KV or the log so the address is still captured.
        console.error("subscribe: mongo write failed", redact(error.message));
      }
    }

    const kvUrl = process.env.KV_REST_API_URL;
    const kvTok = process.env.KV_REST_API_TOKEN;
    if (stored !== "mongodb" && kvUrl && kvTok) {
      const r = await fetch(kvUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${kvTok}`, "Content-Type": "application/json" },
        body: JSON.stringify(["LPUSH", "techscroll:subscribers", JSON.stringify(record)]),
      });
      stored = r.ok ? "kv" : "log";
      if (!r.ok) console.error("KV LPUSH failed", r.status);
    }
    if (stored === "log") {
      // Fallback: at least surface it in logs until a datastore is attached.
      console.log("SUBSCRIBE", JSON.stringify(record));
    }

    res.status(200).json({ ok: true, stored });
  } catch (e) {
    console.error("subscribe error", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
}
