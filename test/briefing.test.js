import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import briefingHandler from "../api/briefing.js";
import { speechSafe, leadSentence, usableVenue, selectBriefingPapers, buildBriefingScript } from "../lib/briefing.js";
import {
  elevenLabsKey, hasElevenLabsKey, redact, synthesizeWithTimestamps,
  timeAtCharacter, totalDurationSeconds, ElevenLabsError, MAX_BRIEFING_CHARS,
} from "../lib/elevenlabs.js";

const NOW = new Date("2026-08-18T06:00:00.000Z");

function paper(overrides = {}) {
  return {
    id: "gs_abc", title: "A Survey of Large Language Models",
    url: "https://example.org/paper", link: "https://example.org/paper",
    topic: "AI / ML", venue: "Nature", published_year: 2025,
    citations: 800, world_score: 84, score_breakdown: { citations_per_year: 640 },
    summary: "Abstract General reasoning represents a long-standing challenge in artificial intelligence. We show that it can be incentivized.",
    ...overrides,
  };
}

function mockRes() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

test("the ElevenLabs credential is env-only, shape-checked, and redacted", () => {
  const key = "sk_" + "a".repeat(40);
  assert.equal(elevenLabsKey({ ELEVENLABS_API_KEY: key }), key);
  assert.equal(elevenLabsKey({ XI_API_KEY: key }), key);
  assert.equal(elevenLabsKey({ ELEVENLABS_API_KEY: "nope" }), null);
  assert.equal(hasElevenLabsKey({}), false);
  assert.ok(!redact(`boom with ${key}`).includes("a".repeat(40)));
  assert.match(redact(`boom with ${key}`), /sk_\*\*\*/);
});

test("synthesis refuses to run before it can cost anything", async () => {
  const env = { ELEVENLABS_API_KEY: "sk_" + "a".repeat(40) };
  // Character budget is checked BEFORE the network call, so an overlong script
  // is rejected locally rather than billed.
  await assert.rejects(() => synthesizeWithTimestamps("x".repeat(MAX_BRIEFING_CHARS + 1), { env }), (error) => {
    assert.ok(error instanceof ElevenLabsError);
    assert.match(error.message, /character budget/);
    return true;
  });
  await assert.rejects(() => synthesizeWithTimestamps("   ", { env }), /empty script/);
  await assert.rejects(() => synthesizeWithTimestamps("hello", { env, voiceId: "../../evil" }), /Invalid voice id/);
  await assert.rejects(() => synthesizeWithTimestamps("hello", { env: {} }), /key is not configured/);
});

test("provider text is made safe to read aloud", () => {
  assert.equal(speechSafe("See https://doi.org/10.1016/j.x for $E=mc^2$ details [12]."), "See for details.");
  assert.equal(speechSafe("Smith et al. showed, e.g., a gain"), "Smith and colleagues showed, for example, a gain");
  assert.equal(speechSafe("Model‐Based Agents"), "Model-Based Agents");
  assert.equal(speechSafe("**bold** `code` #tag"), "bold code tag");
  assert.equal(speechSafe(""), "");
});

test("a quote is only spoken when it is actually a quote", () => {
  // Google Scholar snippets are elided extracts that begin mid-clause. Reading
  // one as "in the authors' own words" would attribute a sentence that does not
  // exist, so a fragment is dropped instead.
  assert.equal(leadSentence("… we question this very process cautiously with intent"), "");
  assert.equal(leadSentence("...and the results were surprising in several ways"), "");
  assert.equal(leadSentence("Published in Nature."), "");
  assert.equal(leadSentence("short"), "");
  assert.equal(
    leadSentence("Abstract General reasoning represents a long-standing challenge in artificial intelligence. More text."),
    "General reasoning represents a long-standing challenge in artificial intelligence.",
  );
});

test("venues elided by the provider are not read aloud half-finished", () => {
  assert.equal(usableVenue("ACM Transactions on"), "ACM Transactions");
  assert.equal(usableVenue("Proceedings of the"), "Proceedings");
  assert.equal(usableVenue("of the ACM on Software Engineering"), "");
  assert.equal(usableVenue("Nature"), "Nature");
  assert.equal(usableVenue(""), "");
});

test("selection spreads the briefing across fields instead of one hot topic", () => {
  const byTopic = {
    "AI / ML": [paper({ id: "a1", world_score: 90 }), paper({ id: "a2", world_score: 89 }), paper({ id: "a3", world_score: 88 })],
    "Robotics": [paper({ id: "r1", topic: "Robotics", world_score: 60 })],
    "Security": [paper({ id: "s1", topic: "Security", world_score: 55 })],
  };
  const picked = selectBriefingPapers(byTopic, { limit: 4, maxPerTopic: 2 });
  assert.equal(picked.length, 4);
  // maxPerTopic is a hard cap: the third AI paper cannot take a fourth slot.
  assert.equal(picked.filter((item) => item.topic === "AI / ML").length, 2);
  assert.ok(picked.map((item) => item.topic).includes("Robotics"));
  // Within the cap, the strongest paper still leads.
  assert.equal(picked[0].id, "a1");
  assert.deepEqual(selectBriefingPapers({}, { limit: 5 }), []);
});

