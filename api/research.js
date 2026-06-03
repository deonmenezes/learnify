// GET /api/research — LIVE trending/top research papers for the TechScroll app.
//
// Sources real papers from lib/papers.js (arXiv newest across cs.AI/LG/CL/CV +
// OpenAlex recent + OpenAlex most-cited "trending"), de-duplicated, mapped to the
// app's research schema. Link-out only — links to the canonical source.
//
// Query params (optional):
//   category  filter by app category value (e.g. "AI / ML", "Science")
//   limit     max papers (default all)
//   sort      "trending" (default, by momentum) | "citations" | "recent"
//
// Response: { generated_at, count, papers: [
//   { id, title, org, category, summary, citations, trend, url } ] }
//
// CORS open. Edge-cached ~30m with stale-while-revalidate so it stays fresh + fast.

import { collectPapers } from "../lib/papers.js";

// The app DROPS any paper whose `category` is not one of these exact NewsCategory
// rawValues. Papers are AI/ML-dominant; classify the few exceptions by keyword.
function toAppCategory(p) {
  const hay = `${p.section || ""} ${(p.categories || []).join(" ")} ${p.id || ""} ${p.title || ""}`.toLowerCase();
  if (/\brobot|locomotion|quadruped|cs\.ro/.test(hay)) return "Robotics";
  if (/secur|cryptograph|adversarial attack|cs\.cr/.test(hay)) return "Security";
  if (/supercond|materials|cond-mat|physics|biolog|chemi|astro|quantum|genom|protein|climate|neurosci/.test(hay)) return "Science";
  if (/semiconduct|hardware|fpga|circuit|photonic/.test(hay)) return "Hardware & Gadgets";
  return "AI / ML"; // arXiv cs.* + OpenAlex AI concepts default to AI/ML
}

// A 0…99 momentum score: most-cited "trending" papers scale by citations; fresh
// papers score by recency so the newest work still surfaces near the top.
function trendScore(p) {
  if (p.trending && p.citations) return Math.min(99, Math.max(20, Math.round(p.citations / 25)));
  if (p.published) {
    // Clamp days to >= 0 so future-dated items can't blow the score up.
    const days = Math.max(0, (Date.now() - new Date(p.published).getTime()) / 86_400_000);
    if (!Number.isNaN(days)) return Math.max(1, Math.min(70, Math.round(45 - days)));
  }
  return p.citations ? Math.min(60, Math.round(p.citations / 40)) : 5;
}

function idFor(title) {
  let h = 0;
  for (let i = 0; i < title.length; i++) { h = (h * 31 + title.charCodeAt(i)) >>> 0; }
  return `p_${h.toString(16)}`;
}

function toResearch(p) {
  const org = String(p.author || p.source || "Research").slice(0, 80);
  const summary = (p.summary && p.summary.trim()) || `Recent ${p.source || "research"} paper.`;
  return {
    id: p.id || idFor(String(p.title || "")),
    title: String(p.title || "").trim(),
    org,
    category: toAppCategory(p),
    summary,
    citations: Number.isFinite(p.citations) ? p.citations : 0,
    trend: trendScore(p),
    url: String(p.link || "").trim(),
  };
}

function str(v) { return (Array.isArray(v) ? v[0] : v || "").toString().trim(); }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const category = str(req.query?.category).toLowerCase();
  const sort = str(req.query?.sort) || "trending";
  const limit = parseInt(str(req.query?.limit), 10);

  let papers = [];
  try {
    const raw = await collectPapers();
    papers = raw.map(toResearch).filter((p) => p.title && p.url);
  } catch (err) {
    // Never 500 the tab — the app has its own bundled-sample fallback.
    return res.status(200).json({ generated_at: new Date().toISOString(), count: 0, papers: [], error: String(err) });
  }

  if (category) papers = papers.filter((p) => p.category.toLowerCase() === category);
  papers.sort((a, b) => {
    if (sort === "citations") return b.citations - a.citations;
    if (sort === "recent") return 0; // collectPapers already returns newest-first
    return b.trend - a.trend;        // "trending" (default)
  });
  if (!Number.isNaN(limit)) papers = papers.slice(0, Math.max(0, limit));

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    count: papers.length,
    papers,
  });
}
