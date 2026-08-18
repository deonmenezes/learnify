// GET /api/briefing - the daily audio research briefing manifest.
//
// Returns the metadata for today's narrated briefing: the audio URL, its real
// duration, the full transcript, and a chapter per paper with the timestamp
// where that paper starts. Chapter times come from ElevenLabs' character-level
// alignment (see scripts/daily-briefing.mjs), not from a word-count estimate,
// so seeking to a chapter lands on the right sentence.
//
// The audio itself is a committed static file under /briefings/. This endpoint
// touches no provider and holds no credential: the ElevenLabs key exists only in
// CI, and a page view can never spend a character of quota.
//
// Query params:
//   date   optional YYYY-MM-DD; serves an archived briefing instead of today's
//
// 404 when no briefing has been generated yet, which is a real state on a fresh
// deploy and is not an error worth a 500.

import { readFileSync } from "node:fs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let cached; // undefined = not loaded, null = unavailable

function loadManifest() {
  if (cached !== undefined) return cached;
  try {
    const parsed = JSON.parse(readFileSync(new URL("../briefing.json", import.meta.url), "utf-8"));
    cached = parsed && typeof parsed.audio_url === "string" && Array.isArray(parsed.chapters) ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

function str(value) { return (Array.isArray(value) ? value[0] : value || "").toString().trim(); }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const manifest = loadManifest();
  if (!manifest) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({ error: "No briefing has been generated yet" });
  }

  // A briefing is immutable once written, and a new one replaces it daily, so a
  // one-hour edge cache with a day of stale-while-revalidate is safe and cheap.
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");

  const requested = str(req.query?.date);
  if (requested) {
    if (!DATE_RE.test(requested)) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }
    if (requested !== manifest.date) {
      // Only dates the manifest itself lists are addressable; the parameter can
      // never be turned into an arbitrary path.
      const archived = (manifest.archive || []).find((entry) => entry.date === requested);
      if (!archived) {
        res.setHeader("Cache-Control", "no-store");
        return res.status(404).json({ error: "No briefing for that date", available: (manifest.archive || []).map((entry) => entry.date) });
      }
      // Archived audio is still playable; only today's transcript and chapters
      // are retained, so those are reported as unavailable rather than faked.
      return res.status(200).json({
        date: archived.date,
        audio_url: archived.audio_url,
        provider: manifest.provider,
        transcript: null,
        chapters: [],
        archived: true,
        archive: manifest.archive || [],
      });
    }
  }

  return res.status(200).json({
    generated_at: manifest.generated_at,
    date: manifest.date,
    date_label: manifest.date_label,
    title: manifest.title,
    audio_url: manifest.audio_url,
    audio_bytes: manifest.audio_bytes,
    duration_seconds: manifest.duration_seconds,
    provider: manifest.provider,
    voice_id: manifest.voice_id,
    model_id: manifest.model_id,
    source: manifest.source,
    transcript: manifest.transcript,
    chapters: manifest.chapters,
    archive: manifest.archive || [],
    archived: false,
  });
}
