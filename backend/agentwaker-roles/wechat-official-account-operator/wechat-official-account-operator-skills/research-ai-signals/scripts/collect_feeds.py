#!/usr/bin/env python3
"""Collect recent entries from open RSS and Atom feeds using only stdlib."""

from __future__ import annotations

import argparse
import email.utils
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree


USER_AGENT = "AgentWaker-Weaver/1.0 (+local editorial feed collector)"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect open RSS or Atom sources from a JSON registry.")
    parser.add_argument("registry", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--source-id", action="append", default=[], help="Collect only this source; repeatable")
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--per-source", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    return parser.parse_args()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def child_text(node: ElementTree.Element, names: set[str]) -> str:
    for child in list(node):
        if local_name(child.tag) in names and child.text:
            return child.text.strip()
    return ""


def entry_link(node: ElementTree.Element) -> str:
    for child in list(node):
        if local_name(child.tag) != "link":
            continue
        href = (child.attrib.get("href") or "").strip()
        rel = (child.attrib.get("rel") or "alternate").lower()
        if href and rel in {"alternate", ""}:
            return href
        if child.text and child.text.strip():
            return child.text.strip()
    return ""


def parse_date(raw: str) -> datetime | None:
    if not raw:
        return None
    text = raw.strip().replace("Z", "+00:00")
    try:
        value = datetime.fromisoformat(text)
    except ValueError:
        try:
            value = email.utils.parsedate_to_datetime(raw)
        except (TypeError, ValueError):
            return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def parse_feed(content: bytes) -> list[dict[str, str]]:
    text = content.decode("utf-8", errors="replace")
    # Some otherwise useful feeds contain XML 1.0-forbidden control characters
    # inside encoded article text. Remove only those characters before parsing.
    text = re.sub(r"[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\U00010000-\U0010FFFF]", "", text)
    root = ElementTree.fromstring(text)
    entries = [node for node in root.iter() if local_name(node.tag) in {"entry", "item"}]
    parsed = []
    for entry in entries:
        title = child_text(entry, {"title"})
        link = entry_link(entry)
        published = child_text(entry, {"published", "updated", "pubdate", "date"})
        if not title or urlsplit(link).scheme not in {"http", "https"}:
            continue
        parsed.append({"title": title, "url": link, "published_at": published})
    return parsed


def load_registry(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    sources = payload.get("sources") if isinstance(payload, dict) else None
    if not isinstance(sources, list):
        raise ValueError("registry must contain a sources array")
    return [source for source in sources if isinstance(source, dict)]


def fetch(source: dict[str, Any], timeout: float) -> list[dict[str, str]]:
    url = str(source.get("feed_url") or "").strip()
    if urlsplit(url).scheme not in {"http", "https"}:
        raise ValueError("missing valid feed_url")
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/atom+xml, application/rss+xml, application/xml, text/xml"})
    with urlopen(request, timeout=timeout) as response:
        content = response.read(5_000_000)
    return parse_feed(content)


def main() -> int:
    args = parse_args()
    if args.days < 0 or args.per_source < 1 or args.timeout <= 0:
        print("error: days, per-source, and timeout must be positive", file=sys.stderr)
        return 2
    try:
        sources = load_registry(args.registry)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    selected_ids = set(args.source_id)
    cutoff = datetime.combine(args.as_of - timedelta(days=args.days), datetime.min.time(), tzinfo=timezone.utc)
    items: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    attempted = 0

    for source in sources:
        source_id = str(source.get("id") or "").strip()
        if not source_id or source.get("enabled", True) is False or not source.get("feed_url"):
            continue
        if selected_ids and source_id not in selected_ids:
            continue
        attempted += 1
        try:
            entries = fetch(source, args.timeout)
        except Exception as error:  # Network and XML failures are reported per source.
            errors.append({"source_id": source_id, "error": f"{type(error).__name__}: {error}"})
            continue
        defaults = source.get("defaults") if isinstance(source.get("defaults"), dict) else {}
        kept = 0
        for entry in entries:
            published = parse_date(entry["published_at"])
            if published is not None and published < cutoff:
                continue
            item = {
                "title": entry["title"],
                "url": entry["url"],
                "published_at": published.isoformat() if published else None,
                "source_id": source_id,
                "source_tier": source.get("tier", 3),
                "source_type": source.get("type", "feed"),
                "evidence_url": entry["url"] if int(source.get("tier", 3)) <= 2 else None,
                "reproduction_ready": False,
                "scores": {
                    "relevance": defaults.get("relevance", 3),
                    "evidence": defaults.get("evidence", 2 if int(source.get("tier", 3)) <= 2 else 1),
                    "reader_utility": defaults.get("reader_utility", 2),
                    "technical_depth": defaults.get("technical_depth", 2),
                    "novelty": defaults.get("novelty", 2),
                    "promotional_risk": defaults.get("promotional_risk", 1),
                },
            }
            items.append(item)
            kept += 1
            if kept >= args.per_source:
                break

    result = {
        "collection": {
            "as_of": args.as_of.isoformat(),
            "days": args.days,
            "attempted_sources": attempted,
            "successful_sources": attempted - len(errors),
            "errors": errors,
        },
        "items": items,
    }
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    return 0 if items or attempted == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
