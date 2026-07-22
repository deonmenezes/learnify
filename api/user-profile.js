// GET /api/user-profile?id=<user_id> — a single user's PUBLIC profile for the
// leaderboard's tap-through profile view. Reads the privacy-safe ts_leaderboard
// view and returns an opaque public lookup id, deterministic Learner alias, and
// aggregate stats only. The account UUID is never accepted or returned.
//
// Response: { user_id, display_name, avatar_url, xp, streak, longest_streak,
//             level, total_read, interests:[String], last_activity, rank }
// 404 when the id isn't on the board (no profile, or zero activity).

import { anonymousPublicProfile } from "../lib/learner-alias.js";
import { sbSelect } from "../lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const id = String(req.query.id || "").trim();
  if (!id) return res.status(400).json({ error: "missing id" });
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ error: "invalid id" });

  const rows = await sbSelect("ts_leaderboard", {
    select: "user_id,display_name,xp,streak,longest_streak,level,total_read,rank",
    user_id: `eq.${id}`,
    limit: "1",
  });
  const r = rows[0];
  if (!r) return res.status(404).json({ error: "not found" });

  return res.status(200).json(anonymousPublicProfile(r));
}
