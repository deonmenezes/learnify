#!/usr/bin/env python3
"""TechScrollDataCach — local multi-source tech-news scraper (no Apify).

Aggregates Silicon Valley / San Francisco focused tech outlets into one
normalised, fully-labelled JSON feed. WordPress outlets are pulled from their
REST API (`_fields`-trimmed, images included); RSS/Atom outlets are parsed
directly with image extraction. Standard library only.

Every article is labelled with: source, source_id, region, focus, content_type,
id, plus title/link/author/published/image/thumbnail/section/categories/summary.

Usage:
    python3 scrape.py                 # newest articles across all sources
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

# id, name, region, focus, type, url, [pages]
SOURCES = [
    {"id": "techcrunch",    "name": "TechCrunch",        "region": "SF Bay Area",    "focus": "Startups & VC",
     "type": "wp",  "url": "https://techcrunch.com/wp-json/wp/v2/posts", "pages": 2},
    {"id": "siliconvalley", "name": "SiliconValley.com", "region": "Silicon Valley", "focus": "Valley business & tech",
     "type": "wp",  "url": "https://www.siliconvalley.com/wp-json/wp/v2/posts", "pages": 1},
    {"id": "wired",         "name": "Wired",             "region": "San Francisco",  "focus": "Tech, science & culture",
     "type": "rss", "url": "https://www.wired.com/feed/rss"},
    {"id": "theverge",      "name": "The Verge",         "region": "National",       "focus": "Consumer tech",
     "type": "rss", "url": "https://www.theverge.com/rss/index.xml"},
    {"id": "arstechnica",   "name": "Ars Technica",      "region": "National",       "focus": "Deep tech & policy",
     "type": "rss", "url": "https://feeds.arstechnica.com/arstechnica/index"},
]

WP_FIELDS = "id,date_gmt,link,title,excerpt,jetpack_featured_media_url,class_list,yoast_head_json"
WP_PER_PAGE = 100
RSS_MAX = 30
UA = "Mozilla/5.0 (compatible; TechScrollDataCach/1.0; +https://github.com/)"
TAG_RE = re.compile(r"<[^>]+>")

ACRONYMS = {
    "ai","api","ar","vr","xr","ev","evs","ipo","ico","saas","gpu","cpu","ml",
    "llm","llms","ux","ui","us","usa","uk","eu","uae","ceo","cto","cfo","ftc",
    "sec","fcc","nasa","ces","b2b","b2c","sdk","vc","vcs","nft","nfts","5g",
    "6g","aws","roi","iot","vpn",
}
BRANDS = {
    "openai":"OpenAI","chatgpt":"ChatGPT","github":"GitHub","youtube":"YouTube",
    "tiktok":"TikTok","iphone":"iPhone","ipad":"iPad","macos":"macOS","ios":"iOS",
    "deepmind":"DeepMind","paypal":"PayPal","linkedin":"LinkedIn","wechat":"WeChat",
    "spacex":"SpaceX","whatsapp":"WhatsApp","deepseek":"DeepSeek","xai":"xAI",
    "anthropic":"Anthropic","nvidia":"Nvidia",
}


def prettify(slug: str) -> str:
    if slug in BRANDS:
        return BRANDS[slug]
    out = []
    for w in slug.split("-"):
        if w.isdigit():
            continue
        if w in BRANDS:
            out.append(BRANDS[w])
        elif w in ACRONYMS:
            out.append(w.upper())
        elif w:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def strip_cdata(text: str) -> str:
    m = re.match(r"^<!\[CDATA\[(.*)\]\]>$", (text or "").strip(), re.S)
    return (m.group(1) if m else (text or "")).strip()


def clean_text(raw: str, limit: int = 320) -> str:
    txt = TAG_RE.sub("", html.unescape(strip_cdata(raw or "")))
    txt = re.sub(r"\s+", " ", txt).strip()
    txt = re.sub(r"Read full article.*$", "", txt, flags=re.I).strip()
    txt = re.sub(r"Comments$", "", txt).strip()
    if len(txt) > limit:
        txt = txt[:limit].rsplit(" ", 1)[0] + "…"
    return txt


def to_base36(n: int) -> str:
    if n == 0:
        return "0"
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while n > 0:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out


def short_id(s: str) -> str:
    h = 5381
    for ch in s:
        h = ((h * 33) ^ ord(ch)) & 0xFFFFFFFF
    return to_base36(h)


def thumbnail(url: str | None, w: int = 420, h: int = 260) -> str | None:
    if not url:
        return None
    return url + ("&" if "?" in url else "?") + f"w={w}&h={h}&crop=1"


def content_type(link: str) -> str:
    if re.search(r"/video[/-]", link):
        return "video"
    if re.search(r"/podcast|/episode", link):
        return "podcast"
    return "article"


def to_iso(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    try:
        return parsedate_to_datetime(raw).astimezone(timezone.utc).isoformat()
    except Exception:
        pass
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return ""


def label(src: dict, art: dict) -> dict:
    art["source"] = src["name"]
    art["source_id"] = src["id"]
    art["region"] = src["region"]
    art["focus"] = src["focus"]
    art["id"] = short_id(art["link"])
    art["content_type"] = content_type(art["link"])
    art["thumbnail"] = thumbnail(art.get("image"))
    if not art.get("section"):
        art["section"] = (art.get("categories") or [None])[0] or src["focus"]
    return art


def fetch(url: str, timeout: int = 25) -> bytes:
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urlopen(req, timeout=timeout) as resp:  # noqa: S310 (trusted hosts)
        return resp.read()


# ---- WordPress REST --------------------------------------------------------
def parse_wp_post(p: dict, src: dict) -> dict | None:
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
    cats, tags = [], []
    for c in p.get("class_list", []) or []:
        if c.startswith("category-"):
            cats.append(prettify(c[len("category-"):]))
        elif c.startswith("tag-"):
            tags.append(prettify(c[len("tag-"):]))
    iso = ""
    if p.get("date_gmt"):
        try:
            iso = datetime.fromisoformat(p["date_gmt"]).replace(tzinfo=timezone.utc).isoformat()
        except Exception:
            iso = ""
    return label(src, {
        "title": title, "link": link,
        "author": (yoast.get("author") or "").strip(),
        "published": iso,
        "image": image or None,
        "section": cats[0] if cats else "",
        "categories": [c for c in dict.fromkeys(cats + tags) if c],
        "summary": clean_text((p.get("excerpt") or {}).get("rendered", "")),
    })


def collect_wp(src: dict) -> list[dict]:
    out = []
    for page in range(1, src.get("pages", 1) + 1):
        url = (f"{src['url']}?per_page={WP_PER_PAGE}&page={page}"
               f"&_fields={quote(WP_FIELDS, safe=',')}&orderby=date&order=desc")
        try:
            posts = json.loads(fetch(url).decode("utf-8", "replace"))
        except Exception as exc:
            print(f"    page {page} failed: {exc}", file=sys.stderr)
            break
        if not isinstance(posts, list) or not posts:
            break
        for p in posts:
            a = parse_wp_post(p, src)
            if a:
                out.append(a)
        if len(posts) < WP_PER_PAGE:
            break
    return out


# ---- RSS / Atom ------------------------------------------------------------
def extract_image(block: str) -> str | None:
    m = re.search(r'<media:content[^>]*\burl="([^"]+)"', block, re.I)
    if m and re.search(r"\.(jpe?g|png|webp|gif|avif)", m.group(1), re.I):
        return m.group(1)
    m = re.search(r'<media:thumbnail[^>]*\burl="([^"]+)"', block, re.I)
    if m:
        return m.group(1)
    m = (re.search(r'<enclosure[^>]*\burl="([^"]+)"[^>]*type="image[^"]*"', block, re.I)
         or re.search(r'<enclosure[^>]*type="image[^"]*"[^>]*\burl="([^"]+)"', block, re.I))
    if m:
        return m.group(1)
    html_blob = ""
    for pat in (r"<content:encoded>(.*?)</content:encoded>", r"<content\b[^>]*>(.*?)</content>",
                r"<description>(.*?)</description>", r"<summary\b[^>]*>(.*?)</summary>"):
        mm = re.search(pat, block, re.S | re.I)
        if mm:
            html_blob = mm.group(1)
            break
    m = re.search(r'<img[^>]*\bsrc="([^"]+)"', html.unescape(strip_cdata(html_blob)), re.I)
    return m.group(1) if m else None


def parse_feed(xml: str, src: dict) -> list[dict]:
    is_atom = bool(re.search(r"<entry[\s>]", xml)) and not re.search(r"<item[\s>]", xml)
    blocks = re.findall(r"<entry[\s>].*?</entry>" if is_atom else r"<item[\s>].*?</item>", xml, re.S)
    out = []
    for b in blocks[:RSS_MAX]:
        def f(pat):
            m = re.search(pat, b, re.S | re.I)
            return strip_cdata(m.group(1)) if m else ""
        title = html.unescape(f(r"<title\b[^>]*>(.*?)</title>")).strip()
        if is_atom:
            m = (re.search(r'<link[^>]*\brel="alternate"[^>]*\bhref="([^"]+)"', b, re.I)
                 or re.search(r'<link[^>]*\bhref="([^"]+)"', b, re.I))
            link = m.group(1) if m else ""
        else:
            link = f(r"<link>(.*?)</link>")
        link = html.unescape(link).strip()
        if not title or not link:
            continue
        author = f(r"<dc:creator>(.*?)</dc:creator>")
        if not author:
            m = re.search(r"<author>.*?<name>(.*?)</name>", b, re.S | re.I)
            author = m.group(1) if m else f(r"<author>(.*?)</author>")
        author = html.unescape(strip_cdata(author)).strip()
        if is_atom:
            cats = [html.unescape(c) for c in re.findall(r'<category[^>]*\bterm="([^"]+)"', b, re.I)]
        else:
            cats = [html.unescape(strip_cdata(c)) for c in re.findall(r"<category>(.*?)</category>", b, re.S)]
        date_raw = f(r"<pubDate>(.*?)</pubDate>") or f(r"<published>(.*?)</published>") or f(r"<updated>(.*?)</updated>")
        summary_raw = (f(r"<description>(.*?)</description>") or f(r"<summary\b[^>]*>(.*?)</summary>")
                       or f(r"<content\b[^>]*>(.*?)</content>"))
        out.append(label(src, {
            "title": title, "link": link, "author": author,
            "published": to_iso(date_raw),
            "image": extract_image(b),
            "section": cats[0] if cats else "",
            "categories": list(dict.fromkeys(cats))[:12],
            "summary": clean_text(summary_raw),
        }))
    return out


def collect_feed(src: dict) -> list[dict]:
    return parse_feed(fetch(src["url"]).decode("utf-8", "replace"), src)


def collect() -> tuple[list[str], list[dict]]:
    by_link: dict[str, dict] = {}
    ok_sources: list[str] = []
    for src in SOURCES:
        try:
            items = collect_wp(src) if src["type"] == "wp" else collect_feed(src)
        except Exception as exc:
            print(f"  [{src['name']:>18}] FAILED: {exc}", file=sys.stderr)
            continue
        if not items:
            print(f"  [{src['name']:>18}] no items", file=sys.stderr)
            continue
        ok_sources.append(src["name"])
        n = 0
        for a in items:
            key = a["link"].rstrip("/")
            if key not in by_link:
                by_link[key] = a
                n += 1
        with_img = sum(1 for a in items if a.get("image"))
        print(f"  [{src['name']:>18}] +{n:>3} ({with_img} with images)", file=sys.stderr)
    articles = sorted(by_link.values(), key=lambda a: a["published"], reverse=True)
    return ok_sources, articles


def main() -> int:
    ap = argparse.ArgumentParser(description="Scrape latest SV/SF tech news (multi-source, with images) to JSON.")
    ap.add_argument("--out", default=str(Path(__file__).with_name("articles.json")))
    args = ap.parse_args()

    print("Scraping Silicon Valley / SF tech sources…", file=sys.stderr)
    sources, articles = collect()
    payload = {
        "sources": sources,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(articles),
        "with_images": sum(1 for a in articles if a.get("image")),
        "articles": articles,
    }
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(articles)} articles from {len(sources)} sources "
          f"({payload['with_images']} with images) -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
