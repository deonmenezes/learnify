#!/usr/bin/env python3
"""TechScrollDataCach — TechCrunch latest-articles scraper.

Pulls the latest items from TechCrunch's public RSS feeds (main + categories),
normalises them into a flat list, dedupes by URL, sorts newest-first and writes
``articles.json`` next to this file. Zero third-party dependencies (stdlib only)
so it runs anywhere Python 3.8+ is available.

Usage:
    python3 scrape.py            # writes ./articles.json
    python3 scrape.py --out x.json
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.request import Request, urlopen

# Main feed first, then a spread of category feeds for breadth. Each returns the
# ~20 most recent posts; deduped together this is a few hundred latest articles.
FEEDS = [
    ("Top", "https://techcrunch.com/feed/"),
    ("AI", "https://techcrunch.com/category/artificial-intelligence/feed/"),
    ("Startups", "https://techcrunch.com/category/startups/feed/"),
    ("Security", "https://techcrunch.com/category/security/feed/"),
    ("Venture", "https://techcrunch.com/category/venture/feed/"),
    ("Apps", "https://techcrunch.com/category/apps/feed/"),
    ("Fintech", "https://techcrunch.com/category/fintech/feed/"),
    ("Enterprise", "https://techcrunch.com/category/enterprise/feed/"),
    ("Gadgets", "https://techcrunch.com/category/gadgets/feed/"),
    ("Transportation", "https://techcrunch.com/category/transportation/feed/"),
    ("Climate", "https://techcrunch.com/category/climate/feed/"),
    ("Crypto", "https://techcrunch.com/category/cryptocurrency/feed/"),
]

UA = "Mozilla/5.0 (compatible; TechScrollDataCach/1.0; +https://github.com/)"
TAG_RE = re.compile(r"<[^>]+>")
ITEM_RE = re.compile(r"<item>(.*?)</item>", re.S)


def _strip_cdata(text: str) -> str:
    text = text.strip()
    m = re.match(r"^<!\[CDATA\[(.*)\]\]>$", text, re.S)
    return m.group(1) if m else text


def _first(pattern: str, block: str) -> str:
    m = re.search(pattern, block, re.S)
    return _strip_cdata(m.group(1)) if m else ""


def _clean_text(raw: str, limit: int = 320) -> str:
    txt = html.unescape(_strip_cdata(raw))
    txt = TAG_RE.sub("", txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    # Drop WordPress' boilerplate footer.
    txt = re.sub(r"The post .*? appeared first on TechCrunch\.?$", "", txt).strip()
    if len(txt) > limit:
        txt = txt[:limit].rsplit(" ", 1)[0] + "…"
    return txt


def _iso(pubdate: str) -> str:
    try:
        dt = parsedate_to_datetime(pubdate)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return ""


def parse_feed(xml: str, section: str) -> list[dict]:
    out = []
    for block in ITEM_RE.findall(xml):
        link = html.unescape(_first(r"<link>(.*?)</link>", block)).strip()
        title = html.unescape(_first(r"<title>(.*?)</title>", block)).strip()
        if not link or not title:
            continue
        cats = [html.unescape(_strip_cdata(c)) for c in
                re.findall(r"<category>(.*?)</category>", block, re.S)]
        out.append({
            "title": title,
            "link": link,
            "author": html.unescape(_first(r"<dc:creator>(.*?)</dc:creator>", block)).strip(),
            "published": _iso(_first(r"<pubDate>(.*?)</pubDate>", block)),
            "categories": cats,
            "summary": _clean_text(_first(r"<description>(.*?)</description>", block)),
            "section": section,
        })
    return out


def fetch(url: str, timeout: int = 25) -> str:
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=timeout) as resp:  # noqa: S310 (trusted host)
        return resp.read().decode("utf-8", "replace")


def collect() -> list[dict]:
    by_link: dict[str, dict] = {}
    for section, url in FEEDS:
        try:
            items = parse_feed(fetch(url), section)
            print(f"  [{section:>14}] {len(items):>3} items  {url}", file=sys.stderr)
        except Exception as exc:  # network/parse failure on one feed must not kill the run
            print(f"  [{section:>14}] FAILED: {exc}", file=sys.stderr)
            continue
        for it in items:
            existing = by_link.get(it["link"])
            if existing is None:
                by_link[it["link"]] = it
            else:
                # Merge category coverage across feeds the article appeared in.
                merged = list(dict.fromkeys(existing["categories"] + it["categories"]))
                existing["categories"] = merged
    articles = list(by_link.values())
    articles.sort(key=lambda a: a["published"], reverse=True)
    return articles


def main() -> int:
    ap = argparse.ArgumentParser(description="Scrape latest TechCrunch articles to JSON.")
    ap.add_argument("--out", default=str(Path(__file__).with_name("articles.json")))
    args = ap.parse_args()

    print("Fetching TechCrunch feeds…", file=sys.stderr)
    articles = collect()
    payload = {
        "source": "TechCrunch RSS",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(articles),
        "articles": articles,
    }
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(articles)} articles -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
