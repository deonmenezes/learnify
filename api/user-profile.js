// GET /api/user-profile?id=<user_id> — a single user's PUBLIC profile for the
// leaderboard's tap-through profile view. Reads the RLS-bypassing ts_leaderboard
// view (migration 0004), so it returns ONLY non-PII public fields (never email).
//
// Response: { user_id, display_name, avatar_url, xp, streak, longest_streak,
//             level, total_read, interests:[String], last_activity, rank }
// 404 when the id isn't on the board (no profile, or zero activity).

import { sbSelect } from "../lib/supabase.js";

const levelFromXp = (xp) => Math.max(1, Math.floor((xp || 0) / 500) + 1);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const id = String(req.query.id || "").trim();
  if (!id) return res.status(400).json({ error: "missing id" });

  const rows = await sbSelect("ts_leaderboard", {
    select: "user_id,display_name,avatar_url,xp,streak,longest_streak,level,total_read,interests,last_activity,rank",
    user_id: `eq.${id}`,
    limit: "1",
  });
  const r = rows[0];
  if (!r) return res.status(404).json({ error: "not found" });

  return res.status(200).json({
    user_id: r.user_id,
    display_name: r.display_name || null,
    avatar_url: r.avatar_url || null,
    xp: r.xp || 0,
    streak: r.streak || 0,
    longest_streak: r.longest_streak || 0,
    level: r.level || levelFromXp(r.xp),
    total_read: r.total_read || 0,
    interests: Array.isArray(r.interests) ? r.interests : [],
    last_activity: r.last_activity || null,
    rank: r.rank || null,
  });
}
