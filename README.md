# Learnify

Latest **tech, science & learning news** — **with images**,
aggregated locally from multiple outlets and made browsable **by keyword and
source**. Type a keyword (e.g. `AI`, `funding`, `OpenAI`), pick a source, or
click any tag to filter; thumbnails and headlines link back to the original
article.

## Sources

| Source | Region | How it's pulled |
|---|---|---|
| **TechCrunch** | SF Bay Area | WordPress REST API |
| **SiliconValley.com** | Silicon Valley | WordPress REST API |
| **Wired** | San Francisco | RSS (media images) |
| **The Verge** | National | Atom (content images) |
| **Ars Technica** | National | RSS (media images) |

Every article is normalised and **fully labelled**: `source`, `source_id`,
`region`, `focus`, `content_type` (`article`/`video`/`podcast`), a stable `id`,
plus title, link, author, published (ISO-8601), image, thumbnail, section,
categories (keywords) and summary.

## How it works — local aggregation, no Apify / no hosted service

WordPress outlets are pulled from their REST API (`/wp-json/wp/v2/posts`,
`_fields`-trimmed) so each post is tiny and arrives **with its featured image**,
keyword slugs, author and excerpt. RSS/Atom outlets are parsed directly with
image extraction (`media:content`, `media:thumbnail`, `enclosure`, or the first
`<img>` in the content). No third-party scraping platform, no API keys.

- **`lib/feeds.js`** — shared multi-source collector (WordPress + RSS/Atom),
  dedup + newest-first, used by both API routes.
- **`api/articles.js`** — Vercel Function: aggregated JSON with filtering
  (`q`, `keyword`, `source`, `region`, `section`), paging, open CORS. Edge-cached 10 min.
- **`api/keywords.js`** — source / region / section / keyword tallies for filter UIs.
- **`index.html`** — single-file front end: lazy-loaded thumbnails, keyword
  search, source filter, top-keywords cloud, video badges. No build step.
- **`scrape.py`** — local scraper (stdlib only) mirroring the same sources and
  labels; writes `articles.json`. The article `id` hash matches the JS exactly,
  so snapshot and live data are interchangeable.
- **`articles.json`** — pre-scraped snapshot (all sources, all with images)
  bundled in so the site works instantly and offline.

The page calls `/api/articles` first for live data and falls back to the bundled
snapshot.

## Run locally

```bash
python3 scrape.py            # refresh articles.json across all sources (with images)
python3 -m http.server       # serve at http://localhost:8000  (snapshot only)
# or, for the live API:
vercel dev                   # http://localhost:3000  (with /api/articles)
```

## Mobile API

A small open JSON API powers the site and is ready for native apps (iOS/Android):

- `GET /api/articles` — newest articles with images; supports `q`, `keyword`,
  `source`, `region`, `section`, `limit`, `page`/`offset`. CORS open, edge-cached.
- `GET /api/keywords` — source / region / section / keyword tallies for a filter UI.

See **[API.md](API.md)** for the full reference plus a copy-paste **Swift
`Codable` + SwiftUI** example.

## Product analytics

Privacy-gated, aggregate product analytics is available through the existing Vercel host and is disabled by default. See **[ANALYTICS.md](ANALYTICS.md)** for setup, the event dictionary, consent behavior, verification, suggested reports, and session-duration interpretation. Run `npm test` to validate the event/property privacy allowlist.

## Research topics

Learnify provides 23 exact research-topic feeds backed by OpenAlex and enforced by a server-side rolling two-year freshness gate. Topic cards are labeled as research papers, identify the indexed journal/publisher when available, and link to the canonical source; Learnify does not render full paper bodies in this milestone. See **[DATA_SOURCES.md](DATA_SOURCES.md)** for the complete frontend-to-provider path, query mappings, exclusions, freshness semantics, limitations, environment variables, and verification steps.

## Deploy

Pushed to GitHub and deployed on Vercel (git-connected — every push auto-deploys).
To redeploy manually:

```bash
vercel --prod
```

## Attribution & legal

**Learnify is an independent news reader and is not affiliated with, endorsed
by, or sponsored by** TechCrunch, SiliconValley.com, Wired, The Verge, Ars
Technica, or their owners. All article headlines, summaries, images, content and
trademarks belong to their respective publishers and are referenced here only
under nominative/fair-use aggregation.

This project does **not** republish full articles. It indexes public
headlines, short summaries/excerpts and thumbnails from each outlet's own public
RSS feed or WordPress REST API (channels intended for syndication) and always
links back to the original source. Source names are used descriptively to
identify where each item came from.

**Rights holders:** to request removal of any item, email
`support@techscroll.app`.

> The name "Learnify" should be cleared against existing trademarks
> (USPTO / EUIPO / your jurisdiction) before any commercial launch.
