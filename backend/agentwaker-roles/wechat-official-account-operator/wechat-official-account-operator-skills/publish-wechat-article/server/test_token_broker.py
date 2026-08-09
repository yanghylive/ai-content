#!/usr/bin/env python3
"""Local tests for the loopback WeChat token broker."""

from __future__ import annotations

import importlib.util
import json
import os
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


MODULE_PATH = Path(__file__).with_name("token_broker.py")
SPEC = importlib.util.spec_from_file_location("token_broker", MODULE_PATH)
assert SPEC and SPEC.loader
token_broker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(token_broker)


class BrokerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.old_env = {
            key: os.environ.get(key)
            for key in (
                "WECHAT_APP_ID",
                "WECHAT_APP_SECRET",
                "WECHAT_TOKEN_BROKER_KEY",
                "WECHAT_API_BASE",
            )
        }
        os.environ["WECHAT_APP_ID"] = "mock-app-id"
        os.environ["WECHAT_APP_SECRET"] = "mock-secret"
        os.environ["WECHAT_TOKEN_BROKER_KEY"] = "mock-broker-key"
        os.environ["WECHAT_API_BASE"] = "https://api.weixin.qq.com"

    def tearDown(self) -> None:
        for key, value in self.old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_api_base_rejects_non_https(self) -> None:
        os.environ["WECHAT_API_BASE"] = "http://api.weixin.qq.com"
        with self.assertRaisesRegex(token_broker.BrokerError, "HTTPS"):
            token_broker.api_base()

    def test_decode_upstream_rejects_error_payload(self) -> None:
        payload = json.dumps({"errcode": 40013, "errmsg": "invalid appid"}).encode()
        with self.assertRaisesRegex(token_broker.BrokerError, "40013"):
            token_broker.decode_upstream(payload, 200)

    def test_cache_reuses_token_until_refresh(self) -> None:
        cache = token_broker.TokenCache()
        with patch.object(
            token_broker, "request_stable_token", return_value=("cached-token", 7200)
        ) as request:
            first = cache.get()
            second = cache.get()
        self.assertEqual(first[0], "cached-token")
        self.assertEqual(second[0], "cached-token")
        request.assert_called_once()

    def test_http_endpoints_and_authorization(self) -> None:
        server = token_broker.ThreadingHTTPServer(
            ("127.0.0.1", 0), token_broker.Handler
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(f"{base}/healthz", timeout=2) as response:
                self.assertEqual(json.load(response), {"status": "ok"})

            with self.assertRaises(HTTPError) as unauthorized:
                urlopen(f"{base}/v1/access-token", timeout=2)
            self.assertEqual(unauthorized.exception.code, 401)

            request = Request(
                f"{base}/v1/access-token",
                headers={"Authorization": "Bearer mock-broker-key"},
            )
            with patch.object(
                token_broker.CACHE, "get", return_value=("served-token", 6900)
            ):
                with urlopen(request, timeout=2) as response:
                    payload = json.load(response)
                    self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(payload["access_token"], "served-token")
            self.assertEqual(payload["source"], "stable_token")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
