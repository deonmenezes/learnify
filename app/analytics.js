const CONSENT_KEY = "learnify.analytics.consent.v1";
const SESSION_KEY = "learnify.analytics.session.v1";
const POLICY_VERSION = "2026-07-21";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PENDING_EVENTS = 20;

const EVENT_PROPERTIES = Object.freeze({
  analytics_consent_granted: ["policy_version"],
  screen_viewed: ["screen"],
  session_started: ["screen"],
  session_minute: ["minute_bucket"],
  session_ended: ["duration_bucket", "reason"],
  acquisition_cta_clicked: ["destination"],
  article_selected: ["surface"],
  article_opened: ["source_id", "category", "content_kind", "auth_state"],
  article_link_out: ["surface", "source_id"],
  article_save_toggled: ["surface", "action", "auth_state"],
  briefing_started: ["surface"],
  brain_bank_viewed: ["items_bucket", "auth_state"],
  quiz_answered: ["surface", "correct", "auth_state"],
  flashcard_created: ["category"],
  filter_applied: ["filter_kind", "surface"],
  sign_in_prompted: ["feature"],
  auth_mode_selected: ["mode"],
  auth_attempted: ["mode", "method"],
  auth_completed: ["mode", "method"],
  auth_failed: ["mode", "method", "error_kind"],
  content_load_failed: ["resource", "fallback"],
  client_error: ["screen", "error_kind", "source_class"],
});

let config = null;
let providerReady = false;
let trackingStarted = false;
let pendingEvents = [];
let session = null;
let visibleSince = null;
let heartbeat = null;
let errorCount = 0;

export function screenName(pathname = "/") {
  const path = pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  if (path === "/") return "landing";
  if (path === "/feed") return "public_feed";
  if (path === "/privacy") return "privacy";
  if (path === "/app") return "latest";
  if (path === "/app/article") return "article";
  if (path === "/app/research") return "research";
  if (path === "/app/learn") return "learn";
  if (path === "/app/saved") return "brain_bank";
  if (path === "/app/login") return "login";
  return path.startsWith("/app/") ? "app_other" : "site_other";
}

export function durationBucket(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (value < 30) return "under_30s";
  if (value < 120) return "30s_2m";
  if (value < 300) return "2m_5m";
  if (value < 600) return "5m_10m";
  return "10m_plus";
}

export function countBucket(count) {
  const value = Number.isFinite(count) ? Math.max(0, count) : 0;
  if (value === 0) return "0";
  if (value <= 3) return "1_3";
  if (value <= 10) return "4_10";
  return "11_plus";
}

function normalizeValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return undefined;
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9&+./ -]+/g, "")
    .replace(/[ ./]+/g, "_")
    .slice(0, 48);
}

export function redactPageUrl(rawUrl) {
  try {
    const placeholderOrigin = "https://learnify.invalid";
    const absolute = /^[a-z][a-z0-9+\.-]*:/i.test(rawUrl);
    if (!absolute && !rawUrl.startsWith("/")) return "/";
    const url = new URL(rawUrl, placeholderOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "/";
    return absolute ? `${url.origin}${url.pathname}` : url.pathname;
  } catch (_) { return "/"; }
}

export function sanitizeEvent(name, properties = {}) {
  const allowed = EVENT_PROPERTIES[name];

  if (!allowed) return null;
  const data = {};
  for (const key of allowed) {
    if (!(key in properties)) continue;
    const value = normalizeValue(properties[key]);
    if (value !== undefined && value !== "") data[key] = value;
  }
  return { name, data };
}

function consent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch (_) { return null; }
}

function saveConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch (_) { /* storage can be blocked */ }
}

function send(event) {
  if (!providerReady || consent() !== "granted") return;
  window.va("event", event);
}

export function track(name, properties = {}) {
  const event = sanitizeEvent(name, properties);
  if (!event || consent() !== "granted") return false;
  if (!providerReady) {
    if (pendingEvents.length < MAX_PENDING_EVENTS) pendingEvents.push(event);
    return true;
  }
  send(event);
  return true;
}

function readSession() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (!parsed || typeof parsed.lastSeen !== "number") return null;
    return {
      startedAt: Number(parsed.startedAt) || Date.now(),
      lastSeen: parsed.lastSeen,
      activeSeconds: Number(parsed.activeSeconds) || 0,
      reportedMinutes: Number(parsed.reportedMinutes) || 0,
    };
  } catch (_) { return null; }
}

function writeSession() {
  if (!session) return;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) { /* storage can be blocked */ }
}

function minuteBucket(minute) {
  if (minute === 1) return "1";
  if (minute <= 4) return "2_4";
  if (minute <= 9) return "5_9";
  return "10_plus";
}

function beginSession(now = Date.now()) {
  session = { startedAt: now, lastSeen: now, activeSeconds: 0, reportedMinutes: 0 };
  writeSession();
  track("session_started", { screen: screenName(location.pathname) });
}

function closeTimedOutSession(reason = "timeout") {
  if (!session) return;
  track("session_ended", { duration_bucket: durationBucket(session.activeSeconds), reason });
}

function commitActiveTime() {
  if (!session || visibleSince === null) return;
  const elapsed = Math.min(300, Math.max(0, (performance.now() - visibleSince) / 1000));
  session.activeSeconds += elapsed;
  session.lastSeen = Date.now();
  visibleSince = null;

  const completedMinutes = Math.floor(session.activeSeconds / 60);
  while (session.reportedMinutes < completedMinutes) {
    session.reportedMinutes += 1;
    track("session_minute", { minute_bucket: minuteBucket(session.reportedMinutes) });
  }
  writeSession();
}

