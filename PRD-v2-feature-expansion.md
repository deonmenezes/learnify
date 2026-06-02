# TechScroll — Product Requirements Document (PRD) · v2

**Working title:** TechScroll v2 — Feature Expansion (Caught-Up Score · Article Images · Doomscroll · Cross-Platform Parity)
**Platforms:** iOS 17+ (native SwiftUI, Xcode 16+) · Android (Expo / React Native, RN 0.85.3 / React 19.2 / expo ~56) · Web (Vercel static `index.html` + serverless `/api/*`)
**One-liner:** Turn the doomscrollable tech-news feed into a daily, gamified habit — a resetting **Caught-Up score**, an immersive **Reels-style single-story mode**, and real **article imagery** — shipped consistently across iOS, Android, and the web, on top of a publisher-friendly, link-out-first backend.
**Author:** Deon Menezes
**Status:** Draft v2.0
**Last updated:** 2026-06-01

---

## 1. Summary & Vision (delta from v1)

### 1.1 What v1 shipped (the baseline this builds on)
v1 (and the shipped code since) delivers a personalized, link-out-only tech-news feed on three runtimes: a native SwiftUI iOS app, an Expo/RN app (the Android delivery vehicle and cross-platform mirror), and a Vercel website + JSON API. The shared backend aggregates **TechCrunch** and **SiliconValley.com** via their public WordPress REST API and **Wired**, **The Verge**, **Ars Technica** via public RSS/Atom — **no Apify, no HTML scraping, no API keys** (UA `TechScroll/1.0`). Every surface renders **headline + source attribution** and taps out to the publisher (SFSafariViewController / WebView / `target="_blank"`), preserving the publisher's ads, paywall, analytics, and referral traffic.

> ⚠️ **v1 PRD is out of date vs. shipped code.** §3.3 / §6 / §13 of the v1 PRD still describe an **Apify** pipeline and a **headline-only / no-thumbnail** posture. The shipped backend uses **public WP-REST + RSS** and the API **already serves `image` + `thumbnail`** per article. v2 supersedes those sections.

### 1.2 What v2 adds (and why)
v2 is a **retention and delight** release. The v1 feed answers "what's new"; it does not answer "am I done?" or give a reason to return tomorrow, and it deliberately suppresses imagery the API already delivers.

| v2 capability | Why now |
|---|---|
| **A — Profile & Caught-Up Score** (gamified daily ring + streaks + XP) | v1 has no finish line and no return loop. A resetting "you're all caught up" score makes staying current *finishable* and gives a morning-coffee reason to reopen. Computed **on-device**, so it ships first with **zero copyright dependency** — its only new endpoint, `/api/availability`, returns article *counts* (no imagery or text), though it still shares the geo/caching invariants in §10.3. |
| **B — Article Images** (legally gated) | The API already serves `image`/`thumbnail`; the apps gate them off at the view layer only. Imagery is the single biggest lift to feed appeal and the prerequisite for D. This is a **policy/legal decision, not a data problem**. |
| **C — Legal & Compliance (image strategy)** (top-level section) | The original tension — show publishers' images vs. stay link-out-only — is **dissolved, not managed**: v2 decouples the image from the publisher and shows a **license-clean image we control** (AI illustration / free-stock / gradient). No third-party image → no display-right exposure, geo-gating, kill-switch, or counsel gate. |
| **D — Doomscroll** (immersive single-story mode) | The headline experience: a TikTok/Reels full-screen, one-story-at-a-time surface using each article's own image + color. It makes the score feel like a game and gives images a reason to exist. |
| **E — Website parity** (gamification + doomscroll + shared API) | The web is the lightest place to land v2 (it already renders images and brands itself "doomscrollable") and is where the **shared backend** changes that unblock A–D on all clients actually live. |

### 1.3 Vision (12 months, refined)
The default "morning coffee" app for tech-curious people — now with a **closeable daily goal** (you can put your phone down), an **immersive lean-back mode** (the cool factor), and a **consistent experience across phone and desktop** — while remaining the *most* publisher-respectful aggregator in the category.

### 1.4 Success metrics — v2 deltas (North Star unchanged = **weekly engaged readers**)

| Metric | v1 target (90-day) | v2 delta / new target |
|---|---|---|
| D1 / D7 / D30 retention | 40% / 20% / 10% | **45% / 25% / 14%** (streaks + daily reset drive return) |
| Avg. session length | ≥ 4 min | **≥ 5 min** overall; **doomscroll depth-of-engagement ≥ 3 min when entered**, bounded by the deck finish line — a *finishable* session, **not** an infinite-scroll incentive (§5) |
| Avg. cards scrolled / session | ≥ 25 | unchanged (quality > raw scroll; depth term governs) |
| **Caught-Up score engagement (new)** | — | **≥ 50%** of WAU view the score weekly; **≥ 30%** reach "All Caught Up" ≥ 1×/week |
| **Streak retention (new)** | — | **≥ 25%** of D7-retained users hold a ≥ 3-day streak |
| **Doomscroll adoption (new)** | — | **≥ 35%** of sessions enter doomscroll at least once |
| **Images uplift (new)** | — | **+10%** card open-rate and **+15%** save-rate vs. the gradient-only baseline, measured via a **per-user holdback cohort** at media-pipeline rollout (see §16 Open Decision #9) |
| Crash-free sessions | ≥ 99.5% | unchanged |
| App Store / Play rating | ≥ 4.5 | unchanged |

---

## 2. Target Users & Personas (v2 lens)

Personas are unchanged from v1; v2 maps each to the new loops.

| Persona | v2 hook |
|---|---|
| **The Builder** (SWE/indie dev) | "You're 70% caught up on AI today" → knows when to put the phone down; XP/levels compound the habit. |
| **The Operator** (founder/PM) | A daily ring closeable in ~10 min; doomscroll for a fast immersive skim; share from the right-rail. |
| **The Learner** (student/switcher) | Per-category breakdown shows where they're behind; deep-dive badge rewards reading, not flicking. |
| **The Enthusiast** (hobbyist) | Pure immersive doomscroll for fun; the score + streak give it a spine. |

**Primary persona for v2:** The Builder (unchanged); **The Enthusiast** is the doomscroll-mode lead.

---

## 3. Scope (v2)

### 3.1 In scope (v2)
- **A** — Profile screen + Caught-Up "Tech Pulse" score (daily reset, streaks + streak-freeze, XP/levels, badges, celebration) on iOS, Android, Web.
- **B** — Article imagery on card/saved/doomscroll surfaces via a **license-clean media layer** (AI illustration primary → free-stock/CC fallback → gradient final), **resolved server-side and hosted by us** (§6). No publisher image is shown.
- **C** — Legal & compliance: the decoupled license-clean image strategy (§4.0), AI-image labeling (IR1) + stock-license hygiene (IR2) + provenance (IR3), a DMCA backstop, and the headline-only text posture. (No image kill-switch / geo-gating / counsel gate — moot.)
- **D** — Doomscroll immersive single-story mode (second surface, opt-in) on iOS, Android, Web.
- **E** — Website parity for A + D, plus the **shared backend** additions (`/api/availability`, the **media-resolution pipeline** that produces `media_url`, optional `/api/read-events` + `/me/stats`).
- Shared on-device read/seen tracking model and stable-id consistency across all three clients.

### 3.2 Out of scope (v2 — later)
- Displaying or licensing **publishers' own** images (the decoupled license-clean strategy makes this unnecessary; it's optional future upside, §4.6).
- Inline playback of publisher video/podcast media (always hand off).
- Server-authoritative score as the **default** (v2 score is client-side and on-device). The optional sync endpoints (`/api/read-events`, `/me/stats`) are **deferred to a fast-follow** — they ship only once the anonymous device-token auth (§10.1.1) is built, are **not** required for v2 "done," and any aggregate sync is opt-in.
- Comments / social graph / user-submitted content (unchanged from v1).
- Abstractive AI summaries (recommended long-term in §4.6, not v2).
- Full web accounts / cross-device sync as a requirement (opt-in only, aggregates-only).
- iPad-optimized layout, Android-tablet layout.

### 3.3 Non-goals
- We are **not** a full RSS reader.
- We are **not** re-hosting publisher article bodies **or publisher images** — link out / reader view only. (We **do** host our *own* license-clean images — AI illustrations / free-stock — which is fine, §4.3.)
- We are **not** displaying author bylines or article ledes/summaries verbatim by default (legal R1/R10).
- The score is **not** a surveillance feature — reading behavior stays **on-device** by default.

---

## 4. ⚠️ Legal & Compliance Analysis (decoupled, license-clean image strategy)

> **⚠️ NOT LEGAL ADVICE.** A product-counsel-style risk map by the eng/PM team to scope the work — not a legal opinion; have counsel review before launch. The point of this section, though, is that v2's image strategy is deliberately chosen to **avoid** the hard copyright questions rather than litigate them.

### 4.0 The decision that changes everything — decouple the image from the publisher
**TechScroll v2 does NOT display any publisher's copyrighted image.** Each story shows a **headline + a link-out to the original publisher** (unchanged, legally clean) paired with a **license-clean image we control**: an **AI-generated editorial illustration (primary)** → a **free-stock / Creative-Commons / public-domain photo matched to the topic (fallback)** → a **category gradient/monogram (final fallback)**. The publishers' own `image`/`thumbnail` URLs stay **not for display** (their v1 posture is preserved).

Because **no third-party copyrighted image exists anywhere in the product**, the entire image-copyright stack below **does not apply**: no display-right exposure (*Goldman*), no full-bleed/thumbnail fair-use tightrope (*Kelly/Perfect 10*), no hotlinking, no per-source image kill-switch, no DMCA-for-images, no EU/Canada geo-gating of imagery. **Full-bleed, high-resolution images become safe because they are ours.** Consequently **Features B and D are no longer counsel-gated** the way a publisher-image approach would be — they ship on the normal track. The case law in §4.2 is retained as the *rationale for why we don't touch publisher images*, not as a tightrope we walk.

### 4.1 Current posture & why it's relatively defensible

TechScroll today sits on the safest side of every line here. Three properties do the legal heavy lifting and **are all preserved** in v2 (the decoupled image strategy keeps them intact):

1. **Facts + headlines only, link-out for everything else.** `Article.swift` and `article.ts` both document the **LINK-OUT-ONLY (App Store Guideline 5.2)** posture and explicitly mark `imageURL`, `thumbnailURL`, `dek`, `author` as "not for display." Headlines and raw facts are the weakest copyright subject matter: under *Feist Publications v. Rural Telephone Service Co.*, 499 U.S. 340 (1991), **facts are not copyrightable** — copyright needs "independent creation plus a modicum of creativity." Short headlines also frequently fail the originality/merger thresholds.
2. **Publisher-PROVIDED syndication, not scraping.** The pipeline (`lib/feeds.js`, `scrape.py`) consumes the publishers' **own WordPress REST API** (`/wp-json/wp/v2/posts`) and **public RSS/Atom** — channels the publishers stand up *for* syndication. No Apify, no HTML scraping, no API keys, no auth bypass. This sidesteps the *Computer Fraud and Abuse Act* theory: in *hiQ Labs v. LinkedIn*, 31 F.4th 1180 (9th Cir. 2022), accessing **publicly available** data "will not constitute access without authorization under the CFAA." (Caveat: hiQ ultimately **lost on breach-of-contract / ToS** — see R7.)
3. **Tap-out preserves the publisher's economics.** `ArticleDetail` opens `SFSafariViewController` to the canonical URL, so the publisher keeps ads, paywall, analytics, and referral traffic. This is the single most important fact for "hot news"/free-riding (R4) and fair use — TechScroll **drives traffic to**, not **substitutes for**, the source.

**Net:** the link-out-only design is defensible precisely because it takes almost nothing protectable and sends users to the source. **The v2 decoupled image strategy preserves all three** — the story still links out, and the image is *our own* license-clean asset rather than the publisher's, so full-bleed is fine (there's no third-party image to appropriate). §4.2 below is the risk map we *designed around*, not one we walk through.

### 4.2 Risk table

