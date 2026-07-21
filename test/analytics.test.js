import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
// Prevent browser auto-initialization while importing the pure helpers.
globalThis.window = {};

const { countBucket, durationBucket, redactPageUrl, sanitizeEvent, screenName } = await import("../app/analytics.js");
test("page-view URLs drop query parameters and fragments", () => {
  assert.equal(redactPageUrl("https://learnify.example/app/article.html?id=secret#section"), "https://learnify.example/app/article.html");
  assert.equal(redactPageUrl("/app/article.html?id=secret#section"), "/app/article.html");
  assert.equal(redactPageUrl("https://user:password@learnify.example/private?q=secret"), "https://learnify.example/private");
  assert.equal(redactPageUrl("javascript:alert(1)"), "/");
  assert.equal(redactPageUrl("not a url"), "/");
});


test("screenName maps clean and .html routes without query data", () => {
  assert.equal(screenName("/app/"), "latest");
  assert.equal(screenName("/app/article.html"), "article");
  assert.equal(screenName("/app/research.html"), "research");
  assert.equal(screenName("/app/saved"), "brain_bank");
  assert.equal(screenName("/"), "landing");
});

test("sanitizeEvent rejects unknown events and strips non-allowlisted properties", () => {
  assert.equal(sanitizeEvent("raw_form_submit", { email: "person@example.com" }), null);
  assert.deepEqual(sanitizeEvent("quiz_answered", {
    surface: "Article Detail",
    correct: true,
    auth_state: "signed in",
    answer: "sensitive free text",
    email: "person@example.com",
  }), {
    name: "quiz_answered",
    data: { surface: "article_detail", correct: true, auth_state: "signed_in" },
  });
});

test("sanitizeEvent normalizes aggregate dimensions and bounds strings", () => {
  const event = sanitizeEvent("article_opened", {
    source_id: "SiliconValley.com",
    category: "AI / ML",
    content_kind: "article",
    auth_state: "guest",
    title: "must never leave the device",
  });
  assert.deepEqual(event.data, {
    source_id: "siliconvalley_com",
    category: "ai_ml",
    content_kind: "article",
    auth_state: "guest",
  });
  assert.equal("title" in event.data, false);
});

test("duration and count buckets avoid high-cardinality metrics", () => {
  assert.equal(durationBucket(29), "under_30s");
  assert.equal(durationBucket(120), "2m_5m");
  assert.equal(durationBucket(999), "10m_plus");
  assert.equal(countBucket(0), "0");
  assert.equal(countBucket(8), "4_10");
  assert.equal(countBucket(30), "11_plus");
});


test("provider runtime is loaded only from the official Vercel script host", () => {
  const source = fs.readFileSync(new URL("../app/analytics.js", import.meta.url), "utf8");
  assert.match(source, /https:\/\/va\.vercel-scripts\.com\/v1\/script\.js/);
});

test("every instrumented event is allowlisted", () => {
  const files = ["app/analytics.js", "app/app.js", "app/index.html", "app/learn.html", "app/saved.html", "app/article.html", "app/login.html", "index.html", "feed.html"];
  const names = new Set();
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of source.matchAll(/(?:T\.|LearnifyAnalytics\.)?track\(\"([a-z_]+)\"/g)) names.add(match[1]);
  }
  assert.ok(names.size >= 20, `expected broad core coverage, found ${names.size} events`);
  for (const name of names) assert.ok(sanitizeEvent(name, {}), `${name} must be in the privacy allowlist`);
});
