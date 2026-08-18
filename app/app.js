/* Learnify web app — shared client logic.
   Same Supabase project + auth.users as the iOS app; cloud data in ts_* tables.
   Soft-auth: guests browse freely; per-user features no-op or prompt sign-in. */
(function () {
  const SUPABASE_URL = "https://bzvmrwdutrmouzbokxds.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6dm1yd2R1dHJtb3V6Ym9reGRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwOTkyMjksImV4cCI6MjA5NTY3NTIyOX0.5kw8SgbuX4hiHGUluf8cvuK-_0zKErPWLf_O5sgRe-0";
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  // ---- category map (mirrors iOS NewsCategory rawValues) ----
  const CATS = {
    "AI / ML": { short: "AI", color: "#7c3aed" },
    "Security": { short: "Security", color: "#e11d48" },
    "Startups & Funding": { short: "Startups", color: "#16a34a" },
    "Coding & Dev Tools": { short: "DevTools", color: "#2563eb" },
    "Hardware & Gadgets": { short: "Hardware", color: "#f59e0b" },
    "Science": { short: "Science", color: "#0ea5e9" },
    "Robotics": { short: "Robotics", color: "#14b8a6" },
    "Big Tech": { short: "Big Tech", color: "#475569" },
    "Crypto / Web3": { short: "Crypto", color: "#d97706" },
    "Learning & Career": { short: "Learning", color: "#16a34a" },
  };
  const NAV_CAT = { AI: "AI / ML", Startups: "Startups & Funding", DevTools: "Coding & Dev Tools", Research: "Science" };
  function catFor(a) {
    const list = a.categories || [];
    for (const c of list) if (CATS[c]) return c;
    const sec = a.section || "";
    for (const k in CATS) if (CATS[k].short.toLowerCase() === sec.toLowerCase()) return k;
    return list[0] || "Big Tech";
  }
  function catMeta(name) { return CATS[name] || { short: name, color: "#475569" }; }

  // ---- xp / level (mirrors iOS TechPulse) ----
  const xpFloor = (n) => Math.floor(50 * Math.pow(n, 1.5));
  function levelForXP(xp) { let n = 1; while (xpFloor(n + 1) <= xp) n++; return n; }
  function levelTitle(lv) { return ["Newbie","Reader","Curious","Explorer","Scholar","Tech Explorer","Analyst","Strategist","Visionary","Luminary"][Math.min(lv, 9)] || "Luminary"; }

  // ---- helpers ----
  const $ = (s, r = document) => r.querySelector(s);
  function esc(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function timeAgo(iso) {
    if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return "";
    const m = Math.round((Date.now() - d) / 60000);
    if (m < 1) return "just now"; if (m < 60) return m + "m ago";
    const h = Math.round(m / 60); if (h < 24) return h + "h ago";
    const dd = Math.round(h / 24); return dd + "d ago";
  }
  function readMins(a) { const t = (a.title || "") + " " + (a.ai_summary || a.summary || ""); return Math.max(2, Math.min(12, Math.round(t.split(/\s+/).length / 60))); }
  let toastT;
  function toast(msg) {
    let el = $("#toast"); if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function track(event, properties) {
    if (window.LearnifyAnalytics) { window.LearnifyAnalytics.track(event, properties || {}); return; }
    try {
      if (localStorage.getItem("learnify.analytics.consent.v1") !== "granted") return;
      const queue = window.learnifyAnalyticsQueue = window.learnifyAnalyticsQueue || [];
      if (queue.length < 20) queue.push([event, properties || {}]);
    } catch (_) {}
  }

  // ---- auth + profile ----
  async function getUser() { const { data } = await sb.auth.getUser(); return data.user || null; }
  // Soft-auth: never redirects — returns the user or null so pages render for guests.
  async function getUserOptional() { return await getUser(); }
  function signInUrl(next) { return "/app/login.html?next=" + encodeURIComponent(next || (location.pathname + location.search)); }
  // Kept for any page that genuinely needs a gate; de-gated pages use getUserOptional instead.
  async function requireAuth() {
    const u = await getUser();
    if (!u) { track("sign_in_prompted", { feature: "required_page" }); location.href = signInUrl(); return null; }
    return u;
  }
  async function loadProfile(u) {
    if (!u) return { guest: true, xp: 0, streak: 0, longest_streak: 0, total_read: 0, level: 1,
      display_name: "Guest", avatar_url: null, interests: [] };
    let { data } = await sb.from("ts_profiles").select("*").eq("user_id", u.id).maybeSingle();
    if (!data) {
      const meta = u.user_metadata || {};
      const ins = { user_id: u.id, display_name: meta.display_name || (u.email || "Reader").split("@")[0],
        avatar_url: meta.avatar_url || null, interests: meta.interests || [], last_activity: new Date().toISOString() };
      const r = await sb.from("ts_profiles").upsert(ins).select("*").maybeSingle();
      data = r.data || ins;
    }
    data.level = levelForXP(data.xp || 0);
    return data;
  }
  async function leaderboard(limit = 5) {
    try {
      const r = await fetch("/api/leaderboard?type=users", { cache: "no-store" });
      if (!r.ok) return [];
      const body = await r.json();
      return Array.isArray(body.users) ? body.users.slice(0, limit) : [];
    } catch (_) { return []; }
  }

  // ---- articles ----
  let _cache = null;
  async function articles() {
    if (_cache) return _cache;
    try {
      const r = await fetch("/api/articles?limit=120", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); _cache = (j.articles || []).filter((a) => !a.is_social); return _cache; }
    } catch (_) {}
    try { const r = await fetch("/articles.json"); const j = await r.json(); _cache = (j.articles || []); return _cache; } catch (_) {}
    return (_cache = []);
  }
  function articleId(a) { return a.id || a.link || a.url || a.title; }

  // ---- saved ----
  async function savedIds(uid) { if (!uid) return new Set(); const { data } = await sb.from("ts_saved_articles").select("article_id").eq("user_id", uid); return new Set((data || []).map((r) => r.article_id)); }
  async function savedList(uid) { if (!uid) return []; const { data } = await sb.from("ts_saved_articles").select("*").eq("user_id", uid).order("saved_at", { ascending: false }); return data || []; }
  async function toggleSave(uid, a) {
    if (!uid) { track("sign_in_prompted", { feature: "save" }); location.href = signInUrl(); return false; } // guests are invited to sign in to save
    const id = articleId(a);
    const ex = await sb.from("ts_saved_articles").select("id").eq("user_id", uid).eq("article_id", id).maybeSingle();
    if (ex.data) { await sb.from("ts_saved_articles").delete().eq("id", ex.data.id); return false; }
    await sb.from("ts_saved_articles").insert({ user_id: uid, article_id: id, title: a.title, source: a.source,
      url: a.link || a.url, category: catFor(a), image_url: a.media_kind === "poster" ? null : (a.media_url || null),
      summary: a.ai_summary || a.summary || null, is_video: a.content_type === "video" });
    return true;
  }

  // ---- record a read (XP + streak; mirrors iOS PulseStore floor) ----
  async function recordOpen(uid, a, profile) {
    if (!uid) return profile; // guests read freely; no XP/streak writes (avoids RLS errors)
    const id = articleId(a);
    // Idempotent: only the FIRST open of an article earns XP (no farming on refresh).
    const already = await sb.from("ts_read_events").select("id").eq("user_id", uid).eq("article_id", id).eq("opened", true).limit(1).maybeSingle();
    if (already.data) return profile;
    await sb.from("ts_read_events").insert({ user_id: uid, article_id: id, category: catFor(a), opened: true });
    const today = new Date(); const todayStr = today.toISOString().slice(0, 10);
    let xp = (profile.xp || 0) + 8;
    let streak = profile.streak || 0, longest = profile.longest_streak || 0;
    let lastGoal = profile.last_goal_date;
    const total = (profile.total_read || 0) + 1;
    // advance streak once/day on first read of the day
    if (lastGoal !== todayStr) {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      streak = (lastGoal === y.toISOString().slice(0, 10)) ? streak + 1 : 1;
      longest = Math.max(longest, streak); lastGoal = todayStr; xp += 15;
    }
    const upd = { xp, streak, longest_streak: longest, level: levelForXP(xp), total_read: total,
      last_goal_date: lastGoal, last_activity: today.toISOString(), updated_at: today.toISOString() };
    await sb.from("ts_profiles").update(upd).eq("user_id", uid);
    return Object.assign(profile, upd);
  }

  // ---- nav ----
  function renderNav(active, profile) {
    const el = $("#nav"); if (!el) return;
    const links = [["Latest", "/app/"], ["AI", "/app/?cat=AI"], ["Startups", "/app/?cat=Startups"],
      ["DevTools", "/app/?cat=DevTools"], ["Research", "/app/research.html"], ["Saved", "/app/saved.html"], ["Learn", "/app/learn.html"]];
    const av = profile && profile.avatar_url;
    const guest = !profile || profile.guest;
    el.className = "nav";
    el.innerHTML = `<div class="nav-inner">
      <a class="logo" href="/app/"><span class="ts">L</span> Learnify</a>
      <nav class="nav-links">${links.map(([n, h]) => `<a href="${h}" class="${n === active ? "active" : ""}">${n}</a>`).join("")}</nav>
      <div class="nav-right">
        <button type="button" class="nav-brief" id="navBrief" title="Play today's narrated research briefing">🎧 Daily brief</button>
        <a class="nav-search" href="/app/?focus=1"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/></svg> Search</a>
        ${guest ? "" : `<span class="streak-pill"><span class="fl">🔥</span> ${profile.streak || 0}-Day Streak</span>`}
        ${guest
          ? `<button class="nav-signin" id="navSignin">Sign in</button>`
          : `<span class="nav-user" id="navUser">
          ${av ? `<img class="avatar" src="${esc(av)}" alt="">` : `<span class="avatar" style="display:grid;place-items:center;font-weight:800;color:#fff;background:#212126">${esc(((profile && profile.display_name) || "U")[0].toUpperCase())}</span>`}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </span>`}
      </div></div>`;
    if (guest) { const b = $("#navSignin"); if (b) b.onclick = () => { track("sign_in_prompted", { feature: "navigation" }); location.href = signInUrl(); }; }
    else { $("#navUser").onclick = async () => { if (confirm("Sign out of Learnify?")) { await sb.auth.signOut(); location.href = "/app/"; } }; }
  }

  window.TS = { sb, getUser, getUserOptional, signInUrl, requireAuth, loadProfile, leaderboard, articles, articleId, savedIds, savedList,
    toggleSave, recordOpen, renderNav, catFor, catMeta, xpFloor, levelForXP, levelTitle, timeAgo, readMins, esc, toast, track, $ };
})();
