// app/briefing.js - the "Daily brief" nav button and its player dialog.
//
// Mounted on every app page. The briefing is a static MP3 rendered once a day by
// scripts/daily-briefing.mjs, so nothing here can spend ElevenLabs quota - but
// the fetch is still LAZY, on first click only, so a page load costs nothing and
// the audio is never downloaded by someone who did not ask for it.
//
// Every state is honest: loading, "not generated yet", and "could not load" are
// three different messages, because they mean three different things to a reader.

const T = window.TS;
const esc = (value) => (T && T.esc ? T.esc(value) : String(value == null ? "" : value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));

const fmtTime = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

let dialog = null;
let loaded = false;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "brief-dialog";
  dialog.innerHTML = `
    <div class="brief-head">
      <div>
        <h2>🎧 Today's research briefing</h2>
        <span class="brief-meta" id="briefMeta"></span>
      </div>
      <button type="button" class="brief-close" id="briefClose" aria-label="Close">✕</button>
    </div>
    <p class="brief-blurb" id="briefBlurb">Loading today's briefing…</p>
    <audio id="briefAudio" controls preload="metadata" hidden></audio>
    <ul class="brief-chapters" id="briefChapters"></ul>
    <details id="briefTranscriptWrap" hidden><summary>Read the transcript</summary><p id="briefTranscript"></p></details>`;
  document.body.appendChild(dialog);

  dialog.querySelector("#briefClose").onclick = () => dialog.close();
  // Pause on close: a briefing playing behind a dismissed dialog is a bug the
  // listener cannot see to fix.
  dialog.addEventListener("close", () => {
    const audio = dialog.querySelector("#briefAudio");
    if (audio && !audio.paused) audio.pause();
  });
  // Click the backdrop to dismiss.
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  return dialog;
}

function renderChapters(data, audio) {
  const list = dialog.querySelector("#briefChapters");
  list.innerHTML = data.chapters.map((chapter) => `<li data-start="${chapter.start_seconds}">
    <button type="button" class="brief-seek" aria-label="Play from ${fmtTime(chapter.start_seconds)}">${fmtTime(chapter.start_seconds)}</button>
    <span class="brief-ch"><b>${esc(chapter.title)}</b><span>${esc(chapter.topic || "")}${chapter.citations ? ` · ${chapter.citations.toLocaleString()} citations` : ""}</span></span>
    ${chapter.url ? `<a class="brief-src" href="${esc(chapter.url)}" target="_blank" rel="noopener nofollow">Source ↗</a>` : ""}
  </li>`).join("");

  list.querySelectorAll("button.brief-seek").forEach((button) => button.onclick = () => {
    audio.currentTime = Number(button.parentElement.dataset.start) || 0;
    audio.play();
    if (T && T.track) T.track("article_selected", { surface: "briefing" });
  });

  const items = [...list.children];
  audio.addEventListener("timeupdate", () => {
    let active = -1;
    items.forEach((item, index) => { if (audio.currentTime >= Number(item.dataset.start)) active = index; });
    items.forEach((item, index) => item.classList.toggle("now", index === active));
  });
}

async function load() {
  if (loaded) return;
  const blurb = dialog.querySelector("#briefBlurb");
  const audio = dialog.querySelector("#briefAudio");
  try {
    const response = await fetch("/api/briefing");
    if (response.status === 404) {
      // A real state on a fresh deploy, not a failure. Say which one it is.
      blurb.textContent = "No briefing has been generated yet. The first one is scheduled for tomorrow morning.";
      return;
    }
    if (!response.ok) throw new Error("request");
    const data = await response.json();
    if (!data.audio_url || !Array.isArray(data.chapters) || !data.chapters.length) throw new Error("empty");

    audio.src = data.audio_url;
    audio.hidden = false;
    dialog.querySelector("#briefMeta").textContent =
      `${data.date_label || data.date} · ${fmtTime(data.duration_seconds || 0)} · ${data.chapters.length} papers`;
    blurb.textContent = `Narrated from the same world ranking on the Research tab: ${data.source || "OpenAlex and Google Scholar"}. Voice by ${data.provider || "ElevenLabs"}. Tap a timestamp to jump to that paper.`;
    dialog.querySelector("#briefTranscript").textContent = data.transcript || "";
    dialog.querySelector("#briefTranscriptWrap").hidden = !data.transcript;
    renderChapters(data, audio);
    loaded = true;

    // Autoplay is allowed here: opening the dialog was a user gesture. If the
    // browser refuses anyway, the controls are right there.
    audio.play().catch(() => {});
    if (T && T.track) T.track("article_selected", { surface: "briefing_play" });
  } catch {
    blurb.textContent = "The briefing could not be loaded. It may be temporarily unavailable.";
    if (T && T.track) T.track("content_load_failed", { resource: "briefing", fallback: "none" });
  }
}

export function openBriefing() {
  ensureDialog();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  load();
}

// The nav is re-rendered per page by TS.renderNav, so the button is wired on a
// delegated listener rather than a direct one: no ordering dependency, and it
// keeps working if the nav repaints.
export function mountBriefing() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("#navBrief, [data-open-briefing]");
    if (!button) return;
    event.preventDefault();
    if (T && T.track) T.track("filter_applied", { filter_kind: "briefing", surface: "nav" });
    openBriefing();
  });
}

mountBriefing();
