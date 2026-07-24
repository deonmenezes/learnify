import assert from "node:assert/strict";
import test from "node:test";

import { validatedSummaryFields } from "../lib/feeds.js";
import { aiSummarize, isSummaryUseful, streamline } from "../lib/summarize.js";

const title = "OpenAI launches a faster model for software developers";

test("summary quality gate rejects unsafe and low-information failure shapes", () => {
  const rejected = [
    "Get 500 free credits today at https://example.com/learnify.",
    "Sponsor message: Developers can use code SAVE50 to receive free credits today.",
    "OpenAI launches a faster model for software developers.",
    "OpenAI launched its faster model for software developers, and it is available.",
    "Researchers mapped model failures across repeated evaluations and found substantially higher reliability\u2026",
    "Researchers documented gains across ten controlled trials and reported stable results",
    "Researchers reproduced the result independently and posted the complete benchmark at example.com.",
    "Researchers documented substantial efficiency gains throughout extensive laboratory trials.",
    "Teams saw ten gains in five short lab tests today.",
    "Researchers mapped the samples across every test group before labeling the final cluster a.",
  ];

  for (const summary of rejected) {
    assert.equal(isSummaryUseful(summary, { title }), false, summary);
  }
});

test("summary quality gate accepts concise factual sentences", () => {
  const accepted = [
    "Researchers found that the battery retained 92 percent of its capacity after 1,000 charge cycles.",
    "Apple will release the update in September, adding offline translation for six more languages.",
    "Snowflake signed a $6 billion agreement to use Amazon.com Inc. cloud services and chips.",
  ];

  for (const summary of accepted) {
    assert.equal(isSummaryUseful(summary, { title }), true, summary);
  }
});

test("streamline skips a headline copy and keeps the useful complete sentence", () => {
  const summary = [
    `${title}.`,
    "The release cuts inference costs by 40 percent and supports a larger context window.",
  ].join(" ");

  assert.equal(
    streamline({ title, summary }),
    "The release cuts inference costs by 40 percent and supports a larger context window.",
  );
});

test("streamline salvages complete facts but never clips an incomplete sentence", () => {
  const complete = "The trial enrolled 240 adults and tracked their sleep for six months.";
  const clipped = "Researchers plan to expand the study across five more clinics\u2026";

  assert.equal(streamline({ title, summary: `${complete} ${clipped}` }), complete);
  assert.equal(streamline({ title, summary: clipped }), "");
});

test("streamline returns empty rather than a slogan, URL, or headline fallback", () => {
  assert.equal(streamline({ title, summary: "Smarter learning starts with better scrolling." }), "");
  assert.equal(streamline({ title, summary: "Claim free credits at https://example.com/start." }), "");
  assert.equal(streamline({ title, summary: "" }), "");
});

test("feed output cannot restore a rejected publisher summary through a fallback", () => {
  const unsafe = "Sponsor message: Developers can claim 500 free credits at https://example.com/start.";
  const rejected = validatedSummaryFields({ title, summary: unsafe });

  assert.deepEqual(rejected, {
    summary: "",
    ai_summary: "",
    ai_summary_kind: null,
  });
  assert.equal(rejected.ai_summary || rejected.summary, "");

  const safe = "The release cuts inference costs by 40 percent and supports a larger context window.";
  assert.deepEqual(validatedSummaryFields({ title, summary: unsafe }, { ai_summary: safe }), {
    summary: safe,
    ai_summary: safe,
    ai_summary_kind: "ai",
  });
});

test("AI summaries pass through the same deterministic quality gate", async (t) => {
  const originalKey = process.env.NVIDIA_API_KEY;
  const originalFetch = globalThis.fetch;
  let output = "Get 500 free credits today at https://example.com/learnify.";

  process.env.NVIDIA_API_KEY = "test-key";
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: output } }] }),
  });
  t.after(() => {
    if (originalKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  const article = { title, summary: "The publisher supplied a complete factual excerpt about the release." };
  assert.equal(await aiSummarize(article), null);

  output = "The release cuts inference costs by 40 percent and supports a larger context window.";
  assert.equal(await aiSummarize(article), output);
});
