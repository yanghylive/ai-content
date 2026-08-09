#!/usr/bin/env python3
"""Local mock tests for GitHub collector scripts; no external token is used."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - stdlib handler name
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/repos/openai/codex":
            payload = {
                "full_name": "openai/codex",
                "node_id": "mock-node",
                "html_url": "https://github.com/openai/codex",
                "description": "Mock coding agent",
                "created_at": "2025-04-13T00:00:00Z",
                "updated_at": "2026-07-10T00:00:00Z",
                "pushed_at": "2026-07-10T00:00:00Z",
                "default_branch": "main",
                "archived": False,
                "disabled": False,
                "fork": False,
                "license": {"spdx_id": "Apache-2.0"},
                "topics": ["coding-agent"],
                "stargazers_count": 100,
                "forks_count": 10,
                "open_issues_count": 5,
            }
        elif parsed.path == "/repos/openai/codex/releases/latest":
            payload = {
                "tag_name": "v1.0.0",
                "name": "Mock release",
                "published_at": "2026-07-09T00:00:00Z",
                "html_url": "https://github.com/openai/codex/releases/tag/v1.0.0",
                "draft": False,
                "prerelease": False,
            }
        elif parsed.path == "/repos/openai/codex/commits":
            payload = [{"sha": "abc123", "commit": {"author": {"date": "2026-07-10T00:00:00Z"}}}]
        elif parsed.path == "/search/issues":
            search = query.get("q", [""])[0]
            payload = {"total_count": 7 if "is:issue" in search else 3, "items": []}
        else:
            self.send_error(404)
            return
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-RateLimit-Resource", "core")
        self.send_header("X-RateLimit-Limit", "5000")
        self.send_header("X-RateLimit-Remaining", "4999")
        self.send_header("X-RateLimit-Reset", "1783680000")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


class InspectorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_project_health_snapshot(self) -> None:
        environment = dict(os.environ)
        environment["GITHUB_API_BASE"] = self.base
        environment.pop("GITHUB_TOKEN", None)
        script = Path(__file__).with_name("inspect_github_project.py")
        result = subprocess.run(
            [sys.executable, str(script), "openai/codex", "--days", "7", "--as-of", "2026-07-10"],
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["repository"]["full_name"], "openai/codex")
        self.assertEqual(payload["activity_window"]["issues_updated"], 7)
        self.assertEqual(payload["activity_window"]["pull_requests_updated"], 3)
        self.assertEqual(payload["latest_release"]["tag_name"], "v1.0.0")


if __name__ == "__main__":
    unittest.main()
