import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_CATEGORY_VALUES,
  balanceByCategory,
  classifyArticle,
  filterByCategoryQuery,
  parseCategoryQuery,
  withAppCategory,
} from "../lib/categories.js";
import { parseFeed, parseYouTubeChannelPage, SOURCES } from "../lib/feeds.js";

const CANONICAL_CATEGORIES = [
  "AI / ML", "Robotics", "Coding & Dev Tools", "Startups & Funding",
  "Hardware & Gadgets", "Learning & Career", "Security", "Crypto / Web3",
  "Science", "Big Tech", "Fitness", "Skincare",
];

test("taxonomy exactly matches the twelve iOS NewsCategory raw values", () => {
  assert.deepEqual(APP_CATEGORY_VALUES, CANONICAL_CATEGORIES);
});

test("category query accepts canonical and short labels as comma-separated OR", () => {
  assert.deepEqual(
    parseCategoryQuery("AI, Coding & Dev Tools,hardware,Big Tech,AI / ML"),
    ["AI / ML", "Coding & Dev Tools", "Hardware & Gadgets", "Big Tech"],
  );
  assert.deepEqual(parseCategoryQuery(["Startups,crypto", "Fitness"]), [
    "Startups & Funding", "Crypto / Web3", "Fitness",
  ]);
});

test("category query filters with OR semantics and is inert when absent", () => {
  const input = [
    { id: "ai", app_category: "AI / ML" },
    { id: "coding", app_category: "Coding & Dev Tools" },
    { id: "science", app_category: "Science" },
  ];
  assert.equal(filterByCategoryQuery(input, undefined), input);
  assert.deepEqual(filterByCategoryQuery(input, "AI,Science").map((article) => article.id), ["ai", "science"]);
  assert.deepEqual(filterByCategoryQuery(input, "not-a-category"), []);
});

test("classifier mirrors iOS priority and can emit every canonical category", () => {
  const cases = [
    [{ section: "Artificial Intelligence" }, "AI / ML"],
    [{ categories: ["Drones"] }, "Robotics"],
    [{ categories: ["Developer tools"] }, "Coding & Dev Tools"],
    [{ section: "Fundraising" }, "Startups & Funding"],
    [{ section: "Hardware" }, "Hardware & Gadgets"],
    [{ categories: ["Tutorial"] }, "Learning & Career"],
    [{ section: "Security" }, "Security"],
    [{ categories: ["Blockchain"] }, "Crypto / Web3"],
    [{ section: "Science" }, "Science"],
    [{ section: "Apps" }, "Big Tech"],
    [{ categories: ["Exercise"] }, "Fitness"],
    [{ categories: ["Dermatology"] }, "Skincare"],
  ];

  for (const [article, expected] of cases) assert.equal(classifyArticle(article), expected);
  assert.equal(classifyArticle({ section: "Security", categories: ["Fitness"] }), "Fitness");
  assert.equal(classifyArticle({ region: "Research" }), "Science");
});

test("balancing covers available categories and preserves order within each category", () => {
  const input = [
    { id: "ai-1", app_category: "AI / ML" },
    { id: "ai-2", app_category: "AI / ML" },
    { id: "code-1", app_category: "Coding & Dev Tools" },
    { id: "ai-3", app_category: "AI / ML" },
    { id: "science-1", app_category: "Science" },
    { id: "code-2", app_category: "Coding & Dev Tools" },
  ];

  const output = balanceByCategory(input);
  assert.deepEqual(output.slice(0, 3).map((article) => article.id), ["ai-1", "code-1", "science-1"]);
  for (const category of ["AI / ML", "Coding & Dev Tools", "Science"]) {
    assert.deepEqual(
      output.filter((article) => article.app_category === category).map((article) => article.id),
      input.filter((article) => article.app_category === category).map((article) => article.id),
    );
  }
  assert.deepEqual(input.map((article) => article.id), ["ai-1", "ai-2", "code-1", "ai-3", "science-1", "code-2"]);
});

test("balancing never promotes an older freshness cohort for category coverage", () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const input = [
    { id: "fresh-ai-1", app_category: "AI / ML", published: "2026-07-20T11:00:00Z" },
    { id: "fresh-ai-2", app_category: "AI / ML", published: "2026-07-20T10:00:00Z" },
    { id: "older-science", app_category: "Science", published: "2026-07-19T10:00:00Z" },
  ];

  assert.deepEqual(balanceByCategory(input, now).map((article) => article.id), [
    "fresh-ai-1", "fresh-ai-2", "older-science",
  ]);
});

