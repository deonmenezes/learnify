import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INDEXES, USER_COLLECTIONS, deleteUserData } from "../lib/mongo.js";
import { serviceRoleKey, hasServiceRole, redact, adminSelectAll, userIdFromAccessToken, SupabaseAdminError } from "../lib/supabase-admin.js";
import deleteHandler from "../api/account-delete.js";

const SERVICE_KEY = "eyJ" + "a".repeat(60);

function mockRes() {
  return {
    headers: {}, setHeader(n, v) { this.headers[n] = v; },
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; },
  };
}

test("the service-role key is env-only, shape-checked, and redacted", () => {
  assert.equal(serviceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }), SERVICE_KEY);
  assert.equal(serviceRoleKey({ SUPABASE_SERVICE_KEY: "sb_secret_" + "b".repeat(30) }), "sb_secret_" + "b".repeat(30));
  assert.equal(serviceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "short" }), null);
  assert.equal(hasServiceRole({}), false);
  assert.ok(!redact(`boom ${SERVICE_KEY}`).includes("a".repeat(60)));
  assert.ok(!redact("key sb_secret_" + "b".repeat(30)).includes("b".repeat(30)));
});

test("the service-role key never reaches anything the browser loads", () => {
  // This key bypasses Row Level Security. If it ever shipped to the client,
  // every user's rows would be readable by anyone who opened devtools.
  for (const file of ["../app/app.js", "../app/briefing.js", "../app/research.html", "../app/index.html", "../app/article.html"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!source.includes("SERVICE_ROLE"), `${file} references a service-role key`);
    assert.ok(!source.includes("supabase-admin"), `${file} imports the admin client`);
  }
});

test("admin reads reject an untrusted table name and a missing key", async () => {
  await assert.rejects(() => adminSelectAll("ts_profiles; drop table", { env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } }), SupabaseAdminError);
  await assert.rejects(() => adminSelectAll("../../secrets", { env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } }), SupabaseAdminError);
  await assert.rejects(() => adminSelectAll("ts_profiles", { env: {} }), /not configured/);
});

test("a malformed token is rejected without a network call", async () => {
  // Fails closed: anything that is not token-shaped resolves to null, and the
  // endpoint treats null as "not authorised", never as "allow".
  for (const bad of ["", "   ", "not-a-jwt", "Bearer x", null, undefined]) {
    assert.equal(await userIdFromAccessToken(bad, { env: { SUPABASE_ANON_KEY: SERVICE_KEY } }), null);
  }
});

test("every user collection is keyed by user_id so erasure is a single indexed delete", () => {
  for (const name of USER_COLLECTIONS) {
    const specs = INDEXES[name];
    assert.ok(specs, `no index spec for ${name}`);
    const keys = specs.flatMap((spec) => Object.keys(spec.key));
    assert.ok(keys.includes("user_id"), `${name} has no user_id index; deletion would scan`);
  }
});

test("erasure clears every collection that holds personal data", async () => {
  const calls = [];
  const fakeDb = {
    collection: (name) => ({
      deleteMany: async (filter) => { calls.push({ name, filter }); return { deletedCount: 3 }; },
    }),
  };
  const deleted = await deleteUserData(fakeDb, "user-123");
  // The list of collections comes from USER_COLLECTIONS, so a new user table
  // cannot be added without deletion covering it.
  assert.deepEqual(Object.keys(deleted).sort(), [...USER_COLLECTIONS].sort());
  assert.equal(calls.length, USER_COLLECTIONS.length);
  for (const call of calls) assert.deepEqual(call.filter, { user_id: "user-123" });
  // Refuses to run without an id: a {} filter would erase the whole archive.
  await assert.rejects(() => deleteUserData(fakeDb, ""), /requires a user id/);
  await assert.rejects(() => deleteUserData(fakeDb, null), /requires a user id/);
});

test("the delete endpoint authorises by token and never by request body", async () => {
  let res = mockRes();
  await deleteHandler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);

  res = mockRes();
  await deleteHandler({ method: "POST", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "missing_token");

  // A user id supplied in the body must be ignored entirely, or any caller
  // could erase any account.
  res = mockRes();
  await deleteHandler({ method: "POST", headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.forged.sig" }, body: { user_id: "victim" } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "invalid_token");

  // An erasure response must never be cached.
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("the reconciler refuses to mass-purge on a suspicious empty read", () => {
  const source = readFileSync(new URL("../scripts/sync-users.mjs", import.meta.url), "utf8");
  // A read that returns zero users is far more likely to be a broken query than
  // every account being deleted at once; purging on that signal would destroy
  // the archive.
  assert.ok(source.includes("REFUSING to purge"));
  assert.ok(source.includes("if (!liveUserIds.size)"));
  // Reconciliation must exist at all: it is what makes deletion certain rather
  // than dependent on a client remembering to call the endpoint.
  assert.ok(source.includes("reconciling deletions"));
  assert.ok(source.includes("deleteMany({ user_id: { $in: departed } })"));
});

test("the privacy policy discloses the archive and the deletion path", () => {
  const html = readFileSync(new URL("../privacy.html", import.meta.url), "utf8");
  // Copying user data to a store the policy does not name would make the policy
  // untrue, so this is asserted rather than left to review.
  assert.ok(html.includes("MongoDB Atlas"), "the archive must be disclosed");
  assert.ok(/removed from Supabase and from our MongoDB Atlas archive/.test(html), "deletion must cover both stores");
  assert.ok(html.includes("reconciled against Supabase"), "the reconciliation guarantee must be stated");
});
