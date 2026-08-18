# TechScroll API

A tiny, open JSON API over the latest **Silicon Valley / San Francisco tech
news** (with images), built for mobile clients. No key, no auth, CORS open
(`*`), edge-cached 10 min.

**Sources** (aggregated live): TechCrunch · SiliconValley.com · Wired ·
The Verge · Ars Technica.

**Base URL**

```
https://techcrunch-articles-listing-by-keyw.vercel.app
```

---

## `GET /api/articles`

Returns the newest articles across all sources, optionally filtered and paginated.

| Param     | Type   | Default | Description                                                                |
|-----------|--------|---------|----------------------------------------------------------------------------|
| `q`       | string | –       | Full-text search across title, summary, keywords, author, source           |
| `keyword` | string | –       | Filter by keyword/tag (case-insensitive). Comma-separated = AND. Alias: `tag` |
| `source`  | string | –       | Filter by source id or name (`techcrunch`, `siliconvalley`, `wired`, `theverge`, `arstechnica`, `x`). Comma = OR |
| `region`  | string | –       | Filter by region (`Silicon Valley`, `San Francisco`, `SF Bay Area`, `National`, `Social`). Comma = OR |
| `section` | string | –       | Filter by section                                                          |
| `social`  | string | –       | `only` → just X posts · `exclude` → hide X posts (default: include both)    |
| `min_score` | int  | 0       | Keep social (X) posts with `worthiness_score ≥ n` (0–100)                  |
| `limit`   | int    | all     | Max articles to return (1–400)                                             |
| `page`    | int    | –       | 1-based page number, used with `limit`                                     |
| `offset`  | int    | 0       | Alternative to `page` (0-based)                                            |

**Response**

```jsonc
{
  "sources": ["TechCrunch", "SiliconValley.com", "Wired", "The Verge", "Ars Technica"],
  "generated_at": "2026-05-29T20:00:00.000Z",
  "total": 359,        // matches after filtering, before paging
  "count": 20,         // returned in this page
  "limit": 20,
  "offset": 0,
  "with_images": 20,
  "articles": [
    {
      "id": "1pl2o4h",                       // stable hash of link (Identifiable)
      "title": "…",
      "link": "https://techcrunch.com/2026/05/29/…/",
      "source": "TechCrunch",
      "source_id": "techcrunch",
      "region": "SF Bay Area",
      "focus": "Startups & VC",
      "content_type": "article",             // article | video | podcast
      "author": "Jane Doe",
      "published": "2026-05-29T17:27:13.000Z",  // ISO-8601 UTC
      "image": "https://techcrunch.com/wp-content/uploads/…/photo.jpg",
      "thumbnail": "https://…/photo.jpg?w=420&h=260&crop=1",  // ~30 KB, list-ready
      "section": "Artificial Intelligence",
      "categories": ["Artificial Intelligence", "Nvidia", "Groq"],  // = keywords
      "summary": "…"
    }
  ]
}
```

**Social (X) items** carry everything above plus the newsworthiness verdict.
TechScroll pulls the latest posts from major tech voices (Sam Altman, Anthropic,
Claude, NVIDIA, Claude devs), scores each for *report-worthiness* + sentiment,
and only surfaces the ones that read like news (replies, retweets and banter are
dropped; duplicates are collapsed against the article feed):

```jsonc
{
  "id": "x_1928…",
  "title": "We've raised $65 billion in Series H funding at a $965 billion …",
  "link": "https://x.com/AnthropicAI/status/1928…",
  "source": "X", "source_id": "x", "region": "Social",
  "content_type": "post",
  "author": "Anthropic · @AnthropicAI",
  "handle": "AnthropicAI", "org": "Anthropic",
  "published": "2026-05-28T16:00:00.000Z",
  "section": "Funding & deals",
  "categories": ["X", "Anthropic", "Funding & deals"],
  "is_social": true,
  "report_worthy": true,
  "worthiness_score": 100,                 // 0–100, ≥55 ⇒ report-worthy
  "sentiment": "neutral",                  // positive | neutral | negative
  "sentiment_score": 0,                    // -1 … 1
  "reasons": ["report-worthy", "business signal (raised, funding)", "concrete metrics"],
  "metrics": { "likes": 12000, "retweets": 800, "replies": 300, "likes_h": "12K" }
}
```

