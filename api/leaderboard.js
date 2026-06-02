// GET /api/leaderboard — the AI model leaderboard powering the TechScroll app.
//
// Reads the arena.ai / LMArena community mirror (no auth) and normalizes it to
// the app's house schema. Reasoning/Agentic/Math have no native arena board, so
// they are proxied from the closest board (text/code) — documented, not invented.
//
// Response: { source, last_updated, lenses, models: [
//   { name, lab, scores:{Overall,Coding,Reasoning,Agentic,Math}, delta_7d, spark[7] } ] }
//   lab ∈ Anthropic | OpenAI | Google | Meta | xAI | Mistral | DeepSeek (others dropped).
//
// CORS open. Cached 24h (arena updates ~weekly) with stale-while-revalidate.
//
// ⚠️ Data originates from arena.ai and remains under arena.ai's Terms of Use;
//    this is an unofficial mirror. Swap to Artificial Analysis (attribution) for
//    a cleaner-licensed primary when ready.

const MIRROR = "https://raw.githubusercontent.com/oolong-tea-2026/arena-ai-leaderboards/main/data";
const WULONG = "https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard";

const LENS_BOARD = { Overall: "text", Coding: "code", Reasoning: "text", Agentic: "code", Math: "text" };
const LENSES = ["Overall", "Coding", "Reasoning", "Agentic", "Math"];

const LAB = {
  anthropic: "Anthropic", openai: "OpenAI", google: "Google",
  "google deepmind": "Google", deepmind: "Google", meta: "Meta",
  xai: "xAI", mistral: "Mistral", "mistral ai": "Mistral", deepseek: "DeepSeek",
};

const j = async (url) => {
  const r = await fetch(url, { headers: { "user-agent": "techscroll-leaderboard/1.0" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

async function board(name, date) {
  try { return (await j(`${WULONG}?name=${name}`)).models || []; }
  catch { return (await j(`${MIRROR}/${date}/${name}.json`)).models || []; }
}
async function boardOn(name, date) {
  try { return (await j(`${MIRROR}/${date}/${name}.json`)).models || []; }
  catch { return []; }
}

const isoDaysAgo = (base, n) => {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

function pretty(id) {
  return String(id)
    .replace(/[-_]/g, " ")
    .replace(/\b(\d+) (\d+)\b/g, "$1.$2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bGpt\b/i, "GPT").replace(/\bAi\b/, "AI");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=43200");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const { date } = await j(`${MIRROR}/latest.json`);

    const wanted = [...new Set(Object.values(LENS_BOARD))];
    const boards = Object.fromEntries(
      await Promise.all(wanted.map(async (n) => [n, await board(n, date)]))
    );

    const history = await Promise.all(
      Array.from({ length: 7 }, (_, i) => boardOn("text", isoDaysAgo(date, 6 - i)))
    );
    const histScore = history.map((rows) => {
      const m = {};
      for (const r of rows) m[r.model] = r.score;
      return m;
    });

    const models = (boards.text || []).map((row) => {
      const lab = LAB[String(row.vendor || "").toLowerCase()];
      if (!lab) return null;

      const scores = {};
      for (const lens of LENSES) {
        const b = boards[LENS_BOARD[lens]] || [];
        const hit = b.find((x) => x.model === row.model);
        scores[lens] = hit ? hit.score : row.score;
      }

      const series = histScore.map((m) => m[row.model]).filter((v) => v != null);
      const lo = Math.min(...series, row.score), hi = Math.max(...series, row.score);
      const spark = (series.length >= 2 ? series : [row.score, row.score])
        .map((v) => (hi === lo ? 0.5 : (v - lo) / (hi - lo)));
      const weekAgo = series.length ? series[0] : row.score;

      return { name: pretty(row.model), lab, scores,
               delta_7d: Math.round((row.score - weekAgo) * 10) / 10, spark };
    }).filter(Boolean);

    models.sort((a, b) => b.scores.Overall - a.scores.Overall);

    return res.status(200).json({
      source: "arena.ai",
      last_updated: new Date().toISOString(),
      lenses: LENSES,
      models: models.slice(0, 12),
    });
  } catch (e) {
    return res.status(502).json({ error: "leaderboard upstream unavailable", detail: String(e) });
  }
}