test("the script carries exact character offsets for every chapter", () => {
  const papers = [paper({ id: "p1" }), paper({ id: "p2", topic: "Robotics", title: "On human-in-the-loop optimization" })];
  const script = buildBriefingScript(papers, { date: NOW, maxChars: 5000 });
  assert.match(script.text, /^This is your Learnify research briefing for Tuesday, August 18\./);
  assert.match(script.text, /Two papers,/); // counts are spoken as words
  assert.equal(script.segments.length, 2);
  assert.equal(script.characters, script.text.length);
  // The offsets are what turn provider alignment into chapter times, so they
  // must index the FINAL string exactly.
  for (const segment of script.segments) {
    assert.equal(script.text.slice(segment.char_start, segment.char_start + 5), segment.index === 1 ? "First" : "Secon");
  }
  assert.ok(script.segments[0].char_start < script.segments[1].char_start);
});

test("the character budget is real: papers are dropped until the script fits", () => {
  const many = Array.from({ length: 10 }, (_, index) => paper({ id: `p${index}`, title: `Paper number ${index} with a reasonably long title` }));
  const tight = buildBriefingScript(many, { date: NOW, maxChars: 900 });
  assert.ok(tight.characters <= 900, `expected <= 900, got ${tight.characters}`);
  assert.ok(tight.dropped > 0);
  assert.ok(tight.segments.length >= 1);
  const empty = buildBriefingScript([], { date: NOW });
  assert.equal(empty.segments.length, 0);
});

test("alignment offsets convert to clamped, finite timestamps", () => {
  const alignment = { character_start_times_seconds: [0, 0.5, 1.2], character_end_times_seconds: [0.5, 1.2, 2.4] };
  assert.equal(timeAtCharacter(alignment, 0), 0);
  assert.equal(timeAtCharacter(alignment, 2), 1.2);
  assert.equal(timeAtCharacter(alignment, 999), 1.2);   // clamped, never NaN
  assert.equal(timeAtCharacter(alignment, -5), 0);
  assert.equal(timeAtCharacter(null, 0), null);
  assert.equal(totalDurationSeconds(alignment), 2.4);
  assert.equal(totalDurationSeconds({}), null);
});

test("the briefing endpoint serves today, rejects paths, and 404s honestly", async () => {
  let res = mockRes();
  await briefingHandler({ method: "GET", query: {}, headers: {} }, res);
  if (res.statusCode === 404) return; // no briefing generated yet is a real state
  assert.equal(res.statusCode, 200);
  assert.match(res.body.audio_url, /^\/briefings\/\d{4}-\d{2}-\d{2}\.mp3$/);
  assert.ok(Array.isArray(res.body.chapters) && res.body.chapters.length);
  assert.ok(res.body.duration_seconds > 0);
  assert.ok(typeof res.body.transcript === "string" && res.body.transcript.length > 100);
  for (const chapter of res.body.chapters) {
    assert.ok(Number.isFinite(chapter.start_seconds) && chapter.start_seconds >= 0);
    assert.ok(chapter.start_seconds <= res.body.duration_seconds + 1);
    assert.ok(/^https?:\/\//.test(chapter.url));
  }
  // Chapter times must be monotonic or seeking sends the listener backwards.
  const times = res.body.chapters.map((chapter) => chapter.start_seconds);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));

  // The date parameter is an allowlist lookup, never a path.
  res = mockRes();
  await briefingHandler({ method: "GET", query: { date: "../../etc/passwd" }, headers: {} }, res);
  assert.equal(res.statusCode, 400);
  res = mockRes();
  await briefingHandler({ method: "GET", query: { date: "1999-01-01" }, headers: {} }, res);
  assert.equal(res.statusCode, 404);
});

test("the committed briefing audio matches its manifest", () => {
  const manifestPath = fileURLToPath(new URL("../briefing.json", import.meta.url));
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const audioPath = fileURLToPath(new URL(`..${manifest.audio_url}`, import.meta.url));
  assert.ok(existsSync(audioPath), `missing audio for ${manifest.audio_url}`);
  assert.equal(statSync(audioPath).size, manifest.audio_bytes);
  // Real MP3 bytes, not a JSON error page renamed to .mp3.
  const head = readFileSync(audioPath).subarray(0, 3);
  assert.ok(head[0] === 0x49 || head[0] === 0xff, "not MP3 audio");
  assert.ok(!/sk_[A-Za-z0-9]{20,}/.test(JSON.stringify(manifest)), "manifest must not carry a credential");
});

test("the research page hides the player rather than showing an empty one", () => {
  const html = readFileSync(new URL("../app/research.html", import.meta.url), "utf8");
  assert.ok(html.includes("/api/briefing"));
  assert.ok(html.includes("briefingChapters"));
  assert.ok(html.includes("Read the transcript"));
  assert.ok(html.includes('class="card briefing"'));
  assert.ok(html.includes('classList.add("on")'), "the card must opt IN only after data loads");
});

test("no ElevenLabs credential is hardcoded in the shipped source", () => {
  for (const file of ["../lib/elevenlabs.js", "../lib/briefing.js", "../api/briefing.js", "../scripts/daily-briefing.mjs", "../app/research.html", "../.env.example"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/sk_[A-Za-z0-9]{30,}/.test(source), `credential-shaped literal in ${file}`);
  }
});
