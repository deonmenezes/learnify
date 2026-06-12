// POST /api/verify-subscription — server-side Learnify Pro entitlement check.
//
// Body (JSON): { transactionId }  — any StoreKit 2 Transaction.id (or
// originalTransactionId) from the Pro subscription group.
//
// Verifies against Apple's App Store Server API (production, then sandbox
// fallback so TestFlight/review purchases resolve). Never trusts the client's
// receipt payload — only the transaction id, which is useless without our key.
//
// 200 -> { ok:true, isPro, status, productId, expiresDate, autoRenew, environment }
// 200 -> { ok:true, isPro:false, status:"not_found" } when Apple doesn't know the id
// 4xx/5xx -> { ok:false, error }

import { verifyProSubscription } from "../lib/apple-iap.js";

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

    const transactionId = String(body.transactionId || "").trim();
    if (!/^\d{1,20}$/.test(transactionId)) {
      res.status(400).json({ ok: false, error: "invalid_transaction_id" });
      return;
    }

    const result = await verifyProSubscription(transactionId);
    if (result.notFound) {
      res.status(200).json({ ok: true, isPro: false, status: "not_found" });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("verify-subscription failed:", err.message);
    res.status(502).json({ ok: false, error: "verification_unavailable" });
  }
}
