import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTENT_TYPES,
  filterByContentTypeQuery,
  parseContentTypeQuery,
} from "../lib/feed-query.js";

test("content type contract includes every current feed item type", () => {
  assert.deepEqual(CONTENT_TYPES, ["article", "video", "podcast", "post", "paper"]);
});

test("content_type parses comma-separated values with OR semantics", () => {
  assert.deepEqual(parseContentTypeQuery("VIDEO, podcast,video"), ["video", "podcast"]);
  assert.deepEqual(parseContentTypeQuery(["article,post", "paper"]), ["article", "post", "paper"]);
});

test("content_type filtering happens across the full input and is inert when absent", () => {
  const input = [
    { id: "new-article", content_type: "article" },
    { id: "older-video", content_type: "video" },
    { id: "podcast", content_type: "podcast" },
    { id: "legacy-default" },
  ];

  assert.equal(filterByContentTypeQuery(input, undefined), input);
  assert.deepEqual(filterByContentTypeQuery(input, "video").map((item) => item.id), ["older-video"]);
  assert.deepEqual(filterByContentTypeQuery(input, "video,podcast").map((item) => item.id), [
    "older-video", "podcast",
  ]);
  assert.deepEqual(filterByContentTypeQuery(input, "article").map((item) => item.id), [
    "new-article", "legacy-default",
  ]);
  assert.deepEqual(filterByContentTypeQuery(input, "unknown"), []);
});
