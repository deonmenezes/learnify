// POST /api/subscribe — opt-in marketing capture for Learnify.
//
// Body (JSON): { email, phone?, optedIn:true, source? }
// Persists to Upstash/Vercel KV if KV_REST_API_URL + KV_REST_API_TOKEN are set,
// otherwise logs (visible in Vercel function logs) so nothing is silently lost.
//
// Compliance: only stores records where optedIn === true (explicit opt-in).

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

    const kvUrl = process.env.KV_REST_API_URL;
    const kvTok = process.env.KV_REST_API_TOKEN;
    let stored = "log";
    if (kvUrl && kvTok) {
      const r = await fetch(kvUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${kvTok}`, "Content-Type": "application/json" },
        body: JSON.stringify(["LPUSH", "techscroll:subscribers", JSON.stringify(record)]),
      });
      stored = r.ok ? "kv" : "log";
      if (!r.ok) console.error("KV LPUSH failed", r.status);
    }
    if (stored !== "kv") {
      // Fallback: at least surface it in logs until a datastore is attached.
      console.log("SUBSCRIBE", JSON.stringify(record));
    }

    res.status(200).json({ ok: true, stored });
  } catch (e) {
    console.error("subscribe error", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
}
