import { createHash } from "node:crypto";

/**
 * Return the stable, non-user-controlled alias used on every public leaderboard
 * surface. The first 32 bits of the UUID's MD5 digest intentionally mirror the
 * SQL expression in migration 0005, then map into a zero-padded four-digit label.
 */
export function learnerAlias(userID) {
  const digest = createHash("md5").update(String(userID ?? "").toLowerCase()).digest();
  const suffix = digest.readUInt32BE(0) % 10_000;
  return `Learner ${String(suffix).padStart(4, "0")}`;
}

/** One-way public lookup key. The account UUID never crosses the public view/API. */
export function publicLearnerID(userID) {
  return createHash("md5").update(String(userID ?? "").toLowerCase()).digest("hex");
}

export function levelFromXp(xp) {
  return Math.max(1, Math.floor((xp || 0) / 500) + 1);
}

/**
 * Keep the legacy wire keys for released clients, but replace every
 * user-controlled public-profile field with an anonymous value.
 */
export function anonymousLeaderboardEntry(row) {
  const suppliedAlias = String(row.display_name ?? "").trim();
  const displayName = /^Learner \d{4}$/.test(suppliedAlias)
    ? suppliedAlias
    : learnerAlias(row.user_id);
  return {
    rank: row.rank,
    user_id: row.user_id,
    display_name: displayName,
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
