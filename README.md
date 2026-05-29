# techscrolldatacach / techcrunch-articles-listing-by-keyword

Latest **TechCrunch** articles, scraped from the public RSS feeds and made
browsable **by keyword**. Type a keyword (e.g. `AI`, `funding`, `security`) or
click any tag to filter; headlines link back to the original article.

## How it works

- **`index.html`** — single-file static front end. Client-side keyword search,
  tag filtering, and a top-keywords cloud. No build step.
- **`api/articles.js`** — Vercel Serverless Function that fetches TechCrunch's
  RSS feeds server-side (no CORS), parses them dependency-free, dedupes by URL,
  and returns JSON. Edge-cached for 10 min so the page stays fresh and live.
- **`articles.json`** — a pre-scraped snapshot bundled into the repo so the site
  works instantly even before the function runs (and as an offline fallback).
- **`scrape.py`** — regenerates the snapshot from the same feeds (stdlib only).

The page calls `/api/articles` first for live data and falls back to the bundled
`articles.json` snapshot.

## Run locally

```bash
python3 scrape.py        # refresh articles.json from TechCrunch
python3 -m http.server   # serve at http://localhost:8000  (snapshot only)
# or, for the live API:
vercel dev               # http://localhost:3000  (with /api/articles)
```

## Deploy

Pushed to GitHub and deployed on Vercel. To redeploy:

```bash
vercel --prod
```

## Attribution

All article content and the TechCrunch name are property of
[TechCrunch](https://techcrunch.com). This project only indexes public RSS
headlines/summaries and links back to the source.
