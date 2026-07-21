// Public, non-secret runtime configuration for privacy-gated product analytics.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const enabled = process.env.LEARNIFY_ANALYTICS_ENABLED === "true";
  return res.status(200).json({ enabled, provider: enabled ? "vercel" : null });
}
