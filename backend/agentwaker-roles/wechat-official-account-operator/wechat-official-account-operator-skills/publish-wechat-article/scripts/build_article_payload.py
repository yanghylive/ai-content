#!/usr/bin/env python3
"""Build a validated WeChat draft create or update JSON payload from HTML."""

from __future__ import annotations

import argparse
import json
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


class ImageInspector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.invalid_images: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "img":
            return
        attributes = {key.lower(): value for key, value in attrs}
        source = str(attributes.get("src") or "").strip()
        scheme = urlsplit(source).scheme.lower()
        if scheme not in {"http", "https"} or "data-local-image" in attributes:
            self.invalid_images.append(source or "missing-src")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a WeChat draft JSON payload from an HTML fragment.")
    parser.add_argument("--html", required=True, type=Path)
    parser.add_argument("--title", required=True)
    parser.add_argument("--author", required=True)
    parser.add_argument("--digest", required=True)
    parser.add_argument("--cover-media-id", required=True)
    parser.add_argument("--source-url")
    parser.add_argument("--open-comments", action="store_true")
    parser.add_argument("--fans-only-comments", action="store_true")
    parser.add_argument("--media-id", help="Build an update payload for this existing draft")
    parser.add_argument("--index", type=int, default=0, help="Zero-based article index for update")
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        content = args.html.read_text(encoding="utf-8").strip()
    except OSError as error:
        print(f"error: cannot read HTML: {error}", file=sys.stderr)
        return 2
    if not content:
        print("error: HTML content is empty", file=sys.stderr)
        return 2
    lowered = content.lower()
    if "<!doctype" in lowered or "<html" in lowered or "<body" in lowered:
        print("error: use an HTML fragment, not a standalone preview document", file=sys.stderr)
        return 2
    inspector = ImageInspector()
    try:
        inspector.feed(content)
    except Exception as error:
        print(f"error: cannot parse HTML: {error}", file=sys.stderr)
        return 2
    if inspector.invalid_images:
        sample = ", ".join(inspector.invalid_images[:3])
        print(f"error: upload local or unsupported images first and replace their src values: {sample}", file=sys.stderr)
        return 2
    if args.source_url and urlsplit(args.source_url).scheme not in {"http", "https"}:
        print("error: source-url must use http or https", file=sys.stderr)
        return 2
    if args.index < 0:
        print("error: index cannot be negative", file=sys.stderr)
        return 2

    article = {
        "title": args.title.strip(),
        "author": args.author.strip(),
        "digest": args.digest.strip(),
        "content": content,
        "thumb_media_id": args.cover_media_id.strip(),
        "need_open_comment": int(args.open_comments),
        "only_fans_can_comment": int(args.fans_only_comments),
    }
    if not all((article["title"], article["author"], article["digest"], article["thumb_media_id"])):
        print("error: title, author, digest, and cover-media-id cannot be blank", file=sys.stderr)
        return 2
    if args.source_url:
        article["content_source_url"] = args.source_url
    if args.media_id:
        payload = {"media_id": args.media_id, "index": args.index, "articles": article}
    else:
        payload = {"articles": [article]}
    try:
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError as error:
        print(f"error: cannot write payload: {error}", file=sys.stderr)
        return 2
    print(f"payload: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
