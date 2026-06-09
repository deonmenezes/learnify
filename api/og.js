// GET /api/og — license-clean editorial "poster" image for an article.
//
// Generates an on-brand SVG card (gradient + source mark + headline) entirely from
// query params. Nothing third-party is embedded, so the output is 100% ours —
// zero copyright exposure (the "gradient/poster" tier of the §6 media strategy).
//
// Params:  t = title (headline)   s = source name   c = accent hex (optional)
//          k = kind label (optional, e.g. "video")
// Renders crisp at any size — good for cards AND full-bleed doomscroll.
// Immutable + long-cached: the same article always yields the same poster.

const PALETTE = {
  techcrunch: "#00d26a",
  siliconvalley: "#34c5ff",
  "siliconvalley.com": "#34c5ff",
  wired: "#bcd2ff",
  "the verge": "#fa4d56",
  theverge: "#fa4d56",
  "ars technica": "#ff7a3c",
  arstechnica: "#ff7a3c",
};

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}
function accentFor(source, override) {
  if (override && /^#[0-9a-fA-F]{6}$/.test(override)) return override;
  const key = (source || "").toLowerCase().trim();
  if (PALETTE[key]) return PALETTE[key];
  return `hsl(${hashHue(key || "learnify")} 85% 62%)`;
}
function xml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// Greedy word-wrap into at most `maxLines` lines of ~`max` chars.
function wrap(text, max = 24, maxLines = 4) {
  const words = String(text || "").trim().split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= max) cur = (cur + " " + w).trim();
    else { if (cur) lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{1}$/, "…");
  }
  return lines.slice(0, maxLines);
}

function poster({ title, source, accent, kind }) {
  const W = 1200, H = 675;
  const ac = accentFor(source, accent);
  const initial = xml((source || "T").trim().charAt(0).toUpperCase());
  const lines = wrap(title, 24, 4);
  const headline = lines
    .map((ln, i) => `<tspan x="72" dy="${i === 0 ? 0 : 64}">${xml(ln)}</tspan>`)
    .join("");
  const startY = H - 96 - (lines.length - 1) * 64;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${xml(title)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B0B0D" stop-opacity="1"/>
      <stop offset="0.55" stop-color="#0B0B0D"/>
      <stop offset="1" stop-color="#0B0B0D"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.12" r="0.9">
      <stop offset="0" stop-color="${ac}" stop-opacity="0.45"/>
      <stop offset="0.6" stop-color="${ac}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.45" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.72"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <text x="${W - 40}" y="${H + 70}" text-anchor="end" font-family="Inter, system-ui, sans-serif"
        font-size="540" font-weight="800" fill="#F7F7FA" fill-opacity="0.05">${initial}</text>
  <rect width="${W}" height="${H}" fill="url(#scrim)"/>
  <g font-family="Inter, system-ui, -apple-system, sans-serif">
    <text x="72" y="86" font-size="26" font-weight="700" letter-spacing="0.5" fill="#F7F7FA" fill-opacity="0.92">
      <tspan fill="#45DB6B">L</tspan> Learnify
    </text>
    <text x="72" y="120" font-size="22" font-weight="600" fill="#F7F7FA" fill-opacity="0.7">${xml(source || "")}${kind ? `  ·  ${xml(kind)}` : ""}</text>
    <text x="72" y="${startY}" font-size="56" font-weight="800" fill="#F7F7FA" letter-spacing="-0.5">${headline}</text>
  </g>
</svg>`;
}

export default function handler(req, res) {
  const q = req.query || {};
  const svg = poster({
    title: Array.isArray(q.t) ? q.t[0] : q.t,
    source: Array.isArray(q.s) ? q.s[0] : q.s,
    accent: Array.isArray(q.c) ? q.c[0] : q.c,
    kind: Array.isArray(q.k) ? q.k[0] : q.k,
  });
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=31536000, max-age=86400, immutable");
  res.status(200).send(svg);
}

export { accentFor, poster };