The top-level response also includes `"social": [<handles surfaced>]`.

**Examples**

```bash
# newest 20 across all sources
curl ".../api/articles?limit=20"

# only Silicon Valley region
curl ".../api/articles?region=Silicon%20Valley&limit=20"

# only TechCrunch + Wired
curl ".../api/articles?source=techcrunch,wired&limit=20"

# only report-worthy X posts from the tech voices
curl ".../api/articles?social=only"

# big stories only (high newsworthiness)
curl ".../api/articles?social=only&min_score=85"

# articles only, no social
curl ".../api/articles?social=exclude&limit=20"

# page 2 of AI articles
curl ".../api/articles?keyword=Artificial%20Intelligence&limit=20&page=2"

# search
curl ".../api/articles?q=funding&limit=10"
```

## `GET /api/keywords`

Source, region, section & keyword tallies — use them to build filter/chips UIs.
Pass any value straight back to `/api/articles` (`?source=`, `?region=`,
`?keyword=`).

```jsonc
{
  "generated_at": "2026-05-29T20:00:00.000Z",
  "total_articles": 359,
  "sources":  [{ "id": "techcrunch", "name": "TechCrunch", "region": "SF Bay Area", "focus": "Startups & VC", "count": 200 }, …],
  "regions":  [{ "name": "SF Bay Area", "count": 200 }, …],
  "sections": [{ "name": "Artificial Intelligence", "count": 105 }, …],
  "keywords": [{ "keyword": "Artificial Intelligence", "count": 105 }, …]  // ?limit= to cap
}
```

---

## iOS / Swift (URLSession + Codable)

Drop this into your app. Works on iOS 15+ (async/await).

```swift
import Foundation

// MARK: - Models
struct ArticlesResponse: Codable {
    let sources: [String]
    let generatedAt: String
    let total: Int
    let count: Int
    let withImages: Int
    let articles: [Article]

    enum CodingKeys: String, CodingKey {
        case sources, total, count, articles
        case generatedAt = "generated_at"
        case withImages  = "with_images"
    }
}

struct Article: Codable, Identifiable, Hashable {
    let id: String                       // stable across snapshot & live
    let title: String
    let link: String
    let source: String                   // "TechCrunch", "Wired", …
    let sourceId: String
    let region: String                   // "Silicon Valley", "San Francisco", …
    let focus: String
    let contentType: String              // "article" | "video" | "podcast"
    let author: String
    let published: String                // ISO-8601 UTC
    let image: String?
    let thumbnail: String?
    let section: String
    let categories: [String]
    let summary: String

    enum CodingKeys: String, CodingKey {
        case id, title, link, source, region, focus, author, published
        case image, thumbnail, section, categories, summary
        case sourceId = "source_id"
        case contentType = "content_type"
    }

    var url: URL? { URL(string: link) }
    var thumbnailURL: URL? { thumbnail.flatMap(URL.init) }
    var publishedDate: Date? { ISO8601DateFormatter().date(from: published) }
    var isVideo: Bool { contentType == "video" }
}

// MARK: - Client
struct TechScrollAPI {
    static let base = URL(string: "https://techcrunch-articles-listing-by-keyw.vercel.app")!

    /// Fetch newest articles with optional source/region/keyword/search/paging.
    static func articles(source: String? = nil,
                         region: String? = nil,
                         keyword: String? = nil,
                         query: String? = nil,
                         limit: Int = 20,
                         page: Int = 1) async throws -> ArticlesResponse {
        var comps = URLComponents(url: base.appendingPathComponent("api/articles"),
                                  resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "limit", value: String(limit)),
                     URLQueryItem(name: "page",  value: String(page))]
        if let source  { items.append(.init(name: "source",  value: source)) }
        if let region  { items.append(.init(name: "region",  value: region)) }
        if let keyword { items.append(.init(name: "keyword", value: keyword)) }
        if let query   { items.append(.init(name: "q", value: query)) }
        comps.queryItems = items

        let (data, _) = try await URLSession.shared.data(from: comps.url!)
        return try JSONDecoder().decode(ArticlesResponse.self, from: data)
    }
}

// MARK: - Usage
// let feed = try await TechScrollAPI.articles(limit: 30)
// let sv   = try await TechScrollAPI.articles(region: "Silicon Valley", limit: 20)
// let tc   = try await TechScrollAPI.articles(source: "techcrunch,wired", limit: 20)
// for a in feed.articles { print(a.source, a.region, a.title) }
```

