#!/usr/bin/env python3
"""Discover current GitHub project candidates through the official REST Search API."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


DEFAULT_API_BASE = "https://api.github.com"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Discover GitHub repositories for editorial triage.")
    parser.add_argument("--query", action="append", default=[], help="GitHub repository search query; repeatable")
    parser.add_argument("--days", type=int, default=14, help="Window for default pushed/created queries")
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    parser.add_argument("--per-query", type=int, default=10)
    parser.add_argument("--include-archived", action="store_true")
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def api_base() -> str:
    value = os.environ.get("GITHUB_API_BASE", DEFAULT_API_BASE).rstrip("/")
    parts = urlsplit(value)
    if parts.scheme == "https" and parts.netloc:
        return value
    if parts.scheme == "http" and parts.hostname in {"127.0.0.1", "localhost", "::1"}:
        return value
    raise ValueError("GITHUB_API_BASE must be HTTPS, except for a localhost test server")


def default_queries(as_of: date, days: int) -> list[str]:
    start = (as_of - timedelta(days=days)).isoformat()
    return [
        f"topic:coding-agent pushed:>={start}",
        f"topic:ai-agent pushed:>={start}",
        f"topic:mcp-server created:>={start}",
        f'("vibe coding" OR "AI coding") in:name,description,readme pushed:>={start}',
    ]


def request_search(query: str, per_page: int, timeout: float) -> tuple[dict[str, Any], dict[str, str]]:
    params = urlencode({"q": query, "sort": "updated", "order": "desc", "per_page": per_page, "page": 1})
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "AgentWaker-Weaver/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(f"{api_base()}/search/repositories?{params}", headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read(10_000_000).decode("utf-8"))
            rate = {
                "limit": response.headers.get("X-RateLimit-Limit", ""),
                "remaining": response.headers.get("X-RateLimit-Remaining", ""),
                "reset": response.headers.get("X-RateLimit-Reset", ""),
                "resource": response.headers.get("X-RateLimit-Resource", ""),
            }
    except HTTPError as error:
        detail = error.read(1_000_000).decode("utf-8", errors="replace")
        try:
            message = json.loads(detail).get("message", detail)
        except json.JSONDecodeError:
            message = detail
        raise RuntimeError(f"GitHub API HTTP {error.code}: {message}") from error
    except (URLError, json.JSONDecodeError) as error:
        raise RuntimeError(f"GitHub API request failed: {error}") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise RuntimeError("GitHub API returned an unexpected response")
    return payload, rate


def candidate(repository: dict[str, Any], query: str) -> dict[str, Any]:
    topics = [str(topic) for topic in repository.get("topics") or []]
    relevance = 4 if {"coding-agent", "ai-agent", "vibe-coding"}.intersection(topics) else 3
    license_data = repository.get("license") if isinstance(repository.get("license"), dict) else {}
    return {
        "title": str(repository.get("full_name") or repository.get("name") or "unknown repository"),
        "url": str(repository.get("html_url") or ""),
        "published_at": repository.get("pushed_at") or repository.get("updated_at"),
        "source_id": "github-rest-search",
        "source_tier": 1,
        "source_type": "official-repository-metadata",
        "canonical_project": str(repository.get("full_name") or ""),
        "evidence_url": str(repository.get("html_url") or ""),
        "reproduction_ready": False,
        "discovery_query": query,
        "scores": {
            "relevance": relevance,
            "evidence": 3,
            "reader_utility": 2,
            "technical_depth": 2,
            "novelty": 3,
            "promotional_risk": 1,
        },
        "github": {
            "node_id": repository.get("node_id"),
            "description": repository.get("description"),
            "created_at": repository.get("created_at"),
            "updated_at": repository.get("updated_at"),
            "pushed_at": repository.get("pushed_at"),
            "stargazers_count": repository.get("stargazers_count"),
            "forks_count": repository.get("forks_count"),
            "open_issues_count": repository.get("open_issues_count"),
            "topics": topics,
            "license": license_data.get("spdx_id"),
            "default_branch": repository.get("default_branch"),
            "archived": repository.get("archived"),
            "disabled": repository.get("disabled"),
            "fork": repository.get("fork"),
        },
    }


def main() -> int:
    args = parse_args()
    if args.days < 1 or not 1 <= args.per_query <= 100 or args.timeout <= 0:
        print("error: days and timeout must be positive; per-query must be between 1 and 100", file=sys.stderr)
        return 2
    queries = args.query or default_queries(args.as_of, args.days)
    projects: dict[str, dict[str, Any]] = {}
    errors: list[dict[str, str]] = []
    rate_limits: list[dict[str, str]] = []
    for query in queries:
        try:
            payload, rate = request_search(query, args.per_query, args.timeout)
            rate["query"] = query
            rate_limits.append(rate)
        except (RuntimeError, ValueError) as error:
            errors.append({"query": query, "error": str(error)})
            continue
        for repository in payload["items"]:
            if not isinstance(repository, dict):
                continue
            if not args.include_archived and (repository.get("archived") or repository.get("disabled")):
                continue
            row = candidate(repository, query)
            if urlsplit(row["url"]).scheme not in {"http", "https"}:
                continue
            key = str(repository.get("node_id") or repository.get("full_name") or row["url"])
            if key not in projects:
                projects[key] = row
            else:
                projects[key].setdefault("additional_queries", []).append(query)
    output_data = {
        "collection": {
            "as_of": args.as_of.isoformat(),
            "queries": queries,
            "authenticated": bool(os.environ.get("GITHUB_TOKEN", "").strip()),
            "rate_limits": rate_limits,
            "errors": errors,
            "warning": "Star count is a snapshot, not growth or quality. Verify releases, contributors, license, installation, and recent deltas before selection."
        },
        "items": list(projects.values()),
    }
    output = json.dumps(output_data, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    return 0 if projects or not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
