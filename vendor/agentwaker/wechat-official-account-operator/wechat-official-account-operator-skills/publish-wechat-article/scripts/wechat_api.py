#!/usr/bin/env python3
"""Small, auditable WeChat Official Account API CLI with explicit write gates."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import secrets
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


DEFAULT_API_BASE = "https://api.weixin.qq.com"
CONTENT_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
COVER_EXTENSIONS = {".bmp", ".gif", ".jpg", ".jpeg", ".png"}


class ApiError(RuntimeError):
    pass


SSH_HOST_PATTERN = re.compile(r"^[A-Za-z0-9.:[\]_-]+$")
SSH_USER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Use official WeChat server APIs without passing credentials on the command line."
    )
    parser.add_argument("--timeout", type=float, default=20.0)
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor = subparsers.add_parser("doctor", help="Check local configuration without printing secrets")
    doctor.add_argument("--check-token", action="store_true", help="Make a live token request")

    upload_image = subparsers.add_parser("upload-content-image", help="Upload a body image")
    upload_image.add_argument("--file", required=True, type=Path)
    upload_image.add_argument("--confirm-write", action="store_true")

    upload_cover = subparsers.add_parser("upload-cover", help="Upload a permanent cover image")
    upload_cover.add_argument("--file", required=True, type=Path)
    upload_cover.add_argument("--confirm-write", action="store_true")

    draft_create = subparsers.add_parser("draft-create", help="Create a draft from a JSON payload")
    draft_create.add_argument("--payload", required=True, type=Path)
    draft_create.add_argument("--confirm-write", action="store_true")

    draft_update = subparsers.add_parser("draft-update", help="Update a draft from a JSON payload")
    draft_update.add_argument("--payload", required=True, type=Path)
    draft_update.add_argument("--confirm-write", action="store_true")

    draft_get = subparsers.add_parser("draft-get", help="Get a draft")
    draft_get.add_argument("--media-id", required=True)

    draft_list = subparsers.add_parser("draft-list", help="List drafts")
    add_list_args(draft_list)

    draft_delete = subparsers.add_parser("draft-delete", help="Delete a draft")
    draft_delete.add_argument("--media-id", required=True)
    draft_delete.add_argument("--confirm-delete", action="store_true")

    preview = subparsers.add_parser("preview", help="Send an approved preview payload")
    preview.add_argument("--payload", required=True, type=Path)
    preview.add_argument("--confirm-write", action="store_true")

    publish = subparsers.add_parser("publish-submit", help="Submit a draft for publication")
    publish.add_argument("--media-id", required=True)
    publish.add_argument("--confirm-publish", action="store_true")

    publish_status = subparsers.add_parser("publish-status", help="Query a publication job")
    publish_status.add_argument("--publish-id", required=True)

    published_list = subparsers.add_parser("published-list", help="List published articles")
    add_list_args(published_list)

    published_get = subparsers.add_parser("published-get", help="Get a published article")
    published_get.add_argument("--article-id", required=True)

    published_delete = subparsers.add_parser("published-delete", help="Delete published content")
    published_delete.add_argument("--article-id", required=True)
    published_delete.add_argument("--index", type=int)
    published_delete.add_argument("--confirm-delete", action="store_true")

    mass_send = subparsers.add_parser("mass-send", help="Send an approved mass-message payload")
    mass_send.add_argument("--payload", required=True, type=Path)
    mass_send.add_argument("--confirm-mass-send", action="store_true")

    summary = subparsers.add_parser("article-summary", help="Retrieve permitted daily article summary data")
    summary.add_argument("--begin-date", required=True, type=date.fromisoformat)
    summary.add_argument("--end-date", required=True, type=date.fromisoformat)
    return parser.parse_args()


def add_list_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--no-content", action="store_true")


def api_base() -> str:
    value = os.environ.get("WECHAT_API_BASE", DEFAULT_API_BASE).rstrip("/")
    parts = urlsplit(value)
    if parts.scheme == "https" and parts.netloc:
        return value
    if parts.scheme == "http" and parts.hostname in {"127.0.0.1", "localhost", "::1"}:
        return value
    raise ApiError("WECHAT_API_BASE must be HTTPS, except for a localhost test server")


def read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ApiError(f"cannot read JSON payload: {error}") from error
    if not isinstance(payload, dict):
        raise ApiError("JSON payload must be an object")
    return payload


def require_confirmation(value: bool, option: str) -> None:
    if not value:
        raise ApiError(f"refusing remote write without {option}")


def decode_response(data: bytes, status: int) -> dict[str, Any]:
    try:
        payload = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ApiError(f"WeChat returned non-JSON data with HTTP {status}") from error
    if not isinstance(payload, dict):
        raise ApiError(f"WeChat returned an unexpected JSON value with HTTP {status}")
    errcode = payload.get("errcode")
    if status >= 400 and errcode in (None, 0, "0"):
        message = str(payload.get("errmsg") or payload.get("message") or "request failed")
        raise ApiError(f"WeChat returned HTTP {status}: {message}")
    if errcode not in (None, 0, "0"):
        errmsg = str(payload.get("errmsg") or "unknown error")
        raise ApiError(f"WeChat API error {errcode}: {errmsg}")
    return payload


def normalize_wechat_asset_url(value: str) -> str:
    parts = urlsplit(value)
    if parts.scheme == "http" and parts.hostname in {"mmbiz.qpic.cn", "mmbiz.qlogo.cn"}:
        return "https://" + value.removeprefix("http://")
    return value


class Client:
    def __init__(self, timeout: float):
        if timeout <= 0:
            raise ApiError("timeout must be positive")
        self.timeout = timeout
        self.base = api_base()
        self._token: str | None = None

    def token(self) -> str:
        if self._token:
            return self._token
        managed = os.environ.get("WECHAT_ACCESS_TOKEN", "").strip()
        if managed:
            self._token = managed
            return managed
        broker_host = os.environ.get("WECHAT_TOKEN_BROKER_SSH_HOST", "").strip()
        if broker_host:
            self._token = self.token_from_ssh_broker(broker_host)
            return self._token
        app_id = os.environ.get("WECHAT_APP_ID", "").strip()
        app_secret = os.environ.get("WECHAT_APP_SECRET", "").strip()
        if not app_id or not app_secret:
            raise ApiError(
                "set WECHAT_ACCESS_TOKEN, configure WECHAT_TOKEN_BROKER_SSH_HOST, "
                "or set both WECHAT_APP_ID and WECHAT_APP_SECRET in a local secret environment"
            )
        payload = self.request_json(
            "/cgi-bin/stable_token",
            {"grant_type": "client_credential", "appid": app_id, "secret": app_secret},
            use_token=False,
        )
        token = str(payload.get("access_token") or "")
        if not token:
            raise ApiError("stable_token response did not include access_token")
        self._token = token
        return token

    def token_from_ssh_broker(self, host: str) -> str:
        user = os.environ.get("WECHAT_TOKEN_BROKER_SSH_USER", "wechat-token-reader").strip()
        identity_value = os.environ.get("WECHAT_TOKEN_BROKER_SSH_KEY", "").strip()
        port_value = os.environ.get("WECHAT_TOKEN_BROKER_SSH_PORT", "22").strip()
        known_hosts_value = os.environ.get("WECHAT_TOKEN_BROKER_KNOWN_HOSTS", "").strip()
        if not SSH_HOST_PATTERN.fullmatch(host) or host.startswith("-"):
            raise ApiError("WECHAT_TOKEN_BROKER_SSH_HOST is invalid")
        if not SSH_USER_PATTERN.fullmatch(user):
            raise ApiError("WECHAT_TOKEN_BROKER_SSH_USER is invalid")
        try:
            port = int(port_value)
        except ValueError as error:
            raise ApiError("WECHAT_TOKEN_BROKER_SSH_PORT must be an integer") from error
        if not 1 <= port <= 65535:
            raise ApiError("WECHAT_TOKEN_BROKER_SSH_PORT must be between 1 and 65535")
        if not identity_value:
            raise ApiError("set WECHAT_TOKEN_BROKER_SSH_KEY for the configured token broker")
        identity = Path(identity_value).expanduser()
        if not identity.is_absolute() or not identity.is_file():
            raise ApiError("WECHAT_TOKEN_BROKER_SSH_KEY must name an existing absolute file")
        command = [
            "/usr/bin/ssh",
            "-T",
            "-o", "BatchMode=yes",
            "-o", "IdentitiesOnly=yes",
            "-o", "StrictHostKeyChecking=yes",
            "-o", f"ConnectTimeout={max(1, min(int(self.timeout), 60))}",
            "-i", str(identity),
            "-p", str(port),
        ]
        if known_hosts_value:
            known_hosts = Path(known_hosts_value).expanduser()
            if not known_hosts.is_absolute() or not known_hosts.is_file():
                raise ApiError("WECHAT_TOKEN_BROKER_KNOWN_HOSTS must name an existing absolute file")
            command.extend(["-o", f"UserKnownHostsFile={known_hosts}"])
        command.extend([f"{user}@{host}", "get-access-token"])
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                timeout=self.timeout,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ApiError("SSH token broker could not be reached") from error
        if completed.returncode != 0:
            raise ApiError(f"SSH token broker failed with exit status {completed.returncode}")
        if len(completed.stdout) > 1_000_000:
            raise ApiError("SSH token broker returned an oversized response")
        payload = decode_response(completed.stdout, 200)
        token = str(payload.get("access_token") or "")
        if not token:
            raise ApiError("SSH token broker response did not include access_token")
        return token

    def url(self, path: str, use_token: bool, query: dict[str, Any] | None = None) -> str:
        params = dict(query or {})
        if use_token:
            params["access_token"] = self.token()
        suffix = "?" + urlencode(params) if params else ""
        return f"{self.base}{path}{suffix}"

    def request_json(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        use_token: bool = True,
        query: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = Request(
            self.url(path, use_token, query),
            data=body,
            method="POST",
            headers={"Content-Type": "application/json; charset=utf-8", "Accept": "application/json"},
        )
        return self.execute(request)

    def upload(self, path: str, file: Path, query: dict[str, Any] | None = None) -> dict[str, Any]:
        boundary = "----AgentWaker" + secrets.token_hex(16)
        filename = file.name.replace('"', "")
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        try:
            content = file.read_bytes()
        except OSError as error:
            raise ApiError(f"cannot read upload file: {error}") from error
        prefix = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="media"; filename="{filename}"\r\n'
            f"Content-Type: {mime}\r\n\r\n"
        ).encode("utf-8")
        body = prefix + content + f"\r\n--{boundary}--\r\n".encode("utf-8")
        request = Request(
            self.url(path, True, query),
            data=body,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"},
        )
        payload = self.execute(request)
        returned_url = payload.get("url")
        if isinstance(returned_url, str):
            payload["url"] = normalize_wechat_asset_url(returned_url)
        return payload

    def execute(self, request: Request) -> dict[str, Any]:
        try:
            with urlopen(request, timeout=self.timeout) as response:
                data = response.read(10_000_000)
                status = response.status
        except HTTPError as error:
            data = error.read(1_000_000)
            try:
                return decode_response(data, error.code)
            except ApiError as decoded:
                raise decoded from error
        except URLError as error:
            raise ApiError(f"network error: {error.reason}") from error
        return decode_response(data, status)


def validate_upload(path: Path, *, content_image: bool) -> None:
    try:
        size = path.stat().st_size
    except OSError as error:
        raise ApiError(f"cannot inspect upload file: {error}") from error
    extension = path.suffix.lower()
    allowed = CONTENT_IMAGE_EXTENSIONS if content_image else COVER_EXTENSIONS
    maximum = 1_000_000 if content_image else 10_000_000
    if extension not in allowed:
        raise ApiError(f"unsupported image extension: {extension or 'none'}")
    if size <= 0 or size > maximum:
        raise ApiError(f"image size must be between 1 and {maximum} bytes")


def validate_list(offset: int, count: int) -> None:
    if offset < 0 or not 1 <= count <= 20:
        raise ApiError("offset must be non-negative and count must be between 1 and 20")


def run(args: argparse.Namespace) -> dict[str, Any]:
    client = Client(args.timeout)

    if args.command == "doctor":
        app_id = os.environ.get("WECHAT_APP_ID", "").strip()
        status: dict[str, Any] = {
            "api_base": client.base,
            "managed_access_token": bool(os.environ.get("WECHAT_ACCESS_TOKEN", "").strip()),
            "ssh_token_broker_configured": bool(
                os.environ.get("WECHAT_TOKEN_BROKER_SSH_HOST", "").strip()
            ),
            "app_id_configured": bool(app_id),
            "app_id_suffix": app_id[-4:] if app_id else None,
            "app_secret_configured": bool(os.environ.get("WECHAT_APP_SECRET", "").strip()),
            "mass_send_enabled": os.environ.get("WECHAT_ENABLE_MASS_SEND") == "1",
            "published_delete_enabled": os.environ.get("WECHAT_ENABLE_PUBLISHED_DELETE") == "1",
        }
        if args.check_token:
            client.token()
            status["token_check"] = "ok"
        return status

    if args.command == "upload-content-image":
        require_confirmation(args.confirm_write, "--confirm-write")
        validate_upload(args.file, content_image=True)
        return client.upload("/cgi-bin/media/uploadimg", args.file)

    if args.command == "upload-cover":
        require_confirmation(args.confirm_write, "--confirm-write")
        validate_upload(args.file, content_image=False)
        return client.upload("/cgi-bin/material/add_material", args.file, {"type": "image"})

    if args.command == "draft-create":
        require_confirmation(args.confirm_write, "--confirm-write")
        payload = read_json(args.payload)
        if not isinstance(payload.get("articles"), list) or not payload["articles"]:
            raise ApiError("draft-create payload must contain a non-empty articles array")
        return client.request_json("/cgi-bin/draft/add", payload)

    if args.command == "draft-update":
        require_confirmation(args.confirm_write, "--confirm-write")
        payload = read_json(args.payload)
        if not payload.get("media_id") or "index" not in payload or not isinstance(payload.get("articles"), dict):
            raise ApiError("draft-update payload must contain media_id, index, and an articles object")
        return client.request_json("/cgi-bin/draft/update", payload)

    if args.command == "draft-get":
        return client.request_json("/cgi-bin/draft/get", {"media_id": args.media_id})

    if args.command == "draft-list":
        validate_list(args.offset, args.count)
        return client.request_json(
            "/cgi-bin/draft/batchget",
            {"offset": args.offset, "count": args.count, "no_content": int(args.no_content)},
        )

    if args.command == "draft-delete":
        require_confirmation(args.confirm_delete, "--confirm-delete")
        return client.request_json("/cgi-bin/draft/delete", {"media_id": args.media_id})

    if args.command == "preview":
        require_confirmation(args.confirm_write, "--confirm-write")
        return client.request_json("/cgi-bin/message/mass/preview", read_json(args.payload))

    if args.command == "publish-submit":
        require_confirmation(args.confirm_publish, "--confirm-publish")
        return client.request_json("/cgi-bin/freepublish/submit", {"media_id": args.media_id})

    if args.command == "publish-status":
        return client.request_json("/cgi-bin/freepublish/get", {"publish_id": args.publish_id})

    if args.command == "published-list":
        validate_list(args.offset, args.count)
        return client.request_json(
            "/cgi-bin/freepublish/batchget",
            {"offset": args.offset, "count": args.count, "no_content": int(args.no_content)},
        )

    if args.command == "published-get":
        return client.request_json("/cgi-bin/freepublish/getarticle", {"article_id": args.article_id})

    if args.command == "published-delete":
        require_confirmation(args.confirm_delete, "--confirm-delete")
        if os.environ.get("WECHAT_ENABLE_PUBLISHED_DELETE") != "1":
            raise ApiError("set WECHAT_ENABLE_PUBLISHED_DELETE=1 for this irreversible operation")
        payload: dict[str, Any] = {"article_id": args.article_id}
        if args.index is not None:
            if args.index < 1:
                raise ApiError("index must be at least 1")
            payload["index"] = args.index
        return client.request_json("/cgi-bin/freepublish/delete", payload)

    if args.command == "mass-send":
        require_confirmation(args.confirm_mass_send, "--confirm-mass-send")
        if os.environ.get("WECHAT_ENABLE_MASS_SEND") != "1":
            raise ApiError("set WECHAT_ENABLE_MASS_SEND=1 to enable follower delivery")
        return client.request_json("/cgi-bin/message/mass/sendall", read_json(args.payload))

    if args.command == "article-summary":
        if args.begin_date > args.end_date:
            raise ApiError("begin-date cannot be after end-date")
        return client.request_json(
            "/datacube/getarticlesummary",
            {"begin_date": args.begin_date.isoformat(), "end_date": args.end_date.isoformat()},
        )

    raise ApiError(f"unsupported command: {args.command}")


def main() -> int:
    args = parse_args()
    try:
        result = run(args)
    except ApiError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
