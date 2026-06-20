# Learnify (techcrunch-articles-listing-by-keyword)

A static-site tech/science news aggregator that pulls articles from TechCrunch, Wired, The Verge, Ars Technica, and SiliconValley.com, normalizes them, and makes them filterable by keyword, source, and category — with thumbnails. Deployed on Vercel.

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS (no framework), ES modules
- **Data scraping:** Python 3 (`scrape.py`)
- **Hosting:** Vercel (static + serverless functions under `api/`)
- **Feeds:** WordPress REST API (TechCrunch, SiliconValley.com), RSS/Atom (Wired, The Verge, Ars Technica)

## Setup

```bash
npm install   # minimal — only dev tooling; no runtime npm deps
pip3 install -r requirements.txt  # if requirements.txt present, for scrape.py
```

No API keys required. All feeds are public.

## Build / Run / Test

```bash
# Scrape fresh articles into articles.json
npm run scrape       # alias for: python3 scrape.py

# Local dev server (requires Vercel CLI)
npm run dev          # alias for: vercel dev

# Deploy to production
npm run deploy       # alias for: vercel --prod
```

## Project Structure

```
index.html            Main app entry — article feed UI
ideas.html            Ideas/experiments page
influencers.html      Influencer listing page
feed.html             Alternative feed view
privacy.html          Privacy policy
support.html          Support page
articles.json         Normalized article cache (output of scrape.py)
enriched.json         Enriched article data
scrape.py             Python scraper — fetches from all sources, normalizes output
api/                  Vercel serverless functions
app/                  App-level JS modules
lib/                  Shared utility code
scripts/              Helper scripts
assets/               Static assets (images, icons)
art/                  Artwork / decorative assets
ugc/                  User-generated content assets
vercel.json           Vercel routing and config
package.json          Scripts + engine requirement (Node >=18)
```

## Architecture & Key Files

- `scrape.py` — the core data pipeline: fetches WordPress REST API and RSS/Atom feeds, normalizes each article to a common schema (id, source, title, link, author, published, image, thumbnail, categories, summary), and writes `articles.json`.
- `api/` — Vercel serverless functions that may proxy or enrich requests at runtime.
- `index.html` — client-side filtering and rendering; reads `articles.json` or calls the API.
- `vercel.json` — controls routing (rewrites/redirects) for the Vercel deployment.

## Conventions & Notes for Agents

- **No build step.** HTML/CSS/JS are served directly; do not introduce a bundler unless explicitly asked.
- **Article schema** is defined by what `scrape.py` outputs — fields: `source`, `source_id`, `region`, `focus`, `content_type`, `id`, `title`, `link`, `author`, `published` (ISO-8601), `image`, `thumbnail`, `section`, `categories`, `summary`. Maintain this schema when modifying the scraper.
- `articles.json` and `enriched.json` are generated artifacts — do not hand-edit them.
- `vercel.json` controls routing; edit carefully to avoid breaking existing URL paths.
- No test suite exists. Manual verification via `npm run dev`.
