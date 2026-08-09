#!/usr/bin/env python3
"""Rank and deduplicate normalized editorial signal records using only stdlib."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


TRACKING_KEYS = {
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "source",
    "spm",
}

WEIGHTS = {
    "relevance": 20.0,
    "evidence": 18.0,
    "source_quality": 15.0,
    "reader_utility": 15.0,
    "technical_depth": 12.0,
    "novelty": 8.0,
    "recency": 7.0,
    "reproduction_ready": 5.0,
    "promotional_risk": -10.0,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Score and deduplicate AI editorial candidates from a JSON file."
    )
    parser.add_argument("input", type=Path, help="JSON array or object containing an items array")
    parser.add_argument("--output", type=Path, help="Write output to this path; stdout when omitted")
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    parser.add_argument(
        "--as-of",
        type=date.fromisoformat,
        default=date.today(),
        help="Scoring date in YYYY-MM-DD format",
    )
    parser.add_argument("--min-score", type=float, default=0.0)
    return parser.parse_args()


def clamp(value: Any, low: float = 0.0, high: float = 5.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return low
    if math.isnan(number) or math.isinf(number):
        return low
    return max(low, min(high, number))


def canonicalize_url(raw: str) -> str:
    parts = urlsplit(raw.strip())
    scheme = parts.scheme.lower()
    host = parts.netloc.lower()
    path = re.sub(r"/{2,}", "/", parts.path).rstrip("/") or "/"
    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        lowered = key.lower()
        if lowered.startswith("utm_") or lowered in TRACKING_KEYS:
            continue
        query.append((key, value))
    return urlunsplit((scheme, host, path, urlencode(sorted(query)), ""))


def normalize_key(raw: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", raw.lower()).strip("-")


def parse_timestamp(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.combine(date.fromisoformat(text[:10]), datetime.min.time())
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def recency_score(published_at: Any, as_of: date) -> tuple[float, int | None]:
    parsed = parse_timestamp(published_at)
    if parsed is None:
        return 0.0, None
    age_days = max(0, (as_of - parsed.date()).days)
    if age_days <= 2:
        return 5.0, age_days
    if age_days <= 7:
        return 4.0, age_days
    if age_days <= 30:
        return 3.0, age_days
    if age_days <= 90:
        return 2.0, age_days
    if age_days <= 180:
        return 1.0, age_days
    return 0.0, age_days


def disposition(score: float, item: dict[str, Any]) -> str:
    scores = item.get("scores") or {}
    if score >= 78 and clamp(scores.get("evidence")) >= 3 and item.get("evidence_url"):
        return "deep-tutorial"
    if score >= 65:
        return "brief-or-series-candidate"
    if score >= 50:
        return "watch"
    return "discard"


def score_item(item: dict[str, Any], as_of: date) -> dict[str, Any]:
    scores = item.get("scores") if isinstance(item.get("scores"), dict) else {}
    tier = int(clamp(item.get("source_tier", 5), 1, 5))
    source_quality = float(6 - tier)
    recent, age_days = recency_score(item.get("published_at"), as_of)
    reproduction = 5.0 if item.get("reproduction_ready") is True else 0.0

    normalized = {
        "relevance": clamp(scores.get("relevance")),
        "evidence": clamp(scores.get("evidence")),
        "source_quality": source_quality,
        "reader_utility": clamp(scores.get("reader_utility")),
        "technical_depth": clamp(scores.get("technical_depth")),
        "novelty": clamp(scores.get("novelty")),
        "recency": recent,
        "reproduction_ready": reproduction,
        "promotional_risk": clamp(scores.get("promotional_risk")),
    }

    breakdown: dict[str, float] = {}
    total = 0.0
    for name, weight in WEIGHTS.items():
        contribution = normalized[name] / 5.0 * weight
        breakdown[name] = round(contribution, 2)
        total += contribution
    total = round(max(0.0, min(100.0, total)), 2)

    enriched = dict(item)
    enriched["url"] = canonicalize_url(str(item["url"]))
    enriched["score"] = total
    enriched["score_breakdown"] = breakdown
    enriched["age_days"] = age_days
    enriched["disposition"] = disposition(total, item)
    return enriched


def dedupe_key(item: dict[str, Any]) -> str:
    event = str(item.get("canonical_event") or "").strip()
    if event:
        return "event:" + normalize_key(event)
    return "url:" + item["url"]


def load_items(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        payload = payload.get("items")
    if not isinstance(payload, list):
        raise ValueError("input must be a JSON array or an object with an items array")
    valid = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            raise ValueError(f"item {index} must be an object")
        if not str(item.get("title") or "").strip():
            raise ValueError(f"item {index} is missing title")
        url = str(item.get("url") or "").strip()
        if urlsplit(url).scheme not in {"http", "https"}:
            raise ValueError(f"item {index} has an invalid http(s) url")
        valid.append(item)
    return valid


def rank(items: list[dict[str, Any]], as_of: date) -> list[dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for raw in items:
        current = score_item(raw, as_of)
        key = dedupe_key(current)
        previous = selected.get(key)
        if previous is None or current["score"] > previous["score"]:
            winner, duplicate = current, previous
            selected[key] = winner
        else:
            winner, duplicate = previous, current
        if duplicate is not None:
            related = set(winner.get("related_urls") or [])
            related.add(duplicate["url"])
            winner["related_urls"] = sorted(related)
            winner["duplicate_count"] = int(winner.get("duplicate_count") or 0) + 1
    return sorted(selected.values(), key=lambda row: (-row["score"], row["title"].lower()))


def markdown(items: list[dict[str, Any]], as_of: date) -> str:
    lines = [
        f"# Ranked editorial signals as of {as_of.isoformat()}",
        "",
        "| Score | Disposition | Source | Title | Evidence |",
        "|------:|-------------|--------|-------|----------|",
    ]
    for item in items:
        title = str(item["title"]).replace("|", "\\|")
        source = str(item.get("source_id") or item.get("source") or "unknown").replace("|", "\\|")
        evidence = str(item.get("evidence_url") or "")
        evidence_cell = f"[primary]({evidence})" if evidence else "missing"
        lines.append(
            f"| {item['score']:.2f} | {item['disposition']} | {source} | "
            f"[{title}]({item['url']}) | {evidence_cell} |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    try:
        ranked = [row for row in rank(load_items(args.input), args.as_of) if row["score"] >= args.min_score]
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    if args.format == "markdown":
        output = markdown(ranked, args.as_of)
    else:
        output = json.dumps(
            {"as_of": args.as_of.isoformat(), "count": len(ranked), "items": ranked},
            ensure_ascii=False,
            indent=2,
        ) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
