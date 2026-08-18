import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mongoUri, hasMongo, redact, INDEXES, ensureIndexes, MongoConfigError, getDb } from "../lib/mongo.js";

const URI = "mongodb+srv://user:s3cr3tpassw0rd@learnify.3heby4y.mongodb.net/?appName=learnify";

test("the connection string is env-only and shape-checked", () => {
  assert.equal(mongoUri({ MONGODB_URI: URI }), URI);
  assert.equal(mongoUri({ MONGO_URL: "mongodb://localhost:27017" }), "mongodb://localhost:27017");
  assert.equal(mongoUri({ MONGODB_URI: "postgres://nope" }), null);
  assert.equal(mongoUri({ MONGODB_URI: "  " }), null);
  assert.equal(mongoUri({}), null);
  assert.equal(hasMongo({}), false);
});

test("a connection string never reaches a log line with its password intact", () => {
  // A Mongo URI embeds the password in the host string, so driver errors that
  // quote the URI would leak it straight into CI output.
  const message = `failed to connect to ${URI} after 3 attempts`;
  assert.ok(!redact(message).includes("s3cr3tpassw0rd"));
  assert.match(redact(message), /mongodb\+srv:\/\/\*\*\*:\*\*\*@learnify/);
  assert.ok(!redact("mongodb://admin:hunter2@localhost:27017").includes("hunter2"));
  assert.equal(redact(null), "");
});

test("connecting without configuration fails fast and typed", async () => {
  await assert.rejects(() => getDb({}), (error) => {
    assert.ok(error instanceof MongoConfigError);
    return true;
  });
});

test("every collection has the unique index that makes re-running a sync safe", () => {
  // Idempotency is the whole contract: the daily job must be able to run twice
  // without duplicating a paper, a citation reading, a briefing or a signup.
  const uniques = {
    papers: { key: 1 },
    paper_citations: { key: 1, date: 1 },   // one reading per paper per UTC day
    briefings: { date: 1 },
    articles: { id: 1 },
    subscribers: { email: 1 },
  };
  for (const [collection, expected] of Object.entries(uniques)) {
    const specs = INDEXES[collection];
    assert.ok(specs, `missing index spec for ${collection}`);
    const unique = specs.find((spec) => spec.unique);
    assert.ok(unique, `${collection} has no unique index`);
    assert.deepEqual(unique.key, expected, collection);
  }
});

test("index creation is idempotent and reports what it applied", async () => {
  const created = [];
  const fakeDb = {
    collection: (name) => ({
      createIndex: async (key, options) => { created.push({ name, key, options }); },
    }),
  };
  const result = await ensureIndexes(fakeDb);
  assert.deepEqual(Object.keys(result).sort(), Object.keys(INDEXES).sort());
  assert.equal(created.length, Object.values(INDEXES).flat().length);
  // Only the specs marked unique may request uniqueness.
  for (const call of created) {
    const spec = INDEXES[call.name].find((s) => JSON.stringify(s.key) === JSON.stringify(call.key));
    assert.equal(Boolean(call.options.unique), Boolean(spec.unique), `${call.name} ${JSON.stringify(call.key)}`);
  }
  // A caller can restrict to one collection.
  const partial = await ensureIndexes(fakeDb, ["subscribers"]);
  assert.deepEqual(Object.keys(partial), ["subscribers"]);
});

test("a signup is never lost because the archive is unreachable", async () => {
  const { default: handler } = await import("../api/subscribe.js");
  const res = {
    headers: {}, setHeader(n, v) { this.headers[n] = v; },
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; },
  };
  // No MONGODB_URI and no KV in the test env: it must still accept the signup
  // and say honestly where the record landed.
  await handler({ method: "POST", body: { email: "Reader@Example.com ", optedIn: true }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(["mongodb", "kv", "log"].includes(res.body.stored));

  // Opt-in is mandatory and the email is validated before anything is stored.
  for (const [body, expected] of [
    [{ email: "a@b.co", optedIn: false }, "opt_in_required"],
    [{ email: "not-an-email", optedIn: true }, "invalid_email"],
  ]) {
    const bad = { ...res, headers: {}, statusCode: 0, body: null };
    await handler({ method: "POST", body, headers: {} }, bad);
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.error, expected);
  }
});

test("no connection string is hardcoded in the shipped source", () => {
  for (const file of ["../lib/mongo.js", "../api/subscribe.js", "../scripts/sync-mongo.mjs", "../.env.example"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    // A real URI has credentials before the @; a placeholder does not.
    assert.ok(!/mongodb(\+srv)?:\/\/[^:@\s"']+:[^@\s"']+@[a-z0-9.-]+\.mongodb\.net/i.test(source), `credential-shaped URI in ${file}`);
  }
});