| # | Risk | Severity | Why | Trigger |
|---|---|---|---|---|
| R1 | **Verbatim text** — RSS/Atom `summary`/`dek`/lede excerpts are expressive, not facts | **Med** | *AP v. Meltwater*, 931 F. Supp. 2d 537 (S.D.N.Y. 2013) rejected fair use where the aggregator auto-took the **lede** — "the heart of the story." Headlines alone are low-risk; **the `dek`/`summary` field is the real text exposure.** | Rendering `dek`/`summary`/`author` verbatim in any view |
| R2 | **Image display (hotlink)** — embedding publisher CDN images | **Med→High** | *Goldman v. Breitbart*, 302 F. Supp. 3d 585 (S.D.N.Y. 2018) **rejected the "server test"**: you can "display" (and infringe) an image you never copied, just by embedding it. The 9th-Cir. *Perfect 10* server-test shield is **not reliable outside the 9th Circuit.** | Any UI that renders a publisher image inside TechScroll (B, D) |
| R3 | **Full-bleed / high-res image** — immersive card | **High** | Thumbnail fair use (*Kelly v. Arriba Soft*, 336 F.3d 811 (9th Cir. 2003); *Perfect 10*) turns on **low resolution + transformative index function + no market harm.** Full-bleed high-res is the opposite. | Feature D rendering the image large as the dominant visual |
| R4 | **Hot-news / free-riding misappropriation** | **Low→Med** | *NBA v. Motorola*, 105 F.3d 841 (2d Cir. 1997); *Barclays v. Theflyonthewall*, 650 F.3d 876 (2d Cir. 2011) **narrowed it sharply.** Link-out + attribution + not-a-direct-competitor cut against it; **full-bleed that discourages tap-out raises "free-riding."** | Time-sensitive headlines published faster/instead-of source, no tap-out |
| R5 | **App Store Guideline 5.2 rejection (iOS)** | **High (gating)** | 5.2.2 requires third-party content display be "specifically permitted… under the service's terms of use," and "**Authorization must be provided upon request.**" 4.2.2 disfavors apps that are "primarily… content aggregators, or a collection of links." | App Review sees an image-rich aggregator and asks for written authorization |
| R6 | **Google Play IP / repetitive-content / min-functionality** | **Med→High** | Play prohibits apps that "infringe… intellectual property rights" and low-functionality/repetitive scraped content (policies eff. Jan 28, 2026). Same authorization exposure as 5.2. | Android (Expo) build flagged as IP-infringing / "repackaged content" |
| R7 | **ToS / contract** (even with no CFAA) | **Med** | hiQ won on CFAA but **LinkedIn won on breach of contract.** Publisher ToS may forbid commercial reuse/framing even of a public feed. | A target publisher's ToS bars commercial redistribution or image reuse |
| R8 | **EU/UK press publishers' right** (DSM Art. 15) | **High if shipped in EU** | DSM Directive Art. 15 (2019/790) gives press publishers a right over online reuse beyond "individual words and very short extracts"; France fined Google €500M; **images/summaries can exceed "very short extracts."** | App/website reachable in EU/UK serving images + summaries |
| R9 | **Canada Online News Act (C-18)** | **Med if shipped in CA** | C-18 forces designated platforms to pay for making news available; Meta **blocked news in Canada**; Google pays ~$100M CAD/yr. Threshold is size-based but the climate is hostile. | App/website serving Canadian users at scale |
| R10 | **Personal data in bylines** (GDPR/CCPA) | **Low→Med** | `author` is personal data → GDPR/CCPA-CPRA obligations (lawful basis, deletion). Today `author` is "not for display"; B may surface it. | Displaying/processing `author` for EU/CA residents |
| R11 | **Defamation / right-of-publicity pass-through** | **Low** | Reproducing a defamatory headline/image or a likeness in a commercial feed carries pass-through exposure; CDA §230 helps for third-party *links* but is weaker once you **re-host/curate** expressive content. | Re-hosting a defamatory image or a commercially-used likeness |

> **Status under v2's decoupled strategy (§4.0):** R2, R3 (image display / full-bleed) → **eliminated** — no publisher image is ever shown. R5, R6 (App-Store/Play IP) → **greatly reduced** — no copyrighted imagery to flag; we keep attribution + link-out. R7 (image ToS), R8, R9 (EU DSM / Canada C-18) → **N/A for imagery**. **Residual risks we still actively manage: R1** (don't show publisher summaries/ledes verbatim), **R10** (bylines), **R11** (only for stock photos of real people), plus the new license-clean-image risks **IR1–IR3** below.

### 4.3 The image strategy (Features B + D) — license-clean, decoupled, we host

| Layer | Source | Rights | When |
|---|---|---|---|
| **Primary** | **AI-generated editorial illustration** from the headline (server-side, scrape time) | We generate it; output is ours to use per the model provider's terms — **no third-party copyright** | Default for every article |
| **Fallback** | **Free-stock / CC / public-domain photo** matched by `categories[]`/keywords — Unsplash, Pexels, Pixabay, Openverse, Wikimedia, NASA/.gov | Free for commercial use; we cache our own copy; attribute where the license requires | Generation skipped/fails, or a real photo reads better |
| **Final fallback** | **Category gradient / source monogram** (existing `placeholderGradient`) | Fully ours | No image resolved |

