# TechScrollDataCach API

A tiny, open JSON API over the latest **TechCrunch** articles (with images),
built for mobile clients. No key, no auth, CORS open (`*`), edge-cached 10 min.

**Base URL**

```
https://techcrunch-articles-listing-by-keyw.vercel.app
```

---

## `GET /api/articles`

Returns the newest articles, optionally filtered and paginated.

| Param     | Type   | Default | Description                                                        |
|-----------|--------|---------|--------------------------------------------------------------------|
| `q`       | string | –       | Full-text search across title, summary, keywords, author           |
| `keyword` | string | –       | Filter by keyword/tag (case-insensitive). Comma-separated = AND. Alias: `tag` |
| `section` | string | –       | Filter by section, e.g. `Artificial Intelligence`                  |
| `limit`   | int    | all     | Max articles to return (1–200)                                     |
| `page`    | int    | –       | 1-based page number, used with `limit`                             |
| `offset`  | int    | 0       | Alternative to `page` (0-based)                                    |

**Response**

```jsonc
{
  "source": "TechCrunch WP REST API (live)",
  "generated_at": "2026-05-29T18:00:00.000Z",
  "total": 200,        // matches after filtering, before paging
  "count": 20,         // returned in this page
  "limit": 20,
  "offset": 0,
  "with_images": 20,
  "articles": [
    {
      "title": "…",
      "link": "https://techcrunch.com/2026/05/29/…/",
      "author": "Jane Doe",
      "published": "2026-05-29T17:27:13.000Z",   // ISO-8601 UTC
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
# newest 20
curl "https://techcrunch-articles-listing-by-keyw.vercel.app/api/articles?limit=20"

# page 2 of AI articles
curl "https://techcrunch-articles-listing-by-keyw.vercel.app/api/articles?keyword=Artificial%20Intelligence&limit=20&page=2"

# search
curl "https://techcrunch-articles-listing-by-keyw.vercel.app/api/articles?q=funding&limit=10"
```

## `GET /api/keywords`

Keyword & section tallies — use it to build a filter/chips UI. Pass any
`keyword` value straight back to `/api/articles?keyword=<value>`.

```jsonc
{
  "generated_at": "2026-05-29T18:00:00.000Z",
  "total_articles": 200,
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
    let source: String
    let generatedAt: String
    let total: Int
    let count: Int
    let withImages: Int
    let articles: [Article]

    enum CodingKeys: String, CodingKey {
        case source, total, count, articles
        case generatedAt = "generated_at"
        case withImages  = "with_images"
    }
}

struct Article: Codable, Identifiable, Hashable {
    var id: String { link }              // link is unique
    let title: String
    let link: String
    let author: String
    let published: String                // ISO-8601 UTC
    let image: String?
    let thumbnail: String?
    let section: String
    let categories: [String]
    let summary: String

    var url: URL? { URL(string: link) }
    var thumbnailURL: URL? { thumbnail.flatMap(URL.init) }
    var publishedDate: Date? { ISO8601DateFormatter().date(from: published) }
}

// MARK: - Client
struct TechScrollAPI {
    static let base = URL(string: "https://techcrunch-articles-listing-by-keyw.vercel.app")!

    /// Fetch newest articles, with optional keyword/search/paging.
    static func articles(keyword: String? = nil,
                         query: String? = nil,
                         limit: Int = 20,
                         page: Int = 1) async throws -> ArticlesResponse {
        var comps = URLComponents(url: base.appendingPathComponent("api/articles"),
                                  resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "limit", value: String(limit)),
                     URLQueryItem(name: "page",  value: String(page))]
        if let keyword { items.append(.init(name: "keyword", value: keyword)) }
        if let query   { items.append(.init(name: "q", value: query)) }
        comps.queryItems = items

        let (data, _) = try await URLSession.shared.data(from: comps.url!)
        return try JSONDecoder().decode(ArticlesResponse.self, from: data)
    }
}

// MARK: - Usage
// let feed = try await TechScrollAPI.articles(limit: 20)
// let ai   = try await TechScrollAPI.articles(keyword: "Artificial Intelligence", limit: 20, page: 1)
// for a in feed.articles { print(a.title, a.thumbnailURL ?? "") }
```

### SwiftUI list (with AsyncImage thumbnails)

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
                        Text(a.title).font(.headline).lineLimit(3)
                        Text(a.section).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .task {
            articles = (try? await TechScrollAPI.articles(limit: 30))?.articles ?? []
        }
    }
}
```

---

## Notes

- **Images**: use `thumbnail` for lists (CDN-cropped ~30 KB); use `image` for full-res detail views. You can request any size yourself: append `?w=<px>&h=<px>&crop=1` to `image`.
- **Caching**: responses are edge-cached for 10 minutes (`stale-while-revalidate` 30 min) — fast and origin-friendly.
- **Freshness**: data is pulled live from TechCrunch's WordPress REST API on each cache miss; no scraping platform involved.
- **Attribution**: all content/images belong to [TechCrunch](https://techcrunch.com); link back to `link`.
