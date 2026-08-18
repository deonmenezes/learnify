#!/usr/bin/env node
// scripts/daily-briefing.mjs - narrate the day's best research with ElevenLabs.
//
//   node scripts/daily-briefing.mjs --dry-run    # print the script, spend nothing
//   node scripts/daily-briefing.mjs              # synthesize + write the manifest
//   node scripts/daily-briefing.mjs --papers 6 --max-chars 4000
//
// The briefing is built from lib/world-feed.js, the exact module /api/research
// serves, so what the listener hears and what the Research tab shows can never
// disagree. Audio is rendered once a day into briefings/<date>.mp3 and committed;
// the request path only ever serves a static file, so no page view spends quota.
//
// Character budget is the cost control. ElevenLabs bills per character, so the
// script is measured BEFORE synthesis and papers are dropped from the end until
// it fits. --dry-run prints the exact character count you would be billed for.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOPICS } from "../lib/topics.js";
import { collectWorldPapers } from "../lib/world-feed.js";
import { buildBriefingScript, selectBriefingPapers } from "../lib/briefing.js";
import {
  synthesizeWithTimestamps, timeAtCharacter, totalDurationSeconds,
  hasElevenLabsKey, DEFAULT_VOICE_ID, DEFAULT_MODEL_ID, redact,
} from "../lib/elevenlabs.js";

const ROOT = new URL("../", import.meta.url);
const AUDIO_DIR = fileURLToPath(new URL("briefings/", ROOT));
const MANIFEST = fileURLToPath(new URL("briefing.json", ROOT));
const KEEP_DAYS = 7; // MP3s are committed; keeping a week bounds repo growth

function loadEnvLocal() {
  const path = fileURLToPath(new URL(".env.local", ROOT));
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const dryRun = arg("dry-run", false) !== false;
const paperCount = Math.max(1, Math.min(12, Number(arg("papers", process.env.BRIEFING_PAPERS || 8))));
const maxChars = Math.max(500, Math.min(9000, Number(arg("max-chars", process.env.BRIEFING_MAX_CHARS || 5000))));
const perTopic = Math.max(1, Math.min(3, Number(process.env.BRIEFING_MAX_PER_TOPIC || 2)));
const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID;

const now = new Date();
const dateKey = now.toISOString().slice(0, 10);

// Gather every topic's world-ranked head. Bounded concurrency keeps us polite
// to OpenAlex; the Scholar tier is a local read and costs nothing.
async function collectAllTopics() {
  const byTopic = {};
  const queue = [...TOPICS];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const topic = queue.shift();
      if (!topic) break;
      try {
        const world = await collectWorldPapers(topic.name, { now, limit: perTopic, poolSize: 40 });
        if (world.ok && world.papers.length) byTopic[topic.name] = world.papers;
      } catch (error) {
        console.warn(`  ${topic.name}: skipped (${redact(error.message)})`);
      }
    }
  });
  await Promise.all(workers);
  return byTopic;
}

console.log(`date         ${dateKey}`);
console.log(`voice/model  ${voiceId} / ${modelId}`);
console.log(`budget       ${paperCount} papers, max ${maxChars} characters`);
console.log("collecting world-ranked papers across all topics…");

const byTopic = await collectAllTopics();
const topicsFound = Object.keys(byTopic).length;
if (!topicsFound) {
  console.error("No topic returned any papers. Previous briefing kept.");
  process.exit(1);
}

const selected = selectBriefingPapers(byTopic, { limit: paperCount, maxPerTopic: perTopic });
const script = buildBriefingScript(selected, { date: now, maxChars });

console.log(`\ntopics       ${topicsFound} with papers`);
console.log(`selected     ${selected.length} papers${script.dropped ? `, ${script.dropped} dropped to fit the budget` : ""}`);
console.log(`script       ${script.characters} characters (billable), ${script.segments.length} chapters`);
console.log(`\n----- SCRIPT -----\n${script.text}\n------------------\n`);

if (dryRun) {
  console.log("--dry-run: no audio was synthesized and nothing was written.");
  process.exit(0);
}
if (!script.segments.length) {
  console.error("Empty script. Previous briefing kept.");
  process.exit(1);
}
if (!hasElevenLabsKey()) {
  console.error("ELEVENLABS_API_KEY is not set. Add it to .env.local (local) or the GitHub secret (CI).");
  process.exit(2);
}

let audio;
let alignment;
try {
  const result = await synthesizeWithTimestamps(script.text, { voiceId, modelId, maxChars });
  audio = result.audio;
  alignment = result.alignment;
} catch (error) {
  console.error(`Synthesis failed: ${redact(error.message)}. Previous briefing kept.`);
  process.exit(1);
}

mkdirSync(AUDIO_DIR, { recursive: true });
const fileName = `${dateKey}.mp3`;
writeFileSync(fileURLToPath(new URL(`briefings/${fileName}`, ROOT)), audio);

// Character offsets become real chapter times through the provider's alignment.
// Estimating them from word counts would drift by seconds over a few minutes and
// send a listener to the wrong paper.
const chapters = script.segments.map((segment) => ({
  ...segment,
  start_seconds: timeAtCharacter(alignment, segment.char_start) ?? 0,
}));
const duration = totalDurationSeconds(alignment);

// Prune old audio so a daily commit cannot grow the repo without bound.
const kept = readdirSync(AUDIO_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.mp3$/.test(name)).sort().reverse();
for (const stale of kept.slice(KEEP_DAYS)) unlinkSync(fileURLToPath(new URL(`briefings/${stale}`, ROOT)));
const archive = kept.slice(0, KEEP_DAYS).map((name) => ({ date: name.replace(/\.mp3$/, ""), audio_url: `/briefings/${name}` }));

writeFileSync(MANIFEST, JSON.stringify({
  generated_at: now.toISOString(),
  date: dateKey,
  date_label: script.date_label,
  title: `Learnify research briefing, ${script.date_label}`,
  audio_url: `/briefings/${fileName}`,
  audio_bytes: audio.length,
  duration_seconds: duration,
  voice_id: voiceId,
  model_id: modelId,
  provider: "ElevenLabs",
  characters: script.characters,
  source: "OpenAlex and Google Scholar, world-ranked",
  transcript: script.text,
  chapters,
  archive,
}, null, 2));

console.log(`audio        ${(audio.length / 1024).toFixed(0)} KB, ${duration ? `${duration}s` : "unknown length"} -> briefings/${fileName}`);
console.log(`manifest     ${chapters.length} chapters -> briefing.json`);
console.log(`archive      keeping ${archive.length} day(s)`);
for (const chapter of chapters) {
  const minutes = Math.floor(chapter.start_seconds / 60);
  const seconds = String(Math.floor(chapter.start_seconds % 60)).padStart(2, "0");
  console.log(`  ${minutes}:${seconds}  ${(chapter.topic || "").padEnd(22)} ${chapter.title.slice(0, 56)}`);
}
