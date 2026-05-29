#!/usr/bin/env python3
"""TechScrollDataCach — local TechCrunch scraper (no Apify, no hosted service).

Primary source is TechCrunch's own WordPress REST API
(``/wp-json/wp/v2/posts``), queried with ``_fields`` so each post is ~8 KB and
arrives with its **featured image**, keyword slugs, author and excerpt already
attached — no per-article HTML scraping and no third-party scraping platform.

If the REST API is ever unreachable it transparently falls back to parsing the
public RSS feeds (no images in that mode). Standard library only — runs anywhere
Python 3.8+ is installed.

Usage:
    python3 scrape.py                 # newest ~200 articles -> ./articles.json
    python3 scrape.py --pages 4       # newest ~400 articles
    python3 scrape.py --out feed.json
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
from urllib.parse import quote
from urllib.request import Request, urlopen

WP_API = "https://techcrunch.com/wp-json/wp/v2/posts"
WP_FIELDS = "id,date_gmt,link,title,excerpt,jetpack_featured_media_url,class_list,yoast_head_json"

# RSS fallback (no images) — used only if the REST API fails entirely.
RSS_FEEDS = [
    ("Top", "https://techcrunch.com/feed/"),
    ("AI", "https://techcrunch.com/category/artificial-intelligence/feed/"),
    ("Startups", "https://techcrunch.com/category/startups/feed/"),
    ("Security", "https://techcrunch.com/category/security/feed/"),
    ("Venture", "https://techcrunch.com/category/venture/feed/"),
    ("Fintech", "https://techcrunch.com/category/fintech/feed/"),
]

UA = "Mozilla/5.0 (compatible; TechScrollDataCach/1.0; +https://github.com/)"
TAG_RE = re.compile(r"<[^>]+>")

# Slug -> display-name helpers so "category-artificial-intelligence" reads nicely.
ACRONYMS = {
    "ai", "api", "ar", "vr", "xr", "ev", "evs", "ipo", "ico", "saas", "gpu",
    "cpu", "ml", "llm", "llms", "ux", "ui", "us", "usa", "uk", "eu", "uae",
    "ceo", "cto", "cfo", "ftc", "sec", "fcc", "nasa", "ces", "b2b", "b2c",
    "sdk", "vc", "vcs", "nft", "nfts", "5g", "6g", "aws", "roi", "iot", "vpn",
}
BRANDS = {
    "openai": "OpenAI", "chatgpt": "ChatGPT", "github": "GitHub",
    "youtube": "YouTube", "tiktok": "TikTok", "iphone": "iPhone",
    "ipad": "iPad", "macos": "macOS", "ios": "iOS", "deepmind": "DeepMind",
    "paypal": "PayPal", "linkedin": "LinkedIn", "wechat": "WeChat",
    "spacex": "SpaceX", "whatsapp": "WhatsApp", "deepseek": "DeepSeek",
    "xai": "xAI", "anthropic": "Anthropic", "nvidia": "Nvidia",
}


def prettify(slug: str) -> str:
    if slug in BRANDS:
        return BRANDS[slug]
    out = []
    for w in slug.split("-"):
        if w.isdigit():            # drop WP dedup suffixes like "...-2"
            continue
        if w in BRANDS:
            out.append(BRANDS[w])
        elif w in ACRONYMS:
            out.append(w.upper())
        elif w:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def clean_text(raw: str, limit: int = 320) -> str:
    txt = TAG_RE.sub("", html.unescape(raw or ""))
    txt = re.sub(r"\s+", " ", txt).strip()
    txt = re.sub(r"\[…\]$|\[…\]$", "…", txt).strip()
    if len(txt) > limit:
        txt = txt[:limit].rsplit(" ", 1)[0] + "…"
    return txt


def fetch(url: str, timeout: int = 30) -> bytes:
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urlopen(req, timeout=timeout) as resp:  # noqa: S310 (trusted host)
        return resp.read()


def parse_wp_post(p: dict) -> dict | None:
    link = (p.get("link") or "").strip()
    title = clean_text((p.get("title") or {}).get("rendered", ""), 300)
    if not link or not title:
        return None
    yoast = p.get("yoast_head_json") or {}
    image = (p.get("jetpack_featured_media_url") or "").strip()
    if not image:
        og = yoast.get("og_image") or []
        if og:
            image = (og[0].get("url") or "").split("?")[0]
    # Keyword slugs from CSS class list -> {category-*, tag-*}.
    cats, tags = [], []
    for c in p.get("class_list", []) or []:
        if c.startswith("category-"):
            cats.append(prettify(c[len("category-"):]))
        elif c.startswith("tag-"):
            tags.append(prettify(c[len("tag-"):]))
    keywords = list(dict.fromkeys(cats + tags))
    iso = ""
    dg = p.get("date_gmt")
    if dg:
        try:
            iso = datetime.fromisoformat(dg).replace(tzinfo=timezone.utc).isoformat()
        except Exception:
            iso = ""
    return {
        "title": title,
        "link": link,
        "author": (yoast.get("author") or "").strip(),
        "published": iso,
        "image": image or None,
        "section": cats[0] if cats else "TechCrunch",
        "categories": keywords,
        "summary": clean_text((p.get("excerpt") or {}).get("rendered", "")),
    }


def collect_wp(pages: int, per_page: int) -> list[dict]:
    by_link: dict[str, dict] = {}
    for page in range(1, pages + 1):
        url = (f"{WP_API}?per_page={per_page}&page={page}"
               f"&_fields={quote(WP_FIELDS, safe=',')}&orderby=date&order=desc")
        try:
            posts = json.loads(fetch(url).decode("utf-8", "replace"))
        except Exception as exc:
            print(f"  [WP page {page}] FAILED: {exc}", file=sys.stderr)
            break
        if not isinstance(posts, list) or not posts:
            break
        n = 0
        for p in posts:
            art = parse_wp_post(p)
            if art and art["link"] not in by_link:
                by_link[art["link"]] = art
                n += 1
        with_img = sum(1 for a in by_link.values() if a["image"])
        print(f"  [WP page {page}] +{n} posts  ({with_img} with images)", file=sys.stderr)
        if len(posts) < per_page:
            break
    return list(by_link.values())


# ---- RSS fallback (images unavailable in RSS) -----------------------------
def parse_rss(xml: str, section: str) -> list[dict]:
    out = []
    for block in re.findall(r"<item>(.*?)</item>", xml, re.S):
        def first(pat):
            m = re.search(pat, block, re.S)
            if not m:
                return ""
            t = m.group(1).strip()
            cd = re.match(r"^<!\[CDATA\[(.*)\]\]>$", t, re.S)
            return cd.group(1) if cd else t
        link = html.unescape(first(r"<link>(.*?)</link>")).strip()
        title = html.unescape(first(r"<title>(.*?)</title>")).strip()
        if not link or not title:
            continue
        cats = [html.unescape(re.sub(r"^<!\[CDATA\[|\]\]>$", "", c).strip())
                for c in re.findall(r"<category>(.*?)</category>", block, re.S)]
        pub = first(r"<pubDate>(.*?)</pubDate>")
        try:
            iso = parsedate_to_datetime(pub).astimezone(timezone.utc).isoformat()
        except Exception:
            iso = ""
        out.append({
            "title": title, "link": link,
            "author": html.unescape(first(r"<dc:creator>(.*?)</dc:creator>")).strip(),
            "published": iso, "image": None, "section": section,
            "categories": cats, "summary": clean_text(first(r"<description>(.*?)</description>")),
        })
    return out


def collect_rss() -> list[dict]:
    by_link: dict[str, dict] = {}
    for section, url in RSS_FEEDS:
        try:
            for art in parse_rss(fetch(url).decode("utf-8", "replace"), section):
                by_link.setdefault(art["link"], art)
        except Exception as exc:
            print(f"  [RSS {section}] FAILED: {exc}", file=sys.stderr)
    return list(by_link.values())


def main() -> int:
    ap = argparse.ArgumentParser(description="Scrape latest TechCrunch articles (with images) to JSON.")
    ap.add_argument("--out", default=str(Path(__file__).with_name("articles.json")))
    ap.add_argument("--pages", type=int, default=2, help="WP API pages to pull (100 posts each)")
    ap.add_argument("--per-page", type=int, default=100)
    args = ap.parse_args()

    print("Scraping TechCrunch via WordPress REST API…", file=sys.stderr)
    source = "TechCrunch WP REST API"
    articles = collect_wp(args.pages, min(args.per_page, 100))
    if not articles:
        print("WP API unavailable — falling back to RSS (no images).", file=sys.stderr)
        articles = collect_rss()
        source = "TechCrunch RSS (fallback)"

    articles.sort(key=lambda a: a["published"], reverse=True)
    payload = {
        "source": source,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(articles),
        "with_images": sum(1 for a in articles if a.get("image")),
        "articles": articles,
    }
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(articles)} articles "
          f"({payload['with_images']} with images) -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
