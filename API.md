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
| `source`  | string | –       | Filter by source id or name (`techcrunch`, `siliconvalley`, `wired`, `theverge`, `arstechnica`). Comma = OR |
| `region`  | string | –       | Filter by region (`Silicon Valley`, `San Francisco`, `SF Bay Area`, `National`). Comma = OR |
| `section` | string | –       | Filter by section                                                          |
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

**Examples**

```bash
# newest 20 across all sources
curl ".../api/articles?limit=20"

# only Silicon Valley region
curl ".../api/articles?region=Silicon%20Valley&limit=20"

# only TechCrunch + Wired
curl ".../api/articles?source=techcrunch,wired&limit=20"

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