**We DO host these images** (Vercel Blob / S3 / our CDN) — and that is now *fine*, because we have the rights to every one of them. (v1's worry was re-hosting *publisher* images; that is exactly what we avoid.) Each article gains a server-resolved **`media_url`** (+ **`media_kind`**, **`media_credit`**); the publisher `image`/`thumbnail` stay **not-for-display**.

### 4.4 Image-layer compliance (the only image rules that remain)
- **IR1 — AI images are illustrations, not fabricated news photos.** Keep them **conceptual / iconographic**; **never** generate a photoreal depiction of a real, identifiable person or a specific real event (right-of-publicity, false-light, misinformation). Label as "illustration" in alt-text/UI. (US Copyright Office: pure AI output isn't itself copyrightable — that affects only *our* ability to stop others copying it, not our right to use it.)
- **IR2 — Free-stock/CC license hygiene.** Honor each library's license: **attribute CC-BY / Wikimedia**; CC0 / Unsplash / Pexels need no attribution but we credit anyway. Unsplash's "don't build a competing stock service" clause doesn't bind a news app. **Never** pair a stock photo of an **identifiable real person** with a news claim about a *different* person (false-light) — prefer non-identifiable / conceptual stock.
- **IR3 — Provenance recorded.** Store `media_kind` (ai|stock|gradient) + `media_credit` (license + attribution string) per image, so attribution renders correctly and any audit is trivial.
- **Text posture unchanged (R1).** Still **do not** display the publisher's `summary`/`dek`/lede verbatim by default — headline + link-out only. (If a teaser line is ever wanted, use a server-side **abstractive** summary, §4.6-3.)
- **Attribution + link-out (R4/R5).** Every card still shows **source name + canonical link** and taps out to the publisher — the economics-preserving move that keeps us a *referrer, not a substitute*.

### 4.5 Lightweight guardrails (much smaller than a publisher-image build)
1. **DMCA designated agent (backstop).** Still register an agent + publish contact (Settings, `privacy.html`/`support.html`) and run a takedown path — cheap insurance, even though images are license-clean and text is headline-only.
2. **Attribution standard (design-system lint invariant).** Source name + canonical link on every card; `media_credit` rendered whenever a stock/CC image requires it.
3. **AI-image moderation.** Filter generated imagery for unsafe/abusive content before caching (provider safety filters + a blocklist); IR1 (no real-person photoreal) enforced in the generation prompt + a review sample.
4. **Removed (no longer needed):** per-source **image** kill-switch, image **geo-gating**, hotlink detection, and the **counsel-gate-before-images** — there is no third-party image to take down, region-restrict, or be sued over. A per-source **text** toggle in `lib/feeds.js` is retained only to drop a misbehaving *feed*, not for image rights.

### 4.6 Optional future upside (not needed for v2)
1. **License a publisher's *own* image** if you ever want a real news photo for a breaking story: Wired + Ars Technica via **Condé Nast** (one deal), The Verge via **Vox Media / Wright's Media**, TechCrunch via **Regent LP**, SiliconValley.com via **MediaNews Group**. All have licensing infrastructure (Condé Nast & Vox both signed OpenAI deals) — but expect 5-figure/yr + months of BD. **Pure upside; the decoupled strategy already meets the "high-quality images" goal with zero exposure.**
2. **Add openly-licensed news sources** (The Conversation CC BY-ND, gov/public-domain, Wikinews) where you can show the article's *own* image legally.
3. **Abstractive AI summaries** (server-side, facts-only) if a teaser line is ever wanted — new expression, sidesteps the *Meltwater* verbatim-lede trap (R1).

> **Sources (rationale for avoiding publisher images + the license-clean approach):** *Feist* 499 U.S. 340 (1991) · *Goldman v. Breitbart* 302 F. Supp. 3d 585 (SDNY 2018) · *Kelly v. Arriba Soft* 336 F.3d 811 (9th Cir. 2003) · *Perfect 10 v. Amazon* 508 F.3d 1146 (9th Cir. 2007) · *AP v. Meltwater* 931 F. Supp. 2d 537 (SDNY 2013) · Apple App Store Review Guidelines 5.2 / 4.2.2 · Google Play Developer Program Policy (IP) · DSM Directive (EU) 2019/790 Art. 15 · Canada Online News Act (C-18) · US Copyright Office, *Copyright and Artificial Intelligence* (AI-output registrability). Image-library licenses: Unsplash · Pexels · Pixabay · Openverse / Creative Commons · Wikimedia Commons · NASA.

---

## 5. Feature: Profile & Caught-Up Score

> **Status:** net-new surface. Ships **independently of images (B) and doomscroll (D)** — computed entirely **on-device** from data the apps already hold, so it carries **no copyright/legal dependency** and **launches first.** The website variant (§8) reuses this exact model.

### 5.1 Summary & rationale

A **Profile** tab anchored by a gamified **"Caught-Up Score" ("Tech Pulse")** — a daily, resetting 0–100 number answering one question: *"Of the tech news that mattered in your chosen categories today, how much have you actually engaged with?"* It fuses three proven loops:

| Borrowed from | What we take |
|---|---|
| **Instagram "You're All Caught Up"** | A reachable finish-line that ends a session positively (we already ship the literal copy `"You're all caught up"` at the end of `FeedView.swift` / `FeedScreen.tsx`) |
| **Apple Fitness rings** | A daily, **resetting**, closeable goal rendered as a ring — fresh every morning, never punishing |
| **Duolingo** | Streaks, streak-freeze, cumulative XP/levels, gentle milestone badges for long-term retention |

### 5.2 User stories
- **As The Builder,** I want to instantly see "you're 70% caught up on AI today" so I know whether I can put my phone down.
- **As The Operator,** I want a daily ring I can *close* in ~10 minutes so staying current feels finishable, not infinite.
- **As The Learner,** I want a streak and XP so the habit compounds, and a **streak-freeze** so one busy day doesn't nuke a 40-day streak.
- **As The Enthusiast,** I want per-category breakdowns and collectible badges so I can chase completion.
- **As any user,** I want my reading behavior to **stay on my device** by default, opting into cloud sync only for a second device.

### 5.3 The score model — "Tech Pulse"

**5.3.1 Freshness window.** Denominator = rolling **24-hour** window (configurable to "since you last opened"). Each article is recency-weighted so this-morning's news outweighs 18-hour-old news:
```
recencyWeight = 0.5 ^ (ageHours / 12)        // 12-hour half-life
```

**5.3.2 Inputs** (all derivable from data we already hold), restricted to the user's **selected categories**:

| Symbol | Meaning | Source |
|---|---|---|
| `A` | **Available** — recency-weighted count of fresh articles in the user's selected categories. **Computed client-side** by filtering the *all-category* counts to `UserProfile.interests`. ⚠️ The endpoint returns **every** category's count (it is shared-/edge-cached and must never be per-user); the client does the selected-category filtering locally. | `/api/availability` (all-category counts) → filtered on-device |
| `S` | **Seen** — articles from `A` with **≥ 1.2 s contiguous foreground dwell** (the timer pauses on background/blur and requires uninterrupted visibility — §7.3) | On-device seen set |
| `O` | **Opened** — subset of `S` the user link-outed on (strong signal) | On-device opened set |
| `B` | **Breadth** — # of selected categories with ≥ 1 seen article today | Derived from `S` |
| `C` | **Categories** — total selected categories | `UserProfile.interests.count` |
| `streak` | Consecutive days the daily goal was reached | On-device streak state |

**5.3.3 The formula** (concrete, opinionated):
```
coverage   = min(S / max(A, 1), 1)            // how much of today's news you've seen
depth      = (S >= 3) ? min(O / S, 1) : 0     // of what you saw, how much you read — needs a real sample (≥3 seen)
breadth    = min(B / max(C, 1), 1)            // spread across your chosen interests

raw        = 100 * (0.55*coverage + 0.30*depth + 0.15*breadth)
CaughtUp%  = round( min(raw, 100) )
```
**Edge cases (defined, not implied):**
- **`A = 0` — no fresh news in your categories:** the score is **N/A**, not a divide-by-zero. Show the dedicated **"All caught up — nothing new yet"** empty state (treat as caught up), and **exclude the day from streak math** — a zero-news day neither builds nor breaks a streak (it auto-freezes, §5.4). Never compute `S / 0`.
- **`depth` minimum-volume guard:** `depth` contributes **0 until ≥ 3 articles are seen** (`S ≥ 3`), so opening 1-of-1 cannot mint full depth credit from a trivial sample.

**Why these weights:** `coverage` is the dominant, intuitive "did you keep up" signal; `depth` (real link-outs) is the **anti-gaming counterweight**; `breadth` nudges across stated interests.

> ⚠️ **Anti-blind-scroll governor (load-bearing):** `depth` is gated entirely behind genuine opens, so a user who flicks past everything without opening is bounded by `0.55·coverage + 0.15·breadth` — an **up-to-~70** ceiling (it equals exactly 70 only when both `coverage` **and** `breadth` reach 1.0; it is lower otherwise). **You cannot reach 100, or earn any read-gated reward (streak floor, "Perfect Day", XP-for-opens), by scrolling.** This ceiling is intentional — do not "fix" it.

**5.3.4 "All Caught Up!" vs. the gamified score — deliberately decoupled.** The celebration is about **seeing** everything new, *not* about the read-gated score:
- **"All Caught Up" (the everyday finish line)** fires on **`coverage ≥ 0.95` alone** (you've seen essentially everything fresh in your categories), **or** on `A = 0`. It must **not** depend on `CaughtUp% ≥ 90` — a pure-coverage user caps at ~70, and tying the celebration to the score would mean *seeing everything yet never being told you're caught up* (the §5.1 promise). This is the trigger referenced by FR-102, §5.5, the doomscroll deck (§7.1), and the streak goal (§5.4).
- **"Perfect Day" (`CaughtUp% ≥ 90`)** is a separate, rarer state — you saw *and* read deeply. It awards a distinct badge/XP, but is **not** the daily finish line.

### 5.4 Daily reset, streaks, levels, badges
- **Daily reset** at the user's **local midnight** (or first open of a new day): `A/S/O/B` recompute, the ring empties, the goal is fresh — Fitness-rings cadence (fair, non-punishing).
- **Streak** increments each day the goal is hit. The goal is **"All Caught Up" (`coverage ≥ 0.95`)** *or* a **read-gated softer floor of `coverage ≥ 0.6` AND `O ≥ 1`** (you saw most of the day *and* genuinely opened ≥ 1 story). The floor is gated on `coverage`+`O`, **not** on the gameable composite score, so pure blind-scroll (which tops out near the ~70 score) **cannot** sustain a streak (§5.7). A busy person still keeps it in ~10 min. Render 🔥 + day count. Offer **one streak-freeze per week** so a single missed day doesn't cause rage-churn; an `A = 0` zero-news day **auto-freezes** (neither builds nor breaks the streak, §5.3.3).
- **XP / Tech Pulse Level** (cumulative, never resets):

| Action | XP |
|---|---|
| Per **seen** article (first time only) | +2 |
| Per **opened** / link-out (first time only) | +8 |
| **Closing the daily ring** (= hitting the "All Caught Up" `coverage ≥ 0.95` trigger, §5.3.4) | +15 |
| **Streak milestone** (7 / 30 / 100 days) | +25 |

Level curve: `level n needs ~ 50 * n^1.5` XP.

- **Badges** (one-time, collectible, on-device):

| Badge | Earned by |
|---|---|
| 🐦 **Early Bird** | Caught up before 9am |
| ✅ **Completionist** | `coverage ≥ 0.95` in a day (the "All Caught Up" bar; literal 100% is a moving target on high-volume news days) |
| 🧠 **Polymath** | `breadth = 1.0` (all selected categories) |
| 🏃 **Marathon** | 30-day streak |
| 🤿 **Deep Diver** | Opened ≥ 10 articles in a day |

### 5.5 The "All Caught Up!" celebration (the emotional payoff)
On trigger: full-screen takeover — ring completes with a spring, brand-gradient confetti/particle burst (`Theme.Palette.brandGradient` iOS/Expo, `--grad` web), **success haptic** (`Haptics.success` / `expo-haptics`), copy: **"You're all caught up 🎉 — you've seen everything new in {top category} today."** Then today's **stat line**: stories caught up · articles read · streak day · categories covered · XP earned. Inside doomscroll (D), the full progress deck → an **honest end-state** with one CTA: **"Come back tomorrow"** / **"Turn on the morning nudge."**

### 5.6 Profile screen layout (per platform)
Shared anatomy, top → bottom: **(1)** Caught-Up ring hero · **(2)** Streak + level + XP bar · **(3)** Per-category breakdown · **(4)** Badges shelf · **(5)** History (7/30-day) · **(6)** Privacy & sync controls.

**5.6.1 iOS — SwiftUI** (`Features/Profile/`)
- **Entry:** wire the no-op profile avatar in the `FeedView.swift` top bar (the `SourceAvatar` carrying `accessibilityLabel: "Profile"`) to push `ProfileView`; add a "Your tech pulse" row to `SettingsView.accountSection`.
- `CaughtUpRingView`: `Circle().trim(...).stroke(brandGradient, …)` driven by `CaughtUp%`, `.animation(.spring)`, center = big number + "caught up today". Accents from `NewsCategory.accentColor`.
- Streak/level row: 🔥 + `tsHeadline`, thin XP bar, Tech Pulse Level chip.
- Per-category breakdown: `LazyVStack` of mini bars, one per selected `NewsCategory`, filled to that category's `coverage`, tinted with its `accentColor` (e.g. `.ai (0.55,0.36,0.96)`, `.security (0.90,0.30,0.45)`).
- History: 7-day sparkline / dot-grid from `ReadEvent`. Reuse `ScreenBackground`, `.glassCard()`, `.glow(_:)`, `ShimmerView`, `EmptyStateView`. Surface the same ring as the doomscroll top progress deck.

**5.6.2 Android — Expo / RN** (`src/screens/`)
- **Entry:** wire the `SourceAvatar` in the `FeedScreen.tsx` top bar to navigate to `ProfileScreen`; add a stats row to `SettingsScreen.tsx` Account `Section`; optional dedicated tab in `MainTabs.tsx`.
- `CaughtUpRing.tsx`: `react-native-svg` `Circle` with animated `strokeDashoffset` (Reanimated); gradient via `expo-linear-gradient`.
- Per-category bars tinted with `CATEGORY_META[key].accent` (`src/models/category.ts`).
- Celebration: Reanimated confetti + `expo-haptics` success. **Use Expo's own tokens** (`background #0D0D12`, `accent #669EFF`, `success #4DCC73`) — not iOS literals (token drift is intentional, §13). Reuse `ScreenBackground`, `PrimaryButton`, `ShimmerView`, `Toast`.

**5.6.3 Website** (`index.html`) — see §8 (Feature E).

### 5.7 Anti-gaming rules (built into the model)
1. **Seen requires dwell ≥ 1.2 s** — fast flicks don't count toward `S`.
2. **Score can't be maxed by scrolling** — `depth` gates 100 behind real link-outs (~30% of the score).
3. **Coverage capped at the recency-weighted available set** — re-viewing/re-scrolling can't inflate.
4. **Diminishing XP** — only the **first** seen / **first** open earns XP.
5. **Breadth can't be farmed** — bounded by *selected* categories; one per category is the intent.
6. **Streaks are read-gated** — the streak floor requires `coverage ≥ 0.6` **AND** `O ≥ 1` (a genuine open), so blind-scrolling past everything cannot sustain a streak (§5.4). The score's ~70 blind-scroll ceiling is *not* a valid streak path.

### 5.8 Privacy posture
- **On-device first.** Score computed entirely on-device from local seen/opened sets + a category-filtered available count. **No per-event server logging** required — a strong App-Store privacy-nutrition-label and `privacy.html` story.
- **Storage:** `@AppStorage` + SwiftData `ReadEvent` (iOS), `AsyncStorage` `ts.reads.v1` (Expo), `localStorage` `techscroll.seen.v1` (web).
- **Opt-in cloud sync only.** `POST /api/read-events` sends **aggregates only** (daily score, streak, XP totals) — **never** the list of articles read — gated behind an explicit Settings toggle.
- **No bylines in the score.** `author` (personal data) is **not** a score input nor displayed in Profile.

---

## 6. Feature: Article Imagery (license-clean, decoupled)

> **🖼️ Feature B.** Give every story a **high-quality image with zero third-party copyright** by decoupling the image from the publisher (§4.0): an **AI-generated editorial illustration (primary)** → a **free-stock / CC / public-domain photo matched to the topic (fallback)** → a **category gradient/monogram (final fallback)**, all **resolved server-side and hosted by us**. The publishers' own `image`/`thumbnail` URLs stay **not for display**. This ships on the **normal track — no counsel gate, no geo-gating, no kill-switch** (there is no infringing image to take down).

### 6.1 Decision: generate or fetch a license-clean image; host it ourselves

Per §4.3, every article is resolved at scrape time to one **`media_url`** we have full rights to:

| Tier | What we ship | Why |
|---|---|---|
| ✅ **AI illustration (primary)** | Generate one editorial illustration from the headline (server-side); cache to Vercel Blob / S3 / our CDN. | Unique, on-brand, **zero third-party copyright**; full-bleed-safe. |
| ✅ **Free-stock / CC fallback** | When generation is skipped/fails, fetch a topic-matched photo (Unsplash · Pexels · Openverse · Wikimedia · NASA); cache our copy; store `media_credit`. | Real photography, free for commercial use, attributed per license (IR2). |
| ✅ **Gradient / monogram (final)** | The existing `placeholderGradient(for:)` / `srcColor` tile. | Always works; fully ours. |
| ❌ **Publisher CDN image** | Never displayed or hotlinked; `image`/`thumbnail` stay not-for-display. | Avoids the entire image-copyright stack (§4.2). |

**Data-layer consequence:** add a server-resolved **`media_url`** (+ **`media_kind`** `ai|stock|gradient`, **`media_credit`**, **`media_srcset`**) per article. We **DO host** these (license-clean) images — now fine (§4.3). Publisher `image`/`thumbnail` remain pointers we never render.

### 6.2 The media-resolution pipeline (server-side, once; all clients inherit)
Runs in the existing aggregation pipeline (`scrape.py` / a new `lib/media.js` step), after an article is normalized:
1. **Generate** an AI illustration from `title` (+ `section`) via a hosted image model (SDXL / Flux / Imagen / DALL·E), with a **fixed TechScroll style prompt** (conceptual, dark, on-brand) and the **IR1 guardrails baked into the prompt** (no real identifiable people/events; "editorial illustration"). Run the provider **safety filter** + a blocklist (§4.5-3).
2. **Or fetch** a free-stock / CC photo keyed by `categories[]`/keywords when AI is disabled for that run, generation fails moderation, or config prefers stock for that section. Record **`media_credit`** (license + attribution).
3. **Cache** the chosen image to our storage at 2–3 responsive sizes (e.g. 420w / 828w / 1242w) → **`media_url`** (+ **`media_srcset`**). Idempotent, keyed by the stable article id, computed **once** and edge-served.
4. **Fallback** to gradient/monogram (`media_kind:"gradient"`) if both fail.

> **What's NOT here (removed vs. a publisher-image build):** no `policy` block, no global/per-source **image** kill-switch, no image **geo-gating**, no hotlink detection, no counsel-gate. The only feed control retained is a per-source **`text`** toggle in `lib/feeds.js` to drop a misbehaving *feed* (not an image-rights control). The media pipeline edge-caches like any other content (`s-maxage=600`).

### 6.3 Model change: add media fields; publisher image stays hidden
- **iOS** `Models/Article.swift`: **add** `mediaURL: URL?`, `mediaKind: MediaKind` (`ai | stock | gradient`), `mediaCredit: String?`. Keep `imageURL`/`thumbnailURL` but they stay **not for display** (the v1 prohibition stands for *publisher* images); `author`/`dek` also stay not-for-display (R1/R10). `SavedArticle.swift` adds `mediaURLString`/`mediaKind`/`mediaCredit` (lightweight SwiftData migration).
- **Expo** `src/models/article.ts`: add `mediaURL`, `mediaKind`, `mediaCredit`; `feedService.ts mapArticle` maps them. Publisher `imageURL`/`thumbnailURL` stay not-displayed.
- **Website:** `index.html` renders `a.media_url` (replacing the old `thumb(a)` publisher-image path) + `a.media_credit` in the overlay.

### 6.4 Rendering specs per platform
Four shared invariants: **(1)** render `mediaURL` (**never** the publisher image), **(2)** show `media_credit` when `media_kind === stock`, **(3)** graceful gradient/monogram fallback, **(4)** downsample to display size.

**6.4.1 iOS** (`ArticleCardView.swift`, `SavedView.swift`)
- Replace `categoryBanner`'s placeholder with `AsyncImage(url: article.mediaURL)` (no policy gate needed); keep the 124pt banner + `UnevenRoundedRectangle` top corners + bottom-fade + `categoryBadge`.
- **Caching:** bump `URLCache.shared` in `TechScrollApp.swift` (12 MB/48 MB → **~40 MB mem / 200 MB disk**); adopt **Nuke (`LazyImage`)** for explicit downsampling if `AsyncImage` is insufficient. Decode off-main-thread.
- Loading → `ShimmerView`; `.failure` → gradient/monogram.
- **Attribution:** when `mediaKind == .stock`, render `mediaCredit` in `.tsCaption` on the bottom scrim (lint-level invariant in `Components.swift`). AI/gradient need no credit but show a subtle **"illustration"** tag (IR1).
- **a11y / reduced-data:** `.accessibilityLabel("Illustration for: \(title)")` (ai) / `"Photo: \(mediaCredit)"` (stock); a **reduced-data toggle** in `SettingsView` drops to the gradient tile.

**6.4.2 Android/Expo** (`ArticleCard.tsx`, `SavedScreen.tsx`)
- Replace the `<LinearGradient>` + `<Icon>` banner with **`expo-image`** `<Image source={{ uri: article.mediaURL }} contentFit="cover" transition={200} />` (add `expo-image`; memory+disk caching, `transition`, `contentFit` for free). Keep existing badges.
- `cachePolicy="memory-disk"`, `recyclingKey={article.id}`; `Image.prefetch([…])` next cards; `onError` → `<LinearGradient>` monogram.
- **Attribution:** `mediaCredit` in `Type.caption` over a `LinearGradient` scrim when `mediaKind === 'stock'` (lint-level invariant in `components.tsx`); subtle "illustration" tag for AI.
- **a11y / reduced-data:** `accessibilityRole="image"` + label; reduced-data toggle in `SettingsScreen.tsx` drops to gradient.

**6.4.3 Website** (`index.html`, `.card .media img`)
- Render `a.media_url` (replacing `thumb(a)`):
  ```html
  <img loading="lazy" decoding="async"
       src="${a.media_url}"
       srcset="${a.media_srcset}"
       sizes="(max-width: 600px) 100vw, 420px"
       alt="${a.media_kind === 'ai' ? 'Illustration' : 'Photo'} for: ${escapeHtml(a.title)}"
       onerror="this.closest('.media').classList.add('media--fallback'); this.remove();">
  ```
- **Fallback:** keep the `onerror` → `.media--fallback` `--grad` / `srcColor(a.source)` monogram tile.
- **Attribution:** render `a.media_credit` over the media when `a.media_kind === 'stock'`; keep the `SOURCE_COLORS` source chip.
- **Reduced-data:** honor `navigator.connection.saveData` (monogram, skip `srcset`); `prefers-reduced-motion` already respected.

**6.4.4 Shared rendering invariants**

| Invariant | iOS | Expo | Web |
|---|---|---|---|
| Render `mediaURL` (never publisher image) | `mediaURL` | `mediaURL` | `media_url` |
| Stock attribution when required | `mediaCredit` | `mediaCredit` | `media_credit` |
| "Illustration" label for AI (IR1) | tag/alt | tag/alt | alt |
| Gradient/monogram fallback | `placeholderGradient` | `<LinearGradient>` monogram | `.media--fallback` |
| Downsample to display size | Nuke/native | `expo-image` | `srcset`/`sizes` |

### 6.5 App Store / Play notes (now much simpler)
- **No image gate to clear.** The app shows **our own** illustrations / licensed photos + a link-out — there is no third-party imagery for **5.2.2 / Play IP** to flag. Keep prominent attribution + link-out (still good practice) and an evidence note (publisher feeds power *text/metadata* only; headline + link-out).
- **Update in-app legal copy:** `SettingsView` `termsOfServiceText`/`privacyPolicyText`, Expo `StaticTextScreen.ts`, and the website footer → *"headlines + links to the original publishers; images are AI-generated illustrations or licensed/Creative-Commons stock that we host; we don't host publisher article text or images."* Keep the **DMCA agent** contact (§4.5-1).
- **No staged image-flag rollout and no geo-gating** — images ship with the binary; nothing to flip post-review.

### 6.6 Acceptance criteria → see §17.

---

## 7. Feature: Doomscroll (Immersive Single-Story Feed)

> 🎬 **The headline experience of v2.** A TikTok/Reels-style, full-screen, one-story-at-a-time surface that highlights a single article immersively using its **license-clean image and color** (§6). It makes the Caught-Up score (§5) feel like a game and gives the imagery a reason to exist. Because the full-bleed image is **our own AI/stock asset** (§4.0), full-bleed is **safe** — no special legal gating; the only standing rules are stock attribution (IR2) and the AI "illustration" label (IR1).

### 7.1 The experience — one card = one screen
Swipe up = next, down = previous, hard-snapped. Z-stack bottom-up:

| Layer | Content | Source / token |
|---|---|---|
| **0 — Full-bleed image** | **`article.mediaURL`** — our license-clean image (AI illustration or licensed/CC stock, §6), rendered **full-resolution** (safe — it's ours). `aspectRatio: fill`, clipped to safe screen | Falls back to `placeholderGradient(for: category)` / category accent when `mediaKind == gradient` or load fails |
| **1 — Per-card color wash** | Tint from the image's dominant color at ~25–35% opacity, blended over the photo so each card "owns" its aesthetic | `accent_hex` from the API (server-computed, preferred) → client fallback |
| **2 — Scrims** | Bottom `clear → black@0.85` over ~55% for legibility; top `black@0.5 → clear` over ~20% so status bar / dots / source pill stay readable over bright photos | `expo-linear-gradient` / SwiftUI `LinearGradient` / CSS gradient |
| **3 — Content overlay** (bottom-left, ~24pt insets) | **Source pill** (favicon + source + region + `timeAgo`) · **Headline** `title` in `tsTitle` (26–30pt, 3–4 lines, tail-truncated) · **Category tag** (`CategoryTag`, `category.accentColor`) · **Content-type chip** ("▶ Watch" / "🎧 Listen" when `content_type != article`) · **Primary CTA** "Read on {Source} →" pill (`brandGradient`) | `SourceAvatar`, `tsTitle`, `CategoryTag`, `PrimaryButton` + mirrors |
| **4 — Right-rail action stack** (right edge, ~56pt targets) | **Save** (fills on tap) · **Share** (system sheet of `article.url`) · **Open ↗** (redundant link-out) · optional **"Less like this"** | Reuses bookmark + share + open paths |

**Copy reuses in-product voice:** end state = **"You're all caught up"**; the brand calls the surface **"doomscrollable."**

**Gesture vocabulary (locked, identical across platforms):**

| Gesture | Action | Feedback |
|---|---|---|
| Swipe **up** | Next story | Snap + light haptic (`Haptics.selection` / `expo-haptics` selection) |
| Swipe **down** | Previous story | Snap + light haptic |
| Pull down (at top) | Refresh feed | Rubber-band + success haptic |
| **Single tap** (card body) | **Open** in in-app reader (link-out) | Medium haptic |
| **Double tap** | **Save / bookmark** | Bookmark burst + accent particles + success haptic |
| Long-press | Pause + context menu (Share · Less like this · Copy link · Open) | Heavy haptic on menu appear |
| Tap right-rail **Save** | Save | Icon fill + tick |

> ℹ️ Double-tap is the TikTok/Instagram "love-tap" repurposed: there is no "like," so the meaningful save is **bookmark** (drives the deterministic-UUID bookmark id). Tap-anywhere = open is unambiguous (one item on screen).

**Progress indicator — the score bridge.** A thin **segmented progress bar** at the top (Stories-style), driven by a **session "deck"** not per-story timers. The deck's **`N` = the §5.3 availability count `A`** for the freshness window (from `/api/availability`, filtered to selected categories) — **decoupled from pagination**: the feed may load `?limit=200` and page further, but the deck denominator is `A`, the *same* denominator as the Caught-Up `coverage`, so the bar and the score never disagree. Show **N segments = today's Caught-Up batch** (e.g. *"37 new stories in your categories today"*), filling as each is seen; a small **"12 / 37"** counter sits near the source pill. When the bar completes (`coverage ≥ 0.95`), the **"All Caught Up"** celebration (§5.3.4/§5.5) fires — the single best UX-to-gamification bridge. No per-story auto-advance timers.

**Video / podcast (`content_type`).** **TechScroll never plays publisher media; it always hands off.** Video cards: still image full-bleed + prominent **▶ play overlay** → tap opens the publisher page in the in-app reader (their player/ads/analytics run). Podcast: 🎧 affordance + accent-colored waveform motif → link out to the episode page. One legally consistent rule (§7.5), immersion preserved (still a full-screen tap). `content_type` is derived best-effort (link pattern → WP `format` → RSS enclosure type), defaulting to `article`.

### 7.2 Coexistence — **recommendation: second tab, never replace**
- ✅ **Recommended: a dedicated "Doomscroll" tab** (iOS `MainTabView` / Expo `MainTabs` / a web mode toggle), sibling to Feed / Saved / Settings. The classic card feed remains the default browse/search/filter surface; doomscroll is the lean-back "one great thing at a time" mode.
- ↪️ **Also offer a fast entry** from the Feed top bar (a "play/immersive" affordance) that opens doomscroll **seeded at the current scroll position**.
- ❌ **Do not replace the card feed.** It owns discovery (categories, search, sort, saved); doomscroll owns immersion. Replacing it strands power users and breaks v1 CTA flows.

> **Lesson from Artifact (shut down 2024):** a beautiful immersive news feed is feasible, but its *retention loop* must carry it. That's exactly why doomscroll **ships alongside the Caught-Up score** — the progress deck gives an honest, closeable finish line instead of an infinite scroll.

### 7.3 Ties into the Caught-Up score (§5)
Both signals computed **on-device** from the stable `article.id` (no server round-trip):
- **Seen → coverage.** A card counts **seen** once it's the snapped page for **≥ 1.2 s** (debounce defeats fast flicks). Persist seen `article.id`s to a capped (~2,000, FIFO) on-device ring.
- **Link-out → depth.** A tap / CTA / right-rail open is the **strong** signal and the only way to move `depth` — you cannot max the score by scrolling.
- **Progress deck = the visible score.** The top segmented bar *is* today's coverage made tangible; completing it triggers the **"All Caught Up 🎉"** takeover. One source of truth powers the classic feed, doomscroll, and the website widget.

### 7.4 Per-platform implementation
**iOS** (`Features/Doomscroll/DoomscrollView.swift` + `DoomscrollCardView.swift`)
- **Paging:** `ScrollView(.vertical)` + `LazyVStack` with `.scrollTargetBehavior(.paging)` + `.containerRelativeFrame(.vertical)` per card (iOS 17+) — true paging *with* lazy loading, smoother than the rotated-`TabView(.page)` hack. Bind via `.scrollPosition(id: $currentArticleID)`; mirror the existing `.scrollTransition(.interactive, …)` from `FeedView.swift`.
- **Data:** consume the **same `FeedViewModel` / `appState.feed`** (`FeedServicing`); preserve `loadGeneration` + dedup-by-id. `APIFeedService.catalogURL` already requests `?limit=200` *"so the doomscroll feed has plenty of depth"* — pre-wired.
- **Image:** full-bleed `AsyncImage(url: article.mediaURL)` — our license-clean image at full resolution; `ShimmerView` loading, gradient fallback; decode off-main-thread, downsample to screen size.
- **Prefetch:** `ImagePrefetcher` keyed by `mediaURL` warms **±2 cards** via `URLSession`/`URLCache` (raise the disk budget in `TechScrollApp.swift`); trigger `loadMoreIfNeeded` at `currentIndex ≥ count − 3`.
- **Link-out:** CTA/tap presents `ArticleDetailView → SafariView` (`SFSafariViewController`) — unchanged.
- **Accent:** `accent_hex` → fallback `CIAreaAverage` downsample of the loaded `UIImage` to ~10×10, clamped mid-luminance, cached per `article.id`; composite over `Palette.background`, text white.

**Android — Expo / RN** (`src/screens/DoomscrollScreen.tsx`)
- **Paging:** `FlatList` (prefer **`@shopify/flash-list`** for memory) with `pagingEnabled`, `snapToInterval={screenHeight}`, `decelerationRate="fast"`, `disableIntervalMomentum`, `getItemLayout` (fixed `height = screenHeight`). Seen/accent via `onViewableItemsChanged` + `viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}`.
- **Data:** reuse `useFeedViewModel.ts` (`reload` / `loadMore` / `PAGE_LIMIT`, existing `loadGen` + dedup). Add a Doomscroll tab to `src/navigation/MainTabs.tsx`.
- **Image:** full-bleed **`expo-image`** `<Image contentFit="cover" transition={…}>` from `article.mediaURL` — our license-clean image at full resolution; `ShimmerView` fallback; `expo-linear-gradient` scrim.
- **Prefetch:** `Image.prefetch(urls)` ±2; `loadMore` at `count − 3`. Gestures via `react-native-gesture-handler`; save-burst via `react-native-reanimated`.
- **Link-out:** CTA/tap opens `ArticleDetailScreen` (`react-native-webview`) — unchanged.
- **Accent:** `accent_hex` → `react-native-image-colors` fallback, keyed by `article.id`; composite over `#0D0D12`.

**Website** (`index.html` / optional `doomscroll.html`)
- **Paging:** full-viewport vertical container with CSS scroll-snap — `scroll-snap-type: y mandatory`; panels `scroll-snap-align: start; height: 100dvh`. No JS paging lib. Add a **"Doomscroll" toggle** in `.controls` opening an `#doom` overlay/route.
- **Data:** reuse in-memory `state.all` + `render()`'s card-building; one item = an `article.card.feat`-style panel using `a.media_url` + `a.accent_hex`/`srcColor(a.source)`.
- **Image / accent:** `a.media_url` (license-clean); preserve `onerror="this.closest('.media').remove()"`; accent from `accent_hex` → `node-vibrant`/canvas-average; composite over `--bg`. Show `a.media_credit` when `media_kind === 'stock'`.
- **Seen:** `IntersectionObserver` (threshold 0.8, dwell ≥ 1.2 s) marks panel seen + recolors accent; persist seen `a.id` (`shortId`) to `localStorage` `techscroll.seen.v1` — the **same** set powering the web Caught-Up widget (§8).
- **Prefetch:** `<link rel="preload" as="image">` for next 2 panels; `loading="eager"` on current ±1; lazy-mount current ±2.
- **Link-out:** headline / CTA → `target="_blank"` to `article.link`.

### 7.5 Image compliance for full-bleed (light)
> Because the full-bleed image is **our own license-clean asset** (§4.0 / §6), full-bleed carries **no special legal risk** — render it full-resolution. Standing rules only: **(1)** show `media_credit` attribution when `media_kind == stock` (IR2); **(2)** label AI images as illustrations (IR1) and never generate a photoreal real person/event; **(3)** keep the **"Read on {Source} →"** link-out (good practice + drives publisher traffic). No counsel gate, no geo-gating, no kill-switch.

### 7.6 Performance budget

| Budget | Target | How |
|---|---|---|
| **Scroll** | **60 fps** sustained during snap-paging | Fixed-height layout (`getItemLayout` / `containerRelativeFrame`); paging snap; no layout thrash |
| **Image prefetch** | **± 2 cards** ahead of `currentIndex` | `ImagePrefetcher` / `expo-image` `prefetch` / `<link rel=preload>` |
| **Page prefetch** | Fetch next page at **`currentIndex ≥ count − 3`** | Existing `loadMoreIfNeeded` / `loadMore`; keep `limit ≈ 20` for instant first paint |
| **Render window** | Mount only **current ± 2** panels | `LazyVStack` (iOS) / FlatList windowing (RN) / lazy-mount+unmount (web) |
| **Decode** | Off-main-thread, **downsampled to screen size** | Never decode a 2000px image into a phone-width view |
| **Memory** | Bounded under continuous scroll | `flash-list` / windowed lists; cap on-device seen set at ~2,000 ids (FIFO) |
| **First paint** | Instant on tab open | `limit ≈ 20` first page; current card image eager, rest lazy |

### 7.7 Accessibility
- **Reduce Motion → in-tab static fallback, not a tab redirect.** When `isReduceMotionEnabled` / `prefers-reduced-motion` is set, **disable snap-paging + like-burst/particle/confetti** and render — **within the Doomscroll tab itself** — a static, **manually-advanced one-up view** (tap or a Next button advances; no animated snap), so the tab still shows what its label promises. Do **not** silently swap the tab for the Feed surface. (The classic card feed remains available on its own tab; doomscroll must never be the *only* path to content.)
- **VoiceOver / TalkBack / screen readers:** each card is one accessible element labeled **"{Source}, {timeAgo}: {headline}. Category {x}."** Right-rail actions carry explicit labels ("Save article," "Share," "Open on {Source}"). The deck announces **"Story 12 of 37."**
- **Tap targets ≥ 44pt (iOS) / 48dp (Android)** for right-rail + CTA.
- **Contrast:** the bottom scrim guarantees white-on-image legibility; never tint the text itself — only the wash behind it. Honor Dynamic Type where layout allows.
- **Captions/affordances** for video/podcast (▶ / 🎧) are labeled, not color-only.

### 7.8 Acceptance criteria → see §17.

---

## 8. Feature: Website (Gamification + Doomscroll + Shared API)

> **Surface:** `index.html` (self-contained Vercel static app + inline vanilla JS) and the `/api/*` serverless layer. **API base:** `https://techcrunch-articles-listing-by-keyw.vercel.app`
> **One-liner:** Bring the gamified **Caught-Up** loop and an immersive **Doomscroll** mode to the web — and ship the **shared backend** that all three clients consume.

The web is the lightest place to land v2: `index.html` **already renders a card image** (`.card .media img`), already brands itself "doomscrollable," already carries the takedown disclaimer in the footer, and already holds the full article set in memory (`state.all`). v2 on web = **two new client surfaces (score + doomscroll)**, swapping the card image to the license-clean **`media_url`** (§6), plus the **shared API additions** that unblock A–D on iOS and Android.

### 8.1 What changes in `index.html` (reuses existing tokens — no new palette)

| # | Add / Modify | Detail |
|---|---|---|
| W1 | **Caught-Up widget** (header/`.results-head`) | Small SVG ring + `%` + 🔥 streak. Computed **client-side** from `state.all` vs a `localStorage` seen-set. `--grad` stroke over `--bg`. Matches the "doomscrollable" header voice. |
| W2 | **"All caught up!" state** | Trigger (§5.3.4) → full-width banner/takeover: ring completes (CSS `stroke-dashoffset` spring), tiny `<canvas>` confetti in `--grad`, copy **"You're all caught up 🎉"** + stat line. Reuses the existing `"You're all caught up"` copy. |
| W3 | **Doomscroll mode** (`#doom` overlay/route) | Full-viewport takeover, one story/screen, `scroll-snap-type: y mandatory` + `scroll-snap-align: start; height: 100dvh`. Each panel = full-bleed **`a.media_url`** (our license-clean image), `--bg` base, bottom scrim, headline, source pill, per-card accent from `a.accent_hex` (→ `srcColor(a.source)` fallback). Reuses `render()`; same `/api/articles`/`state.all`. |
| W4 | **Doomscroll toggle** (`.controls`) | A "Doomscroll" button enters/exits the overlay; lazy-mounts current ±2 panels. |
| W5 | **License-clean media** | Render **`a.media_url`** (AI illustration / free-stock / gradient, §6) — **not** the publisher `image`/`thumbnail`. Show `a.media_credit` when `media_kind === 'stock'`; label AI as "illustration". Preserve `onerror` → monogram fallback. **No policy gate** (none exists). |
| W6 | **Link-out on click** | Tap anywhere on a doomscroll card → `a.link` (`target="_blank"`) — preserves publisher ads/paywall/analytics. Card is a *trailer*; publisher page is the *payoff*. |
| W7 | **`IntersectionObserver` seen-tracking** | One shared observer (threshold 0.8, dwell ≥ 1.2 s) marks a panel "seen," recolors accent, feeds **both** the doomscroll deck and the Caught-Up score — one source of truth (W1/W3). |

**Doomscroll layer stack (web), bottom-up:** full-bleed `a.media_url` → `accent_hex`/`srcColor` color wash (~30%) → bottom scrim (`transparent → rgba(0,0,0,.85)`) → content overlay (source pill + `timeAgo`, headline, "Read on {source} ↗" CTA, `media_credit` when stock, ▶/🎧 chip when `content_type !== "article"`).

> **Attribution (§4):** render `a.media_credit` over stock photos and an "illustration" label on AI images; the `onerror` → monogram path already exists, so a missing image degrades gracefully. **No kill-switch / geo-gating** — the imagery is license-clean (§4.0).

### 8.2 Tracking "seen / read" without heavy auth (localStorage-first)
Privacy-clean, account-optional, fully offline-in-browser — mirrors the on-device model used on iOS/Android.
- **Seen set:** `localStorage` `techscroll.seen.v1`, keyed by the web's `a.id` = the API's stable **`shortId(link)`**. FIFO-capped ~2,000. ⚠️ This `shortId` is the **canonical wire id** for any cross-client sync (§9/§12.4): iOS and Expo use *different* local ids (MD5-UUID and raw-link), so a sync payload must map each local id → `shortId` before upload.
- **Read set:** a separate key records ids the user **link-outed** on (gates the `depth` term).
- **Denominator:** `available` (`A`) = recency-weighted count of fresh articles **in the user's selected categories**, computed **client-side** by filtering the **all-category** counts from `GET /api/availability` (§8.3-1) — or derived from `state.all` — down to the selected set. The endpoint returns *all* categories (it's shared/edge-cached, never per-user); the browser filters locally.
- **Score formula (shared with apps):** `100 * (0.55·coverage + 0.30·depth + 0.15·breadth)`, capped at 100 (`depth` needs `S ≥ 3`); **"All caught up"** fires on **`coverage ≥ 0.95` alone** (or `A = 0`); `CaughtUp% ≥ 90` is the separate "Perfect Day"; `depth` means **no 100 by scrolling alone**.
- **Streak + reset:** daily reset at local midnight; streak in `localStorage` `techscroll.streak.v1`.
- **Optional account sync (opt-in):** if/when a lightweight web account exists, sync **aggregates only** via `POST /api/read-events` (§8.3-2) — **never** the list of articles read; gated behind a toggle; feature works fully without it.

### 8.3 Shared backend / API additions (consumed by ALL three clients)
Live in the Vercel serverless layer (`api/*.js`, `lib/feeds.js`, `lib/media.js`, `vercel.json`), following `articles.js` / `keywords.js` / `subscribe.js`. The additions serve the **media layer (B/D)**, the **score (A/E)**, and a **DMCA backstop (C)**. (Full consolidation in §10.)
1. **Score denominator — `GET /api/keywords` (confirmed) + `GET /api/availability` (new).** `/api/keywords` already returns `total_articles` + per-source/region/section/keyword counts. Add `/api/availability` that runs `collectArticles()` and buckets by the **app taxonomy** → `{ category: count, window: "24h" }` for **all categories** (never user-filtered — clients filter to selected categories locally, §8.2). To avoid taxonomy drift, `classify()` becomes a **single shared module** consumed by both the serverless layer and the clients (or the server owns the taxonomy and clients read `categories[]` off each article — pick one, §10.1). Edge-cacheable (`s-maxage=600`).
2. **`POST /api/read-events` (optional, deferred — needs auth, §10.1.1).** `{ deviceToken, articleIds[], openedIds[], seenAt }`, where `articleIds` are **canonical `shortId`s** (§12.4). Authorized by a **server-issued anonymous device token** (never a client-supplied `userId`) → Vercel KV (`LPUSH`, `console.log` fallback, like `subscribe.js`). **`Cache-Control: private, no-store`.**
3. **`GET /me/stats` (optional, deferred — needs auth, §10.1.1).** Authorized on the **device token** (not a client-supplied `userId`); returns `{ caughtUpScore, currentStreakDays, longestStreakDays, lastCaughtUpAt, totalXP, perCategoryProgress }` (`perCategoryProgress` keyed by the canonical taxonomy, §12.4). CORS `*`, **`private, no-store`**.
4. **Media-resolution pipeline** (`lib/media.js`, §6.2) — generates/fetches a license-clean `media_url` (+ `media_kind`, `media_credit`, `media_srcset`) per article and hosts it on Vercel Blob / S3 / our CDN; edge-cached like other content.
5. **DMCA backstop** (§4.5-1) — surface the registered agent on `privacy.html`/`support.html` (strengthen the footer disclaimer, `support@techscroll.app`).
6. **AI-image moderation** (§4.5-3) — provider safety filter + blocklist before caching generated imagery.

> **Caching (critical):** the article feed is edge-cached **10 min** (`s-maxage=600`, set per-handler via headers, not `vercel.json`) — keep for `/api/articles`, `/api/keywords`, `/api/availability`. **Personalized endpoints (`/api/read-events`, `/me/stats`) must NOT inherit edge caching** — `Cache-Control: private, no-store` so one user's score is never served to another.

### 8.4 Design-token reuse (web)

| Use | Token |
|---|---|
| Base / panels | `--bg #070a0e`, `--panel #0f151d`, `--panel-2 #141c26` |
| Caught-Up ring + "All caught up" + CTA glow | `--accent #00e08a`, `--grad linear-gradient(120deg,#00e08a,#34c5ff,#a98bff)` |
| Doomscroll per-card accent | `SOURCE_COLORS` (`techcrunch #00d26a`, `wired #e6e6e6`, `the verge #fa4d56`, `ars technica #ff5a00`) |
| Text / muted | `--txt #eef3f8`, `--txt-2 #c4ced9`, `--mut #93a0b0` |
| Radius / shadow | `--radius 16px`, `--shadow 0 18px 50px -20px rgba(0,0,0,.85)` |

No new tokens introduced — web parity is achieved entirely with the existing `:root` vars.

### 8.5 Acceptance criteria → see §17.

---

## 9. Cross-Platform Parity Matrix

| Feature | iOS (SwiftUI) | Android (Expo RN) | Web (`index.html`) | Backend | Status |
|---|---|---|---|---|---|
| **A/E — Caught-Up score + streak** | `CaughtUpRingView` + `ReadTrackingService` (SwiftData `ReadEvent`) | `CaughtUpRing` + `ReadEventsContext` (`AsyncStorage` `ts.reads.v1`) | SVG ring + `localStorage` `techscroll.seen.v1` | `/api/availability`; optional `/api/read-events`, `/me/stats` | **Planned — ships first (no legal gate)** |
| **"All caught up!" celebration** | `AllCaughtUpView` + `Haptics.success` + `brandGradient` confetti | Reanimated confetti + `expo-haptics` | `<canvas>` confetti + `--grad` banner | — | Planned |
| **B — Article imagery (license-clean)** | `AsyncImage(url: mediaURL)` + gradient fallback | `expo-image` `mediaURL` + gradient fallback | render `a.media_url` (replaces publisher image) | **media-resolution pipeline** → `media_url` / `media_kind` / `media_credit`, hosted by us | **Planned — no legal gate (decoupled, §4.0)** |
| **D — Doomscroll** | New `DoomscrollView` (`.scrollTargetBehavior(.paging)`) | New `DoomscrollScreen.tsx` (`FlatList`/`flash-list` `pagingEnabled`) | New `#doom` overlay (CSS `scroll-snap`) | full-bleed `media_url` (license-clean) | **Planned — full-bleed safe (image is ours, §4.0)** |
| **Seen tracking** | dwell ≥ 1.2 s, `@AppStorage`/SwiftData ring | dwell ≥ 1.2 s, `AsyncStorage` | dwell ≥ 1.2 s, `IntersectionObserver` + `localStorage` | — | Planned |
| **Link-out preserved** | `SFSafariViewController` (`SafariView`) | `react-native-webview` (`ArticleDetailScreen`) | `target="_blank"` → `a.link` | — | ✅ Existing — must be preserved |
| **Stable article id** | `UUID(stableFrom: link)` (MD5) | raw `link` string | `shortId(link)` hash | **Canonical wire id = server `shortId`** | ✅ Deterministic per client; **any sync maps local id → `shortId`** before upload (§12.4) |
| **Score denominator** | `/api/availability` (or local `state`) | `/api/availability` (or local `state`) | `/api/keywords` counts / `state.all` | `/api/availability` | Planned |
| **Media pipeline + attribution + DMCA backstop** | renders `mediaCredit` / illustration label | renders `mediaCredit` / illustration label | renders `media_credit` / illustration label | `lib/media.js` generate/fetch + host; DMCA agent registered | **Planned** |
| **Score persistence** | On-device (offline-first); opt-in sync | On-device (offline-first); opt-in sync | `localStorage`; opt-in account sync | KV (opt-in only) | Planned |
| **Per-card accent** | `accent_hex` → `CIAreaAverage` fallback | `accent_hex` → `react-native-image-colors` fallback | `accent_hex` → `node-vibrant`/canvas fallback | `accent_hex` in `scrape.py` — **required Phase 0** | Planned |

---

## 10. Shared Backend & API Changes (consolidated)

All additions follow existing `articles.js` / `keywords.js` / `subscribe.js` patterns. **No backend change is required for images (B) or doomscroll (D)** — `image` + `thumbnail` already flow end-to-end. The additions serve the score (A/E), the per-card accent, and the legal guardrails (C).

### 10.1 New / changed endpoints

| Endpoint | Method | Purpose | Caching |
|---|---|---|---|
| `/api/articles` | GET | **Add per-article `media_url`, `media_kind`, `media_credit`, `media_srcset`, `accent_hex`/`accent_is_dark`** (from the media pipeline, §6.2). **No `policy` block.** | `s-maxage=600` |
| `/api/keywords` | GET | **Confirmed denominator source** — `total_articles` + per-source/region/section/keyword counts. No change. | `s-maxage=600` |
| `/api/availability` | GET | **NEW.** Runs `collectArticles()`, buckets by the **canonical app taxonomy** (shared `classify()` module, §8.3-1) → `{ category: count, window: "24h" }` for **all** categories. The score denominator, **not user-specific** (clients filter to selected categories locally). | `public, s-maxage=600, stale-while-revalidate=1800` + CORS `*` |
| `/api/read-events` | POST | **NEW (optional, deferred — §10.1.1 auth).** `{ deviceToken, articleIds[] (canonical `shortId`), openedIds[], seenAt }` → Vercel KV `LPUSH "techscroll:reads:<deviceId>"` (deviceId from the **verified token**, never a client `userId`), `console.log` fallback (mirrors `subscribe.js`). Cross-device sync only. | **`Cache-Control: private, no-store`** + CORS `*` |
| `/me/stats` | GET | **NEW (optional, deferred — §10.1.1 auth).** Authorized on the device token; `{ caughtUpScore, currentStreakDays, longestStreakDays, lastCaughtUpAt, totalXP, perCategoryProgress (canonical-taxonomy keys, §12.4) }`. | **`Cache-Control: private, no-store`** + CORS `*` |

### 10.1.1 Auth for personalized endpoints (gates `/api/read-events` + `/me/stats`)
v2 ships **no account system**, so these endpoints must **not** trust a client-supplied `userId` — anyone could read or overwrite another user's stats. Minimum model: on the first sync opt-in, the client requests an **anonymous opaque device id + a server-issued signed token** (HMAC/JWT signed with a server secret); every read/write authorizes on that token and KV is keyed by the **verified** device id, never a value the client names. **Until this is built, both endpoints stay deferred** (not part of v2 "done", §3.2) — the on-device score is fully functional without them, so this is a fast-follow, not a v2 blocker. **Conflict resolution (when sync exists):** on-device state **wins by default** for the current day; `longestStreakDays` and `totalXP` are **max-merged** across devices; `streak_broken`/`streak_incremented` reconcile to the on-device value, never the server's.

### 10.2 `lib/media.js` — the media-resolution pipeline (server-side once, all clients inherit)
- **Generate or fetch** a license-clean image per article (AI illustration primary → free-stock/CC fallback), **host** it at 2–3 sizes (Vercel Blob / S3 / CDN) → `media_url` + `media_srcset`; record `media_kind` + `media_credit`. Idempotent, keyed by the stable article id, computed once, edge-cached (§6.2).
- **IR1/IR3 enforcement:** the AI prompt forbids photoreal real people/events and tags output as "illustration"; provider safety filter + blocklist (§4.5-3); provenance stored in `media_kind`/`media_credit`.
- **`accent_hex` (required Phase 0 deliverable)** computed in the pipeline from the chosen `media_url` (downscale 16×16, average, bump saturation) → zero client cost, identical across platforms, edge-cached. Per-client extraction (`CIAreaAverage` / `react-native-image-colors` / `node-vibrant`) is the **fallback**, so the doomscroll color system (§7.1) is defined on day one.
- **`lib/feeds.js`** retains only a per-source **`text`** toggle to drop a misbehaving *feed* (no image kill-switch — there is no third-party image).

### 10.3 Caching rules (must-hold invariants)
- Edge-cached endpoints keep `s-maxage=600`: `/api/articles` (incl. `media_url`), `/api/keywords`, `/api/availability`.
- **No personalized endpoint is edge-cached:** `/api/read-events`, `/me/stats` → `private, no-store` (never serve one user's pulse to another).
- **No region-varied policy and no geo-gating** — the same `/api/articles` body (with license-clean `media_url`) is served everywhere; nothing to region-split.

### 10.4 Media hosting & moderation
License-clean images are hosted on **Vercel Blob / S3 / our CDN** (we hold rights to all of them) at 2–3 responsive sizes, served globally with **no geo restriction**. AI output passes a **safety filter + blocklist** before caching (§4.5-3). A **DMCA agent** is registered as a backstop (§4.5-1) even though imagery is license-clean and text is headline-only.

---

## 11. Consolidated Functional Requirements

| ID | Requirement | Feature | Platforms | Priority |
|---|---|---|---|---|
| FR-100 | On-device seen-tracking (≥ 1.2 s **contiguous foreground** dwell; timer pauses on background/blur) keyed off the stable article id | A/D | iOS, Android, Web | P0 |
| FR-101 | On-device opened/link-out tracking (gates `depth`) | A/D | iOS, Android, Web | P0 |
| FR-102 | Caught-Up score per §5.3.3 (capped 100; `depth` needs `S≥3`; `A=0`→N/A/caught-up). **"All Caught Up" fires on `coverage ≥ 0.95` alone**; `CaughtUp% ≥ 90` is the separate "Perfect Day" state | A | iOS, Android, Web | P0 |
| FR-103 | Daily reset at local midnight; ring empties and recomputes | A | iOS, Android, Web | P0 |
| FR-104 | Recency weight `0.5^(ageHours/12)`; rolling 24h default window | A | iOS, Android, Web | P0 |
| FR-105 | Streak increments on goal (All-Caught-Up `coverage≥0.95` **or** read-gated floor `coverage≥0.6 AND O≥1`); one freeze/week; `A=0` auto-freezes | A | iOS, Android, Web | P1 |
| FR-106 | XP / Tech Pulse Level (cumulative) + milestone bonuses | A | iOS, Android, Web | P1 |
| FR-107 | Collectible badges (Early Bird, Completionist, Polymath, Marathon, Deep Diver) | A | iOS, Android, Web | P2 |
| FR-108 | "All Caught Up" celebration (confetti + success haptic + stat line) | A | iOS, Android, Web | P1 |
| FR-109 | Profile screen (ring hero, streak/level, per-category breakdown, badges, history, privacy/sync) | A | iOS, Android, Web | P0 |
| FR-110 | Per-category breakdown tinted by category accent | A | iOS, Android, Web | P1 |
| FR-111 | `GET /api/availability` — **all-category** counts (shared `classify()` taxonomy), edge-cached; clients filter to selected categories locally | A | Backend | P0 |
| FR-112 | **Deferred fast-follow:** `POST /api/read-events` + `GET /me/stats` (device-token auth §10.1.1, canonical `shortId`, aggregates only, `private, no-store`) — **not** required for v2 "done" | A | Backend | P2 |
| FR-113 | Score computed on-device by default; cloud sync opt-in, aggregates only | A | iOS, Android, Web | P0 |
| FR-200 | Media-resolution pipeline produces a license-clean `media_url` (+ `media_kind`, `media_credit`, `media_srcset`) per article: AI illustration primary → free-stock/CC fallback → gradient final | B | Backend | P0 |
| FR-201 | Clients render `media_url` (**never** the publisher `image`/`thumbnail`); gradient/monogram on missing/failed | B | iOS, Android, Web | P0 |
| FR-202 | We host our own license-clean images (Vercel Blob/S3/CDN); publisher images are never displayed or hotlinked | B/C | Backend | P0 |
| FR-203 | Attribution: render `media_credit` when `media_kind==stock`; label AI as "illustration" (IR1/IR2, lint-level invariant) | B/C | iOS, Android, Web | P0 |
| FR-204 | Gradient/monogram fallback on missing/failed image (never broken/empty) | B | iOS, Android, Web | P0 |
| FR-205 | Downsample images to display size; off-main-thread decode; prefetch ±2 | B/D | iOS, Android, Web | P1 |
| FR-206 | AI-image moderation: provider safety filter + blocklist; generation prompt forbids photoreal real people/events (IR1) | C | Backend | P0 |
| FR-207 | `accent_hex` computed server-side from `media_url` (per-client extraction is the fallback) | B/D | Backend | P1 |
| FR-208 | Provenance recorded per image: `media_kind` (ai\|stock\|gradient) + `media_credit` license/attribution (IR3) | B/C | Backend | P0 |
| FR-209 | Reduced-data toggle (+ `saveData`) drops to the gradient tile | B | iOS, Android, Web | P2 |
| FR-210 | Update in-app legal copy (`termsOfServiceText`/`privacyPolicyText`, `StaticTextScreen.ts`, web footer): headlines + links; images are AI/licensed-stock we host | B/C | iOS, Android, Web | P1 |
| FR-211 | DMCA designated agent registered (backstop); contact in Settings + `privacy.html`/`support.html` | C | Backend/Process | P1 |
| FR-300 | Doomscroll surface: full-screen, one story at a time, hard vertical snap-paging | D | iOS, Android, Web | P0 |
| FR-301 | Doomscroll as a **separate opt-in surface** (dedicated tab/toggle); never replaces the card feed | D | iOS, Android, Web | P0 |
| FR-302 | Fast entry from Feed top bar seeded at current scroll position **(iOS/Android only — web has no equivalent paged scroll position to seed; web uses the §8.1 W4 `.controls` toggle)** | D | iOS, Android | P2 |
| FR-303 | Card Z-stack: full-bleed image → color wash → scrims → content overlay → right-rail actions | D | iOS, Android, Web | P0 |
| FR-304 | Locked gesture set (swipe up/down, pull-refresh, tap=open, double-tap=save, long-press menu) | D | iOS, Android | P0 |
| FR-305 | Segmented "session deck" progress bar where **N = the §5.3 availability count `A`** (decoupled from pagination); completion (`coverage≥0.95`) fires the celebration | D | iOS, Android, Web | P1 |
| FR-306 | Per-card accent from `accent_hex` (→ client fallback) drives wash/progress/save-burst | D | iOS, Android, Web | P1 |
| FR-307 | Link-out preserved from doomscroll (Safari VC / WebView / new tab); sets `openedAt` | D | iOS, Android, Web | P0 |
| FR-308 | Video/podcast cards hand off (never play publisher media inline) | D/C | iOS, Android, Web | P0 |
| FR-309 | Full-bleed renders the license-clean `media_url` at **full resolution** (safe — it's ours) | D | iOS, Android, Web | P0 |
| FR-310 | Source attribution + `media_credit` (stock) / "illustration" label (AI) on every full-bleed card | D/C | iOS, Android, Web | P0 |
| FR-311 | No per-source image kill-switch / geo-gating for full-bleed (decoupled license-clean image, §4.0) | D | Backend, all clients | P0 |
| FR-312 | 60 fps snap-paging; render window current ±2; page prefetch at `count−3` | D | iOS, Android, Web | P1 |
| FR-313 | Reduce-Motion disables snap/particles → standard-list fallback; full a11y labels + "Story X of N" | D | iOS, Android, Web | P0 |
| FR-314 | Doomscroll reuses existing feed VM/data path (`loadGeneration`/`loadGen` + dedup preserved) | D | iOS, Android | P1 |
| FR-400 | Each client keys seen/read/bookmark off its **deterministic local id**; the **canonical wire id for any cross-client sync is the server `shortId`**, with clients mapping local→`shortId` before upload (§12.4) | A/B/D | iOS, Android, Web | P0 |
| FR-401 | Add `media_url`/`media_kind`/`media_credit` fields on every platform; publisher `image`/`thumbnail` stay **not-for-display** | B | iOS, Android, Web | P0 |
| FR-402 | Publisher `image`/`thumbnail`/`author`/`dek`/`summary` remain not-for-display by default | B/C | iOS, Android, Web | P0 |

---

## 12. Data-Model Changes (consolidated)

### 12.1 iOS — `Models/Article.swift` (add media fields), `Models/UserProfile.swift` (extend), new `Core/Persistence/ReadEvent.swift`
```swift
// Models/Article.swift — ADD license-clean media fields; publisher image stays not-for-display.
/// License-clean image we host (AI illustration / free-stock / gradient). THIS is what the UI renders.
var mediaURL: URL?
enum MediaKind: String, Codable { case ai, stock, gradient }
var mediaKind: MediaKind = .gradient
var mediaCredit: String?           // license + attribution; rendered when mediaKind == .stock
// Publisher fields retained for fidelity but NEVER displayed (the v1 prohibition stands):
var imageURL: URL?                 // publisher CDN — not rendered
var thumbnailURL: URL?             // publisher CDN — not rendered

// Models/UserProfile.swift — ADD gamification state (existing fields unchanged):
struct UserProfile: Codable, Identifiable, Hashable {
    let id: UUID
    var displayName: String?
    var email: String
    var interests: [NewsCategory]
    // NEW:
    var caughtUpScore: Int                 // 0–100, today
    var currentStreakDays: Int
    var longestStreakDays: Int
    var lastCaughtUpAt: Date?
    var totalXP: Int
    var perCategoryProgress: [String: Double]   // KEY = canonical classify() taxonomy id (the wire contract), NOT NewsCategory.rawValue; map local enum → canonical on sync (§12.4)
}

// NEW Core/Persistence/ReadEvent.swift (@Model, SwiftData — mirrors SavedArticle.swift):
@Model final class ReadEvent {
    @Attribute(.unique) var articleId: UUID   // == UUID(stableFrom: canonicalLink) — NEVER Hasher
    var category: String
    var seenAt: Date
    var openedAt: Date?                        // non-nil = link-out (counts toward depth)
}
```
> ⚠️ `articleId` **must** be the deterministic `UUID(stableFrom:)` (MD5 of canonical link) used in `Article.swift` — so "seen" survives refresh and matches the bookmark id. `SavedArticle` gains `mediaURLString`/`mediaKind`/`mediaCredit` (lightweight SwiftData migration).

### 12.2 Android/Expo — `src/models/article.ts` (add media fields), `src/models/user.ts` (extend), new `ReadEventsContext`
```ts
// src/models/article.ts — ADD mediaURL: string|null, mediaKind: 'ai'|'stock'|'gradient', mediaCredit?: string
//   (set by feedService.ts mapArticle). Publisher imageURL/thumbnailURL retained but NOT displayed.

// src/models/user.ts — extend UserProfile:
export interface UserProfile {
  id: string;
  displayName?: string | null;
  email: string;
  interests: CategoryKey[];
  // NEW:
  caughtUpScore?: number;                 // 0–100, today
  currentStreakDays?: number;
  longestStreakDays?: number;
  lastCaughtUpAt?: number;                // epoch ms
  totalXP?: number;
  perCategoryProgress?: Record<string, number>; // KEY = canonical classify() taxonomy id (wire contract); coverage 0…1 — map CategoryKey → canonical on sync (§12.4)
}

// NEW persisted shape (ReadEventsContext, AsyncStorage key `ts.reads.v1`, mirrors BookmarkContext `ts.bookmarks.v1`):
interface ReadEvent { articleId: string; category: CategoryKey; seenAt: number; openedAt?: number }
```
> ⚠️ In Expo, `article.id` = the raw canonical `link` string (not MD5). `ReadEvent.articleId` **must** use this same id so reads match `BookmarkContext` keys.

### 12.3 Website
No model files. Persist a `Set` of seen `a.id` (the `shortId` DJB-hash) in `localStorage` (`techscroll.seen.v1`); a separate read set; streak in `techscroll.streak.v1`. Denominator from `state.all` / `/api/keywords` per-bucket counts.

### 12.4 Shared article contract (all clients — v2 adds license-clean media fields)
```
{ id (stable shortId hash of link), title, link, source, source_id, region, focus,
  content_type (article|video|podcast), author, published (ISO8601 UTC),
  image, thumbnail,            // publisher CDN — retained for fidelity, NOT displayed
  section, categories[], summary,
  // v2 additions (server, from lib/media.js):
  media_url, media_kind (ai|stock|gradient), media_credit?, media_srcset,
  accent_hex?, accent_is_dark? }
```
Decoders: iOS `APIFeedService.APIArticle → Article` (`id = UUID(stableFrom: link)`); Expo `feedService.ts ApiArticle → Article` (`id = link`); Web uses the raw object. All clients render **`media_url`** (not `image`/`thumbnail`).

> **Canonical wire id & taxonomy (the cross-client contract).** The three local ids differ **by design** (MD5-UUID / raw `link` / `shortId`) and each is fine for *local* seen/read/bookmark keys. But anything that crosses the wire — `/api/read-events`, `/me/stats`, any cross-device compare — uses the server's **`shortId(link)`** as the single canonical id; each client maps its local id → `shortId` before upload. Likewise `perCategoryProgress` keys are the canonical **`classify()` taxonomy** on the wire, mapped from each client's local category enum. This is what makes FR-400 satisfiable despite three id schemes.

---

## 13. Design & UX notes (reuse existing tokens; per-platform)

> **No new palettes.** Each platform reuses its own existing tokens; **token drift between iOS and Expo is intentional and documented** — spec each target against its own values. **Parity (§9) means *behavioral / feature* parity, explicitly *not* pixel-identical theming** — a reviewer should not file token drift as a parity defect.

**iOS** (`Core/DesignSystem/Theme.swift`) — `background (0.035,0.04,0.07)`, `surface (0.10,0.10,0.13)`, `accent (0.40,0.62,1.00)`, `accentSecondary` violet, `accentTertiary` cyan, `success (0.30,0.80,0.45)`; `brandGradient` cyan→blue→violet; `placeholderGradient(for:)` (image fallback); typography `tsLargeTitle/tsTitle/tsHeadline/tsCardTitle/tsBody/tsCaption/tsTag`; spacing `xs4…xxl48`; radius `sm10…pill999`; per-category `NewsCategory.accentColor`. Reuse `ScreenBackground`, `.glassCard()`, `.glow(_:)`, `PrimaryButton`, `CategoryChip/Tag`, `SourceAvatar`, `EmptyStateView`, `ShimmerView`, `.toast(_:)`, `Haptics`.

**Android/Expo** (`src/theme/theme.ts`) — ⚠️ **drift:** `background #0D0D12` (vs iOS `(0.035,0.04,0.07)`), `accent #669EFF`, `success #4DCC73`, category accents in `category.ts` (`ai #8C5CF5`, `security #E64D73`). Same spacing/radius/type scale. Reuse `ScreenBackground`, `PrimaryButton`, `SourceAvatar`, `ShimmerView`, `Toast`, `Icon.tsx`, `haptics.ts`, `expo-linear-gradient`.

**Web** (`index.html` `:root`) — DIFFERENT palette: `--bg #070a0e`, `--accent #00e08a`, `--accent-2 #34c5ff`, `--accent-3 #a98bff`, `--grad`, `--radius 16px`, `--shadow`; per-source `SOURCE_COLORS`. Reuse `render()`, `thumb()`, skeletons, scroll-progress topbar, the featured `article.card.feat` hero.

**Shared UX principles:** dark-first; white text over scrims, never tinted; ≥44pt/48dp tap targets; Dynamic Type / large-text; Reduce-Motion fallbacks; link-out is always the "payoff," surfaced as a feature ("Read on {Source} →"); reuse in-product copy `"You're all caught up"` and the `"doomscrollable"` brand voice for continuity.

---

## 14. Analytics & Instrumentation (new v2 events)

> Product analytics = **aggregate funnel only**, distinct from per-event reading logs which stay **on-device**.

**Gamification (A/E)**

| Event | Properties |
|---|---|
| `profile_opened` | `entry_point` (feed_avatar \| settings \| tab) |
| `caught_up_score_viewed` | `score`, `coverage`, `depth`, `breadth`, `categories_count` |
| `all_caught_up_reached` | `top_category`, `stories_seen`, `articles_opened`, `time_to_caught_up_min` |
| `streak_incremented` | `streak_days`, `hit_via` (all_caught_up \| floor_60) |
| `streak_freeze_used` | `streak_days`, `freezes_remaining` |
| `streak_broken` | `previous_streak_days` |
| `level_up` | `new_level`, `total_xp` |
| `badge_earned` | `badge_id` |
| `cloud_sync_toggled` | `enabled` |
| `morning_nudge_opt_in` | `granted` |
| `availability_fetch_failed` | `fallback` (local) — denominator-source drift guard |
| `score_denominator_source` | `source` (api \| local) |

**Images (B)**

| Event | Properties |
|---|---|
| `image_render` | `source_id`, `media_kind` (ai\|stock\|gradient), `surface` (card/saved/fullbleed), `from_cache` |
| `image_load_fail` | `source_id`, `media_kind`, `reason` (404/timeout/decode) |
| `image_fallback_shown` | `source_id`, `reason` (no_media_url/load_fail/save_data) → gradient |
| `media_resolved` (server) | `media_kind`, `gen_ms` — how each article got its image (AI vs stock vs gradient mix + cost) |
| `reduced_data_skip` | `surface` |

> `media_resolved` shows the AI/stock/gradient mix and generation cost; a spike in `image_fallback_shown{reason:load_fail}` flags a CDN/storage issue. `image_render.from_cache` = an **on-device** image-cache hit (`URLCache` / `expo-image` disk / browser cache). No compliance-audit events are needed — the imagery is **license-clean** (§4.0), with provenance carried in `media_kind`/`media_credit`.

**Doomscroll (D)**

| Event | Properties |
|---|---|
| `doomscroll_entered` | `entry_point` (tab \| feed_topbar), `seeded_index` |
| `doomscroll_card_seen` | `source_id`, `category`, `dwell_ms` |
| `doomscroll_link_out` | `source_id`, `via` (tap \| cta \| right_rail) |
| `doomscroll_save` | `source_id`, `via` (double_tap \| right_rail) |
| `doomscroll_session_end` | `cards_seen`, `link_outs`, `duration_s`, `reached_deck_end` |

---

## 15. Milestones & Phases (dependency-aware)

> **Dependency rules:** (1) The **decoupled image strategy (§4.0) removes the legal gate** — images (B) and full-bleed (D) ship on the **normal track**; no counsel sign-off blocks go-live. (2) The **media-resolution pipeline (Phase 1)** is built first so B/D have a `media_url` to render. (3) The **Caught-Up score (A/E) ships first**, gated only by the (optional) `/api/availability` denominator. (4) The score's `depth` term is exercised by the **existing v1 card-feed link-outs**, so Phases 2–3 are testable **before** images/doomscroll exist.

| Phase | Deliverable | Depends on | Key skill(s) |
|---|---|---|---|
| **L. Legal & compliance** (parallel, light) | Confirm the decoupled strategy with counsel; register DMCA agent (backstop); finalize AI-prompt IR1 rules + the free-stock/CC library license list (IR2); update in-app legal copy | — | — |
| **0. Backend foundations** | `GET /api/availability` (app-taxonomy denominator); media storage (Vercel Blob/S3/CDN) + image-model/stock-API access provisioned; caching invariants verified | — | `vercel:vercel-functions` |
| **1. Media pipeline (server)** | `lib/media.js`: AI-generate / stock-fetch + host license-clean images → `media_url`/`media_kind`/`media_credit`/`media_srcset` + `accent_hex` on `/api/articles`; moderation (IR1/IR3) | 0 | `vercel:vercel-functions` |
| **2. Score model + on-device tracking** | Shared seen/opened model; `CaughtUp%` formula + reset/streak/XP/badges; `ReadEvent`/`ReadEventsContext`/`localStorage` | 0 | — |
| **3. Profile + celebration (A/E)** | `ProfileView` / `ProfileScreen` / web widget; ring, streak, breakdown, badges, "All Caught Up" takeover | 2 | `swiftui-pro`, `vercel:react-best-practices` |
| **4. Imagery build (B)** | Render `media_url` on card/saved (`AsyncImage`/`expo-image`/`<img>`); `media_credit`/illustration attribution (lint invariant); gradient fallback; `URLCache`/`srcset`; reduced-data | 1 | `swiftui-pro`, `app-store-preflight-skills` |
| **5. Doomscroll build (D)** | `DoomscrollView` / `DoomscrollScreen` / `#doom`; full-bleed `media_url`; paging, accent, scrims, right-rail, progress deck wired to A; link-out preserved | 1, 2 | `swiftui-pro`, `building-native-ui` |
| **6. Cross-platform parity + perf/a11y** | 60 fps snap; Reduce-Motion fallbacks; VoiceOver/TalkBack labels; token-drift compliance; offline-first score | 3, 4, 5 | `swiftui-pro` |
| **7. Submission prep** | Updated in-app legal copy (AI/licensed-stock images we host + link-out); DMCA contact published; App-Store/Play preflight (imagery ships enabled — it's our own assets) | 4, 5 | `app-store-preflight-skills` |
| **8. Ship & monitor** | Release with imagery enabled (no gate — license-clean); monitor `media_resolved` mix, `image_fallback_shown`, generation cost; tune AI/stock balance per section | 7 | — |
| **9. Growth** | Images-uplift holdback, doomscroll adoption, streak-retention dashboards; listing refresh | 8 | `aso-audit`, `apple-search-ads` |

**Suggested timeline (solo/small team):** ~6–8 weeks of engineering across Phases 0–6; Phase L (light) runs in parallel — **no hard gate**, since imagery is license-clean.

---

## 16. Risks & Open Decisions

**Risks**
- ✅ **Image legality (R2/R3/R5/R6) — largely eliminated** by the decoupled license-clean strategy (§4.0): no publisher image is shown. Residual: AI-image IR1 (no real-person photoreal) + stock-license IR2 (attribution), handled in the pipeline + design system.
- **App Store 5.2.2 / Play IP** — much lower now (we show our own illustrations / licensed stock, not aggregated imagery). Mitigation: attribution + link-out + the legal-copy update.
- **EU/UK (DSM Art. 15) + Canada (C-18)** — **N/A for imagery** (no publisher images/summaries reused); only the headline-only text posture (R1) applies. Ship globally, no geo-gating.
- **AI generation cost / latency** — an image per article adds pipeline cost. Mitigation: generate once + cache; fall back to free-stock or gradient; tune the AI/stock mix per section (§14 `media_resolved`).
- **Doomscroll retention without a loop (the Artifact lesson)** — Mitigation: ship alongside the Caught-Up deck (honest finish line).
- **Token drift iOS↔Expo** — risk of accidental cross-pollination. Mitigation: spec each target against its own tokens; treat drift as intentional.
- **Score gaming** — Mitigation: dwell rule + `depth` governor + recency-capped coverage + first-only XP (§5.7).
- **Edge-cache leaking a personal score** — Mitigation: `private, no-store` on all personalized endpoints (hard invariant, §10.3).

**Open decisions (genuine product calls the team still owns)**
1. **Image model + stock library + AI/stock mix** — which image-gen model (SDXL / Flux / Imagen / DALL·E) and which stock APIs (Unsplash / Pexels / Openverse), and the default AI-vs-stock balance per section. (Strategy is fixed — AI primary, stock fallback, gradient final, §6; this is the implementation choice.)
2. **Doomscroll: opt-in second tab (recommended) vs. default surface** — recommendation is a dedicated tab + Feed entry, never replacing the card feed. Revisit after adoption data.
3. **Web auth depth** — fully offline `localStorage`-only (recommended for v2) vs. a lightweight account for cross-device streaks. Account is opt-in, aggregates-only, and not required for v2.
4. **Score sync authority** — on-device default (recommended) vs. server-authoritative `/me/stats`. v2 ships on-device; server endpoints are optional.
5. **Streak floor** — the resolved floor is **read-gated** (`coverage ≥ 0.6` **AND** `O ≥ 1`, §5.4/§5.7) so blind-scroll can't farm streaks; the only open sub-question is the exact `coverage` threshold (0.5–0.7). (Recommendation: 0.6 — ~10-min readers keep streaks while one genuine open is always required.)
6. **`accent_hex` computation locus** — the per-card accent system is **required for D** (§9/§10.2); the only open call is *where*: in the **media pipeline** server-side (recommended — zero client cost, identical across platforms) with per-client extraction as the **fallback**.
7. **AI illustration house style** — define the fixed TechScroll illustration style (palette, motif, level of abstraction) so AI cards feel cohesive and on-brand across the feed.
8. **Morning nudge / push** — reuse the v1 notification plan for the "Turn on the morning nudge" CTA, or defer? (Recommendation: reuse, opt-in.)
9. **Images uplift measurement (§1.4)** — measure +open / +save via a **per-user holdback cohort** (gradient-only control vs. media-on) at rollout, using a simple per-user experiment flag in the media pipeline.

---

## 17. Acceptance Criteria ("v2 done")

### A — Profile & Caught-Up Score
**Shared / model**
- [ ] `CaughtUp%` matches §5.3.3 for hand-checked fixtures; capped at 100; `depth` contributes 0 until `S ≥ 3`.
- [ ] Pure blind-scroll (no opens) is bounded by `0.55·coverage + 0.15·breadth` (**up to ~70**); reaching 100 — or any read-gated reward — **requires** real link-outs.
- [ ] **"All Caught Up" fires on `coverage ≥ 0.95` alone** (or `A = 0`), independent of the score; `CaughtUp% ≥ 90` is the separate **"Perfect Day"** state.
- [ ] `A = 0` (no fresh news) shows the caught-up empty state (no divide-by-zero) and **auto-freezes** the streak.
- [ ] "Seen" requires **≥ 1.2 s contiguous foreground** dwell; the timer pauses on background/blur and does not count interrupted views.
- [ ] Recency weight uses a **12-hour half-life**; window defaults to rolling 24h.
- [ ] Daily reset at **local midnight**; ring empties and recomputes.
- [ ] Streak increments on goal (All-Caught-Up `coverage≥0.95` **or** read-gated floor `coverage≥0.6 AND O≥1`); **blind-scroll alone cannot hold a streak**; **one freeze/week** prevents a single-miss break.
- [ ] Score computed **on-device**; cloud sync sends **aggregates only**, is opt-in, and uses canonical `shortId` + device-token auth (§10.1.1).

**iOS**
- [ ] `ProfileView` reachable from the `FeedView` topBar avatar **and** `SettingsView`.
- [ ] `CaughtUpRingView` animates with a spring; per-category bars tint via `NewsCategory.accentColor`.
- [ ] `ReadEvent` keys on `UUID(stableFrom:)` (not `Hasher`); seen survives relaunch and matches bookmark ids.
- [ ] Link-out from a card/doomscroll sets `openedAt` (counts toward `depth`).
- [ ] All-Caught-Up plays `Haptics.success` + `brandGradient` confetti; shows the stat line.

**Android (Expo)**
- [ ] `ProfileScreen` reachable from `FeedScreen` topBar avatar and/or `MainTabs`.
- [ ] `CaughtUpRing` (`react-native-svg` + Reanimated) animates `strokeDashoffset`; bars tint via `CATEGORY_META[key].accent`.
- [ ] `ReadEventsContext` persists to `ts.reads.v1`; `articleId` = `article.id` (raw link), matching `BookmarkContext`.
- [ ] Uses Expo tokens (`#0D0D12` / `#669EFF` / `#4DCC73`), not iOS literals; celebration fires `expo-haptics` success.

**Website**
- [ ] Header `--grad` ring shows live `%`; Profile panel renders ring + streak + per-source/keyword breakdown.
- [ ] Seen-set persists to `localStorage` `techscroll.seen.v1` keyed by `a.id`; shares `IntersectionObserver` tracking with the doomscroll panels; works with **no account / fully offline**.
- [ ] All-Caught-Up canvas confetti fires; styled with `--accent` / `--grad`; reuses `"You're all caught up"` copy.

**Backend**
- [ ] `GET /api/availability` returns **all-category** `{ category: count }` via the **shared `classify()` module**; clients filter to selected categories locally; carries `s-maxage=600` + CORS `*`.
- [ ] `POST /api/read-events` + `GET /me/stats` (deferred fast-follow) authorize on a **server-issued device token** (never a client `userId`), key payloads by canonical `shortId`, and set **`private, no-store`** — never edge-cached; KV mirrors `subscribe.js` with a `console.log` fallback.

### B — Article Imagery (license-clean)
**Media pipeline**
- [ ] Each article resolves to a `media_url` (+ `media_kind`, `media_credit`, `media_srcset`) via `lib/media.js`: AI illustration primary → free-stock/CC fallback → gradient final.
- [ ] License-clean images are **hosted by us** (Vercel Blob/S3/CDN); publisher `image`/`thumbnail` are **never** displayed or hotlinked.
- [ ] AI generation prompt forbids photoreal real people/events (IR1); output passes a safety filter + blocklist; provenance stored in `media_kind`/`media_credit` (IR3).
- [ ] `accent_hex` computed server-side from `media_url` (client extraction = fallback).

**Model**
- [ ] `media_url`/`media_kind`/`media_credit` added on iOS/Expo/Web; publisher `image`/`thumbnail`/`author`/`dek`/`summary` remain not-for-display; `SavedArticle` migration is lightweight.

**Rendering (per platform)**
- [ ] iOS renders `mediaURL` via `AsyncImage` (Nuke/native cache, downsampled); `URLCache` raised.
- [ ] Expo renders `mediaURL` via `expo-image` (`contentFit:cover`, memory-disk).
- [ ] Web renders `media_url` with `loading=lazy`, `decoding=async`, `srcset`/`sizes`.
- [ ] `media_credit` attribution shown when `media_kind==stock`; AI images carry an "illustration" label (IR1/IR2, lint-level invariant).
- [ ] Missing/failed image → **gradient or monogram fallback** (never broken/empty) on all three platforms.

**Accessibility & data**
- [ ] Every image exposes a descriptive alt / `accessibilityLabel` ("Illustration/Photo for: {title}").
- [ ] Reduced-data mode (Settings + `saveData`) drops to the gradient tile; reduced-motion disables transitions/shimmer.

**Legal**
- [ ] In-app legal copy updated: headlines + links to publishers; images are AI-generated illustrations or licensed/CC stock we host; we don't host publisher text or images.
- [ ] DMCA designated agent registered + contact published (Settings + `privacy.html`/`support.html`) — backstop.
- [ ] No publisher image is displayed anywhere; **no counsel gate / kill-switch / geo-gating** is required (decoupled, §4.0).

### D — Doomscroll
**iOS**
- [ ] `DoomscrollView.swift` + `DoomscrollCardView.swift` added; reachable via a `MainTabView` tab **and** a Feed top-bar entry seeded at scroll position.
- [ ] Vertical hard-snap paging via `ScrollView`+`LazyVStack`+`.scrollTargetBehavior(.paging)`+`.containerRelativeFrame(.vertical)`; bound via `.scrollPosition(id:)`.
- [ ] Full-bleed image with `ShimmerView` load + `placeholderGradient(for:)` failure fallback; downsampled to screen size.
- [ ] Per-card accent from `accent_hex` (→ `CIAreaAverage` fallback) drives wash + progress + save-burst; composited over `Palette.background`, text white.
- [ ] Overlay: `SourceAvatar` + source + region + `timeAgo`, `tsTitle` headline (≤4 lines), `CategoryTag`, content-type chip, `brandGradient` "Read on {Source} →" pill.
- [ ] Single-tap/CTA/right-rail Open → `ArticleDetailView → SafariView`; double-tap saves (deterministic-UUID bookmark) with burst + `Haptics.success`; swipe up/down with `Haptics.selection`.
- [ ] Seen recorded after ≥1.2 s; link-out recorded on open; both keyed off `UUID(stableFrom:)` and feed the score; deck fills and triggers "All Caught Up" at completion.
- [ ] Image prefetch ±2; `loadMoreIfNeeded` at `count−3`; reuses `FeedViewModel` (`loadGeneration` + dedup intact); sustains 60 fps.
- [ ] Reduce Motion disables snap/particles → standard-list fallback; each card one VoiceOver element with labeled actions + "Story X of N."
- [ ] Full-bleed renders the license-clean `mediaURL` at full resolution; persistent source attribution; `media_credit` (stock) / "illustration" label (AI); no kill-switch / geo-gating (image is ours, §4.0).

**Android (Expo)**
- [ ] `DoomscrollScreen.tsx` added; Doomscroll tab added to `MainTabs.tsx`.
- [ ] `FlatList`/`flash-list` with `pagingEnabled`, `snapToInterval=screenHeight`, `decelerationRate="fast"`, `disableIntervalMomentum`, `getItemLayout`; `onViewableItemsChanged` + `itemVisiblePercentThreshold: 80` drives seen/accent.
- [ ] Full-bleed `expo-image` (`contentFit="cover"`, transition) with shimmer/gradient fallback; `expo-linear-gradient` scrim.
- [ ] Per-card accent from `accent_hex` (→ `react-native-image-colors`), keyed by `article.id`; composited over `#0D0D12`.
- [ ] Overlay: `SourceAvatar` + source/region/`timeAgo`, `Type.title` headline, category tag (`CATEGORY_META.accent`), content-type chip, "Read on {source} →" pill.
- [ ] Single-tap/CTA opens `ArticleDetailScreen` (`react-native-webview`); double-tap saves (keyed on `article.id`) via `gesture-handler` + `reanimated` burst + `expo-haptics`; swipe up/down navigates.
- [ ] Seen after ≥1.2 s; link-out on open; both keyed off `article.id` (raw link), persisted in `ReadEventsContext`, feeding the score + deck.
- [ ] `expo-image` prefetch ±2; `loadMore` at `count−3`; reuses `useFeedViewModel` (`loadGen` + dedup intact); 60 fps, memory bounded via windowing/`flash-list`.
- [ ] Reduce Motion (`AccessibilityInfo`) disables snap/particles → standard-list fallback; each card one accessible element + "Story X of N."
- [ ] Full-bleed `expo-image` from `mediaURL` at full resolution; persistent source attribution; `media_credit` (stock) / "illustration" label (AI); no kill-switch / geo-gating (§4.0).

**Website**
- [ ] Doomscroll overlay/route (`#doom` or `doomscroll.html`) + a "Doomscroll" toggle in `.controls`, consuming the same `/api/articles`/`state.all`.
- [ ] Full-viewport CSS scroll-snap (`scroll-snap-type: y mandatory`; panels `height:100dvh; scroll-snap-align:start`); current ±2 panels lazy-mounted.
- [ ] Full-bleed `a.media_url` with `onerror` → monogram fallback; per-card accent from `accent_hex` (→ `node-vibrant`/canvas) over `--bg`; CSS-gradient scrim; headline + `srcColor` source chip + `timeAgo` + category + `media_credit` (stock) + "Read on {source} →".
- [ ] `IntersectionObserver` (0.8) marks panel seen + recolors accent; seen `a.id` (`shortId`) persisted to `localStorage` `techscroll.seen.v1`, shared with the Caught-Up widget.
- [ ] Single tap/CTA → `target="_blank"` to `article.link`; deck fills and triggers the web "All Caught Up" (`--grad`).
- [ ] `<link rel="preload" as="image">` for next 2 panels; `prefers-reduced-motion` disables snap + confetti → standard card grid; panels keyboard-navigable with "Story X of N" labels.
- [ ] Full-bleed uses the license-clean `a.media_url` at full resolution; visible source attribution + `media_credit` (stock); no kill-switch / geo-gating (§4.0).

### Shared backend / API
- [ ] `GET /api/keywords` confirmed to return per-bucket counts usable as the score denominator.
- [ ] `GET /api/availability` returns app-taxonomy category counts for the freshness window (edge-cacheable, `s-maxage=600`).
- [ ] `lib/media.js` resolves a license-clean `media_url` per article (AI/stock/gradient), hosts it, and serves it on `/api/articles`; a per-source **`text`** toggle in `lib/feeds.js` can drop a misbehaving feed.
- [ ] AI output passes a safety filter + blocklist before caching; `media_kind`/`media_credit` provenance recorded.
- [ ] Edge-cached endpoints keep `s-maxage=600`; **no personalized endpoint is edge-cached** (verified `private, no-store`).
- [ ] No geo-gating / region-split — the same `/api/articles` body (with license-clean `media_url`) is served globally.
- [ ] All three clients key seen/read/bookmark events off the **same stable article id** so "seen," bookmarks, and score stay consistent.

### Cross-cutting "v2 done"
- [ ] Caught-Up score (A/E) shipped on all three platforms with **no legal dependency**.
- [ ] Imagery (AI illustrations / licensed stock we host) ships enabled and passes App Store / Play review — no third-party imagery to flag.
- [ ] `swiftui-pro` review passes (iOS); `vercel:react-best-practices` pass (web/Expo where applicable); `app-store-preflight-skills` scan clean before submission.
- [ ] Crash-free ≥ 99.5%; doomscroll sustains 60 fps; v2 success-metric instrumentation (§14) live.