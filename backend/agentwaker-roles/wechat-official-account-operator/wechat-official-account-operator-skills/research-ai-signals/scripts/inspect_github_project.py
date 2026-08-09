#!/usr/bin/env python3
"""Capture a dated GitHub project-health evidence snapshot through official REST APIs."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen


DEFAULT_API_BASE = "https://api.github.com"
REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect one GitHub repository for editorial evidence.")
    parser.add_argument("repository", help="owner/repository")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today())
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


class Client:
    def __init__(self, timeout: float):
        self.timeout = timeout
        self.base = api_base()
        self.rate_limits: list[dict[str, str]] = []

    def get(self, path: str, query: dict[str, Any] | None = None, allow_404: bool = False) -> Any:
        suffix = "?" + urlencode(query) if query else ""
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "AgentWaker-Weaver/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        token = os.environ.get("GITHUB_TOKEN", "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = Request(f"{self.base}{path}{suffix}", headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                data = json.loads(response.read(10_000_000).decode("utf-8"))
                self.rate_limits.append({
                    "resource": response.headers.get("X-RateLimit-Resource", ""),
                    "limit": response.headers.get("X-RateLimit-Limit", ""),
                    "remaining": response.headers.get("X-RateLimit-Remaining", ""),
                    "reset": response.headers.get("X-RateLimit-Reset", ""),
                })
                return data
        except HTTPError as error:
            if error.code == 404 and allow_404:
                return None
            body = error.read(1_000_000).decode("utf-8", errors="replace")
            try:
                message = json.loads(body).get("message", body)
            except json.JSONDecodeError:
                message = body
            raise RuntimeError(f"GitHub API HTTP {error.code}: {message}") from error
        except (URLError, json.JSONDecodeError) as error:
            raise RuntimeError(f"GitHub API request failed: {error}") from error


def main() -> int:
    args = parse_args()
    if not REPOSITORY_PATTERN.fullmatch(args.repository):
        print("error: repository must use owner/repository syntax", file=sys.stderr)
        return 2
    if args.days < 1 or args.timeout <= 0:
        print("error: days and timeout must be positive", file=sys.stderr)
        return 2
    since_date = args.as_of - timedelta(days=args.days)
    since = datetime.combine(since_date, datetime.min.time(), tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    encoded_repo = "/".join(quote(part, safe="") for part in args.repository.split("/"))
    client = Client(args.timeout)
    try:
        repository = client.get(f"/repos/{encoded_repo}")
        release = client.get(f"/repos/{encoded_repo}/releases/latest", allow_404=True)
        commits = client.get(f"/repos/{encoded_repo}/commits", {"since": since, "per_page": 100})
        issue_updates = client.get(
            "/search/issues",
            {"q": f"repo:{args.repository} is:issue updated:>={since_date.isoformat()}", "per_page": 1},
        )
        pull_updates = client.get(
            "/search/issues",
            {"q": f"repo:{args.repository} is:pr updated:>={since_date.isoformat()}", "per_page": 1},
        )
    except (RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if not isinstance(repository, dict) or not isinstance(commits, list):
        print("error: GitHub returned an unexpected project response", file=sys.stderr)
        return 1
    license_data = repository.get("license") if isinstance(repository.get("license"), dict) else {}
    latest_commit = commits[0] if commits and isinstance(commits[0], dict) else {}
    latest_commit_data = latest_commit.get("commit") if isinstance(latest_commit.get("commit"), dict) else {}
    author_data = latest_commit_data.get("author") if isinstance(latest_commit_data.get("author"), dict) else {}
    result = {
        "snapshot": {
            "as_of": args.as_of.isoformat(),
            "window_days": args.days,
            "authenticated": bool(os.environ.get("GITHUB_TOKEN", "").strip()),
            "rate_limits": client.rate_limits,
        },
        "repository": {
            "full_name": repository.get("full_name"),
            "node_id": repository.get("node_id"),
            "html_url": repository.get("html_url"),
            "description": repository.get("description"),
            "created_at": repository.get("created_at"),
            "updated_at": repository.get("updated_at"),
            "pushed_at": repository.get("pushed_at"),
            "default_branch": repository.get("default_branch"),
            "archived": repository.get("archived"),
            "disabled": repository.get("disabled"),
            "fork": repository.get("fork"),
            "license": license_data.get("spdx_id"),
            "topics": repository.get("topics") or [],
            "stargazers_count_snapshot": repository.get("stargazers_count"),
            "forks_count_snapshot": repository.get("forks_count"),
            "open_issues_and_pull_requests_snapshot": repository.get("open_issues_count"),
        },
        "activity_window": {
            "since": since,
            "recent_commits_returned": len(commits),
            "recent_commits_at_least_100": len(commits) == 100,
            "issues_updated": issue_updates.get("total_count") if isinstance(issue_updates, dict) else None,
            "pull_requests_updated": pull_updates.get("total_count") if isinstance(pull_updates, dict) else None,
            "latest_commit_sha": latest_commit.get("sha"),
            "latest_commit_date": author_data.get("date"),
        },
        "latest_release": {
            "tag_name": release.get("tag_name"),
            "name": release.get("name"),
            "published_at": release.get("published_at"),
            "html_url": release.get("html_url"),
            "draft": release.get("draft"),
            "prerelease": release.get("prerelease"),
        } if isinstance(release, dict) else None,
        "warnings": [
            "Counts are dated snapshots, not growth rates or quality conclusions.",
            "The repository open_issues_count includes pull requests.",
            "A 100-commit result is a lower bound because this snapshot intentionally reads one page.",
            "Inspect representative issues, pull requests, releases, documentation, license text, and installation before publication."
        ],
    }
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
