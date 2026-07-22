export const CONTENT_TYPES = Object.freeze(["article", "video", "podcast", "post", "paper"]);

export function parseContentTypeQuery(value) {
  const values = Array.isArray(value) ? value : [value];
  const allowed = new Set(CONTENT_TYPES);
  const resolved = values
    .flatMap((item) => (item || "").toString().split(","))
    .map((item) => item.trim().toLowerCase())
    .filter((item) => allowed.has(item));
  return [...new Set(resolved)];
}

/** Apply comma-OR content-type filtering without changing absent queries. */
export function filterByContentTypeQuery(articles, value) {
  const values = Array.isArray(value) ? value : [value];
  const hasQuery = values.some((item) => (item || "").toString().trim());
  if (!hasQuery) return articles;

  const requested = new Set(parseContentTypeQuery(value));
  return articles.filter((article) => requested.has((article.content_type || "article").toLowerCase()));
}
