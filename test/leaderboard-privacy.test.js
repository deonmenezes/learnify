import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  anonymousLeaderboardEntry,
  anonymousPublicProfile,
  learnerAlias,
} from "../lib/learner-alias.js";

const userID = "8cf0a02a-fca1-4f0f-bc1a-d7bc1cf5b26b";
const privateRow = {
  user_id: userID,
  display_name: "Private Person",
  avatar_url: "https://example.com/private-avatar.jpg",
  interests: ["Security", "AI / ML"],
  xp: 725,
  streak: 4,
  longest_streak: 9,
  level: 2,
  total_read: 31,
  last_activity: "2026-07-22T12:00:00.000Z",
  rank: 3,
};

test("Learner aliases are deterministic, opaque, and four digits", () => {
  const alias = learnerAlias(userID);
  assert.match(alias, /^Learner \d{4}$/);
  assert.equal(learnerAlias(userID), alias);
  assert.notEqual(learnerAlias("cc01308c-5e9b-48a4-b5db-c79fc5b49d30"), alias);
});

test("leaderboard mapping never returns user-controlled profile fields", () => {
  const entry = anonymousLeaderboardEntry(privateRow);
  assert.equal(entry.display_name, learnerAlias(userID));
  assert.equal(entry.avatar_url, null);
  assert.equal(entry.user_id, userID);
  assert.equal(entry.rank, 3);
  assert.equal(entry.xp, 725);
  assert.equal(entry.last_activity, null);
  assert.ok(!JSON.stringify(entry).includes("Private Person"));
  assert.ok(!JSON.stringify(entry).includes("private-avatar"));
  assert.ok(!JSON.stringify(entry).includes("Security"));
});

test("public profile keeps aggregate stats but always empties interests", () => {
  const profile = anonymousPublicProfile(privateRow);
  assert.deepEqual(profile.interests, []);
  assert.equal(profile.longest_streak, 9);
  assert.equal(profile.total_read, 31);
  assert.equal(profile.last_activity, null);
  assert.ok(!JSON.stringify(profile).includes("AI / ML"));
});

test("the web leaderboard reads the privacy-filtered API, not the Supabase view", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.ok(app.includes('/api/leaderboard?type=users'));
  assert.ok(!app.includes('.from("ts_leaderboard")'));
});