function resumeSession() {
  const now = Date.now();
  if (!session || now - session.lastSeen > SESSION_TIMEOUT_MS) {
    if (session) closeTimedOutSession();
    beginSession(now);
  }
  session.lastSeen = now;
  visibleSince = performance.now();
  writeSession();
}

function installLifecycleTracking() {
  session = readSession();
  resumeSession();
  track("screen_viewed", { screen: screenName(location.pathname) });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) commitActiveTime();
    else resumeSession();
  });
  window.addEventListener("pagehide", commitActiveTime);
  heartbeat = window.setInterval(() => {
    if (document.hidden) return;
    commitActiveTime();
    visibleSince = performance.now();
  }, 15000);
}

function installErrorTracking() {
  window.addEventListener("error", (event) => {
    if (errorCount >= 3) return;
    errorCount += 1;
    let sourceClass = "unknown";
    try {
      if (event.filename) sourceClass = new URL(event.filename, location.href).origin === location.origin ? "same_origin" : "third_party";
    } catch (_) { /* never send the filename itself */ }
    track("client_error", { screen: screenName(location.pathname), error_kind: "script", source_class: sourceClass });
  });
  window.addEventListener("unhandledrejection", () => {
    if (errorCount >= 3) return;
    errorCount += 1;
    track("client_error", { screen: screenName(location.pathname), error_kind: "promise", source_class: "unknown" });
  });
}

function loadVercelProvider() {
  if (providerReady || !config?.enabled || config.provider !== "vercel") return;
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  window.va("beforeSend", (event) => ({ ...event, url: redactPageUrl(event && event.url) }));
  const script = document.createElement("script");
  script.defer = true;
  script.dataset.learnifyAnalytics = "vercel";
  script.src = "https://va.vercel-scripts.com/v1/script.js";
  document.head.appendChild(script);
  providerReady = true;
  pendingEvents.splice(0).forEach(send);

  if (!trackingStarted) {
    trackingStarted = true;
    installLifecycleTracking();
    installErrorTracking();
  }
}

function styles() {
  if (document.getElementById("learnify-analytics-style")) return;
  const style = document.createElement("style");
  style.id = "learnify-analytics-style";
  style.textContent = `
    .lf-analytics{position:fixed;z-index:10000;left:18px;right:18px;bottom:18px;max-width:680px;margin:auto;padding:18px;border:1px solid #35353b;border-radius:16px;background:#17171a;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.42);font:14px/1.45 system-ui,sans-serif}
    .lf-analytics[hidden]{display:none}.lf-analytics b{display:block;font-size:16px;margin-bottom:5px}.lf-analytics p{margin:0;color:rgba(255,255,255,.72)}
    .lf-analytics a{color:#45db6b}.lf-analytics-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}.lf-analytics button{min-height:40px;padding:8px 14px;border-radius:999px;border:1px solid #3d3d43;background:#212126;color:#fff;font-weight:700;cursor:pointer}.lf-analytics button[data-choice="granted"]{background:#f7f7fa;color:#0d0d0f;border-color:#f7f7fa}
    .lf-analytics-pref{position:fixed;z-index:9999;left:12px;bottom:12px;border:1px solid #34343a;border-radius:999px;background:#17171a;color:rgba(255,255,255,.68);font:600 11px system-ui,sans-serif;padding:7px 10px;cursor:pointer}
    @media(max-width:520px){.lf-analytics{left:10px;right:10px;bottom:10px}.lf-analytics-actions{display:grid}.lf-analytics button{width:100%}}
  `;
  document.head.appendChild(style);
}

function renderPreferences(forceOpen = false) {
  if (!config?.enabled) return;
  styles();
  let panel = document.getElementById("learnify-analytics-panel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "learnify-analytics-panel";
    panel.className = "lf-analytics";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Anonymous analytics preferences");
    panel.innerHTML = `<b>Help improve Learnify?</b><p>Share anonymous, aggregate usage events so we can understand navigation and engagement. We never send searches, article titles, form values, account IDs, or session recordings. <a href="/privacy.html">Privacy details</a>.</p><div class="lf-analytics-actions"><button type="button" data-choice="granted">Allow anonymous analytics</button><button type="button" data-choice="denied">No thanks</button></div>`;
    panel.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-choice]");
      if (!button) return;
      const choice = button.dataset.choice;
      saveConsent(choice);
      renderPreferences();
      panel.hidden = true;
      if (choice === "granted") {
        loadVercelProvider();
        track("analytics_consent_granted", { policy_version: POLICY_VERSION });
      }
    });
    document.body.appendChild(panel);
  }
  panel.hidden = !(forceOpen || consent() === null);

  if (!document.getElementById("learnify-analytics-pref") && consent() !== null) {
    const button = document.createElement("button");
    button.id = "learnify-analytics-pref";
    button.className = "lf-analytics-pref";
    button.type = "button";
    button.textContent = "Analytics preferences";
    button.addEventListener("click", () => { panel.hidden = false; });
    document.body.appendChild(button);
  }
}

async function initialize() {
  try {
    const response = await fetch("/api/analytics-config", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    config = await response.json();
  } catch (_) { return; }
  if (!config?.enabled) return;
  renderPreferences();
  if (consent() === "granted") loadVercelProvider();
}

export function openPreferences() {
  renderPreferences(true);
}

const earlyEvents = Array.isArray(window.learnifyAnalyticsQueue) ? window.learnifyAnalyticsQueue.splice(0) : [];
window.LearnifyAnalytics = { track, openPreferences, countBucket };
earlyEvents.forEach(([name, properties]) => track(name, properties));
if (typeof document !== "undefined") initialize();