### SwiftUI list (with AsyncImage thumbnails + source label)

```swift
import SwiftUI

struct FeedView: View {
    @State private var articles: [Article] = []
    var body: some View {
        List(articles) { a in
            Link(destination: a.url ?? TechScrollAPI.base) {
                HStack(alignment: .top, spacing: 12) {
                    AsyncImage(url: a.thumbnailURL) { $0.resizable().scaledToFill() }
                        placeholder: { Color.gray.opacity(0.2) }
                        .frame(width: 96, height: 64).clipped().cornerRadius(8)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(a.source) · \(a.region)").font(.caption).foregroundStyle(.tint)
                        Text(a.title).font(.headline).lineLimit(3)
                    }
                }
            }
        }
        .task { articles = (try? await TechScrollAPI.articles(limit: 40))?.articles ?? [] }
    }
}
```

---

## Notes

- **Labels**: every article is tagged with `source`, `source_id`, `region`,
  `focus`, `content_type` and a stable `id` — ready for grouping/filtering in-app.
- **Images**: use `thumbnail` for lists (CDN-cropped ~30 KB); use `image` for
  full-res detail views.
- **Caching**: responses are edge-cached for 10 minutes (`stale-while-revalidate`
  30 min). The cache key includes the query string.
- **Freshness**: data is pulled live from each outlet's public feed/REST API on
  each cache miss; no scraping platform involved.
- **Attribution**: all content/images belong to their respective outlets; link
  back to `link`.
