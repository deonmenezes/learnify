# techscrolldatacach / techcrunch-articles-listing-by-keyword

Latest **TechCrunch** articles — **with images** — scraped locally and made
browsable **by keyword**. Type a keyword (e.g. `AI`, `funding`, `security`) or
click any tag to filter; thumbnails and headlines link back to the original
article.

## How it works — a local scraper, no Apify / no hosted service

Both the local scraper and the live function pull straight from **TechCrunch's
own WordPress REST API** (`/wp-json/wp/v2/posts`), queried with `_fields` so
each post is ~8 KB and arrives **with its featured image**, keyword slugs,
author and excerpt already attached. No third-party scraping platform, no
per-article HTML scraping, and images come free in the payload. If the REST API
is ever unreachable it transparently falls back to parsing the public RSS feeds
(no images in that mode).

- **`index.html`** — single-file static front end. Lazy-loaded thumbnails,
  client-side keyword search, tag filtering, and a top-keywords cloud. No build
  step. Thumbnails are served at a card-sized crop via the image CDN (~30 KB).
- **`api/articles.js`** — Vercel Serverless Function: WP REST API → JSON (with
  images), deduped and newest-first. Edge-cached for 10 min so the page stays
  fresh and live. RSS fallback built in.
- **`scrape.py`** — local scraper (stdlib only). Pages through the WP REST API
  and writes `articles.json`. RSS fallback built in.
- **`articles.json`** — a pre-scraped snapshot (200 articles, all with images)
  bundled into the repo so the site works instantly and offline.

The page calls `/api/articles` first for live data and falls back to the bundled
`articles.json` snapshot.

## Run locally

```bash
python3 scrape.py            # refresh articles.json (newest ~200, with images)
python3 scrape.py --pages 4  # newest ~400 articles
python3 -m http.server       # serve at http://localhost:8000  (snapshot only)
# or, for the live API:
vercel dev                   # http://localhost:3000  (with /api/articles)
```

## Mobile API

A small open JSON API powers the site and is ready for native apps (iOS/Android):

- `GET /api/articles` — newest articles with images; supports `q`, `keyword`,
  `section`, `limit`, `page`/`offset`. CORS open, edge-cached.
- `GET /api/keywords` — keyword & section tallies for a filter UI.

See **[API.md](API.md)** for the full reference plus a copy-paste **Swift
`Codable` + SwiftUI** example.

## Deploy

Pushed to GitHub and deployed on Vercel. To redeploy:

```bash
vercel --prod
```

## Attribution

All article content, images and the TechCrunch name are property of
[TechCrunch](https://techcrunch.com). This project only indexes public
headlines/summaries/thumbnails from TechCrunch's own public API and links back
to the source.
