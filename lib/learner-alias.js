import { createHash } from "node:crypto";

/**
 * Return the stable, non-user-controlled alias used on every public leaderboard
 * surface. The first 32 bits of the UUID's MD5 digest intentionally mirror the
 * SQL expression in migration 0005, then map into a zero-padded four-digit label.
 */
export function learnerAlias(userID) {
  const digest = createHash("md5").update(String(userID ?? "")).digest();
  const suffix = digest.readUInt32BE(0) % 10_000;
  return `Learner ${String(suffix).padStart(4, "0")}`;
}

export function levelFromXp(xp) {
  return Math.max(1, Math.floor((xp || 0) / 500) + 1);
}

/**
 * Keep the legacy wire keys for released clients, but replace every
 * user-controlled public-profile field with an anonymous value.
 */
export function anonymousLeaderboardEntry(row) {
  return {
    rank: row.rank,
    user_id: row.user_id,
    display_name: learnerAlias(row.user_id),
    avatar_url: null,
    xp: row.xp || 0,
    streak: row.streak || 0,
    longest_streak: row.longest_streak || 0,
    level: row.level || levelFromXp(row.xp),
    total_read: row.total_read || 0,
    last_activity: null,
  };
}

export function anonymousPublicProfile(row) {
  return {
    ...anonymousLeaderboardEntry(row),
    rank: row.rank || null,
    interests: [],
  };
}
