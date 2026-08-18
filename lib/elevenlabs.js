// lib/elevenlabs.js - minimal hardened ElevenLabs text-to-speech client.
//
// Used by scripts/daily-briefing.mjs to narrate the day's best research. Like
// lib/apify.js, this is a build-time dependency ONLY: the request path serves a
// pre-rendered MP3 from the repo, so no serverless function ever holds this
// credential and no page view can spend a character of quota.
//
// Rules enforced here:
//   1. The key comes from the environment, rides the xi-api-key header, is
//      shape-checked, and is redacted out of anything this module reports.
//   2. Every synthesis declares a hard character budget BEFORE the call, because
//      ElevenLabs bills per character and a runaway script is the only real way
//      to burn a month of quota in one run.
//   3. Responses are size-capped and the audio is validated as real MP3 bytes,
//      so a JSON error page can never be written to disk as a .mp3.

const API_BASE = "https://api.elevenlabs.io/v1";
const KEY_RE = /^sk_[A-Za-z0-9]{20,}$/;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;

// Hard ceiling on one briefing, independent of whatever a caller passes. About
// eight minutes of speech; far more than a daily briefing should ever need.
export const MAX_BRIEFING_CHARS = 9000;

export class ElevenLabsError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = "ElevenLabsError";
    this.status = status;
  }
}

export function elevenLabsKey(env = process.env) {
  const raw = String(env.ELEVENLABS_API_KEY || env.ELEVEN_LABS_API_KEY || env.XI_API_KEY || "").trim();
  return KEY_RE.test(raw) ? raw : null;
}

export function hasElevenLabsKey(env = process.env) {
  return elevenLabsKey(env) !== null;
}

export function redact(value) {
  return String(value == null ? "" : value).replace(/sk_[A-Za-z0-9]{20,}/g, "sk_***");
}

// "River" reads as a calm, neutral news anchor, which is what a research
// briefing wants. Override with ELEVENLABS_VOICE_ID.
export const DEFAULT_VOICE_ID = "SAz9YHcvj6GT2YYXdXww";
// Flash v2.5 bills at half the character rate of the multilingual models and is
// more than good enough for spoken prose. Override with ELEVENLABS_MODEL_ID.
export const DEFAULT_MODEL_ID = "eleven_flash_v2_5";
// 22.05 kHz / 32 kbps mono: speech-appropriate, roughly 250 KB per minute, and
// available on every ElevenLabs tier including free.
export const DEFAULT_OUTPUT_FORMAT = "mp3_22050_32";

function isMp3(buffer) {
  if (!buffer || buffer.length < 4) return false;
  // ID3v2 tag, or a raw MPEG audio frame sync word.
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return true;
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

/**
 * Synthesize speech and return the audio plus character-level timings.
 *
 * Uses the /with-timestamps endpoint so the caller can turn character offsets
 * into real chapter start times. Guessing chapter times from word counts would
 * drift several seconds over a multi-minute briefing and make the chapter list
 * worse than useless.
 *
 * @returns {Promise<{audio: Buffer, alignment: object, characterCount: number}>}
 */
export async function synthesizeWithTimestamps(text, options = {}) {
  const {
    voiceId = DEFAULT_VOICE_ID,
    modelId = DEFAULT_MODEL_ID,
    outputFormat = DEFAULT_OUTPUT_FORMAT,
    maxChars = MAX_BRIEFING_CHARS,
    voiceSettings = { stability: 0.45, similarity_boost: 0.75, speed: 1 },
    timeoutMs = 180_000,
    env = process.env,
  } = options;

  const script = String(text || "");
  if (!script.trim()) throw new ElevenLabsError("Refusing to synthesize an empty script");
  const budget = Math.min(Number(maxChars) || MAX_BRIEFING_CHARS, MAX_BRIEFING_CHARS);
  if (script.length > budget) {
    throw new ElevenLabsError(`Script is ${script.length} characters, over the ${budget}-character budget`);
  }
  if (!/^[A-Za-z0-9_-]{10,}$/.test(String(voiceId))) throw new ElevenLabsError("Invalid voice id");

  const key = elevenLabsKey(env);
  if (!key) throw new ElevenLabsError("ElevenLabs API key is not configured");

  const url = new URL(`${API_BASE}/text-to-speech/${voiceId}/with-timestamps`);
  url.searchParams.set("output_format", outputFormat);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ text: script, model_id: modelId, voice_settings: voiceSettings }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    throw new ElevenLabsError(error?.name === "AbortError" ? "ElevenLabs request timed out" : "ElevenLabs network error");
  }

  try {
    if (!response.ok) {
      // The provider echoes the submitted text in some errors, so only the
      // status and a redacted reason string are ever surfaced.
      let reason = "";
      try { reason = redact((await response.text()).slice(0, 200)); } catch { /* body already consumed */ }
      throw new ElevenLabsError(`ElevenLabs returned HTTP ${response.status}${reason ? `: ${reason}` : ""}`, { status: response.status });
    }
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) throw new ElevenLabsError("ElevenLabs response exceeded the size limit");
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new ElevenLabsError("ElevenLabs returned a non-JSON payload"); }
    if (typeof payload?.audio_base64 !== "string") throw new ElevenLabsError("ElevenLabs returned no audio");

    const audio = Buffer.from(payload.audio_base64, "base64");
    if (!isMp3(audio)) throw new ElevenLabsError("ElevenLabs returned bytes that are not MP3 audio");

    return { audio, alignment: payload.normalized_alignment || payload.alignment || null, characterCount: script.length };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a character offset in the submitted script into a playback timestamp.
 *
 * The alignment array is per-character and monotonic, so the offset indexes
 * straight into it. Clamped at both ends: an out-of-range offset returns the
 * nearest real time rather than NaN.
 */
export function timeAtCharacter(alignment, offset) {
  const starts = alignment?.character_start_times_seconds;
  if (!Array.isArray(starts) || !starts.length) return null;
  const index = Math.max(0, Math.min(starts.length - 1, Math.round(offset)));
  const value = starts[index];
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

export function totalDurationSeconds(alignment) {
  const ends = alignment?.character_end_times_seconds;
  if (!Array.isArray(ends) || !ends.length) return null;
  const value = ends[ends.length - 1];
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}
