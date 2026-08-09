#!/usr/bin/env python3
"""Local mock tests for the WeChat API client; no external account is used."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import wechat_api


def subprocess_result(*, stdout: bytes, returncode: int = 0):
    class Result:
        pass

    result = Result()
    result.stdout = stdout
    result.stderr = b""
    result.returncode = returncode
    return result


class Handler(BaseHTTPRequestHandler):
    requests: list[tuple[str, dict[str, list[str]], bytes]] = []

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler name
        size = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(size)
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        self.requests.append((parsed.path, query, body))
        if parsed.path == "/cgi-bin/stable_token":
            response = {"access_token": "mock-stable-token", "expires_in": 7200}
        elif parsed.path == "/cgi-bin/draft/batchget":
            response = {"total_count": 0, "item_count": 0, "item": []}
        elif parsed.path == "/cgi-bin/media/uploadimg":
            response = {"url": "https://mmbiz.qpic.cn/mock-image"}
        else:
            response = {"errcode": 40013, "errmsg": "invalid appid"}
        encoded = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: object) -> None:
        return


class ClientTest(unittest.TestCase):
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

    def setUp(self) -> None:
        self.old_env = {key: os.environ.get(key) for key in (
            "WECHAT_API_BASE", "WECHAT_ACCESS_TOKEN", "WECHAT_APP_ID", "WECHAT_APP_SECRET",
            "WECHAT_TOKEN_BROKER_SSH_HOST", "WECHAT_TOKEN_BROKER_SSH_USER",
            "WECHAT_TOKEN_BROKER_SSH_PORT", "WECHAT_TOKEN_BROKER_SSH_KEY",
            "WECHAT_TOKEN_BROKER_KNOWN_HOSTS",
        )}
        os.environ["WECHAT_API_BASE"] = self.base
        Handler.requests.clear()

    def tearDown(self) -> None:
        for key, value in self.old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_managed_token_and_json_request(self) -> None:
        os.environ["WECHAT_ACCESS_TOKEN"] = "mock-managed-token"
        client = wechat_api.Client(2)
        result = client.request_json(
            "/cgi-bin/draft/batchget", {"offset": 0, "count": 1, "no_content": 1}
        )
        self.assertEqual(result["item_count"], 0)
        path, query, body = Handler.requests[-1]
        self.assertEqual(path, "/cgi-bin/draft/batchget")
        self.assertEqual(query["access_token"], ["mock-managed-token"])
        self.assertEqual(json.loads(body)["count"], 1)

    def test_stable_token_request(self) -> None:
        os.environ.pop("WECHAT_ACCESS_TOKEN", None)
        os.environ["WECHAT_APP_ID"] = "mock-app-id"
        os.environ["WECHAT_APP_SECRET"] = "mock-app-secret"
        client = wechat_api.Client(2)
        self.assertEqual(client.token(), "mock-stable-token")
        path, query, body = Handler.requests[-1]
        self.assertEqual(path, "/cgi-bin/stable_token")
        self.assertEqual(query, {})
        self.assertEqual(json.loads(body)["appid"], "mock-app-id")

    def test_ssh_token_broker(self) -> None:
        os.environ.pop("WECHAT_ACCESS_TOKEN", None)
        os.environ.pop("WECHAT_APP_ID", None)
        os.environ.pop("WECHAT_APP_SECRET", None)
        with tempfile.NamedTemporaryFile() as identity:
            os.environ["WECHAT_TOKEN_BROKER_SSH_HOST"] = "broker.example.test"
            os.environ["WECHAT_TOKEN_BROKER_SSH_PORT"] = "2222"
            os.environ["WECHAT_TOKEN_BROKER_SSH_KEY"] = identity.name
            completed = subprocess_result(
                stdout=b'{"access_token":"mock-broker-token","expires_in":6900}'
            )
            with patch("wechat_api.subprocess.run", return_value=completed) as run:
                self.assertEqual(wechat_api.Client(2).token(), "mock-broker-token")
            command = run.call_args.args[0]
            self.assertIn("BatchMode=yes", command)
            self.assertIn("StrictHostKeyChecking=yes", command)
            self.assertIn("wechat-token-reader@broker.example.test", command)

    def test_incomplete_ssh_token_broker_does_not_fall_back(self) -> None:
        os.environ.pop("WECHAT_ACCESS_TOKEN", None)
        os.environ["WECHAT_TOKEN_BROKER_SSH_HOST"] = "broker.example.test"
        os.environ.pop("WECHAT_TOKEN_BROKER_SSH_KEY", None)
        os.environ["WECHAT_APP_ID"] = "mock-app-id"
        os.environ["WECHAT_APP_SECRET"] = "mock-app-secret"
        with self.assertRaisesRegex(wechat_api.ApiError, "WECHAT_TOKEN_BROKER_SSH_KEY"):
            wechat_api.Client(2).token()

    def test_multipart_upload(self) -> None:
        os.environ["WECHAT_ACCESS_TOKEN"] = "mock-managed-token"
        handle = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        try:
            handle.write(b"mock-png")
            handle.close()
            path = Path(handle.name)
            wechat_api.validate_upload(path, content_image=True)
            result = wechat_api.Client(2).upload("/cgi-bin/media/uploadimg", path)
            self.assertIn("mmbiz.qpic.cn", result["url"])
            self.assertIn(b'name="media"', Handler.requests[-1][2])
        finally:
            Path(handle.name).unlink(missing_ok=True)

    def test_write_confirmation_is_required(self) -> None:
        with self.assertRaises(wechat_api.ApiError):
            wechat_api.require_confirmation(False, "--confirm-write")

    def test_official_asset_url_is_upgraded_to_https(self) -> None:
        self.assertEqual(
            wechat_api.normalize_wechat_asset_url("http://mmbiz.qpic.cn/mock.png?from=appmsg"),
            "https://mmbiz.qpic.cn/mock.png?from=appmsg",
        )
        self.assertEqual(
            wechat_api.normalize_wechat_asset_url("http://example.com/mock.png"),
            "http://example.com/mock.png",
        )


if __name__ == "__main__":
    unittest.main()