```

---

## `GET /api/research`

Returns normalized research-paper metadata from arXiv/OpenAlex. Add `topic` using one exact label advertised in `topics`, `limit` (1–50), and `sort=recent|trending|citations`. Unknown topics return HTTP 400.

Exact-topic requests use focused OpenAlex searches restricted to DOI-bearing core-journal articles and return `topic`, `published`, `provider`, `publisher`, `source_label`, `content_type=paper`, `content_type_label=Research paper`, `canonical_url`, and `freshness_verified`. The response also returns the dynamic inclusive `cutoff`, provider status, and all 23 labels.

The server rejects missing, malformed, stale, future, retracted, paratext, non-article, and off-topic provider records at normalization time. Topic-provider failure returns HTTP 502 and never falls back to bundled or mock research. See [DATA_SOURCES.md](DATA_SOURCES.md).

### World-ranked lane: `?topic=<label>&rank=world`

`rank=world` is topic-only and opts into a merged, ranked result instead of a
single-provider sorted one. It combines the strict OpenAlex core-journal tier
with a Google Scholar tier collected by `scripts/snapshot-scholar.mjs` through
Apify and served from the committed `scholar-snapshot.json`. **The request path
never calls Apify**, so response latency and cost are unaffected by the Scholar
tier being present.

Ordering comes from `lib/world-rank.js`: citations per year (log-scaled),
recency, venue prestige, cross-provider corroboration, and whether the paper is
actually openable. Ties break on citations, then title, so the order is total
and stable across refreshes.

Additional response fields on this lane:

| Field | Meaning |
|---|---|
| `world_ranked` | `true` for this lane, `false` otherwise |
| `sources[]` | `{ provider, via, count, snapshot_at }` per contributing tier |
| `rank_weights` | the exact weights used, so the ordering is auditable |
| `scholar_snapshot` | `{ generated_at, actor, count, topic_count }` or `null` |

Additional per-paper fields (all additive and optional; absent on other lanes,
and safely ignored by existing iOS decoders):

| Field | Meaning |
|---|---|
| `world_rank` / `world_score` | 1-based position and the 0–100 score behind it |
| `score_breakdown` | `impact`, `recency`, `venue`, `corroboration`, `access`, `citations_per_year` |
| `providers[]` | every provider that independently surfaced this paper |
| `published_year` / `date_precision` | Scholar reports a year, not a date: `date_precision` is `"year"` and `published` is `null` |
| `venue`, `authors`, `host_domain` | parsed publication metadata |
| `open_access_pdf` | publisher-hosted PDF link, or `null` |
| `provider_via` | `"Apify"` for the Scholar tier |

Scholar-tier papers always report `freshness_verified: false` and
`rights_status: "unknown_or_restricted"`: Scholar is a metadata index, so it
cannot verify a publication day or grant redistribution rights. Only the
Europe PMC path in `/api/content` can do the latter.

If OpenAlex fails but the Scholar snapshot has papers, the lane returns HTTP 200
with `provider_status: "partial"`. It returns HTTP 502 only when both tiers are
empty. Requests without `rank=world` behave exactly as before.

```bash
curl -fsS 'https://<host>/api/research?topic=AI%20%2F%20ML&rank=world&limit=10'
```


---

## `GET /api/briefing`

Returns the manifest for the daily narrated research briefing: the audio URL,
its measured duration, the full transcript, and one chapter per paper with the
timestamp where that paper begins.

Chapter timestamps come from ElevenLabs' character-level alignment, not from a
word-count estimate, so seeking to a chapter lands on the right sentence rather
than drifting several seconds over a multi-minute briefing.

| Field | Meaning |
|---|---|
| `date`, `date_label`, `title` | which briefing this is |
| `audio_url` | committed static MP3 under `/briefings/` |
| `duration_seconds`, `audio_bytes` | measured, not estimated |
| `transcript` | the exact text that was synthesized |
| `chapters[]` | `index`, `start_seconds`, `title`, `topic`, `venue`, `citations`, `world_score`, `url`, `open_access_pdf`, `providers` |
| `archive[]` | `{ date, audio_url }` for the retained back-catalogue |
| `provider`, `voice_id`, `model_id` | how it was narrated |

`?date=YYYY-MM-DD` serves an archived briefing. The parameter is matched against
the manifest's own `archive` list, so it can never be turned into a filesystem
path; a malformed value is HTTP 400 and an unlisted date is HTTP 404. Archived
entries return playable audio with `transcript: null` and `chapters: []`, since
only the current briefing retains those.

HTTP 404 before the first briefing has been generated. That is a real state on a
fresh deploy, not an error.

**No credential is involved in a request.** The briefing is rendered once a day
by `scripts/daily-briefing.mjs` in CI and committed; the endpoint reads a local
JSON file. A page view can never spend a character of ElevenLabs quota.

```bash
curl -fsS 'https://<host>/api/briefing' | jq '{date, duration_seconds, chapters: [.chapters[].title]}'
```

---

## `GET /api/content`

Accepts exactly one strict `pmcid=PMC…` or numeric `pmid=…` parameter. A PMID is resolved to a PMCID through Europe PMC’s bounded JSON search endpoint. The server constructs a fixed Europe PMC `fullTextXML` URL; arbitrary URLs and hosts are not accepted. A body is returned only when the XML contains an exact supported license URL for CC0 1.0, Public Domain Mark 1.0, CC BY 3.0, or CC BY 4.0.

Success returns `content_type=paper`, `rights_status=verified_open_access`, `full_text_status=available`, `full_text_available=true`, `license_id`, `license_url`, `canonical_url`, `attribution`, `copyright_notice`, `adaptation_notice`, `body_source`, `body_source_url`, `rights_provenance_at`, `content_format=structured_plain_text`, `content_truncated`, and bounded `blocks[]` of type `heading`, `paragraph`, or `citation`. XML/HTML is never returned.

Invalid identifiers return 400; unverified rights return 403; missing bodies return 404; unsupported content types return 415; oversized provider responses return 413; rate limiting returns 429; timeouts return 504. Rights failures and provider errors fail closed and are not cached.
