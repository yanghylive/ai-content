#!/usr/bin/env python3
"""Loopback-only WeChat stable-token broker with in-memory caching."""

from __future__ import annotations

import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class BrokerError(RuntimeError):
    pass


class TokenCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._token = ""
        self._refresh_at = 0.0

    def get(self) -> tuple[str, int]:
        with self._lock:
            now = time.monotonic()
            if self._token and now < self._refresh_at:
                return self._token, max(1, int(self._refresh_at - now))
            token, expires_in = request_stable_token()
            refresh_after = max(60, expires_in - 300)
            self._token = token
            self._refresh_at = now + refresh_after
            return token, refresh_after


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise BrokerError(f"missing required environment variable: {name}")
    return value


def api_base() -> str:
    value = os.environ.get("WECHAT_API_BASE", "https://api.weixin.qq.com").rstrip("/")
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.netloc:
        raise BrokerError("WECHAT_API_BASE must be an HTTPS URL")
    return value


def decode_upstream(data: bytes, status: int) -> dict[str, Any]:
    try:
        payload = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BrokerError(f"WeChat returned non-JSON data with HTTP {status}") from error
    if not isinstance(payload, dict):
        raise BrokerError("WeChat returned an unexpected response")
    errcode = payload.get("errcode")
    if status >= 400 or errcode not in (None, 0, "0"):
        safe_code = errcode if errcode is not None else status
        safe_message = str(payload.get("errmsg") or "request failed")[:300]
        raise BrokerError(f"WeChat token request failed ({safe_code}): {safe_message}")
    return payload


def request_stable_token() -> tuple[str, int]:
    payload = json.dumps(
        {
            "grant_type": "client_credential",
            "appid": required_env("WECHAT_APP_ID"),
            "secret": required_env("WECHAT_APP_SECRET"),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    request = Request(
        f"{api_base()}/cgi-bin/stable_token",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=20) as response:
            data = response.read(1_000_000)
            status = response.status
    except HTTPError as error:
        data = error.read(1_000_000)
        status = error.code
    except URLError as error:
        raise BrokerError("WeChat token endpoint is unreachable") from error
    decoded = decode_upstream(data, status)
    token = str(decoded.get("access_token") or "")
    if not token:
        raise BrokerError("WeChat response did not include access_token")
    try:
        expires_in = int(decoded.get("expires_in", 7200))
    except (TypeError, ValueError):
        expires_in = 7200
    return token, max(60, expires_in)


CACHE = TokenCache()


class Handler(BaseHTTPRequestHandler):
    server_version = "wechat-token-broker/1"

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self.respond(200, {"status": "ok"})
            return
        if self.path != "/v1/access-token":
            self.respond(404, {"error": "not_found"})
            return
        expected = f"Bearer {required_env('WECHAT_TOKEN_BROKER_KEY')}"
        supplied = self.headers.get("Authorization", "")
        if not hmac.compare_digest(supplied, expected):
            self.respond(401, {"error": "unauthorized"})
            return
        try:
            token, expires_in = CACHE.get()
        except BrokerError as error:
            self.respond(502, {"error": "upstream_error", "message": str(error)})
            return
        self.respond(200, {"access_token": token, "expires_in": expires_in, "source": "stable_token"})

    def respond(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    required_env("WECHAT_APP_ID")
    required_env("WECHAT_APP_SECRET")
    required_env("WECHAT_TOKEN_BROKER_KEY")
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
