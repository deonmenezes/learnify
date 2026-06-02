#!/usr/bin/env bash
# scripts/hourly-refresh.sh — the overnight news-pipeline refresh.
#
# Runs the AI-summary precompute + the X snapshot, then commits & pushes ONLY
# the data files (enriched.json, x-snapshot.json) if they changed — which
# triggers a Vercel redeploy so the live web API and the iOS app get the
# freshest AI summaries + social posts. Scheduled hourly 01:00–08:00 (see the
# crontab entry installed alongside this script).
#
# Reliability: each step is best-effort; a failed step never blocks the others,
# and nothing is committed unless a data file actually changed.

set -uo pipefail
# cron runs with a minimal PATH — make sure node + git are found.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
REPO="$(pwd)"
LOG="$REPO/.omc/hourly-refresh.log"
mkdir -p "$REPO/.omc"

ts() { date "+%Y-%m-%d %H:%M:%S %Z"; }
log() { echo "[$(ts)] $*" >>"$LOG"; }

# Stop after 08:xx — only run 01:00–08:59 (cron also scopes this; belt + braces).
HOUR=$(date +%H)
if [ "$HOUR" -gt 8 ]; then log "hour=$HOUR > 8, skipping (daytime)"; exit 0; fi

log "=== refresh start (hour=$HOUR) ==="

# 1. AI summaries for new articles (reads NVIDIA key from .env.local).
node scripts/enrich.mjs >>"$LOG" 2>&1 && log "enrich ok" || log "enrich failed (kept previous enriched.json)"

# 2. Fresh X report-worthy snapshot (sequential, 429-safe; keeps old on failure).
node scripts/snapshot-x.mjs >>"$LOG" 2>&1 && log "snapshot ok" || log "snapshot skipped/failed"

# 3. Commit + push ONLY the data files, only if they changed.
CHANGED=$(git status --porcelain enriched.json x-snapshot.json 2>/dev/null)
if [ -n "$CHANGED" ]; then
  git add enriched.json x-snapshot.json 2>/dev/null
  if git commit -q -m "chore(data): hourly news refresh — AI summaries + X snapshot [skip ci]" 2>>"$LOG"; then
    if git push origin main >>"$LOG" 2>&1; then
      log "pushed — Vercel will redeploy with fresh data"
    else
      log "push FAILED (check auth); commit is local"
    fi
  fi
else
  log "no data changes — nothing to deploy"
fi

log "=== refresh done ==="
