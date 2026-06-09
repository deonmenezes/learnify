# TechScroll Website — Hand-Drawn Redesign Plan

Goal: an artistic, **handwritten**, genuinely **fun-to-explore** website, with artwork made by
**Codex image-gen 2.0** (`codex exec '...'`). Keep all live-feed functionality intact. Improve the
UI **every hour until 08:00 local, consulting the Codex CLI** each round.

## Aesthetic (locked)
- Warm cream "paper desk" (`--paper #f5ecd6`), notebook-dot texture, washi tape, taped clippings.
- Type: `Caveat` (display handwriting) + `Shantell Sans` (UI handwriting) + `Nunito` (readable body).
- Ink `#2c2620`, marker green `#2f9e54`, coral `#ef6b54`, gold; highlighter swipes.
- Wobbly hand-drawn borders, gentle card rotations, highlighter hovers.
- Art lives in `art/` (Codex `.png/.jpg`), referenced with graceful `onerror` fallbacks.

## How each hourly run works
1. Read this file; pick the FIRST unchecked item.
2. **Consult Codex CLI**: `codex exec '<design critique or image prompt>'` — for a fresh art asset
   OR a design critique of `index.html`. Harvest new images from `~/.codex/generated_images/<sid>/`.
3. Implement ONE improvement in the HTML/CSS (or a sub-page).
4. Verify: HTML loads (headless Chrome screenshot, no console errors), feed still renders.
5. Commit + push (Vercel auto-deploys). Check the box + log it. Stop at/after 08:00.

## Done
- [x] **0. Homepage redesign** — hand-drawn scrapbook `index.html` + Codex hero/mascot/empty art. (89911d1)

## Backlog (first unchecked = next)
- [ ] **1. Cleaner card images** — when an article only has the `/api/og` poster (headline baked in),
  the headline shows twice (poster + card body). Either hide the poster image and show the sketch
  tile, or restyle `/api/og` to a cream hand-drawn poster. Pick the cleaner look.
- [ ] **2. Redesign sub-pages** — `ideas.html`, `influencers.html`, `privacy.html`, `support.html`
  to share the cream/handwritten header + footer + type system.
- [ ] **3. Scattered doodle decorations** — inline SVG squiggles, arrows pointing at the search,
  stars/sparkles in the margins (reduce-motion + non-distracting).
- [ ] **4. Fun loading state** — replace the plain skeleton with the scroll mascot + "pinning up
  today's clippings…" handwritten line.
- [ ] **5. Codex section art** — generate a small set of hand-drawn category icons (AI, chips,
  startups, security…) and use them on source/keyword chips or card labels.
- [ ] **6. Mobile polish** — verify the hero stacks nicely, tape/rotations don't overflow, tap targets.
- [ ] **7. Playful micro-interactions** — a gentle "pick up the clipping" tilt, a doodle underline
  that draws on hover, a confetti-scribble when you clear filters.
- [ ] **8. Codex OG/share image** — a hand-drawn social share image + favicon refresh.

## Progress log
- 2026-06-09 01:16 — Homepage redesigned + deployed. Codex art: hero.jpg (SF news-desk doodle),
  mascot.png (scroll-with-lightning logo), empty.png (magnifying-glass character). Live + verified.
</content>