test("withAppCategory adds a canonical field without mutating the input", () => {
  const input = { id: "one", section: "Hardware" };
  assert.deepEqual(withAppCategory(input), { ...input, app_category: "Hardware & Gadgets" });
  assert.equal(input.app_category, undefined);
});

test("educational YouTube sources are canonical, categorized video feeds", () => {
  const expected = new Map([
    ["youtube-fireship", ["UCsBjURrPoezykLs9EqgamOA", "Coding & Dev Tools", "@Fireship"]],
    ["youtube-two-minute-papers", ["UCbfYPyITQ-7l4upoX8nvctg", "AI / ML", "@TwoMinutePapers"]],
    ["youtube-computerphile", ["UC9-y-6csu5WGm29I7JiwpnA", "Coding & Dev Tools", "@Computerphile"]],
    ["youtube-veritasium", ["UCHnyfMqiRRG1u-2MsSQLbXA", "Science", "@veritasium"]],
  ]);
  const sources = SOURCES.filter((source) => expected.has(source.id));

  assert.equal(sources.length, expected.size);
  for (const source of sources) {
    const [channel, category, handle] = expected.get(source.id);
    assert.equal(source.url, `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`);
    assert.equal(source.youtubePageUrl, `https://www.youtube.com/${handle}/videos`);
    assert.equal(source.cat, category);
    assert.equal(source.contentType, "video");
    assert.equal(source.userAgent, "TechScroll/1.0");
    assert.equal(source.fallbackUserAgent, "YouTube-RSS/1.0");
  }
});

test("YouTube Atom parser preserves real video metadata", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
      <entry>
        <title>Every JavaScript framework in 100 seconds</title>
        <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
        <author><name>Fireship</name></author>
        <published>2026-07-20T18:30:00+00:00</published>
        <media:group>
          <media:thumbnail url="https://i.ytimg.com/vi/abc123/hqdefault.jpg" width="480" height="360"/>
          <media:description>A fast software lesson.</media:description>
        </media:group>
      </entry>
    </feed>`;
  const source = SOURCES.find((item) => item.id === "youtube-fireship");

  const [video] = parseFeed(xml, source);
  assert.equal(video.link, "https://www.youtube.com/watch?v=abc123");
  assert.equal(video.image, "https://i.ytimg.com/vi/abc123/hqdefault.jpg");
  assert.equal(video.source, "Fireship");
  assert.equal(video.source_id, "youtube-fireship");
  assert.equal(video.published, "2026-07-20T18:30:00.000Z");
  assert.equal(video.summary, "A fast software lesson.");
  assert.equal(video.content_type, "video");
  assert.equal(video.categories.at(-1), "Coding & Dev Tools");
  assert.equal(classifyArticle(video), "Coding & Dev Tools");
});

test("article titles beginning with video are not mislabeled as videos", () => {
  const source = {
    id: "publisher", name: "Publisher", region: "Global", focus: "Technology", max: 2,
  };
  const xml = `<rss><channel>
    <item><title>Video-generation startup raises funding</title>
      <link>https://example.com/2026/07/video-generation-startup</link>
      <pubDate>Sun, 20 Jul 2026 12:00:00 GMT</pubDate></item>
    <item><title>A real publisher video</title>
      <link>https://example.com/video/new-robot</link>
      <pubDate>Sun, 20 Jul 2026 11:00:00 GMT</pubDate></item>
  </channel></rss>`;

  const [article, video] = parseFeed(xml, source);
  assert.equal(article.content_type, "article");
  assert.equal(video.content_type, "video");
});

test("YouTube channel-page fallback preserves current video metadata", () => {
  const initialData = {
    contents: [{
      contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      contentId: "fresh123",
      contentImage: { thumbnailViewModel: {} },
      metadata: {
        lockupMetadataViewModel: {
          title: { content: "A new computer science lesson" },
          metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [
            { text: { content: "12K views" } },
            { text: { content: "3 days ago" } },
          ] }] } },
        },
      },
    }],
  };
  const html = `<html><script>var ytInitialData = ${JSON.stringify(initialData)};</script></html>`;
  const source = SOURCES.find((item) => item.id === "youtube-computerphile");

  const [video] = parseYouTubeChannelPage(html, source, new Date("2026-07-20T12:00:00Z"));
  assert.equal(video.link, "https://www.youtube.com/watch?v=fresh123");
  assert.equal(video.image, "https://i.ytimg.com/vi/fresh123/hqdefault.jpg");
  assert.equal(video.source, "Computerphile");
  assert.equal(video.published, "2026-07-17T12:00:00.000Z");
  assert.equal(video.content_type, "video");
  assert.equal(video.categories.at(-1), "Coding & Dev Tools");
});
