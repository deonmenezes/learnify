#!/bin/bash
# TechScroll WEBSITE — hourly hand-drawn-UI improvement loop that CONSULTS Codex.
# Spawns a fresh Claude CLI each hour to advance WEBSITE_REDESIGN_PLAN.md, using
# `codex exec` for artwork + design critique. Verifies with a headless-Chrome
# screenshot, commits + pushes (Vercel auto-deploys). Self-stops at/after 08:00.
#
# crontab:  0 1-7 * * *   (the 8am cutoff is also enforced below)
set -uo pipefail

REPO="/Users/deonmenezes/Downloads/techscrolldatacach/techcrunch-articles-listing-by-keyword"
CLAUDE="/Applications/cmux.app/Contents/Resources/bin/claude"
LOG_DIR="$REPO/.omc/ui-logs"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/ui_$(date +%Y%m%d_%H%M%S).log"

HOUR=$(date +%H)
if [ "$HOUR" -ge 8 ] || [ "$HOUR" -lt 1 ]; then
  echo "[$(date)] Outside 01:00-07:59 (hour=$HOUR). Skipping." >>"$LOG"; exit 0
fi

cd "$REPO" || exit 1

# Single-flight lock (atomic mkdir; stale after 110 min auto-clears).
LOCK="$REPO/.omc/ui.lock.d"
if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +110 2>/dev/null)" ]; then rm -rf "$LOCK"; fi
if ! mkdir "$LOCK" 2>/dev/null; then echo "[$(date)] locked, skip." >>"$LOG"; exit 0; fi
trap 'rm -rf "$LOCK"' EXIT

# Don't race an active editing session.
if [ -n "$(git status --porcelain index.html ideas.html influencers.html WEBSITE_REDESIGN_PLAN.md art 2>/dev/null)" ]; then
  echo "[$(date)] working tree dirty — skipping this hour." >>"$LOG"; exit 0
fi

echo "[$(date)] starting UI iteration (hour=$HOUR)" >>"$LOG"

PROMPT=$(cat <<'EOF'
You are improving the TechScroll WEBSITE UI (repo: the techcrunch-articles-listing-by-keyword
Vercel site). It is a hand-drawn / handwritten scrapbook "news desk". Read WEBSITE_REDESIGN_PLAN.md.

Do EXACTLY ONE thing: the FIRST unchecked "- [ ]" item (or, if all are checked, invent one new
genuinely valuable, on-aesthetic improvement and append it).

REQUIRED — consult the Codex CLI this run:
- For any new artwork run:  codex exec 'Generate an image. <hand-drawn ink, cream paper, green accent, no text> ...'
  then harvest the newest PNG from ~/.codex/generated_images/<session-id>/ig_*.png (grep "session id:"
  from codex stdout), copy into art/, and optimize with: sips -Z <px> art/<file>; (jpeg for big art).
- OR for a design critique:  codex exec 'Critique this homepage HTML for a playful hand-drawn tech-news
  site and suggest 3 concrete CSS tweaks: <paste the relevant CSS>' — then apply the best suggestion.

Hard rules:
- Keep ALL feed functionality: do not change the <script> DOM ids/classes the JS uses
  (q, srcSel, socialSel, sort, clear, sources, keywords, count, activeFilters, cards, skeleton,
  state, toTop, and the render() class names). Restyle freely; keep behavior.
- Stay on the locked aesthetic (cream paper, Caveat/Shantell Sans/Nunito, wobble borders, washi tape).
- Verify before committing: serve locally (python3 -m http.server 8770 &) and screenshot with
  headless Chrome ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new
  --window-size=1440,1800 --virtual-time-budget=7000 --screenshot=/tmp/ui_check.png http://localhost:8770/),
  then look at /tmp/ui_check.png. It must render the feed cleanly. If broken, fix or `git checkout .`.
- ONLY if it looks good: check the box in WEBSITE_REDESIGN_PLAN.md, append a one-line dated note to the
  Progress log, then `git add -A && git commit && git push` (Vercel auto-deploys). NEVER push a broken page.
- Keep scope to ONE improvement.
EOF
)

"$CLAUDE" -p "$PROMPT" --dangerously-skip-permissions >>"$LOG" 2>&1
echo "[$(date)] iteration finished (exit=$?)" >>"$LOG"
