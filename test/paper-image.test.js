import test from "node:test";
import assert from "node:assert/strict";
import paperImageHandler from "../api/paper-image.js";

function response() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

test("paper image search requests landscape photos and returns the 2x source", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.PEXELS_API_KEY;
  const requests = [];
  process.env.PEXELS_API_KEY = "test-key";
  global.fetch = async (value) => {
    requests.push(new URL(String(value)));
    return {
      ok: true,
      async json() {
        return {
          photos: [{
            src: {
              large2x: "https://images.pexels.com/paper-large2x.jpg",
              large: "https://images.pexels.com/paper-large.jpg",
              medium: "https://images.pexels.com/paper-medium.jpg",
              original: "https://images.pexels.com/paper-original.jpg",
            },
            photographer: "Ada",
            photographer_url: "https://www.pexels.com/@ada",
            alt: "Research equipment",
          }],
        };
      },
    };
  };

  try {
    const res = response();
    await paperImageHandler({
      method: "GET",
      query: { q: "quantum materials", fallback: "science", seed: "0" },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get("query"), "quantum materials");
    assert.equal(requests[0].searchParams.get("orientation"), "landscape");
    assert.equal(requests[0].searchParams.get("per_page"), "20");
    assert.equal(res.body.url, "https://images.pexels.com/paper-large2x.jpg");
    assert.equal(res.body.thumb, "https://images.pexels.com/paper-medium.jpg");
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.PEXELS_API_KEY;
    } else {
      process.env.PEXELS_API_KEY = originalKey;
    }
  }
});
