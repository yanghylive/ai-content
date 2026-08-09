import asyncio
import base64
import json
import logging
import os
import re
import sqlite3
import subprocess
import threading
import time
import uuid
from concurrent.futures import TimeoutError as FutureTimeoutError
from datetime import datetime
from pathlib import Path
from conf import DEBUG_SKIP_FINAL_PUBLISH
from queue import Empty, Queue
from urllib.parse import urlparse
from flask_cors import CORS
from myUtils.auth import check_cookie
from flask import Flask, cli as flask_cli, request, jsonify, Response, send_from_directory
from conf import BASE_DIR
from cdp_runtime import (
    get_session as _cdp_get_session,
    stop_session as _cdp_stop_session,
    stop_all_sessions as _cdp_stop_all,
    list_sessions as _cdp_list_sessions,
    profile_dir as _cdp_profile_dir,
)
from platform_douyin_cdp import (
    is_douyin_customer_text as _is_douyin_customer_text,
    translate_douyin_network_diagnostic as _translate_douyin_network_diagnostic,
    check_douyin_login_state as _check_douyin_login_state,
    wait_for_douyin_page_stable as _wait_for_douyin_page_stable,
    DOUYIN_IM_PATTERNS,
)
from platform_channel_cdp import (
    is_channel_customer_text as _is_channel_customer_text,
    translate_channel_network_diagnostic as _translate_channel_network_diagnostic,
    check_channel_login_state as _check_channel_login_state,
    wait_for_channel_page_stable as _wait_for_channel_page_stable,
    CHANNEL_NETWORK_PATTERNS,
)
from myUtils.login import get_tencent_cookie, douyin_cookie_gen, get_ks_cookie, xiaohongshu_cookie_gen, bilibili_cookie_gen
from myUtils.postVideo import post_video_tencent, post_video_DouYin, post_video_ks, post_video_xhs
from myUtils.postVideo import post_video_bilibili
from myUtils.postVideo import post_video_batch_dry_run_tabs, post_video_batch_tabs
from utils.base_social_media import (
    launch_chromium_with_codecs,
    new_publish_context,
    reveal_page_window,
    set_init_script,
)
from playwright.async_api import Error as PlaywrightError, TimeoutError as PlaywrightTimeoutError, async_playwright
from myUtils.avatar import capture_identity_from_page
from utils.publish_limits import get_publish_tag_limit, normalize_publish_tags


active_queues = {}
active_login_sessions = {}
cancelled_login_request_ids = set()
_open_browsers = []  # keep references to prevent GC/auto-close
_open_playwrights = []  # keep draft/interactive browser drivers alive for manual confirmation
_interaction_runtime_loop = None
_interaction_runtime_thread = None
_interaction_runtime_lock = threading.Lock()
_interaction_runtime_call_lock = threading.Lock()
_interaction_playwright = None
_interaction_browser_sessions = {}
INTERACTION_PROFILE_ROOT = BASE_DIR / "browser-profiles"
INTERACTION_SENT_LEDGER_PATH = BASE_DIR / "logs" / "interaction-sent-ledger.jsonl"
INTERACTION_RUNTIME_TIMEOUT_SECONDS = int(os.getenv("INTERACTION_RUNTIME_TIMEOUT_SECONDS", "240"))
PUBLISH_PLATFORM_ORDER = [3, 2, 5, 1, 4]  # 抖音、视频号、B站、小红书、快手
PUBLISH_PLATFORM_ORDER_INDEX = {platform_type: index for index, platform_type in enumerate(PUBLISH_PLATFORM_ORDER)}
PLATFORM_NAME_MAP = {
    1: "小红书",
    2: "视频号",
    3: "抖音",
    4: "快手",
    5: "B站",
}


class _WerkzeugStartupWarningFilter(logging.Filter):
    _hidden_fragments = (
        "This is a development server",
        "Do not use it in a production deployment",
        "Use a production WSGI server instead",
    )

    def filter(self, record):
        message = record.getMessage()
        return not any(fragment in message for fragment in self._hidden_fragments)


def _quiet_local_server_startup_noise():
    flask_cli.show_server_banner = lambda *args, **kwargs: None
    logging.getLogger("werkzeug").addFilter(_WerkzeugStartupWarningFilter())


def _publish_platform_sort_key(item):
    if not isinstance(item, dict):
        return 999
    try:
        platform_type = int(item.get('type'))
    except (TypeError, ValueError):
        return 999
    return PUBLISH_PLATFORM_ORDER_INDEX.get(platform_type, 999)

def _run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _interaction_loop_worker(loop):
    asyncio.set_event_loop(loop)
    loop.run_forever()


def _get_interaction_runtime_loop():
    global _interaction_runtime_loop, _interaction_runtime_thread
    with _interaction_runtime_lock:
        if _interaction_runtime_loop and _interaction_runtime_loop.is_running():
            return _interaction_runtime_loop
        loop = asyncio.new_event_loop()
        thread = threading.Thread(
            target=_interaction_loop_worker,
            args=(loop,),
            name="interaction-cdp-runtime",
            daemon=True,
        )
        thread.start()
        _interaction_runtime_loop = loop
        _interaction_runtime_thread = thread
        return loop


def _run_interaction_async(coro, timeout=INTERACTION_RUNTIME_TIMEOUT_SECONDS):
    loop = _get_interaction_runtime_loop()
    with _interaction_runtime_call_lock:
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        try:
            return future.result(timeout=timeout)
        except FutureTimeoutError:
            future.cancel()
            raise TimeoutError(f"客户互动 CDP 浏览器执行超时（{timeout}s）")


def _interaction_profile_dir(platform, account_id):
    return _cdp_profile_dir(platform, account_id)


async def _ensure_interaction_context(platform, account_id, storage_path, start_url=None):
    global _interaction_playwright
    key = f"{platform}:{account_id}"
    print(f"[interaction] _ensure_interaction_context called for {key}")
    existing = _interaction_browser_sessions.get(key)
    if existing:
        context = existing.get("context")
        browser = existing.get("browser_obj")
        try:
            pages = context.pages
            if pages is not None:
                page = pages[0] if pages else await context.new_page()
                await page.bring_to_front()
                existing["currentUrl"] = page.url or ""
                print(f"[interaction] reusing existing session for {key}, url={page.url}")
                return {
                    **existing,
                    "context": context,
                    "page": page,
                    "reused": True,
                }
        except Exception as e:
            print(f"[interaction/cdp] session stale, reconnecting key={key}: {e}")
            try:
                await context.close()
            except Exception:
                pass
            try:
                if browser:
                    await browser.close()
            except Exception:
                pass
            _interaction_browser_sessions.pop(key, None)

    if _interaction_playwright is None:
        _interaction_playwright = await async_playwright().start()

    print(f"[interaction] getting CDP session for {key}")
    cdp_session = _cdp_get_session(platform, account_id)
    print(f"[interaction] ensuring CDP session is running for {key}")
    cdp_info = cdp_session.ensure_running()
    cdp_port = cdp_info["cdpPort"]
    profile_dir = cdp_info["profileDir"]
    chrome_path = cdp_info["browser"]
    print(f"[interaction] CDP session ready for {key}: port={cdp_port}, profile={profile_dir}")

    endpoint = f"http://127.0.0.1:{cdp_port}"
    print(f"[interaction/cdp] connecting to {endpoint} profile={profile_dir}")

    browser_obj = await _interaction_playwright.chromium.connect_over_cdp(endpoint)
    contexts = browser_obj.contexts
    if contexts:
        context = contexts[0]
    else:
        context = await browser_obj.new_context(
            locale="zh-CN",
            timezone_id="Asia/Shanghai",
        )

    # 从 profile 目录加载登录 cookie（如果存在）
    profile_cookies_path = Path(profile_dir) / ".login-cookies.json"
    if profile_cookies_path.exists():
        try:
            state = json.loads(profile_cookies_path.read_text(encoding="utf-8"))
            cookies = state.get("cookies", [])
            if cookies:
                await context.add_cookies(cookies)
                print(f"[interaction/cdp] loaded {len(cookies)} cookies from profile dir for {key}")
        except Exception as e:
            print(f"[interaction/cdp] load profile cookies failed for {key}: {e}")

    # 也从 cookiesFile 加载（向后兼容）
    if storage_path and Path(storage_path).exists():
        try:
            state = json.loads(Path(storage_path).read_text(encoding="utf-8"))
            cookies = state.get("cookies", [])
            if cookies:
                await context.add_cookies(cookies)
                print(f"[interaction/cdp] loaded {len(cookies)} cookies from cookiesFile for {key}")
        except Exception as e:
            print(f"[interaction/cdp] load cookiesFile failed for {key}: {e}")

    page = context.pages[0] if context.pages else await context.new_page()
    if start_url and not (page.url or "").startswith("http"):
        await page.goto(start_url, wait_until="domcontentloaded", timeout=30000)
    try:
        await reveal_page_window(page)
    except Exception as e:
        print(f"[interaction/cdp] reveal page failed: {e}")

    current_url = page.url or ""

    session = {
        "context": context,
        "browser_obj": browser_obj,
        "profileDir": profile_dir,
        "cdpPort": cdp_port,
        "startedAt": cdp_info["startedAt"],
        "runtimeMode": "persistent-cdp-browser",
        "browser": chrome_path,
        "currentUrl": current_url,
    }
    _interaction_browser_sessions[key] = session
    return {
        **session,
        "page": page,
        "reused": cdp_info["reused"],
    }


async def _start_interaction_network_trace(context, page, patterns=None, max_events=80):
    trace = []
    response_meta = {}
    response_body_tasks = set()
    patterns = patterns or [
        "douyin",
        "bytedance",
        "snssdk",
        "im",
        "comment",
        "message",
        "conversation",
    ]
    try:
        client = await context.new_cdp_session(page)
        await client.send("Network.enable")

        def should_keep(url):
            value = str(url or "").lower()
            return any(pattern.lower() in value for pattern in patterns)

        def append_event(kind, params):
            try:
                request = params.get("request") or {}
                response = params.get("response") or {}
                url = request.get("url") or response.get("url") or params.get("documentURL") or ""
                if not should_keep(url):
                    return
                request_id = params.get("requestId")
                event = {
                    "kind": kind,
                    "url": url[:500],
                    "requestId": request_id,
                    "method": request.get("method"),
                    "status": response.get("status"),
                    "resourceType": params.get("type"),
                    "errorText": params.get("errorText"),
                    "timestamp": datetime.now().isoformat(),
                }
                trace.append({key: value for key, value in event.items() if value not in (None, "")})
                del trace[:-max_events]
                if kind == "response" and request_id:
                    response_meta[request_id] = {
                        "url": url,
                        "status": response.get("status"),
                        "resourceType": params.get("type"),
                    }
            except Exception:
                pass

        async def append_response_body(params):
            request_id = params.get("requestId")
            meta = response_meta.pop(request_id, None)
            if not request_id or not meta:
                return
            url = str(meta.get("url") or "")
            lower_url = url.lower()
            is_douyin_message_response = any(fragment in lower_url for fragment in (
                "creator/im/user_token",
                "creator/msg/top",
                "user_message/unread_count",
                "imapi.snssdk.com",
                "mcs.snssdk.com",
                "message",
                "conversation",
                "chat",
            ))
            is_wechat_channel_response = (
                "channels.weixin.qq.com" in lower_url
                and "/cgi-bin/" in lower_url
                and any(fragment in lower_url for fragment in (
                    "comment",
                    "private",
                    "message",
                    "msg",
                    "session",
                    "post_list",
                ))
            )
            if not is_douyin_message_response and not is_wechat_channel_response:
                return
            try:
                body = await client.send("Network.getResponseBody", {"requestId": request_id})
                text = body.get("body") or ""
                if body.get("base64Encoded"):
                    text = base64.b64decode(text).decode("utf-8", errors="ignore")
                douyin_candidates = (
                    _extract_douyin_im_message_candidates_from_payload(text, limit=20)
                    if is_douyin_message_response
                    else []
                )
                wechat_channel_candidates = (
                    _extract_wechat_channel_candidates_from_payload(text, lower_url, limit=20)
                    if is_wechat_channel_response
                    else []
                )
                event = {
                    "kind": "responseBody",
                    "url": url[:500],
                    "requestId": request_id,
                    "status": meta.get("status"),
                    "resourceType": meta.get("resourceType"),
                    "messageCandidates": douyin_candidates,
                    "wechatChannelCandidates": wechat_channel_candidates,
                    "bodyPreview": text[:800] if douyin_candidates or wechat_channel_candidates else "",
                    "timestamp": datetime.now().isoformat(),
                }
                trace.append({key: value for key, value in event.items() if value not in (None, "", [])})
                del trace[:-max_events]
            except Exception as e:
                trace.append({
                    "kind": "responseBodyFailed",
                    "url": url[:500],
                    "requestId": request_id,
                    "errorText": str(e)[:240],
                    "timestamp": datetime.now().isoformat(),
                })
                del trace[:-max_events]

        client.on("Network.requestWillBeSent", lambda params: append_event("request", params))
        client.on("Network.responseReceived", lambda params: append_event("response", params))
        client.on("Network.loadingFailed", lambda params: append_event("failed", params))
        def schedule_response_body(params):
            task = asyncio.create_task(append_response_body(params))
            response_body_tasks.add(task)
            task.add_done_callback(lambda done: response_body_tasks.discard(done))

        client.on("Network.loadingFinished", schedule_response_body)
        return client, trace
    except Exception as e:
        print(f"[interaction/cdp] network trace unavailable: {e}")
        return None, trace


async def _wait_interaction_network_bodies(trace, timeout_ms=3000):
    deadline = time.time() + (timeout_ms / 1000)
    last_count = -1
    while time.time() < deadline:
        body_events = [
            event for event in trace or []
            if event.get("kind") in ("responseBody", "responseBodyFailed")
        ]
        has_im_body = any("imapi.snssdk.com" in str(event.get("url") or "") for event in body_events)
        has_candidates = any(event.get("messageCandidates") for event in body_events)
        has_wechat_channel_candidates = any(event.get("wechatChannelCandidates") for event in body_events)
        has_wechat_channel_body = any("channels.weixin.qq.com" in str(event.get("url") or "") for event in body_events)
        body_count = len(body_events)
        if has_candidates or has_wechat_channel_candidates or ((has_im_body or has_wechat_channel_body) and body_count == last_count):
            return
        last_count = body_count
        await asyncio.sleep(0.25)


async def _install_douyin_im_route_capture(context, trace=None, max_events=80):
    captures = []
    patterns = [
        "**/v2/message/**",
        "**/*message/get_by_user_init*",
        "**/*conversation*",
    ]

    def append_capture(event):
        captures.append({key: value for key, value in event.items() if value not in (None, "", [])})
        del captures[:-max_events]
        if trace is not None:
            trace.append({key: value for key, value in event.items() if value not in (None, "", [])})
            del trace[:-max_events]

    async def handler(route):
        request = route.request
        url = request.url or ""
        lower_url = url.lower()
        should_capture = any(fragment in lower_url for fragment in (
            "imapi.snssdk.com",
            "message/get_by_user_init",
            "conversation",
            "chat",
        ))
        if not should_capture:
            await route.continue_()
            return
        try:
            response = await route.fetch()
            body_bytes = await response.body()
            text = body_bytes.decode("utf-8", errors="ignore")
            candidates = _extract_douyin_im_message_candidates_from_payload(text, limit=20)
            append_capture({
                "kind": "routeCapture",
                "url": url[:500],
                "method": request.method,
                "status": response.status,
                "resourceType": request.resource_type,
                "messageCandidates": candidates,
                "bodyPreview": text[:800] if candidates else "",
                "timestamp": datetime.now().isoformat(),
            })
            await route.fulfill(response=response)
        except Exception as e:
            append_capture({
                "kind": "routeCaptureFailed",
                "url": url[:500],
                "method": request.method,
                "resourceType": request.resource_type,
                "errorText": str(e)[:240],
                "timestamp": datetime.now().isoformat(),
            })
            try:
                await route.continue_()
            except Exception:
                pass

    for pattern in patterns:
        try:
            await context.unroute(pattern)
        except Exception:
            pass
        try:
            await context.route(pattern, handler)
        except Exception as e:
            append_capture({
                "kind": "routeCaptureInstallFailed",
                "url": pattern,
                "errorText": str(e)[:240],
                "timestamp": datetime.now().isoformat(),
            })

    return {
        "patterns": patterns,
        "handler": handler,
        "captures": captures,
    }


async def _detach_douyin_im_route_capture(context, route_capture):
    if not route_capture:
        return
    handler = route_capture.get("handler")
    for pattern in route_capture.get("patterns") or []:
        try:
            await context.unroute(pattern, handler)
        except Exception:
            pass


def _douyin_im_window_capture_script():
    return r"""(() => {
        const root = window;
        if (!Array.isArray(root.__kaypalDouyinImResponses)) {
            root.__kaypalDouyinImResponses = [];
        }
        const normalizeUrl = (input) => {
            try {
                if (typeof input === 'string') return input;
                if (input && typeof input.url === 'string') return input.url;
            } catch {}
            return '';
        };
        const shouldCapture = (url) => {
            const value = String(url || '').toLowerCase();
            return value.includes('imapi.snssdk.com') ||
                value.includes('message/get_by_user_init') ||
                value.includes('conversation') ||
                value.includes('/message/');
        };
        const pushCapture = (entry) => {
            try {
                const list = root.__kaypalDouyinImResponses || [];
                list.push({
                    kind: entry.kind,
                    url: String(entry.url || '').slice(0, 500),
                    status: entry.status,
                    body: String(entry.body || '').slice(0, 200000),
                    errorText: entry.errorText ? String(entry.errorText).slice(0, 240) : undefined,
                    capturedAt: new Date().toISOString(),
                });
                root.__kaypalDouyinImResponses = list.slice(-50);
            } catch {}
        };
        if (!root.__kaypalDouyinImFetchPatched && typeof root.fetch === 'function') {
            const originalFetch = root.fetch;
            const patchedFetch = async function(input, init) {
                const url = normalizeUrl(input);
                const response = await originalFetch.apply(this, arguments);
                if (shouldCapture(url || response.url)) {
                    try {
                        response.clone().text()
                            .then((body) => pushCapture({ kind: 'fetch', url: url || response.url, status: response.status, body }))
                            .catch((error) => pushCapture({ kind: 'fetchFailed', url: url || response.url, status: response.status, errorText: error && error.message }));
                    } catch (error) {
                        pushCapture({ kind: 'fetchFailed', url: url || response.url, status: response.status, errorText: error && error.message });
                    }
                }
                return response;
            };
            root.fetch = patchedFetch;
            root.__kaypalDouyinImFetchPatched = true;
        }
        if (!root.__kaypalDouyinImXhrPatched && root.XMLHttpRequest) {
            const xhrProto = root.XMLHttpRequest.prototype;
            const originalOpen = xhrProto.open;
            const originalSend = xhrProto.send;
            xhrProto.open = function(method, url) {
                this.__kaypalCaptureUrl = normalizeUrl(url);
                this.__kaypalCaptureMethod = method;
                return originalOpen.apply(this, arguments);
            };
            xhrProto.send = function() {
                if (shouldCapture(this.__kaypalCaptureUrl)) {
                    this.addEventListener('loadend', () => {
                        try {
                            pushCapture({
                                kind: 'xhr',
                                url: this.__kaypalCaptureUrl,
                                status: this.status,
                                body: this.responseType && this.responseType !== 'text' && this.responseType !== '' ? '' : this.responseText,
                            });
                        } catch (error) {
                            pushCapture({ kind: 'xhrFailed', url: this.__kaypalCaptureUrl, status: this.status, errorText: error && error.message });
                        }
                    });
                }
                return originalSend.apply(this, arguments);
            };
            root.__kaypalDouyinImXhrPatched = true;
        }
    })();"""


async def _install_douyin_im_window_capture(page):
    script = _douyin_im_window_capture_script()
    try:
        await page.add_init_script(script)
    except Exception:
        pass
    try:
        await page.evaluate(script)
    except Exception:
        pass


async def _collect_douyin_im_window_capture(page, trace=None, limit=20):
    try:
        captures = await page.evaluate(
            r"""() => (window.__kaypalDouyinImResponses || []).slice(-30).map((item) => ({
                kind: item.kind,
                url: item.url,
                status: item.status,
                body: item.body,
                errorText: item.errorText,
                capturedAt: item.capturedAt,
            }))"""
        )
    except Exception:
        captures = []

    candidates = []
    for item in captures or []:
        body = item.get("body") if isinstance(item, dict) else ""
        for candidate in _extract_douyin_im_message_candidates_from_payload(body, limit=limit):
            candidate["source"] = f"window-{item.get('kind') or 'capture'}:{candidate.get('source') or 'response'}"
            candidates.append(candidate)
            if len(candidates) >= limit:
                break
        if len(candidates) >= limit:
            break

    event = {
        "kind": "windowCapture",
        "url": "window.__kaypalDouyinImResponses",
        "status": len(captures or []),
        "messageCandidates": candidates[:limit],
        "captures": [
            {
                "kind": item.get("kind"),
                "url": item.get("url"),
                "status": item.get("status"),
                "capturedAt": item.get("capturedAt"),
                "bodyLength": len(item.get("body") or ""),
                "errorText": item.get("errorText"),
            }
            for item in (captures or [])[-10:]
            if isinstance(item, dict)
        ],
        "timestamp": datetime.now().isoformat(),
    }
    if trace is not None:
        trace.append({key: value for key, value in event.items() if value not in (None, "", [])})
        del trace[:-80]
    return event


def _interaction_runtime_fields(session, trace=None):
    return {
        "runtimeMode": session.get("runtimeMode") or "persistent-cdp-browser",
        "profileDir": session.get("profileDir"),
        "cdpPort": session.get("cdpPort"),
        "browser": session.get("browser"),
        "browserReused": bool(session.get("reused")),
        "currentUrl": session.get("currentUrl"),
        "networkTrace": list(trace or [])[-30:],
    }


def _contains_cjk_text(value):
    return any('\u4e00' <= ch <= '\u9fff' for ch in str(value or ""))


def _looks_like_utf8_mojibake(value):
    text = str(value or "")
    if not text:
        return False
    mojibake_markers = ("Ã", "Â", "ä", "å", "æ", "ç", "è", "é", "ï", "ð")
    return any(marker in text for marker in mojibake_markers) or any(0x80 <= ord(ch) <= 0x9f for ch in text)


def _decode_likely_utf8_mojibake(value):
    text = str(value or "")
    if not text or not _looks_like_utf8_mojibake(text):
        return text
    try:
        fixed = text.encode("latin-1").decode("utf-8")
    except Exception:
        return text
    if _contains_cjk_text(fixed) and not _contains_cjk_text(text):
        return fixed
    return text


def _normalize_interaction_text(value):
    text = _decode_likely_utf8_mojibake(value)
    return " ".join(str(text or "").replace("\u200b", "").replace("\ufeff", "").split()).strip()


def _interaction_text_variants(value):
    variants = []
    for item in (value, _decode_likely_utf8_mojibake(value), _normalize_interaction_text(value)):
        text = " ".join(str(item or "").replace("\u200b", "").replace("\ufeff", "").split()).strip()
        if text and text not in variants:
            variants.append(text)
    return variants


_interaction_sent_ledger_lock = threading.Lock()
_interaction_sent_memory_cache = set()


def _interaction_sent_key(platform, account_id, kind, target_text):
    return "|".join([
        _normalize_interaction_text(platform).lower(),
        str(account_id or ""),
        _normalize_interaction_text(kind).lower(),
        _normalize_interaction_text(target_text).lower(),
    ])


def _load_recent_interaction_sent_keys(max_age_hours=72):
    keys = set(_interaction_sent_memory_cache)
    path = INTERACTION_SENT_LEDGER_PATH
    if not path.exists():
        return keys
    cutoff = time.time() - max_age_hours * 3600
    try:
        for line in path.read_text(encoding="utf-8").splitlines()[-1000:]:
            try:
                item = json.loads(line)
            except Exception:
                continue
            if float(item.get("sentTs") or 0) < cutoff:
                continue
            keys.add(item.get("key") or _interaction_sent_key(
                item.get("platform"),
                item.get("accountId"),
                item.get("kind"),
                item.get("targetText"),
            ))
    except Exception as e:
        print(f"[interaction/sent-ledger] read failed: {e}")
    return {key for key in keys if key}


def _load_recent_interaction_sent_reply_texts(platform=None, account_id=None, kind=None, max_age_hours=72):
    path = INTERACTION_SENT_LEDGER_PATH
    if not path.exists():
        return set()
    cutoff = time.time() - max_age_hours * 3600
    texts = set()
    try:
        for line in path.read_text(encoding="utf-8").splitlines()[-1000:]:
            try:
                item = json.loads(line)
            except Exception:
                continue
            if float(item.get("sentTs") or 0) < cutoff:
                continue
            if platform is not None and item.get("platform") != platform:
                continue
            if account_id is not None and str(item.get("accountId")) != str(account_id):
                continue
            if kind is not None and item.get("kind") != kind:
                continue
            reply_text = _normalize_interaction_text(item.get("replyText"))
            if reply_text:
                texts.add(reply_text.lower())
    except Exception as e:
        print(f"[interaction/sent-ledger] read reply texts failed: {e}")
    return texts


def _mark_interaction_sent(platform, account_id, kind, target_text, reply_text):
    key = _interaction_sent_key(platform, account_id, kind, target_text)
    with _interaction_sent_ledger_lock:
        _interaction_sent_memory_cache.add(key)
    try:
        INTERACTION_SENT_LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
        item = {
            "key": key,
            "platform": platform,
            "accountId": account_id,
            "kind": kind,
            "targetText": _normalize_interaction_text(target_text),
            "replyText": _normalize_interaction_text(reply_text),
            "sentTs": time.time(),
            "sentAt": datetime.now().isoformat(),
        }
        with INTERACTION_SENT_LEDGER_PATH.open("a", encoding="utf-8") as fp:
            fp.write(json.dumps(item, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[interaction/sent-ledger] write failed: {e}")


def _filter_recently_sent_interaction_items(platform, account_id, kind, items):
    sent_keys = _load_recent_interaction_sent_keys()
    sent_reply_texts = _load_recent_interaction_sent_reply_texts(platform, account_id, kind)
    filtered = []
    skipped = []
    for item in items or []:
        text = _normalize_interaction_text(item.get("text") if isinstance(item, dict) else "")
        key = _interaction_sent_key(platform, account_id, kind, text)
        if key in sent_keys:
            skipped.append({**item, "skippedReason": "recently_sent"})
            continue
        if text.lower() in sent_reply_texts:
            skipped.append({**item, "skippedReason": "own_recent_reply"})
            continue
        filtered.append(item)
    return filtered, skipped


def _looks_like_douyin_customer_message(text):
    text = _normalize_interaction_text(text)
    if not text or len(text) < 2 or len(text) > 240:
        return False
    if not any(('\u4e00' <= ch <= '\u9fff') or ch.isalnum() for ch in text):
        return False
    noise_fragments = (
        "抖音社区自律公约",
        "账号授权协议",
        "用户服务协议",
        "隐私政策",
        "北京抖音科技有限公司",
        "京ICP",
        "网络文化经营许可证",
        "请打开抖音 app 查看",
        "请打开抖音app查看",
        "请打开抖音APP查看",
        "你收到一条新类型消息",
        "该消息类型暂不支持",
        "当前版本暂不支持",
        "平台通知",
        "系统通知",
        "服务通知",
        "加载中",
        "私信管理",
        "评论管理",
        "创作者中心",
        "高清发布",
        "分享[视频]",
        "[视频]",
        "[图片]",
    )
    if any(fragment.lower() in text.lower() for fragment in noise_fragments):
        return False
    if text in {"全部", "朋友私信", "陌生人私信", "群消息", "发送", "搜索", "抖音", "首页"}:
        return False
    if text.isdigit():
        return False
    return True


def _try_parse_json_text(value):
    text = value.strip() if isinstance(value, str) else ""
    if not text or text[0] not in "[{":
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def _extract_douyin_im_message_candidates_from_payload(payload_text, limit=20):
    parsed = _try_parse_json_text(payload_text)
    candidates = []
    seen = set()
    message_keys = {
        "text",
        "content",
        "message",
        "msg",
        "msg_content",
        "last_message",
        "lastMessage",
        "preview",
        "abstract",
        "push_content",
        "conversation_name",
        "nickname",
        "nick_name",
        "name",
    }

    def add_candidate(text, source, context=None):
        normalized = _normalize_interaction_text(text)
        if not _looks_like_douyin_customer_message(normalized):
            return
        key = normalized.lower()
        if key in seen:
            return
        seen.add(key)
        candidates.append({
            "text": normalized,
            "looksLikeMessage": True,
            "source": source,
            "context": _normalize_interaction_text(context or "")[:260],
            "score": 80 if "content" in source or "message" in source else 55,
        })

    def walk(value, path="", parent=None):
        if len(candidates) >= limit:
            return
        if isinstance(value, dict):
            compact_context = " ".join(
                _normalize_interaction_text(value.get(key))
                for key in ("nickname", "nick_name", "conversation_name", "text", "content", "msg_content")
                if isinstance(value.get(key), (str, int, float))
            )
            for key, child in value.items():
                child_path = f"{path}.{key}" if path else str(key)
                lower_key = str(key).lower()
                if isinstance(child, str):
                    nested = _try_parse_json_text(child)
                    if nested is not None:
                        walk(nested, child_path, value)
                    if lower_key in message_keys or any(token in lower_key for token in ("text", "content", "message", "msg")):
                        add_candidate(child, child_path, compact_context)
                else:
                    walk(child, child_path, value)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, f"{path}[{index}]", parent)

    if parsed is not None:
        walk(parsed)

    if not candidates:
        for match in re.finditer(r'"(?:text|content|msg_content|message|preview|abstract)"\s*:\s*"([^"]{2,240})"', payload_text or "", re.I):
            try:
                decoded = bytes(match.group(1), "utf-8").decode("unicode_escape")
            except Exception:
                decoded = match.group(1)
            add_candidate(decoded, "response-regex")
            if len(candidates) >= limit:
                break

    return candidates[:limit]


def _merge_douyin_message_candidates(dom_messages, trace, limit):
    merged = []
    seen = set()
    for item in dom_messages or []:
        text = _normalize_interaction_text(item.get("text") if isinstance(item, dict) else "")
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        merged.append(item)
        if len(merged) >= limit:
            return merged

    for event in trace or []:
        if not isinstance(event, dict):
            continue
        for item in event.get("messageCandidates") or []:
            text = _normalize_interaction_text(item.get("text") if isinstance(item, dict) else "")
            if not text or text.lower() in seen:
                continue
            seen.add(text.lower())
            merged.append({
                "text": text,
                "looksLikeMessage": True,
                "source": item.get("source") or "network-response",
                "context": item.get("context") or "",
                "score": item.get("score") or 70,
            })
            if len(merged) >= limit:
                return merged
    return merged


def _looks_like_wechat_channel_customer_text(text):
    text = _normalize_interaction_text(text)
    if not text or len(text) > 280:
        return False
    has_cjk = any('\u4e00' <= ch <= '\u9fff' for ch in text)
    has_alnum = any(ch.isalnum() for ch in text)
    has_emoji = any(
        ord(ch) > 0x1F600 or (0x2600 <= ord(ch) <= 0x27BF) or (0x1F300 <= ord(ch) <= 0x1F9FF)
        for ch in text
    )
    has_bracket_emoji = bool(re.search(r'\[[\u4e00-\u9fff]+\]', text))
    if not (has_cjk or has_alnum or has_emoji or has_bracket_emoji):
        return False
    # 如果是纯表情消息（包括括号表情），接受即使很短
    if has_bracket_emoji or has_emoji:
        return True
    noise_fragments = (
        "视频号助手",
        "评论管理",
        "私信管理",
        "互动管理",
        "全部视频",
        "全部私信",
        "全部消息",
        "共143个",
        "关于腾讯",
        "微信视频号运营规范",
        "问题咨询",
        "Tencent Inc",
        "All Rights Reserved",
        "暂无评论",
        "暂无私信",
        "暂无消息",
        "暂无打招呼消息",
        "没有更多",
        "加载中",
        "通知中心",
        "数据中心",
        "收入与服务",
        "带货助手",
        "收到，看到你发的是",
        "你把具体想咨询的问题发我",
        "有具体问题直接发我",
        "我按实际情况",
        "不再接收对方消息",
        "扫描二维码后",
        "填写投诉",
    )
    if any(fragment.lower() in text.lower() for fragment in noise_fragments):
        return False
    if text in {"评论", "私信", "打招呼消息", "全部", "视频", "图文", "回复", "发送", "删除", "点赞"}:
        return False
    if text in {"私信 打招呼消息", "全部私信", "全部评论", "评论权限 写评论", "评论权限", "写评论"}:
        return False
    if re.fullmatch(r"共\d+个", text):
        return False
    if " 20" in text and re.search(r"20\d{2}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}", text):
        return False
    if re.fullmatch(r"20\d{2}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}", text):
        return False
    if re.fullmatch(r".+?\s+\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}", text):
        return False
    if text.startswith("共") and ("条评论" in text or "个" in text):
        return False
    if re.search(r"20\d{2}[/-]\d{1,2}[/-]\d{1,2}", text) and ("#" in text or len(text) > 36):
        return False
    if re.fullmatch(r"\d+|20\d{2}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}:\d{2}|刚刚|今天|昨天", text):
        return False
    if re.fullmatch(r"\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}", text):
        return False
    return True


def _extract_wechat_channel_candidates_from_payload(payload_text, url="", limit=20):
    parsed = _try_parse_json_text(payload_text)
    if parsed is None:
        return []

    candidates = []
    seen = set()
    lower_url = str(url or "").lower()
    default_kind = "comment" if "comment" in lower_url else "message"

    def add_candidate(kind, text, source, author=None, context=None, extra=None):
        normalized = _normalize_interaction_text(text)
        if not _looks_like_wechat_channel_customer_text(normalized):
            return
        author_text = _normalize_interaction_text(author)
        key = f"{kind}:{author_text}:{normalized}".lower()
        if key in seen:
            return
        seen.add(key)
        item = {
            "text": normalized,
            "author": author_text,
            "source": source,
            "context": _normalize_interaction_text(context or "")[:260],
            "score": 95 if kind == "comment" else 90,
        }
        if kind == "comment":
            item["looksLikeComment"] = True
        else:
            item["looksLikeMessage"] = True
        if isinstance(extra, dict):
            for key_name in ("commentId", "sessionId", "username", "readFlag", "createTime"):
                value = extra.get(key_name)
                if value not in (None, ""):
                    item[key_name] = str(value)
        candidates.append(item)

    def walk(value, path=""):
        if len(candidates) >= limit:
            return
        if isinstance(value, dict):
            if "commentContent" in value:
                add_candidate(
                    "comment",
                    value.get("commentContent"),
                    f"{path}.commentContent",
                    value.get("commentNickname") or value.get("nickname"),
                    " ".join(_normalize_interaction_text(value.get(key)) for key in ("commentNickname", "commentContent", "commentCreatetime") if value.get(key)),
                    {
                        "commentId": value.get("commentId"),
                        "username": value.get("username"),
                        "readFlag": value.get("readFlag"),
                        "createTime": value.get("commentCreatetime"),
                    },
                )
            if any(key in value for key in ("msgContent", "messageContent", "lastMsg", "lastMsgContent", "content")):
                author = value.get("nickname") or value.get("name") or value.get("sessionName") or value.get("fromNickname")
                for key in ("msgContent", "messageContent", "lastMsgContent", "lastMsg", "content", "summary"):
                    if isinstance(value.get(key), str):
                        add_candidate(
                            "message" if default_kind == "message" else default_kind,
                            value.get(key),
                            f"{path}.{key}",
                            author,
                            " ".join(_normalize_interaction_text(value.get(ctx_key)) for ctx_key in ("nickname", "name", "sessionName", key) if value.get(ctx_key)),
                            {
                                "sessionId": value.get("sessionId") or value.get("id"),
                                "username": value.get("username") or value.get("fromUsername"),
                                "readFlag": value.get("readFlag"),
                                "createTime": value.get("createTime") or value.get("timestamp"),
                            },
                        )
            for key, child in value.items():
                child_path = f"{path}.{key}" if path else str(key)
                if isinstance(child, str):
                    nested = _try_parse_json_text(child)
                    if nested is not None:
                        walk(nested, child_path)
                else:
                    walk(child, child_path)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, f"{path}[{index}]")

    walk(parsed)
    return candidates[:limit]


def _merge_wechat_channel_candidates(dom_items, trace, target_kind, limit):
    merged = []
    seen = set()
    expected_key = "looksLikeComment" if target_kind == "comments" else "looksLikeMessage"

    def push(item, source_hint=None):
        if not isinstance(item, dict):
            return
        text = _normalize_interaction_text(item.get("text"))
        if not _looks_like_wechat_channel_customer_text(text):
            return
        author = _normalize_interaction_text(item.get("author"))
        key = f"{author}:{text}".lower()
        if key in seen:
            return
        seen.add(key)
        merged_item = dict(item)
        merged_item[expected_key] = True
        if source_hint and not merged_item.get("source"):
            merged_item["source"] = source_hint
        merged.append(merged_item)

    for event in trace or []:
        if not isinstance(event, dict):
            continue
        for item in event.get("wechatChannelCandidates") or []:
            if target_kind == "comments" and not item.get("looksLikeComment"):
                continue
            if target_kind == "messages" and not item.get("looksLikeMessage"):
                continue
            push(item, "wechat-channel-network")
            if len(merged) >= limit:
                return merged
    if merged:
        return merged
    if target_kind == "messages":
        for item in _extract_wechat_channel_messages_from_dom_items(dom_items or []):
            push(item, "wechat-channel-dom-session")
            if len(merged) >= limit:
                return merged
        if merged:
            return merged
    for item in dom_items or []:
        push(item, "wechat-channel-dom")
        if len(merged) >= limit:
            return merged
    return merged


def _extract_wechat_channel_messages_from_dom_items(dom_items):
    extracted = []
    seen = set()
    for item in dom_items or []:
        if not isinstance(item, dict):
            continue
        if item.get("sessionRow"):
            author = _normalize_interaction_text(item.get("author"))
            content = _normalize_interaction_text(item.get("text"))
            timestamp = _normalize_interaction_text(item.get("timestamp"))
            # 对于私信，只要内容看起来像客户消息就接受，不强制要求作者也通过过滤
            if not _looks_like_wechat_channel_customer_text(content):
                continue
            key = f"{author}:{content}".lower()
            if key in seen:
                continue
            seen.add(key)
            extracted.append({
                "text": content,
                "author": author,
                "context": _normalize_interaction_text(item.get("context"))[:260],
                "timestamp": timestamp,
                "looksLikeMessage": True,
                "source": item.get("source") or "wechat-channel-dom-session",
                "score": item.get("score") or 92,
            })
            continue
        text = _normalize_interaction_text(item.get("text"))
        context = _normalize_interaction_text(item.get("context"))
        source_text = context if len(context) >= len(text) else text
        match = re.match(
            r"^(.+?)\s+(\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}|今天\s*\d{1,2}:\d{2}|昨天\s*\d{1,2}:\d{2}|\d{1,2}:\d{2})\s+(.+)$",
            source_text,
        )
        if not match:
            match = re.match(
                r"^(.+?)\s+(.+?)\s+(\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}|今天|昨天|\d+分钟前|\d+小时前)$",
                source_text,
            )
        if not match:
            parts = source_text.split(None, 1)
            if len(parts) == 2 and _looks_like_wechat_channel_customer_text(parts[1]):
                match = type('Match', (), {'groups': lambda self: (parts[0], '', parts[1])})()
        if not match:
            continue
        author, timestamp, content = (_normalize_interaction_text(part) for part in match.groups())
        # 对于私信，只要内容看起来像客户消息就接受
        if not _looks_like_wechat_channel_customer_text(content):
            continue
        key = f"{author}:{content}".lower()
        if key in seen:
            continue
        seen.add(key)
        extracted.append({
            "text": content,
            "author": author,
            "context": source_text[:260],
            "timestamp": timestamp or "",
            "looksLikeMessage": True,
            "source": "wechat-channel-dom-session",
            "score": 88,
        })
    return extracted


def _find_wechat_channel_trace_candidate(trace, target_kind, target_text):
    expected_key = "looksLikeComment" if target_kind == "comments" else "looksLikeMessage"
    normalized_target = _normalize_interaction_text(target_text)
    for event in reversed(trace or []):
        if not isinstance(event, dict):
            continue
        for item in event.get("wechatChannelCandidates") or []:
            if not isinstance(item, dict) or not item.get(expected_key):
                continue
            text = _normalize_interaction_text(item.get("text"))
            if not normalized_target or text == normalized_target or text in normalized_target or normalized_target in text:
                return item
    return {}


def _drop_interaction_context(platform, account_id):
    key = f"{platform}:{account_id}"
    session = _interaction_browser_sessions.pop(key, None)
    if not session:
        return
    context = session.get("context")
    browser_obj = session.get("browser_obj")
    loop = _get_interaction_runtime_loop()
    if context:
        try:
            future = asyncio.run_coroutine_threadsafe(context.close(), loop)
            future.result(timeout=5)
        except Exception as e:
            print(f"[interaction/cdp] close stale context failed key={key}: {e}")
    if browser_obj:
        try:
            future = asyncio.run_coroutine_threadsafe(browser_obj.close(), loop)
            future.result(timeout=5)
        except Exception as e:
            print(f"[interaction/cdp] close browser failed key={key}: {e}")


def _run_osascript(script, timeout=8):
    return subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _detect_wechat_desktop():
    permission_hints = [
        "需要 macOS 自动化权限以激活微信。",
        "需要辅助功能权限以向当前焦点输入框粘贴草稿。",
        "不会读取微信私聊、联系人或消息记录。",
    ]
    safety_boundary = {
        "draftOnly": True,
        "readsPrivateChats": False,
        "readsContacts": False,
        "sendsMessages": False,
        "targeting": "仅使用用户手动打开并聚焦的当前微信会话输入框。",
        "manualSteps": [
            "用户先在桌面微信中打开目标会话。",
            "系统只粘贴回复草稿。",
            "用户人工检查后手动点击发送。",
        ],
    }
    if os.uname().sysname != "Darwin":
        return {
            "platform": os.uname().sysname,
            "available": False,
            "running": False,
            "appName": None,
            "windowCount": 0,
            "permissionHints": permission_hints,
            "safetyBoundary": safety_boundary,
            "requiresManualTarget": True,
            "message": "当前不是 macOS，暂未接入桌面微信控制。",
        }

    candidates = ["WeChat", "微信"]
    for app_name in candidates:
        try:
            running = _run_osascript(
                f'tell application "System Events" to exists process "{app_name}"'
            ).stdout.strip().lower() == "true"
            if not running:
                continue
            window_result = _run_osascript(
                f'tell application "System Events" to count windows of process "{app_name}"'
            )
            try:
                window_count = int((window_result.stdout or "0").strip() or "0")
            except ValueError:
                window_count = 0
            return {
                "platform": "Darwin",
                "available": True,
                "running": True,
                "appName": app_name,
                "windowCount": window_count,
                "permissionHints": permission_hints,
                "safetyBoundary": safety_boundary,
                "requiresManualTarget": True,
                "message": "已检测到桌面微信进程；不会读取私聊内容，确认后仅把草稿粘贴到你手动打开的当前会话输入框。",
            }
        except Exception:
            continue

    return {
        "platform": "Darwin",
        "available": False,
        "running": False,
        "appName": None,
        "windowCount": 0,
        "permissionHints": permission_hints,
        "safetyBoundary": safety_boundary,
        "requiresManualTarget": True,
        "message": "未检测到桌面微信进程，请先打开微信并进入目标会话。",
    }


def _interaction_evidence_dir():
    path = Path(BASE_DIR / "logs" / "interaction-evidence")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _interaction_evidence_url(filename):
    return f"http://127.0.0.1:5409/interaction/evidence/{filename}"


def _interaction_evidence_status():
    evidence_dir = _interaction_evidence_dir()
    files = []
    try:
        files = [item for item in evidence_dir.iterdir() if item.is_file()]
    except Exception:
        files = []

    total_bytes = 0
    latest_mtime = None
    for item in files:
        try:
            stat = item.stat()
        except Exception:
            continue
        total_bytes += stat.st_size
        latest_mtime = max(latest_mtime or stat.st_mtime, stat.st_mtime)

    return {
        "directory": str(evidence_dir),
        "urlPrefix": "http://127.0.0.1:5409/interaction/evidence/",
        "fileCount": len(files),
        "totalBytes": total_bytes,
        "latestUpdatedAt": (
            datetime.fromtimestamp(latest_mtime).isoformat() if latest_mtime else None
        ),
    }


def _interaction_evidence_cleanup_preview(retention_days=7, execute=False):
    try:
        days = max(0, int(retention_days))
    except (TypeError, ValueError):
        days = 7

    evidence_dir = _interaction_evidence_dir()
    cutoff = datetime.now().timestamp() - (days * 24 * 60 * 60)
    candidates = []
    deleted = []
    errors = []

    try:
        files = [item for item in evidence_dir.iterdir() if item.is_file()]
    except Exception as e:
        files = []
        errors.append(str(e))

    for item in files:
        if item.name.startswith("."):
            continue
        if item.suffix.lower() not in [".png", ".jpg", ".jpeg", ".webp", ".txt", ".json", ".html"]:
            continue
        try:
            stat = item.stat()
        except Exception as e:
            errors.append(f"{item.name}: {e}")
            continue
        if stat.st_mtime > cutoff:
            continue

        record = {
            "name": item.name,
            "path": str(item),
            "sizeBytes": stat.st_size,
            "updatedAt": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        }
        candidates.append(record)

        if execute:
            try:
                item.unlink()
                deleted.append(record)
            except Exception as e:
                errors.append(f"{item.name}: {e}")

    target_records = deleted if execute else candidates
    return {
        "directory": str(evidence_dir),
        "retentionDays": days,
        "execute": bool(execute),
        "candidateCount": len(candidates),
        "deletedCount": len(deleted),
        "totalBytes": sum(item["sizeBytes"] for item in target_records),
        "files": target_records[:50],
        "errors": errors[:20],
        "checkedAt": datetime.now().isoformat(),
        "status": _interaction_evidence_status(),
    }


def _interaction_read_summary(total_candidates, usable_items, empty_label):
    usable_count = len(usable_items) if isinstance(usable_items, list) else 0
    try:
        candidate_count = int(total_candidates or 0)
    except (TypeError, ValueError):
        candidate_count = 0

    empty_reason = None
    if usable_count == 0:
        empty_reason = (
            f"扫描到 {candidate_count} 个候选，但未形成可用{empty_label}对象。"
            if candidate_count > 0
            else f"页面扫描未发现{empty_label}候选对象。"
        )

    return {
        "totalCandidates": candidate_count,
        "usableCount": usable_count,
        "emptyReason": empty_reason,
    }


def _interaction_capabilities_payload():
    evidence = _interaction_evidence_status()
    cleanup_command = (
        f'find "{evidence["directory"]}" -type f -name "*.png" -mtime +7 -delete'
    )
    return {
        "service": "auto-upload-interaction",
        "version": "local",
        "checkedAt": datetime.now().isoformat(),
        "supportedTaskTypes": [
            {
                "key": "douyin-comment-reply",
                "platformType": 3,
                "platformName": "抖音",
                "entryType": "douyin-comment-reply",
                "stages": ["open-entry", "target-read", "draft-fill", "auto-send"],
                "controlledSend": True,
                "autoSend": True,
                "evidence": ["screenshot", "page-text-sample"],
            },
            {
                "key": "douyin-direct-message-reply",
                "platformType": 3,
                "platformName": "抖音",
                "entryType": "douyin-direct-message-reply",
                "stages": ["open-entry", "target-read", "draft-fill", "auto-send"],
                "controlledSend": True,
                "autoSend": True,
                "evidence": ["screenshot", "page-text-sample"],
            },
            {
                "key": "wechat-channel-comment-reply",
                "platformType": 2,
                "platformName": "视频号",
                "entryType": "wechat-channel-comment-reply",
                "stages": ["open-entry", "target-read", "draft-fill", "auto-send"],
                "controlledSend": True,
                "autoSend": True,
                "evidence": ["screenshot", "page-text-sample"],
            },
            {
                "key": "wechat-channel-direct-message-reply",
                "platformType": 2,
                "platformName": "视频号",
                "entryType": "wechat-channel-direct-message-reply",
                "stages": ["open-entry", "target-read", "draft-fill", "auto-send"],
                "controlledSend": True,
                "autoSend": True,
                "evidence": ["screenshot", "page-text-sample"],
            },
            {
                "key": "wechat-reply-draft",
                "platformType": 2,
                "platformName": "视频号 / 微信",
                "entryType": "wechat-reply-draft",
                "stages": ["desktop-status", "draft-fill"],
                "controlledSend": False,
                "evidence": ["desktop-status"],
            },
        ],
        "evidence": evidence,
        "screenshotCleanup": {
            "recommendation": "互动截图只作为本地排障证据，建议保留 7 天或 200 张以内；确认任务无争议后可删除。",
            "retentionDays": 7,
            "maxFiles": 200,
            "safePattern": "*.png",
            "suggestedCommand": cleanup_command,
        },
        "safetyBoundary": {
            "host": "127.0.0.1:5409",
            "network": "仅作为本机 HTTP 服务暴露，默认不提供公网访问能力。",
            "dataLocality": "账号 Cookie、本地数据库、素材、日志和互动截图保存在本机 BASE_DIR 下。",
            "browserAutomation": "互动任务可打开平台页面、读取目标文本、填入回复，并在自动发送模式下点击平台发送按钮。",
            "sendPolicy": "抖音和视频号评论/私信仅在找到真实目标对象、写入回复并识别到发送按钮后执行自动发送；微信桌面草稿仍由桌面控制链路决定。",
            "pathAccess": [
                str(Path(BASE_DIR / "cookiesFile")),
                str(Path(BASE_DIR / "db" / "database.db")),
                str(Path(BASE_DIR / "logs")),
                str(Path(BASE_DIR / "videoFile")),
            ],
        },
    }


async def _capture_interaction_screenshot(page, prefix, label="页面截图"):
    try:
        safe_prefix = ''.join(
            ch if ch.isalnum() or ch in ('-', '_') else '-'
            for ch in str(prefix or 'interaction')
        )[:80] or 'interaction'
        filename = f"{safe_prefix}-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}.png"
        path = _interaction_evidence_dir() / filename
        await page.screenshot(path=str(path), full_page=False)
        return {
            "type": "screenshot",
            "label": label,
            "value": _interaction_evidence_url(filename),
            "path": str(path),
        }
    except Exception as e:
        print(f"[interaction/evidence] screenshot failed prefix={prefix}: {e}")
        return None

# 全局账号验证缓存时间（秒），默认 3600 秒（1 小时）
ACCOUNT_STATUS_TTL_SECONDS = int(os.getenv('ACCOUNT_STATUS_TTL_SECONDS', '3600'))
# 账号有效性校验并发数。浏览器校验很重，默认 3 个并发比串行快，也避免一次性压满机器。
ACCOUNT_VALIDATION_CONCURRENCY = max(1, int(os.getenv('ACCOUNT_VALIDATION_CONCURRENCY', '3')))
# 上次完整验证时间戳
_last_accounts_validation_ts: float = 0.0

# Detect frontend dist directory for portable serving
ROOT_DIR = Path(__file__).resolve().parent

def _find_frontend_dist():
    candidates = [
        ROOT_DIR / "frontend" / "dist",
        ROOT_DIR.parent / "frontend" / "dist",
    ]
    for p in candidates:
        if (p / "index.html").exists():
            return p
    return ROOT_DIR / "frontend"

FRONTEND_DIST = _find_frontend_dist()
print(f"FRONTEND_DIST: {FRONTEND_DIST}")

def initialize_database() -> None:
    db_dir = Path(BASE_DIR / "db")
    db_dir.mkdir(parents=True, exist_ok=True)
    db_file = db_dir / "database.db"
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        cursor.execute('''
CREATE TABLE IF NOT EXISTS user_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type INTEGER NOT NULL,
    filePath TEXT NOT NULL,
    userName TEXT NOT NULL,
    status INTEGER DEFAULT 0
)
''')
        cursor.execute("PRAGMA table_info(user_info)")
        existing_columns = {row[1] for row in cursor.fetchall()}
        migrations = {
            "profileName": "ALTER TABLE user_info ADD COLUMN profileName TEXT",
            "avatarPath": "ALTER TABLE user_info ADD COLUMN avatarPath TEXT",
            "avatarUpdatedAt": "ALTER TABLE user_info ADD COLUMN avatarUpdatedAt TEXT",
        }
        for column, sql in migrations.items():
            if column not in existing_columns:
                cursor.execute(sql)
        cursor.execute("UPDATE user_info SET profileName = userName WHERE profileName IS NULL OR profileName = ''")
        cursor.execute('''
CREATE TABLE IF NOT EXISTS file_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    filesize REAL,
    upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    file_path TEXT
)
''')
        cursor.execute('''
CREATE TABLE IF NOT EXISTS publish_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    platform_type INTEGER,
    account_file TEXT,
    file_list TEXT,
    tags TEXT,
    dry_run INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',
    message TEXT,
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
''')
        conn.commit()
    Path(BASE_DIR / "avatars").mkdir(parents=True, exist_ok=True)
    print("[OK] 数据库已初始化")

app = Flask(__name__, static_folder=str(FRONTEND_DIST))

#允许所有来源跨域访问
CORS(app)

# 限制上传文件大小为160MB
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024

def _serve_frontend_index():
    response = app.send_static_file('index.html')
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

def _safe_storage_path(base_dir, stored_name):
    if not stored_name:
        return None
    stored_name = str(stored_name).replace("\\", "/")
    if stored_name.startswith("/") or ".." in stored_name.split("/"):
        return None
    return Path(base_dir / stored_name).resolve()

def _remove_if_exists(path):
    if path and path.exists() and path.is_file():
        path.unlink()

def _account_row_to_dict(row):
    keys = [
        "id", "type", "filePath", "userName", "status",
        "profileName", "avatarPath", "avatarUpdatedAt"
    ]
    data = dict(zip(keys, row))
    data["avatarUrl"] = f"/avatars/{data['avatarPath']}" if data.get("avatarPath") else None
    return data

def _update_account_identity(account_id: int, avatar_path=None, display_name=None):
    if not avatar_path and not display_name:
        return
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        if avatar_path and display_name:
            cursor.execute(
                """
                UPDATE user_info
                SET avatarPath = ?, userName = ?, avatarUpdatedAt = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (avatar_path, display_name, account_id)
            )
        elif avatar_path:
            cursor.execute(
                "UPDATE user_info SET avatarPath = ?, avatarUpdatedAt = CURRENT_TIMESTAMP WHERE id = ?",
                (avatar_path, account_id)
            )
        else:
            cursor.execute(
                "UPDATE user_info SET userName = ?, avatarUpdatedAt = CURRENT_TIMESTAMP WHERE id = ?",
                (display_name, account_id)
            )
        conn.commit()

async def _capture_identity_from_logged_in_page(page, account_id: int, account_type: int):
    try:
        avatar_name = f"account_{account_id}.png"
        avatar_path, display_name = await capture_identity_from_page(page, avatar_name, account_type)
        _update_account_identity(account_id, avatar_path, display_name)
        return avatar_path, display_name
    except Exception as e:
        print(f"capture account identity failed id={account_id} type={account_type} err={e}")
        return None, None

async def _capture_account_avatar(account_id: int):
    url_map = {
        1: "https://creator.xiaohongshu.com/new/note-manager",
        2: "https://channels.weixin.qq.com/platform",
        3: "https://creator.douyin.com/creator-micro/content/manage",
        4: "https://cp.kuaishou.com/article/publish/video",
        5: "https://member.bilibili.com/platform/upload-manager/article",
    }
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, type, filePath FROM user_info WHERE id = ?",
            (account_id,)
        )
        row = cursor.fetchone()

    if not row:
        return None, "account not found"

    cookie_file = Path(BASE_DIR / "cookiesFile" / row["filePath"])
    if not cookie_file.exists():
        return None, "account cookie file not found"

    p = await async_playwright().start()
    browser = None
    try:
        browser = await launch_chromium_with_codecs(p, headless=True, executable_path=None)
        context = await browser.new_context(
            storage_state=str(cookie_file),
            viewport={"width": 1600, "height": 1000},
        )
        context = await set_init_script(context)
        page = await context.new_page()
        await page.goto(url_map.get(row["type"], "https://www.baidu.com"), wait_until="domcontentloaded", timeout=30000)
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await page.wait_for_timeout(1200)
        avatar_path, display_name = await _capture_identity_from_logged_in_page(page, account_id, row["type"])
        await context.close()
        if not avatar_path and not display_name:
            return None, "未在平台后台页面识别到头像或昵称"
        return avatar_path, None
    except Exception as e:
        return None, str(e)
    finally:
        if browser:
            await browser.close()
        await p.stop()

def _validate_publish_payload(data):
    errors = []
    if not isinstance(data, dict):
        return ["发布参数格式错误"]

    platform_type = data.get('type')
    if platform_type not in (1, 2, 3, 4, 5):
        errors.append("请选择有效的发布平台")

    if data.get('enableTimer') in (1, "1", True, "true", "True"):
        try:
            jitter_minutes = int(data.get('timeJitterMinutes', 0) or 0)
            if jitter_minutes < 0 or jitter_minutes > 120:
                errors.append("随机浮动需在0-120分钟之间")
        except (TypeError, ValueError):
            errors.append("随机浮动需在0-120分钟之间")

    title = (data.get('title') or data.get('biliTitle') or '').strip()
    if platform_type == 5 and not title:
        errors.append("请填写B站稿件标题")

    file_list = data.get('fileList', [])
    if not isinstance(file_list, list) or not file_list:
        errors.append("请至少选择一个视频文件")
    else:
        for file_name in file_list:
            path = _safe_storage_path(Path(BASE_DIR / "videoFile"), file_name)
            if not path or not path.exists():
                errors.append(f"视频文件不存在：{file_name}")

    account_list = data.get('accountList', [])
    if not isinstance(account_list, list) or not account_list:
        errors.append("请至少选择一个发布账号")
    else:
        for account_file in account_list:
            path = _safe_storage_path(Path(BASE_DIR / "cookiesFile"), account_file)
            if not path or not path.exists():
                errors.append(f"账号登录文件不存在：{account_file}")

    cover_path = data.get('coverPath')
    if cover_path:
        path = _safe_storage_path(Path(BASE_DIR / "videoFile"), cover_path)
        if not path or not path.exists():
            errors.append(f"封面文件不存在：{cover_path}")

    cover_paths = data.get('coverPaths')
    if cover_paths is not None:
        if not isinstance(cover_paths, dict):
            errors.append("封面规格数据格式不正确")
        else:
            for ratio, file_name in cover_paths.items():
                if not file_name:
                    continue
                path = _safe_storage_path(Path(BASE_DIR / "videoFile"), file_name)
                if not path or not path.exists():
                    errors.append(f"{ratio} 封面文件不存在：{file_name}")

    return errors

async def _check_publish_account_states(data_list):
    account_items = []
    seen_keys = set()

    for data in data_list:
        if not isinstance(data, dict):
            continue
        if data.get("skipAccountCheck") in (1, "1", True, "true", "True", "yes"):
            continue
        try:
            platform_type = int(data.get("type"))
        except (TypeError, ValueError):
            continue
        for account_file in data.get("accountList") or []:
            key = (platform_type, account_file)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            account_items.append({
                "type": platform_type,
                "filePath": account_file,
            })

    if not account_items:
        return []

    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(account_items))
        file_paths = [item["filePath"] for item in account_items]
        cursor.execute(
            f"""
            SELECT id, type, filePath, userName, status, profileName, avatarPath, avatarUpdatedAt
            FROM user_info
            WHERE filePath IN ({placeholders})
            """,
            file_paths,
        )
        rows_by_file = {row["filePath"]: row for row in cursor.fetchall()}

    failures = []
    status_updates = []
    transient_failures = []

    for item in account_items:
        platform_type = item["type"]
        file_path = item["filePath"]
        row = rows_by_file.get(file_path)
        display_name = row["userName"] if row else file_path
        profile_name = row["profileName"] if row else None
        label_name = display_name or profile_name or file_path
        platform_name = PLATFORM_NAME_MAP.get(platform_type, "未知平台")

        cookie_path = Path(BASE_DIR / "cookiesFile" / file_path)
        if not cookie_path.exists():
            failures.append({
                "type": platform_type,
                "filePath": file_path,
                "platform": platform_name,
                "account": label_name,
                "message": f"{platform_name}「{label_name}」登录文件不存在，请重新登录",
            })
            if row:
                status_updates.append((0, row["id"]))
            continue

        try:
            is_valid = await check_cookie(platform_type, file_path)
        except Exception as e:
            print(f"publish account preflight failed type={platform_type} file={file_path} err={e}")
            if _is_transient_browser_error(e):
                transient_failures.append({
                    "type": platform_type,
                    "filePath": file_path,
                    "platform": platform_name,
                    "account": label_name,
                    "transient": True,
                    "message": f"{platform_name}「{label_name}」账号校验临时超时，请稍后重试；不会把账号标记为失效",
                })
                continue
            is_valid = False

        if row:
            status_updates.append((1 if is_valid else 0, row["id"]))

        if not is_valid:
            failures.append({
                "type": platform_type,
                "filePath": file_path,
                "platform": platform_name,
                "account": label_name,
                "message": f"{platform_name}「{label_name}」登录已失效，请先重登后再发布",
            })

    if status_updates:
        with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
            cursor = conn.cursor()
            cursor.executemany(
                "UPDATE user_info SET status = ? WHERE id = ?",
                status_updates,
            )
            conn.commit()

    return failures + transient_failures

def _validate_publish_accounts_before_run(data_list):
    failures = _run_async(_check_publish_account_states(data_list))
    blocking_failures = [
        item
        for item in failures
        if not item.get("transient")
    ]
    if not blocking_failures:
        return {"messages": [], "failures": []}
    return {
        "messages": ["发布前账号检查未通过"] + [item["message"] for item in blocking_failures],
        "failures": blocking_failures,
    }

def _build_publish_preflight_results(data_list, failed_by_index):
    results = []
    for index, data in enumerate(data_list):
        try:
            platform_type = int(data.get("type"))
        except (TypeError, ValueError):
            platform_type = 0
        account_file = (data.get("accountList") or [""])[0]
        errors = failed_by_index.get(index, [])
        results.append({
            "type": platform_type,
            "ok": False if errors else None,
            "message": "；".join(errors) if errors else "参数检查通过，因本次存在失败项，发布流程未执行",
            "platform": PLATFORM_NAME_MAP.get(platform_type, f"平台 {platform_type}"),
            "account": account_file,
        })
    return results

def _is_transient_browser_error(error):
    text = str(error)
    return isinstance(error, (PlaywrightTimeoutError, PlaywrightError)) or any(
        keyword in text
        for keyword in (
            "Timeout",
            "ERR_TIMED_OUT",
            "ERR_CONNECTION",
            "ERR_NETWORK",
            "net::",
            "Target closed",
            "Browser closed",
        )
    )

def _create_publish_tasks(data_list, dry_run=True):
    task_ids = []
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        for data in data_list:
            cursor.execute('''
                INSERT INTO publish_tasks (
                    title, platform_type, account_file, file_list, tags,
                    dry_run, status, message, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 'running', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ''', (
                data.get('title') or data.get('biliTitle') or '',
                data.get('type'),
                ",".join(data.get('accountList') or []),
                json.dumps(data.get('fileList') or [], ensure_ascii=False),
                json.dumps(data.get('tags') or [], ensure_ascii=False),
                1 if dry_run else 0,
                "预发布检查中" if dry_run else "发布中",
            ))
            task_ids.append(cursor.lastrowid)
        conn.commit()
    return task_ids

def _update_publish_tasks(task_ids, results=None, status="success", message=None):
    results = results if isinstance(results, list) else []
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        for index, task_id in enumerate(task_ids):
            result = results[index] if index < len(results) else None
            task_status = status
            task_message = message
            if isinstance(result, dict):
                if result.get("ok") is False:
                    task_status = "failed"
                task_message = result.get("message") or task_message
            cursor.execute('''
                UPDATE publish_tasks
                SET status = ?, message = ?, result = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (
                task_status,
                task_message,
                json.dumps(result, ensure_ascii=False) if result is not None else None,
                task_id,
            ))
        conn.commit()

def _list_publish_tasks(limit=50):
    limit = max(1, min(int(limit or 50), 200))
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, title, platform_type, account_file, file_list, tags, dry_run,
                   status, message, result, created_at, updated_at
            FROM publish_tasks
            ORDER BY id DESC
            LIMIT ?
        ''', (limit,))
        rows = cursor.fetchall()
    items = []
    for row in rows:
        item = dict(row)
        for key in ("file_list", "tags", "result"):
            try:
                item[key] = json.loads(item[key]) if item.get(key) else None
            except Exception:
                item[key] = item.get(key)
        item["platform"] = PLATFORM_NAME_MAP.get(item.get("platform_type"), str(item.get("platform_type")))
        item["dry_run"] = bool(item.get("dry_run"))
        items.append(item)
    return items

@app.route('/')
def hello_world():
    return _serve_frontend_index()

@app.route('/health', methods=['GET'])
def health_check():
    db_file = Path(BASE_DIR / "db" / "database.db")
    folders = {
        "cookiesFile": Path(BASE_DIR / "cookiesFile"),
        "videoFile": Path(BASE_DIR / "videoFile"),
        "avatars": Path(BASE_DIR / "avatars"),
        "logs": Path(BASE_DIR / "logs"),
    }
    return jsonify({
        "status": "ok",
        "service": "auto-upload",
        "version": "local",
        "baseDir": str(BASE_DIR),
        "frontendDist": str(FRONTEND_DIST),
        "database": {
            "path": str(db_file),
            "exists": db_file.exists(),
        },
        "folders": {
            name: {
                "path": str(path),
                "exists": path.exists(),
            }
            for name, path in folders.items()
        },
    }), 200

@app.route('/logs/recent', methods=['GET'])
def recent_logs():
    try:
        limit = int(request.args.get('limit', 80))
    except Exception:
        limit = 80
    limit = max(1, min(limit, 300))

    logs_dir = Path(BASE_DIR / "logs")
    log_files = [
        ("douyin", "抖音", "douyin.log"),
        ("xiaohongshu", "小红书", "xiaohongshu.log"),
        ("xhs", "小红书", "xhs.log"),
        ("tencent", "视频号", "tencent.log"),
        ("kuaishou", "快手", "kuaishou.log"),
        ("bilibili", "B站", "bilibili.log"),
    ]
    items = []
    for key, platform, filename in log_files:
        path = logs_dir / filename
        if not path.exists():
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            lines = []
        items.append({
            "key": key,
            "platform": platform,
            "filename": filename,
            "path": str(path),
            "size": path.stat().st_size,
            "updatedAt": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
            "lines": lines[-limit:],
        })

    return jsonify({
        "code": 200,
        "msg": None,
        "data": items,
    }), 200

@app.route('/publishTasks', methods=['GET'])
def publish_tasks():
    try:
        limit = int(request.args.get('limit', 50))
    except Exception:
        limit = 50
    return jsonify({
        "code": 200,
        "msg": None,
        "data": _list_publish_tasks(limit),
    }), 200

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({
            "code": 200,
            "data": None,
            "msg": "No file part in the request"
        }), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({
            "code": 200,
            "data": None,
            "msg": "No selected file"
        }), 400
    try:
        # 保存文件到指定位置
        uuid_v1 = uuid.uuid1()
        print(f"UUID v1: {uuid_v1}")
        filepath = Path(BASE_DIR / "videoFile" / f"{uuid_v1}_{Path(file.filename).name}")
        filepath.parent.mkdir(parents=True, exist_ok=True)
        file.save(filepath)
        return jsonify({"code":200,"msg": "File uploaded successfully", "data": f"{uuid_v1}_{file.filename}"}), 200
    except Exception as e:
        print(f"Upload failed: {e}")
        return jsonify({"code":500,"msg": str(e),"data":None}), 500

@app.route('/getFile', methods=['GET'])
def get_file():
    # 获取 filename 参数
    filename = request.args.get('filename')

    if not filename:
        return {"error": "filename is required"}, 400

    # 防止路径穿越攻击
    if '..' in filename or filename.startswith('/'):
        return {"error": "Invalid filename"}, 400

    # 拼接完整路径
    file_path = str(Path(BASE_DIR / "videoFile"))

    # 返回文件
    return send_from_directory(file_path,filename)

@app.route('/avatars/<path:filename>', methods=['GET'])
def get_avatar(filename):
    if '..' in filename or filename.startswith('/'):
        return {"error": "Invalid filename"}, 400
    return send_from_directory(str(Path(BASE_DIR / "avatars")), filename)


@app.route('/interaction/evidence/<path:filename>', methods=['GET'])
def get_interaction_evidence(filename):
    if '..' in filename or filename.startswith('/'):
        return {"error": "Invalid filename"}, 400
    return send_from_directory(str(_interaction_evidence_dir()), filename)


@app.route('/interaction/capabilities', methods=['GET'])
def get_interaction_capabilities():
    return jsonify({
        "code": 200,
        "msg": None,
        "data": _interaction_capabilities_payload(),
    }), 200


@app.route('/interaction/cdp/sessions', methods=['GET'])
def get_cdp_sessions():
    return jsonify({
        "code": 200,
        "msg": None,
        "data": _cdp_list_sessions(),
    }), 200


@app.route('/interaction/evidence/cleanup-preview', methods=['GET'])
def preview_interaction_evidence_cleanup():
    return jsonify({
        "code": 200,
        "msg": None,
        "data": _interaction_evidence_cleanup_preview(
            request.args.get("retentionDays", 7),
            execute=False,
        ),
    }), 200


@app.route('/interaction/evidence/cleanup', methods=['POST'])
def cleanup_interaction_evidence():
    payload = request.get_json(silent=True) or {}
    return jsonify({
        "code": 200,
        "msg": None,
        "data": _interaction_evidence_cleanup_preview(
            payload.get("retentionDays", 7),
            execute=True,
        ),
    }), 200


# SPA fallback: serve files if exist, else index.html
@app.route('/<path:path>')
def spa_fallback(path):
    target = FRONTEND_DIST / path
    if target.exists() and target.is_file():
        return send_from_directory(str(FRONTEND_DIST), path)
    return _serve_frontend_index()


@app.route('/uploadSave', methods=['POST'])
def upload_save():
    if 'file' not in request.files:
        return jsonify({
            "code": 400,
            "data": None,
            "msg": "No file part in the request"
        }), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({
            "code": 400,
            "data": None,
            "msg": "No selected file"
        }), 400

    # 获取表单中的自定义文件名（可选）
    custom_filename = request.form.get('filename', None)
    if custom_filename:
        suffix = Path(file.filename).suffix
        filename = Path(custom_filename).name + suffix
    else:
        filename = Path(file.filename).name

    try:
        # 生成 UUID v1
        uuid_v1 = uuid.uuid1()
        print(f"UUID v1: {uuid_v1}")

        # 构造文件名和路径
        final_filename = f"{uuid_v1}_{filename}"
        filepath = Path(BASE_DIR / "videoFile" / f"{uuid_v1}_{filename}")
        filepath.parent.mkdir(parents=True, exist_ok=True)

        # 保存文件
        file.save(filepath)

        with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                                INSERT INTO file_records (filename, filesize, file_path)
            VALUES (?, ?, ?)
                                ''', (filename, round(float(os.path.getsize(filepath)) / (1024 * 1024),2), final_filename))
            conn.commit()
            print("[OK] 上传文件已记录")

        return jsonify({
            "code": 200,
            "msg": "File uploaded and saved successfully",
            "data": {
                "filename": filename,
                "filepath": final_filename
            }
        }), 200

    except Exception as e:
        return jsonify({
            "code": 500,
            "msg": f"upload failed: {e}",
            "data": None
        }), 500

@app.route('/getFiles', methods=['GET'])
def get_all_files():
    try:
        # 使用 with 自动管理数据库连接
        with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
            conn.row_factory = sqlite3.Row  # 允许通过列名访问结果
            cursor = conn.cursor()

            # 查询所有记录
            cursor.execute("SELECT * FROM file_records")
            rows = cursor.fetchall()

            # 将结果转为字典列表
            data = [dict(row) for row in rows]

        return jsonify({
            "code": 200,
            "msg": "success",
            "data": data
        }), 200
    except Exception as e:
        return jsonify({
            "code": 500,
            "msg": str("get file failed!"),
            "data": None
        }), 500


@app.route("/getValidAccounts",methods=['GET'])
async def getValidAccounts():
    """
    获取账号列表。
    可选参数：
      - validate: 1/true 表示触发校验；0/false 表示仅返回数据库缓存状态（更快）。默认 0。
      - force: 1/true 表示忽略 TTL 强制校验。
      - ids: 可选，逗号分隔的账号 id 列表。提供时，仅对这些账号执行校验，其余账号保留缓存状态。
    说明：
      - 为避免频繁打开浏览器验证，增加了 TTL，默认 1 小时内重复请求不会再次校验。
    """
    global _last_accounts_validation_ts

    validate = request.args.get('validate', '0').lower() in ('1', 'true', 'yes')
    force = request.args.get('force', '0').lower() in ('1', 'true', 'yes')
    ids_param = request.args.get('ids', '').strip()
    selected_ids = set()
    if ids_param:
        try:
            selected_ids = {int(x) for x in ids_param.split(',') if x.strip().isdigit()}
        except Exception:
            selected_ids = set()

    now_ts = time.time()
    should_validate = validate and (force or (now_ts - _last_accounts_validation_ts >= ACCOUNT_STATUS_TTL_SECONDS))

    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        cursor.execute('''
        SELECT id, type, filePath, userName, status, profileName, avatarPath, avatarUpdatedAt FROM user_info''')
        rows = cursor.fetchall()
        rows_list = [_account_row_to_dict(row) for row in rows]

        # 快速返回：不需要校验时，直接返回数据库中的缓存状态
        if not should_validate:
            return jsonify({
                "code": 200,
                "msg": None,
                "data": rows_list
            }), 200

        rows_to_validate = [
            row for row in rows_list
            if not selected_ids or row["id"] in selected_ids
        ]
        preview = request.args.get('preview', '0').lower() in ('1', 'true', 'yes')
        concurrency = 1 if preview else min(ACCOUNT_VALIDATION_CONCURRENCY, max(1, len(rows_to_validate)))
        semaphore = asyncio.Semaphore(concurrency)

        async def validate_account_row(row):
            platform = {1: 'xhs', 2: 'tencent', 3: 'douyin', 4: 'kuaishou', 5: 'bilibili'}.get(row["type"], 'unknown')
            started_at = time.perf_counter()
            try:
                cookie_path = Path(BASE_DIR / "cookiesFile" / row["filePath"])
                if not cookie_path.exists():
                    print(f"   - [{platform}] 跳过: cookie 文件不存在 id={row['id']} file={row['filePath']}")
                    return row, False, "missing_cookie"

                async with semaphore:
                    print(f"   - 正在校验 [{platform}] 账号: id={row['id']} user={row['userName']}")
                    flag = await check_cookie(row["type"], row["filePath"], preview=preview)
                    elapsed = time.perf_counter() - started_at
                    print(f"     -> [{platform}] 结果: {'cookie 有效' if flag else 'cookie 失效'} ({elapsed:.1f}s)")
                    return row, flag, None
            except Exception as e:
                print(f"check_cookie 出错: platform={row['type']} id={row['id']} user={row['userName']} err={e}")
                if _is_transient_browser_error(e):
                    return row, None, "transient_error"
                return row, False, "invalid"

        print(f"\n[INFO] 开始账号有效性校验：{len(rows_to_validate)} 个账号，并发 {concurrency} ...")
        results = await asyncio.gather(*(validate_account_row(row) for row in rows_to_validate))

        any_updated = False
        for row, flag, reason in results:
            if reason == "transient_error":
                print(f"[WARN] 账号校验临时失败，保持原状态: id={row['id']} user={row['userName']}")
                continue
            new_status = 1 if flag else 0
            if row["status"] != new_status:
                row["status"] = new_status
                cursor.execute('''
                UPDATE user_info 
                SET status = ? 
                WHERE id = ?
                ''', (new_status, row["id"]))
                any_updated = True

        if any_updated:
            conn.commit()
            print("[OK] 用户状态已更新并写入数据库")
        else:
            print("[INFO] 用户状态无变更，保持现状")

        _last_accounts_validation_ts = time.time()

        return jsonify({
            "code": 200,
            "msg": None,
            "data": rows_list
        }), 200

@app.route('/deleteFile', methods=['GET'])
def delete_file():
    file_id = request.args.get('id')

    if not file_id or not file_id.isdigit():
        return jsonify({
            "code": 400,
            "msg": "Invalid or missing file ID",
            "data": None
        }), 400

    try:
        # 获取数据库连接
        with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # 查询要删除的记录
            cursor.execute("SELECT * FROM file_records WHERE id = ?", (file_id,))
            record = cursor.fetchone()

            if not record:
                return jsonify({
                    "code": 404,
                    "msg": "File not found",
                    "data": None
                }), 404

            record = dict(record)

            # 删除数据库记录
            cursor.execute("DELETE FROM file_records WHERE id = ?", (file_id,))
            conn.commit()

        _remove_if_exists(_safe_storage_path(Path(BASE_DIR / "videoFile"), record.get('file_path')))

        return jsonify({
            "code": 200,
            "msg": "File deleted successfully",
            "data": {
                "id": record['id'],
                "filename": record['filename']
            }
        }), 200

    except Exception as e:
        return jsonify({
            "code": 500,
            "msg": str("delete failed!"),
            "data": None
        }), 500

@app.route('/batchDeleteFiles', methods=['POST'])
def batch_delete_files():
    data = request.get_json()
    
    if not data or 'ids' not in data:
        return jsonify({
            "code": 400,
            "msg": "Missing or invalid request data",
            "data": None
        }), 400
    
    ids = data['ids']
    
    if not isinstance(ids, list) or len(ids) == 0:
        return jsonify({
            "code": 400,
            "msg": "Invalid IDs list",
            "data": None
        }), 400
    
    try:
        # 获取数据库连接
        with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # 查询要删除的记录
            placeholders = ','.join(['?' for _ in ids])
            cursor.execute(f"SELECT * FROM file_records WHERE id IN ({placeholders})", ids)
            records = cursor.fetchall()
            
            if not records:
                return jsonify({
                    "code": 404,
                    "msg": "No files found",
                    "data": None
                }), 404
            
            records = [dict(record) for record in records]

            # 删除数据库记录
            cursor.execute(f"DELETE FROM file_records WHERE id IN ({placeholders})", ids)
            conn.commit()
            
            deleted_count = cursor.rowcount

        for record in records:
            _remove_if_exists(_safe_storage_path(Path(BASE_DIR / "videoFile"), record.get('file_path')))
            
        return jsonify({
            "code": 200,
            "msg": f"Successfully deleted {deleted_count} files",
            "data": {
                "deleted_count": deleted_count,
                "deleted_ids": ids
            }
        }), 200
        
    except Exception as e:
        return jsonify({
            "code": 500,
            "msg": str("Batch delete failed!"),
            "data": None
        }), 500

@app.route('/deleteAccount', methods=['GET'])
def delete_account():
    account_id = request.args.get('id')
    if not account_id or not str(account_id).isdigit():
        return jsonify({
            "code": 400,
            "msg": "Invalid or missing account ID",
            "data": None
        }), 400
    account_id = int(account_id)

    try:
        # 获取数据库连接
        with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # 查询要删除的记录
            cursor.execute("SELECT * FROM user_info WHERE id = ?", (account_id,))
            record = cursor.fetchone()

            if not record:
                return jsonify({
                    "code": 404,
                    "msg": "account not found",
                    "data": None
                }), 404

            record = dict(record)

            # 删除数据库记录
            cursor.execute("DELETE FROM user_info WHERE id = ?", (account_id,))
            conn.commit()

        _remove_if_exists(_safe_storage_path(Path(BASE_DIR / "cookiesFile"), record.get('filePath')))
        _remove_if_exists(_safe_storage_path(Path(BASE_DIR / "avatars"), record.get('avatarPath')))

        return jsonify({
            "code": 200,
            "msg": "account deleted successfully",
            "data": None
        }), 200

    except Exception as e:
        return jsonify({
            "code": 500,
            "msg": str("delete failed!"),
            "data": None
        }), 500

@app.route('/refreshAccountAvatar', methods=['POST'])
def refresh_account_avatar():
    data = request.get_json() or {}
    account_id = data.get('id')
    if not account_id or not str(account_id).isdigit():
        return jsonify({
            "code": 400,
            "msg": "Invalid or missing account ID",
            "data": None
        }), 200

    try:
        avatar_path, error = _run_async(_capture_account_avatar(int(account_id)))
    except Exception as e:
        avatar_path, error = None, str(e)

    if error:
        return jsonify({
            "code": 500,
            "msg": error,
            "data": None
        }), 200

    return jsonify({
        "code": 200,
        "msg": "account identity refreshed",
        "data": {
            "avatarPath": avatar_path,
            "avatarUrl": f"/avatars/{avatar_path}" if avatar_path else None
        }
    }), 200


# SSE 登录接口
@app.route('/login')
def login():
    # 1 小红书 2 视频号 3 抖音 4 快手
    type = request.args.get('type')
    # 账号名
    id = request.args.get('id')
    request_id = request.args.get('request_id') or str(uuid.uuid4())
    if request_id in cancelled_login_request_ids:
        cancelled_login_request_ids.discard(request_id)
        status_queue = Queue()
        status_queue.put("CANCELLED")
        response = Response(sse_stream(status_queue), mimetype='text/event-stream')
        response.headers['Cache-Control'] = 'no-cache'
        response.headers['X-Accel-Buffering'] = 'no'
        response.headers['Content-Type'] = 'text/event-stream'
        response.headers['Connection'] = 'keep-alive'
        return response
    # 是否更新已有记录
    update_mode = request.args.get('update', '0') in ('1', 'true', 'True')
    record_id = request.args.get('record_id')

    # 模拟一个用于异步通信的队列
    status_queue = Queue()
    cancel_event = threading.Event()
    active_queues[id] = status_queue
    active_login_sessions[request_id] = {
        "queue": status_queue,
        "cancel_event": cancel_event,
        "account_name": id,
    }
    # 启动异步任务线程
    thread = threading.Thread(
        target=run_async_function,
        args=(type, id, status_queue, update_mode, record_id, cancel_event),
        daemon=True
    )
    thread.start()
    response = Response(sse_stream(status_queue, session_key=request_id), mimetype='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'  # 关键：禁用 Nginx 缓冲
    response.headers['Content-Type'] = 'text/event-stream'
    response.headers['Connection'] = 'keep-alive'
    return response


@app.route('/cancelLogin', methods=['POST'])
def cancel_login():
    data = request.get_json() or {}
    request_id = data.get('requestId') or data.get('request_id')
    if not request_id:
        return jsonify({
            "code": 400,
            "msg": "requestId required",
            "data": None
        }), 200

    session = active_login_sessions.get(request_id)
    if not session:
        cancelled_login_request_ids.add(request_id)
        return jsonify({
            "code": 200,
            "msg": None,
            "data": {"cancelled": True}
        }), 200

    session["cancel_event"].set()
    session["queue"].put("CANCELLED")
    return jsonify({
        "code": 200,
        "msg": None,
        "data": {"cancelled": True}
    }), 200

@app.route('/postVideo', methods=['POST'])
def postVideo():
    # 获取JSON数据
    data = request.get_json() or {}

    validation_errors = _validate_publish_payload(data)
    if validation_errors:
        return jsonify({
            "code": 400,
            "msg": "；".join(validation_errors),
            "data": None
        }), 200

    account_check = _validate_publish_accounts_before_run([data])
    if account_check["messages"]:
        return jsonify({
            "code": 409,
            "msg": "；".join(account_check["messages"]),
            "data": {
                "reason": "account_preflight_failed",
                "results": [
                    {
                        "type": item["type"],
                        "ok": False,
                        "message": item["message"],
                        "platform": item["platform"],
                        "account": item["account"],
                    }
                    for item in account_check["failures"]
                ],
            }
        }), 200

    # 从JSON数据中提取fileList和accountList
    file_list = data.get('fileList', [])
    account_list = data.get('accountList', [])
    type = data.get('type')
    title = data.get('title') or data.get('biliTitle') or ''
    tags = normalize_publish_tags(data.get('tags'), max_count=get_publish_tag_limit(type))
    category = data.get('category')
    enableTimer = data.get('enableTimer')
    cover_path = data.get('coverPath')  # 可选封面路径（相对 videoFile 下的存储名）
    cover_paths = data.get('coverPaths') if isinstance(data.get('coverPaths'), dict) else {}
    debug_dry_run = DEBUG_SKIP_FINAL_PUBLISH if 'debugDryRun' not in data else bool(data.get('debugDryRun'))
    debug_dry_run_hold_browser = bool(data.get('debugDryRunHoldBrowser', True))
    # B站专用字段
    bili_desc = data.get('biliDesc')
    bili_type = data.get('biliType')  # 自制/转载
    bili_partition = data.get('biliPartition')
    schedule_time = data.get('scheduleTime')
    if category == 0:
        category = None

    videos_per_day = data.get('videosPerDay')
    daily_times = data.get('dailyTimes')
    start_days = data.get('startDays')
    jitter_minutes = data.get('timeJitterMinutes', 0)
    # 打印获取到的数据（仅作为示例）
    print("File List:", file_list)
    print("Account List:", account_list)
    try:
        match type:
            case 1:
                post_video_xhs(title, file_list, tags, account_list, category, enableTimer, videos_per_day, daily_times,
                                   start_days, cover_path=cover_path, cover_paths=cover_paths,
                                   jitter_minutes=jitter_minutes, dry_run=debug_dry_run,
                                   dry_run_hold_browser=debug_dry_run_hold_browser)
            case 2:
                post_video_tencent(title, file_list, tags, account_list, category, enableTimer, videos_per_day, daily_times,
                                   start_days, cover_path=cover_path, cover_paths=cover_paths,
                                   jitter_minutes=jitter_minutes, dry_run=debug_dry_run,
                                   dry_run_hold_browser=debug_dry_run_hold_browser)
            case 3:
                post_video_DouYin(title, file_list, tags, account_list, category, enableTimer, videos_per_day, daily_times,
                          start_days, cover_path=cover_path, cover_paths=cover_paths,
                          jitter_minutes=jitter_minutes, dry_run=debug_dry_run,
                          dry_run_hold_browser=debug_dry_run_hold_browser)
            case 4:
                post_video_ks(title, file_list, tags, account_list, category, enableTimer, videos_per_day, daily_times,
                          start_days, cover_path=cover_path, cover_paths=cover_paths,
                          jitter_minutes=jitter_minutes, dry_run=debug_dry_run,
                          dry_run_hold_browser=debug_dry_run_hold_browser)
            case 5:
                post_video_bilibili(title, file_list, tags, account_list, category, enableTimer, videos_per_day, daily_times,
                          start_days, desc=bili_desc, bili_type=bili_type, bili_partition=bili_partition,
                          cover_path=cover_path, cover_paths=cover_paths,
                          schedule_time=schedule_time, jitter_minutes=jitter_minutes, dry_run=debug_dry_run,
                          dry_run_hold_browser=debug_dry_run_hold_browser)
            case _:
                return jsonify({"code": 400, "msg": "unsupported platform", "data": None}), 200
    except Exception as e:
        print(f"postVideo failed: {e}")
        return jsonify({
            "code": 500,
            "msg": f"发布失败：{e}",
            "data": None
        }), 200
    # 返回响应给客户端
    return jsonify(
        {
            "code": 200,
            "msg": None,
            "data": None
        }), 200


@app.route('/openAccounts', methods=['POST'])
def open_accounts():
    data = request.get_json() or {}
    ids = data.get('ids', [])
    if not isinstance(ids, list) or not ids:
        return jsonify({
            "code": 400,
            "msg": "ids required",
            "data": None
        }), 200

    # 查询账号信息
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        # rows: [id, type, filePath, userName, status]
        placeholders = ",".join(["?"] * len(ids))
        cursor.execute(f"SELECT id, type, filePath, userName, status FROM user_info WHERE id IN ({placeholders})", tuple(ids))
        rows = cursor.fetchall()

    if not rows:
        return jsonify({
            "code": 404,
            "msg": "accounts not found",
            "data": None
        }), 200

    def run_open_tabs(rows_):
        async def open_tabs_async():
            platform_key_map = {
                1: "xiaohongshu",
                2: "wechat-channel",
                3: "douyin",
                4: "kuaishou",
                5: "bilibili",
            }
            platform_domains = {
                1: ("xiaohongshu.com",),
                2: ("channels.weixin.qq.com", "weixin.qq.com", "qq.com",),
                3: ("douyin.com", "bytedance.com", "iesdouyin.com",),
                4: ("kuaishou.com",),
                5: ("bilibili.com",),
            }

            def domain_matches(value, domains):
                if not value:
                    return False
                normalized = str(value).lower().lstrip(".")
                return any(normalized == domain or normalized.endswith(f".{domain}") for domain in domains)

            def origin_matches(origin, domains):
                try:
                    host = urlparse(origin).hostname or origin
                except Exception:
                    host = origin
                return domain_matches(host, domains)

            def filter_storage_state_for_account(state, account_type):
                domains = platform_domains.get(account_type, ())
                if not domains:
                    return state
                return {
                    "cookies": [
                        cookie for cookie in state.get("cookies", [])
                        if domain_matches(cookie.get("domain"), domains)
                    ],
                    "origins": [
                        origin_state for origin_state in state.get("origins", [])
                        if origin_matches(origin_state.get("origin"), domains)
                    ],
                }

            def looks_logged_in(account_type, page_url):
                if not page_url:
                    return False
                if account_type == 2:
                    return "channels.weixin.qq.com/platform" in page_url and "login" not in page_url
                if account_type == 4:
                    return "cp.kuaishou.com" in page_url and "login" not in page_url
                return "login" not in page_url

            def mark_account_normal(account_id):
                try:
                    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
                        cursor = conn.cursor()
                        cursor.execute("UPDATE user_info SET status = 1 WHERE id = ?", (account_id,))
                        conn.commit()
                except Exception as e:
                    print(f"mark account normal failed id={account_id} err={e}")

            async def save_cookies_file(context, storage_path, account_type):
                try:
                    try:
                        state = await context.storage_state(indexed_db=True)
                    except TypeError:
                        state = await context.storage_state()
                    filtered_state = filter_storage_state_for_account(state, account_type)
                    storage_path.parent.mkdir(parents=True, exist_ok=True)
                    storage_path.write_text(
                        json.dumps(filtered_state, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                except Exception as e:
                    print(f"[openAccounts] save cookies file failed: {e}")

            async def save_account_state(
                context,
                page,
                storage_path,
                account_id,
                account_type,
                cdp_session=None,
            ):
                try:
                    if not looks_logged_in(account_type, page.url):
                        return False
                    await save_cookies_file(context, storage_path, account_type)
                    # 同时把 cookie 写入 profile 目录的 marker 文件，
                    # 让 _ensure_interaction_context 能加载
                    if cdp_session:
                        try:
                            profile_cookies_path = cdp_session.profile_path / ".login-cookies.json"
                            try:
                                state = await context.storage_state()
                            except TypeError:
                                state = await context.storage_state()
                            filtered = filter_storage_state_for_account(state, account_type)
                            profile_cookies_path.write_text(
                                json.dumps(filtered, ensure_ascii=False),
                                encoding="utf-8",
                            )
                            print(f"[openAccounts] login cookies synced to profile dir: {profile_cookies_path}")
                        except Exception as e:
                            print(f"[openAccounts] sync cookies to profile failed: {e}")
                    mark_account_normal(account_id)
                    await _capture_identity_from_logged_in_page(page, account_id, account_type)
                    print(f"[openAccounts] account {account_id} state saved to cookiesFile and profile directory")
                    return True
                except Exception as e:
                    print(f"persist account state failed id={account_id} err={e}")
                return False

            async def monitor_login_state(
                context,
                page,
                storage_path,
                account_id,
                account_type,
                cdp_session=None,
            ):
                for _ in range(300):
                    await asyncio.sleep(1)
                    if page.is_closed():
                        return
                    if not looks_logged_in(account_type, page.url):
                        continue
                    await page.wait_for_timeout(1800)
                    if page.is_closed() or not looks_logged_in(account_type, page.url):
                        continue
                    saved = await save_account_state(
                        context,
                        page,
                        storage_path,
                        account_id,
                        account_type,
                        cdp_session,
                    )
                    if saved:
                        print(f"[openAccounts] account {account_id} login detected and saved")
                        return

            url_map = {
                1: "https://creator.xiaohongshu.com/new/note-manager",
                2: "https://channels.weixin.qq.com/platform/post/list",
                3: "https://creator.douyin.com/creator-micro/content/manage",
                4: "https://cp.kuaishou.com/article/publish/video",
                5: "https://member.bilibili.com/platform/upload-manager/article",
            }

            for (acc_id, acc_type, file_path, user_name, _status) in rows_:
                try:
                    platform_key = platform_key_map.get(acc_type, f"platform-{acc_type}")
                    storage_path = Path(BASE_DIR / "cookiesFile" / file_path)
                    url = url_map.get(acc_type) or "https://www.baidu.com"

                    cdp_session = _cdp_get_session(platform_key, acc_id)
                    cdp_info = cdp_session.ensure_running()
                    cdp_port = cdp_info["cdpPort"]
                    endpoint = f"http://127.0.0.1:{cdp_port}"
                    print(f"[openAccounts] using CDP browser port={cdp_port} profile={cdp_info['profileDir']} for account {acc_id} ({platform_key})")

                    # 使用 CdpBrowserSession 自己的 Playwright 连接，而不是创建新的
                    await cdp_session._ensure_playwright_connected()
                    context = cdp_session._context
                    page = cdp_session._page
                    
                    # 导航到登录页
                    await page.goto(url, wait_until="commit", timeout=15000)
                    try:
                        await page.evaluate("document.title = document.title + ' - ' + arguments[0]", user_name)
                    except Exception:
                        pass
                    try:
                        await reveal_page_window(page)
                    except Exception as e:
                        print(f"[openAccounts] reveal failed id={acc_id} err={e}")

                    # 启动登录状态监控
                    asyncio.create_task(monitor_login_state(
                        context,
                        page,
                        storage_path,
                        acc_id,
                        acc_type,
                        cdp_session,
                    ))
                    print(f"[openAccounts] account {acc_id} login monitoring started on port {cdp_port}")
                except Exception as e:
                    print(f"[openAccounts] open tab failed id={acc_id} err={e}")

            print("[openAccounts] Tabs opened, holding browsers open...")
            try:
                while True:
                    await asyncio.sleep(3600)
            finally:
                pass

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(open_tabs_async())
        finally:
            loop.close()

    t = threading.Thread(target=run_open_tabs, args=(rows,), daemon=True)
    t.start()

    return jsonify({
        "code": 200,
        "msg": None,
        "data": {"opened": len(rows)}
    }), 200


@app.route('/interaction/openEntry', methods=['POST'])
def open_interaction_entry():
    data = request.get_json() or {}
    account_id = data.get('accountId')
    entry_type = (data.get('entryType') or '').strip()

    if not account_id or not str(account_id).isdigit():
        return jsonify({
            "code": 400,
            "msg": "accountId required",
            "data": None
        }), 200

    account_id = int(account_id)
    entry_configs = {
        "douyin-comment-reply": {
            "platformType": 3,
            "platformName": "抖音",
            "entryName": "评论管理预检",
            "url": "https://creator.douyin.com/creator-micro/content/manage",
        },
        "douyin-direct-message-reply": {
            "platformType": 3,
            "platformName": "抖音",
            "entryName": "私信入口预检",
            "url": "https://creator.douyin.com/creator-micro/data/following/chat",
        },
        "wechat-channel-comment-reply": {
            "platformType": 2,
            "platformName": "视频号",
            "entryName": "视频号评论管理预检",
            "url": "https://channels.weixin.qq.com/platform",
        },
        "wechat-channel-direct-message-reply": {
            "platformType": 2,
            "platformName": "视频号",
            "entryName": "视频号私信入口预检",
            "url": "https://channels.weixin.qq.com/platform",
        },
        "wechat-reply-draft": {
            "platformType": 2,
            "platformName": "视频号",
            "entryName": "微信/视频号互动入口预检",
            "url": "https://channels.weixin.qq.com/platform",
        },
    }
    config = entry_configs.get(entry_type)
    if not config:
        return jsonify({
            "code": 400,
            "msg": "unsupported interaction entry",
            "data": None
        }), 200

    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, type, filePath, userName, status FROM user_info WHERE id = ?",
            (account_id,)
        )
        row = cursor.fetchone()

    if not row:
        return jsonify({
            "code": 404,
            "msg": "account not found",
            "data": None
        }), 200

    acc_id, acc_type, file_path, user_name, status = row
    if acc_type != config["platformType"]:
        return jsonify({
            "code": 400,
            "msg": f"account platform mismatch, expected {config['platformName']}",
            "data": {
                "accountId": acc_id,
                "accountType": acc_type,
                "expectedType": config["platformType"],
            }
        }), 200

    storage_path = Path(BASE_DIR / "cookiesFile" / file_path)
    if not storage_path.exists():
        return jsonify({
            "code": 404,
            "msg": "account cookie file not found",
            "data": None
        }), 200

    async def open_entry_async(row_, entry_config, storage_file):
        platform_key = "douyin" if entry_config["platformType"] == 3 else "wechat-channel" if entry_config["platformType"] == 2 else f"platform-{entry_config['platformType']}"
        try:
            session = await _ensure_interaction_context(
                platform_key,
                row_[0],
                storage_file,
                entry_config["url"],
            )
            page = session["page"]
            await page.goto(entry_config["url"], wait_until="domcontentloaded", timeout=30000)
            try:
                await page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass
            await page.wait_for_timeout(1200)
            try:
                await reveal_page_window(page)
            except Exception as e:
                print(f"[interaction/openEntry] reveal failed id={row_[0]} err={e}")
            try:
                await _capture_identity_from_logged_in_page(page, row_[0], row_[1])
            except Exception as e:
                print(f"[interaction/openEntry] capture identity failed id={row_[0]} err={e}")

            page_probe = await page.evaluate(
                r"""() => {
                    const normalize = (value) => String(value || '')
                        .replace(/\s+/g, ' ')
                        .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                        .trim();
                    const text = normalize(document.body ? document.body.innerText : '');
                    const loginHints = ['登录', '扫码登录', '手机登录', '密码登录'];
                    const loggedOut = loginHints.some((item) => text.includes(item)) && !text.includes('创作者服务中心');
                    return {
                        url: location.href,
                        title: document.title,
                        loggedIn: !loggedOut && !location.href.includes('login'),
                        pageTextSample: text.slice(0, 600),
                    };
                }"""
            )
            evidence = await _capture_interaction_screenshot(
                page,
                f"{entry_type}-{row_[0]}-entry",
                f"{entry_config['entryName']}截图",
            )
            print(
                f"[interaction/openEntry] Opened {entry_config['entryName']} "
                f"id={row_[0]} user={row_[3]} url={page_probe.get('url')}"
            )
            if evidence:
                page_probe["evidence"] = evidence
            page_probe.update(_interaction_runtime_fields(session))
            return page_probe
        except Exception:
            _drop_interaction_context(platform_key, row_[0])
            raise

    try:
        probe = _run_interaction_async(open_entry_async(row, config, storage_path))
    except Exception as e:
        return jsonify({
            "code": 500,
            "msg": f"interaction entry open failed: {e}",
            "data": None
        }), 200

    return jsonify({
        "code": 200,
        "msg": None,
        "data": {
            "accountId": acc_id,
            "accountName": user_name,
            "platformType": acc_type,
            "platformName": config["platformName"],
            "entryType": entry_type,
            "entryName": config["entryName"],
            "url": probe.get("url") or config["url"],
            "title": probe.get("title"),
            "loggedIn": probe.get("loggedIn"),
            "pageTextSample": probe.get("pageTextSample"),
            "evidence": probe.get("evidence"),
            "runtimeMode": probe.get("runtimeMode"),
            "profileDir": probe.get("profileDir"),
            "cdpPort": probe.get("cdpPort"),
            "browser": probe.get("browser"),
            "browserReused": probe.get("browserReused"),
            "status": "opened",
            "accountStatus": status,
            "openedAt": datetime.now().isoformat(),
        }
    }), 200

@app.route('/interaction/douyin/comments/read', methods=['POST'])
def read_douyin_comments():
    data = request.get_json() or {}
    account_id = data.get('accountId')
    limit = data.get('limit', 10)
    parsing_rules = data.get('parsingRules') or {}

    if not account_id or not str(account_id).isdigit():
        return jsonify({
            "code": 400,
            "msg": "accountId required",
            "data": None
        }), 200

    try:
        limit = max(1, min(int(limit), 20))
    except Exception:
        limit = 10

    account_id = int(account_id)
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, type, filePath, userName, status FROM user_info WHERE id = ?",
            (account_id,)
        )
        row = cursor.fetchone()

    if not row:
        return jsonify({
            "code": 404,
            "msg": "account not found",
            "data": None
        }), 200

    acc_id, acc_type, file_path, user_name, status = row
    if acc_type != 3:
        return jsonify({
            "code": 400,
            "msg": "account platform mismatch, expected 抖音",
            "data": {
                "accountId": acc_id,
                "accountType": acc_type,
                "expectedType": 3,
            }
        }), 200

    storage_path = Path(BASE_DIR / "cookiesFile" / file_path)
    if not storage_path.exists():
        return jsonify({
            "code": 404,
            "msg": "account cookie file not found",
            "data": None
        }), 200

    async def read_comments_async():
        session = await _ensure_interaction_context(
            "douyin",
            acc_id,
            storage_path,
            "https://creator.douyin.com/creator-micro/content/manage",
        )
        context = session["context"]
        page = session["page"]
        trace_client, trace = await _start_interaction_network_trace(
            context,
            page,
            patterns=["douyin", "bytedance", "comment", "creator-micro", "aweme"],
        )
        try:
            await _open_douyin_comment_page(page)
            scan_result = await _choose_douyin_comment_work_with_candidates(page, limit, parsing_rules=parsing_rules)
            evidence = await _capture_interaction_screenshot(
                page,
                f"douyin-comments-read-{acc_id}",
                "评论读取截图",
            )
            if bool(parsing_rules.get("commentSkipHandled")):
                comments, skipped_comments = _filter_recently_sent_interaction_items(
                    "douyin",
                    acc_id,
                    "comments",
                    scan_result.get("comments") or [],
                )
            else:
                comments = scan_result.get("comments") or []
                skipped_comments = []
            return {
                "accountId": acc_id,
                "accountName": user_name,
                "platformType": acc_type,
                "platformName": "抖音",
                "url": scan_result.get("url"),
                "title": scan_result.get("title"),
                "comments": comments,
                "skippedRecentlySent": skipped_comments,
                "selectedWorkTitle": scan_result.get("selectedWorkTitle"),
                "selectedWorkIndex": scan_result.get("selectedWorkIndex"),
                "workSwitchAttempted": scan_result.get("workSwitchAttempted"),
                "summary": _interaction_read_summary(
                    scan_result.get("totalCandidates"),
                    comments,
                    "评论",
                ),
                "pageTextSample": scan_result.get("pageTextSample") or "",
                "evidence": evidence,
                "readAt": datetime.now().isoformat(),
                **_interaction_runtime_fields(session, trace),
            }
        finally:
            if trace_client:
                try:
                    await trace_client.detach()
                except Exception:
                    pass

    try:
        result = _run_interaction_async(read_comments_async())
        return jsonify({
            "code": 200,
            "msg": None,
            "data": result
        }), 200
    except Exception as e:
        _drop_interaction_context("douyin", acc_id)
        return jsonify({
            "code": 500,
            "msg": f"抖音评论读取失败：{e}",
            "data": None
        }), 200


@app.route('/interaction/douyin/messages/read', methods=['POST'])
def read_douyin_messages():
    data = request.get_json() or {}
    account_id = data.get('accountId')
    limit = data.get('limit', 10)

    if not account_id or not str(account_id).isdigit():
        return jsonify({
            "code": 400,
            "msg": "accountId required",
            "data": None
        }), 200

    try:
        limit = max(1, min(int(limit), 20))
    except Exception:
        limit = 10

    account_id = int(account_id)
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, type, filePath, userName, status FROM user_info WHERE id = ?",
            (account_id,)
        )
        row = cursor.fetchone()

    if not row:
        return jsonify({
            "code": 404,
            "msg": "account not found",
            "data": None
        }), 200

    acc_id, acc_type, file_path, user_name, status = row
    if acc_type != 3:
        return jsonify({
            "code": 400,
            "msg": "account platform mismatch, expected 抖音",
            "data": {
                "accountId": acc_id,
                "accountType": acc_type,
                "expectedType": 3,
            }
        }), 200

    storage_path = Path(BASE_DIR / "cookiesFile" / file_path)
    if not storage_path.exists():
        return jsonify({
            "code": 404,
            "msg": "account cookie file not found",
            "data": None
        }), 200

    async def read_messages_async():
        session = await _ensure_interaction_context(
            "douyin",
            acc_id,
            storage_path,
            "https://creator.douyin.com/creator-micro/data/following/chat",
        )
        context = session["context"]
        page = session["page"]
        trace_client, trace = await _start_interaction_network_trace(
            context,
            page,
            patterns=["douyin", "bytedance", "snssdk", "im", "message", "chat", "conversation"],
        )
        route_capture = None
        try:
            route_capture = await _install_douyin_im_route_capture(context, trace)
            await _install_douyin_im_window_capture(page)
            await _open_douyin_message_page(page)
            scan_result = await _scan_douyin_message_tabs(page, limit)
            await page.wait_for_timeout(1200)
            await _wait_interaction_network_bodies(trace, timeout_ms=5000)
            capture_result = await _collect_douyin_im_window_capture(page, trace, limit)
            evidence = await _capture_interaction_screenshot(
                page,
                f"douyin-messages-read-{acc_id}",
                "私信读取截图",
            )
            messages = _merge_douyin_message_candidates(scan_result.get("messages") or [], trace, limit)
            messages, skipped_messages = _filter_recently_sent_interaction_items(
                "douyin",
                acc_id,
                "messages",
                messages,
            )
            if messages and scan_result.get("loadBlocked"):
                scan_result.pop("loadBlocked", None)
                scan_result.pop("loadBlockedReason", None)
            summary = _douyin_message_load_blocked_summary(scan_result) or _interaction_read_summary(
                scan_result.get("totalCandidates"),
                messages,
                "私信",
            )
            if messages and (summary.get("totalCandidates") or 0) < len(messages):
                summary["totalCandidates"] = len(messages)
            return {
                "accountId": acc_id,
                "accountName": user_name,
                "platformType": acc_type,
                "platformName": "抖音",
                "url": scan_result.get("url"),
                "title": scan_result.get("title"),
                "messages": messages,
                "skippedRecentlySent": skipped_messages,
                "summary": summary,
                "loadBlocked": bool(scan_result.get("loadBlocked")),
                "loadBlockedReason": scan_result.get("loadBlockedReason"),
                "selectedTab": scan_result.get("selectedTab"),
                "scannedTabs": scan_result.get("scannedTabs") or [],
                "pageLoadState": scan_result.get("pageLoadState"),
                "pageTextSample": scan_result.get("pageTextSample") or "",
                "imCapture": {
                    "routeEvents": len((route_capture or {}).get("captures") or []),
                    "windowEvents": (capture_result or {}).get("status") or 0,
                    "messageCandidates": (capture_result or {}).get("messageCandidates") or [],
                },
                "evidence": evidence,
                "readAt": datetime.now().isoformat(),
                **_interaction_runtime_fields(session, trace),
            }
        finally:
            await _detach_douyin_im_route_capture(context, route_capture)
            if trace_client:
                try:
                    await trace_client.detach()
                except Exception:
                    pass

    try:
        result = _run_interaction_async(read_messages_async())
        return jsonify({
            "code": 200,
            "msg": None,
            "data": result
        }), 200
    except Exception as e:
        _drop_interaction_context("douyin", acc_id)
        return jsonify({
            "code": 500,
            "msg": f"抖音私信读取失败：{e}",
            "data": None
        }), 200


def _load_douyin_interaction_account(account_id):
    if not account_id or not str(account_id).isdigit():
        return None, None, (
            jsonify({"code": 400, "msg": "accountId required", "data": None}),
            200,
        )

    account_id = int(account_id)
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, type, filePath, userName, status FROM user_info WHERE id = ?",
            (account_id,)
        )
        row = cursor.fetchone()

    if not row:
        return None, None, (
            jsonify({"code": 404, "msg": "account not found", "data": None}),
            200,
        )

    acc_id, acc_type, file_path, user_name, status = row
    if acc_type != 3:
        return row, None, (
            jsonify({
                "code": 400,
                "msg": "account platform mismatch, expected 抖音",
                "data": {
                    "accountId": acc_id,
                    "accountType": acc_type,
                    "expectedType": 3,
                }
            }),
            200,
        )

    storage_path = Path(BASE_DIR / "cookiesFile" / file_path)
    if not storage_path.exists():
        return row, storage_path, (
            jsonify({"code": 404, "msg": "account cookie file not found", "data": None}),
            200,
        )

    return row, storage_path, None


def _load_wechat_channel_interaction_account(account_id):
    if not account_id or not str(account_id).isdigit():
        return None, None, (
            jsonify({"code": 400, "msg": "accountId required", "data": None}),
            200,
        )

    account_id = int(account_id)
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, type, filePath, userName, status FROM user_info WHERE id = ?",
            (account_id,)
        )
        row = cursor.fetchone()

    if not row:
        return None, None, (
            jsonify({"code": 404, "msg": "account not found", "data": None}),
            200,
        )

    acc_id, acc_type, file_path, user_name, status = row
    if acc_type != 2:
        return row, None, (
            jsonify({
                "code": 400,
                "msg": "account platform mismatch, expected 视频号",
                "data": {
                    "accountId": acc_id,
                    "accountType": acc_type,
                    "expectedType": 2,
                }
            }),
            200,
        )

    if status != 1:
        return row, None, (
            jsonify({
                "code": 409,
                "msg": "视频号账号登录态不可用，请先重新登录视频号账号",
                "data": {
                    "accountId": acc_id,
                    "accountStatus": status,
                    "nextAction": "请到发布中心的平台账号里重新登录该视频号账号，再回来执行评论或私信回复。",
                }
            }),
            200,
        )

    storage_path = Path(BASE_DIR / "cookiesFile" / file_path)
    if not storage_path.exists():
        return row, storage_path, (
            jsonify({"code": 404, "msg": "account cookie file not found", "data": None}),
            200,
        )

    return row, storage_path, None


async def _dismiss_douyin_overlays(page):
    labels = [
        "我知道了",
        "知道了",
        "稍后再看",
        "不再显示",
        "关闭",
    ]
    for label in labels:
        try:
            locator = page.get_by_text(label, exact=True).first
            if await locator.count() > 0:
                await locator.click(timeout=1200)
                await page.wait_for_timeout(400)
        except Exception:
            pass


async def _open_douyin_comment_page(page):
    await page.goto("https://creator.douyin.com/creator-micro/content/manage", wait_until="domcontentloaded", timeout=30000)
    try:
        await page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    await page.wait_for_timeout(2000)
    try:
        await page.get_by_text("互动管理", exact=True).first.click(timeout=5000)
        await page.wait_for_timeout(500)
        await page.get_by_text("评论管理", exact=True).first.click(timeout=5000)
        await page.wait_for_timeout(2500)
    except Exception as e:
        print(f"[interaction/douyin/comments] switch comment page failed: {e}")
    await _dismiss_douyin_overlays(page)


async def _open_douyin_message_page(page):
    await page.goto("https://creator.douyin.com/creator-micro/data/following/chat", wait_until="domcontentloaded", timeout=30000)
    try:
        await page.wait_for_load_state("networkidle", timeout=12000)
    except Exception:
        pass
    await page.wait_for_timeout(2500)
    if "following/chat" not in (page.url or ""):
        for label in ["互动管理", "私信管理", "私信", "用户私信", "消息"]:
            try:
                await page.get_by_text(label, exact=True).first.click(timeout=2500)
                await page.wait_for_timeout(1200)
            except Exception:
                pass
    else:
        try:
            await _click_douyin_message_tab(page, "全部")
        except Exception:
            pass
    await _dismiss_douyin_overlays(page)
    await _wait_douyin_message_page_settled(page, timeout_ms=14000)


async def _wait_douyin_message_page_settled(page, timeout_ms=25000):
    deadline = time.time() + (timeout_ms / 1000)
    last_state = None
    while time.time() < deadline:
        try:
            state = await page.evaluate(
                r"""() => {
                    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
                    const text = normalize(document.body.innerText || '');
                    const visible = (node) => {
                        if (!node || !node.getBoundingClientRect) return false;
                        const rect = node.getBoundingClientRect();
                        const style = window.getComputedStyle(node);
                        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
                    };
                    const tabsVisible = ['全部', '朋友私信', '陌生人私信', '群消息'].some((label) =>
                        Array.from(document.querySelectorAll('div, span, button, [role="tab"]')).some((node) =>
                            visible(node) && normalize(node.innerText || node.textContent) === label
                        )
                    );
                    const hasEmptyState = /暂无|没有|空空如也|还没有|未收到私信|没有收到私信/.test(text);
                    const hasConversationHint = /未读|分钟前|小时前|昨天|今天|\d{1,2}:\d{2}|回复|发送/.test(text);
                    const contentText = text
                        .replace(/高清发布|首页|内容管理|作品管理|合集管理|共创中心|原创保护中心|互动管理|数据中心|变现中心|创作中心|通知|网址|抖音/g, '')
                        .replace(/全部|朋友私信|陌生人私信|群消息/g, '')
                        .trim();
                    const visibleLoaders = Array.from(document.querySelectorAll('[class*="loading"], [class*="Loading"], [class*="spin"], [class*="Spin"], .semi-spin, .semi-spin-wrapper, svg'))
                        .filter((node) => {
                            if (!visible(node)) return false;
                            const rect = node.getBoundingClientRect();
                            return rect.x > 250 && rect.y > 120 && rect.width <= 160 && rect.height <= 160;
                        }).length;
                    return {
                        text,
                        tabsVisible,
                        hasEmptyState,
                        hasConversationHint,
                        contentLength: contentText.length,
                        visibleLoaders,
                    };
                }"""
            )
            last_state = state
            if state.get("hasEmptyState"):
                return state
            if state.get("hasConversationHint") and state.get("contentLength", 0) > 20:
                return state
            if state.get("tabsVisible") and state.get("visibleLoaders", 0) == 0 and state.get("contentLength", 0) > 12:
                return state
        except Exception:
            pass
        await page.wait_for_timeout(1000)
    return last_state or {}


async def _click_douyin_message_tab(page, label):
    try:
        return await page.evaluate(
            r"""(label) => {
                const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
                const visible = (node) => {
                    if (!node || !node.getBoundingClientRect) return false;
                    const rect = node.getBoundingClientRect();
                    const style = window.getComputedStyle(node);
                    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
                };
                const candidates = Array.from(document.querySelectorAll('button, [role="tab"], div, span'))
                    .filter((node) => {
                        if (!visible(node)) return false;
                        if (normalize(node.innerText || node.textContent) !== label) return false;
                        const rect = node.getBoundingClientRect();
                        return rect.x > 220 && rect.y > 70 && rect.y < 260;
                    })
                    .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
                const node = candidates[0];
                if (!node) return false;
                node.click();
                return true;
            }""",
            label,
        )
    except Exception:
        return False


async def _scan_douyin_message_tabs(page, limit=10, target_text=None):
    tabs = ["全部", "朋友私信", "陌生人私信", "群消息"]
    scanned_tabs = []
    best_scan = None
    target_text = (target_text or "").strip()

    for index, label in enumerate(tabs):
        clicked = False
        if index > 0 or target_text:
            clicked = await _click_douyin_message_tab(page, label)
            if clicked:
                await page.wait_for_timeout(1200)
        settled = await _wait_douyin_message_page_settled(page, timeout_ms=9000 if index == 0 else 5000)
        scan = await page.evaluate(_douyin_message_scan_script(), limit)
        scan["selectedTab"] = label
        scan["tabClicked"] = bool(clicked)
        scan["pageLoadState"] = settled
        messages = scan.get("messages") or []
        scanned_tabs.append({
            "label": label,
            "clicked": bool(clicked),
            "totalCandidates": scan.get("totalCandidates"),
            "usableCount": len(messages),
            "pageTextSample": scan.get("pageTextSample") or "",
            "loading": (settled or {}).get("visibleLoaders", 0),
        })
        if target_text and any(target_text in (item.get("text") or "") or (item.get("text") or "") in target_text for item in messages):
            scan["scannedTabs"] = scanned_tabs
            return scan
        if messages:
            scan["scannedTabs"] = scanned_tabs
            return scan
        if best_scan is None or (scan.get("totalCandidates") or 0) > (best_scan.get("totalCandidates") or 0):
            best_scan = scan
        if index == 0 and not target_text:
            page_text = _normalize_interaction_text(scan.get("pageTextSample") or "")
            empty_match = re.search(r"(还没有收到私信|暂无私信|暂无消息|没有收到私信|没有私信|暂无会话)", page_text)
            if empty_match:
                scan["emptyState"] = True
                scan["emptyReason"] = empty_match.group(1)
                scan["scannedTabs"] = scanned_tabs
                return scan

    best_scan = best_scan or await page.evaluate(_douyin_message_scan_script(), limit)
    best_scan["scannedTabs"] = scanned_tabs
    still_loading = any((tab.get("loading") or 0) > 0 for tab in scanned_tabs)
    has_usable_text = any((tab.get("totalCandidates") or 0) > 0 for tab in scanned_tabs)
    page_text = _normalize_interaction_text(best_scan.get("pageTextSample") or "")
    empty_match = re.search(r"(还没有收到私信|暂无私信|暂无消息|没有收到私信|没有私信|暂无会话)", page_text)
    if empty_match and not has_usable_text:
        best_scan["emptyState"] = True
        best_scan["emptyReason"] = empty_match.group(1)
        best_scan.pop("loadBlocked", None)
        best_scan.pop("loadBlockedReason", None)
    elif still_loading and not has_usable_text:
        best_scan["loadBlocked"] = True
        best_scan["loadBlockedReason"] = "抖音私信页会话列表持续加载，未进入可读取状态。"
    return best_scan


def _douyin_comment_scan_has_target(scan_result, target_text):
    target_text = _normalize_interaction_text(target_text)
    if not target_text:
        return bool((scan_result or {}).get("comments") or [])
    for item in (scan_result or {}).get("comments") or []:
        text = _normalize_interaction_text(item.get("text") or "")
        if text and (text == target_text or target_text in text or text in target_text):
            return True
    return False


def _summarize_douyin_comment_parsing_rules(rules):
    rules = rules if isinstance(rules, dict) else {}
    return {
        "mode": rules.get("commentParsingMode") or "none",
        "preset": rules.get("commentRulePreset") or "loose",
        "allowShortText": rules.get("commentAllowShortText") is not False,
        "skipHandled": bool(rules.get("commentSkipHandled")),
        "questionOnly": bool(rules.get("commentQuestionOnly")),
        "minLength": rules.get("commentMinLength") or 1,
        "maxLength": rules.get("commentMaxLength") or 500,
        "whitelistCount": len(rules.get("commentWhitelistKeywords") or []),
    }


async def _choose_douyin_comment_work_with_candidates(page, scan_limit=10, max_works=8, target_text=None, parsing_rules=None):
    target_text = _normalize_interaction_text(target_text)
    parsing_rules = parsing_rules if isinstance(parsing_rules, dict) else {}

    async def scan_current(selected_title=None, selected_index=None):
        scan = await page.evaluate(_douyin_comment_scan_script(), {"limit": scan_limit, "rules": parsing_rules})
        scan["selectedWorkTitle"] = selected_title
        scan["selectedWorkIndex"] = selected_index
        scan["parsingRulesApplied"] = _summarize_douyin_comment_parsing_rules(parsing_rules)
        return scan

    initial = await scan_current()
    if (initial.get("comments") or []) and (not target_text or _douyin_comment_scan_has_target(initial, target_text)):
        return initial

    can_switch = await page.evaluate(
        r"""() => {
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const visible = (node) => {
                if (!node || !node.getBoundingClientRect) return false;
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            };
            const nodes = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
                .filter((node) => visible(node) && normalize(node.innerText || node.textContent) === '选择作品');
            if (!nodes.length) return false;
            nodes.sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x);
            nodes[0].click();
            return true;
        }"""
    )
    if not can_switch:
        initial["workSwitchAttempted"] = False
        return initial

    await page.wait_for_timeout(1500)
    work_items = await page.evaluate(
        r"""(maxWorks) => {
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const visible = (node) => {
                if (!node || !node.getBoundingClientRect) return false;
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return rect.width > 40 && rect.height > 30 && style.display !== 'none' && style.visibility !== 'hidden';
            };
            const parseCommentCount = (text) => {
                const lines = text.split(/\n+/).map(normalize).filter(Boolean);
                for (let i = lines.length - 1; i >= 0; i -= 1) {
                    if (/^\d+$/.test(lines[i])) return Number(lines[i]);
                }
                const match = text.match(/发布于[\s\S]*?\s(\d+)\s*$/);
                return match ? Number(match[1]) : 0;
            };
            const candidates = Array.from(document.querySelectorAll('div, li, tr, section'))
                .filter(visible)
                .map((node, index) => {
                    const text = normalize(node.innerText || node.textContent);
                    const rect = node.getBoundingClientRect();
                    const hasCover = node.querySelector('img, video, canvas, [class*="cover"], [class*="Cover"]');
                    const hasPublishTime = /发布于|202\d年|\d{1,2}:\d{2}/.test(text);
                    const inDrawer = rect.x > window.innerWidth * 0.55;
                    const commentCount = parseCommentCount(node.innerText || node.textContent || '');
                    const tooGeneric = /^(选择作品|全部作品|公开视频|图文|搜索|取消|确定|暂无作品)$/.test(text);
                    return { index, text, x: rect.x, y: rect.y, width: rect.width, height: rect.height, hasCover: Boolean(hasCover), hasPublishTime, commentCount, inDrawer, tooGeneric };
                })
                .filter((item) =>
                    item.inDrawer &&
                    !item.tooGeneric &&
                    item.hasCover &&
                    item.hasPublishTime &&
                    item.width >= 240 &&
                    item.height >= 60 &&
                    item.height <= 180 &&
                    item.text.length >= 2 &&
                    item.text.length <= 260
                )
                .sort((a, b) => (b.commentCount - a.commentCount) || (a.y - b.y) || (a.x - b.x));
            const seen = new Set();
            return candidates.filter((item) => {
                const key = `${Math.round(item.y / 10)}:${item.text.slice(0, 80)}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).slice(0, maxWorks);
        }""",
        max_works,
    )
    scanned = [initial]
    best_scan_with_comments = initial if (initial.get("comments") or []) else None
    for index, item in enumerate(work_items or []):
        try:
            clicked = await page.evaluate(
                r"""({ text, index }) => {
                    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
                    const visible = (node) => {
                        if (!node || !node.getBoundingClientRect) return false;
                        const rect = node.getBoundingClientRect();
                        const style = window.getComputedStyle(node);
                        return rect.width > 40 && rect.height > 30 && style.display !== 'none' && style.visibility !== 'hidden';
                    };
                    const nodes = Array.from(document.querySelectorAll('div, li, tr, section'))
                        .filter((node) => {
                            const rect = node.getBoundingClientRect();
                            return visible(node) &&
                                rect.x > window.innerWidth * 0.55 &&
                                normalize(node.innerText || node.textContent).includes(text.slice(0, Math.min(text.length, 80)));
                        })
                        .sort((a, b) => {
                            const ar = a.getBoundingClientRect();
                            const br = b.getBoundingClientRect();
                            return (ar.height - br.height) || (ar.width - br.width);
                        });
                    const fallback = Array.from(document.querySelectorAll('div, li, tr, section')).filter((node) => {
                        const rect = node.getBoundingClientRect();
                        return visible(node) && rect.x > window.innerWidth * 0.55 && node.querySelector('img') && /发布于/.test(normalize(node.innerText || node.textContent));
                    })[index];
                    const node = nodes[0] || fallback;
                    if (!node) return false;
                    node.scrollIntoView({ block: 'center', inline: 'nearest' });
                    node.click();
                    return true;
                }""",
                {"text": item.get("text") or "", "index": index},
            )
            if not clicked:
                continue
            await page.wait_for_timeout(2200)
            await _dismiss_douyin_overlays(page)
            scan = await scan_current(item.get("text"), index)
            scanned.append(scan)
            if (scan.get("comments") or []):
                if best_scan_with_comments is None:
                    best_scan_with_comments = scan
                if not target_text or _douyin_comment_scan_has_target(scan, target_text):
                    scan["workSwitchAttempted"] = True
                    scan["workCandidates"] = work_items
                    scan["scannedWorks"] = scanned[-8:]
                    return scan

            await page.evaluate(
                r"""() => {
                    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
                    const nodes = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
                        .filter((node) => {
                            const rect = node.getBoundingClientRect();
                            const style = window.getComputedStyle(node);
                            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
                                && normalize(node.innerText || node.textContent) === '选择作品';
                        });
                    if (nodes.length) {
                        nodes.sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x);
                        nodes[0].click();
                    }
                }"""
            )
            await page.wait_for_timeout(1200)
        except Exception as e:
            print(f"[interaction/douyin/comments] choose work failed index={index}: {e}")
            try:
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(500)
            except Exception:
                pass

    fallback = best_scan_with_comments or initial
    fallback["workSwitchAttempted"] = True
    fallback["workCandidates"] = work_items
    fallback["scannedWorks"] = scanned[-8:]
    if target_text:
        fallback["targetText"] = target_text
        fallback["targetMatched"] = _douyin_comment_scan_has_target(fallback, target_text)
    return fallback


def _douyin_comment_scan_script():
    return r"""({ limit, rules = {} }) => {
        const normalize = (value) => String(value || '')
            .replace(/\s+/g, ' ')
            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
            .trim();
        const list = (value) => Array.isArray(value) ? value.map((item) => normalize(item)).filter(Boolean) : [];
        const parsingMode = rules.commentParsingMode === 'rules' ? 'rules' : 'none';
        const preset = rules.commentRulePreset === 'strict' ? 'strict' : 'loose';
        const allowShortText = rules.commentAllowShortText !== false;
        const skipHandled = Boolean(rules.commentSkipHandled);
        const questionOnly = Boolean(rules.commentQuestionOnly);
        const requireActionAndTime = Boolean(rules.commentRequireActionAndTime);
        const minLength = Math.max(1, Math.min(Number(rules.commentMinLength) || 1, 80));
        const maxLength = Math.max(10, Math.min(Number(rules.commentMaxLength) || 500, 500));
        const whitelistKeywords = list(rules.commentWhitelistKeywords);
        const authorKeywords = list(rules.commentExcludeAuthorKeywords);
        const configuredNoise = list(rules.commentNoiseKeywords);
        const priorityKeywords = list(rules.commentPriorityKeywords);
        const hasAny = (text, keywords) => keywords.some((keyword) => keyword && text.includes(keyword));
        const questionPattern = /[？?吗呢吧呀哦]|预约|价格|多少|怎么|哪里|联系|电话|微信|私信/;
        const visible = (node) => {
            if (!node || !node.getBoundingClientRect) return false;
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
        };
        const hasReadableChar = (text) => /[\u4e00-\u9fa5a-zA-Z0-9]/.test(text) || /[\u{1F300}-\u{1FAFF}]/u.test(text);
        const exactNoise = new Set([
            '发布作品', '作品管理', '数据中心', '创作者服务中心', '全部作品',
            '公开视频', '图文', '合集', '搜索', '筛选', '下载', '置顶',
            '删除', '编辑', '查看数据', '发布', '草稿', '审核', '回复',
            '高清发布', '选择作品', '全部评论', '全部人群', '最新发布',
            '暂无更多评论', '暂无评论', '点击刷新', '发送', '评论管理',
            '请选择排序方式', '有爱评论，说点儿好听的～',
            '你对评论管理功能是否满意', '不再显示', '在线客服',
            '通知', '网址', '抖音', '首页', '内容管理', '互动管理',
            '关注管理', '粉丝管理', '弹幕管理', '私信管理', '变现中心',
            '创作中心', '我知道了', '加载中，请稍候...', '加载中'
        ]);
        const containsNoise = [
            'KAYPAL REAL PUB',
            'KAYPAL COMMERCIAL',
            'commercial #realtest',
            '#kaypal',
            '新增「共创中心」模块',
            '管理你的共创作品',
            '发布于202',
            '本通知发布',
            '如有疑问',
            '星图平台',
        ];
        const statPattern = /^(播放|点赞|评论|分享)\s*[-\d]+$|播放\s*[-\d]+\s*点赞\s*[-\d]+\s*评论\s*[-\d]+\s*分享\s*[-\d]+|^\d+$|^\d{1,2}:\d{2}$|^(昨天|今天)\d{1,2}:\d{2}$|^\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}$|^\d+分钟前$|^\d+小时前$|^\d+天前$|^刚刚$/;
        const isNoise = (text) => {
            if (!text) return true;
            if (whitelistKeywords.length && hasAny(text, whitelistKeywords)) return false;
            if (text.length < minLength || text.length > maxLength) return true;
            if (!allowShortText && text.length < 2) return true;
            if (!hasReadableChar(text)) return true;
            if (exactNoise.has(text)) return true;
            if (configuredNoise.length && hasAny(text, configuredNoise)) return true;
            if (containsNoise.some((item) => text.includes(item))) return true;
            if (/^展开\d+条回复$/.test(text)) return true;
            if (/^[\u4e00-\u9fa5A-Za-z0-9_·\-]{1,24}(?:📷|✅|✔|V)?$/.test(text) && !questionPattern.test(text) && !/干净|好|不错|喜欢|想|要|买|来|发|帮|看/.test(text)) return true;
            if (questionOnly && !questionPattern.test(text) && !hasAny(text, whitelistKeywords)) return true;
            if (text.includes('#') && !hasAny(text, whitelistKeywords)) return true;
            if (/发布于20\d{2}年/.test(text)) return true;
            if (statPattern.test(text)) return true;
            return false;
        };
        const candidates = [];
        const commentTextFromRow = (row) => {
            const texts = [];
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                const parent = node.parentElement;
                if (!parent || !visible(parent)) continue;
                const text = normalize(node.nodeValue);
                if (!text || isNoise(text)) continue;
                const rect = parent.getBoundingClientRect();
                const nearActions = rect.y > row.getBoundingClientRect().bottom - 90;
                texts.push({
                    text,
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    nearActions,
                    question: /[？?吗呢吧呀哦]|预约|价格|多少|怎么|哪里|联系|电话|微信|私信/.test(text),
                });
            }
            return texts
                .filter((item) => !item.nearActions || item.question)
                .sort((a, b) => (b.question ? 1 : 0) - (a.question ? 1 : 0) || b.y - a.y || b.x - a.x)[0]?.text || '';
        };
        const pushCandidate = (text, node, source, baseScore = 0) => {
            text = normalize(text);
            if (isNoise(text)) return;
            const rect = node.getBoundingClientRect();
            if (rect.x < 260 || rect.y < 120) return;
            const row = node.closest('tr, li, [class*="comment"], [class*="Comment"], [class*="item"], [class*="Item"], [class*="list"], [class*="List"]') || node.parentElement || node;
            const context = normalize(row.innerText || row.textContent || '').slice(0, 260);
            const hasCommentAction = /回复|删除/.test(context);
            const hasCommentTime = /分钟前|小时前|刚刚|昨天|今天|\d{1,2}:\d{2}/.test(context);
            const hasCommentContext = requireActionAndTime ? hasCommentAction && hasCommentTime : (hasCommentAction || hasCommentTime);
            if (parsingMode === 'rules' && !hasCommentContext && preset === 'strict') return;
            if (skipHandled && /已回复|我已回复|商家回复|作者回复/.test(context)) return;
            if (/(^|\s)(商家|客服)(\s|$)/.test(context) || hasAny(context, authorKeywords)) return;
            const rowComment = commentTextFromRow(row);
            if (source === 'comment-row' && rowComment && !isNoise(rowComment)) {
                text = rowComment;
            }
            let score = baseScore;
            if (hasCommentContext) score += 30;
            if (source === 'comment-row') score += 18;
            if (questionPattern.test(text)) score += 18;
            if (hasAny(text, priorityKeywords)) score += 20;
            if (hasAny(text, whitelistKeywords)) score += 60;
            if (/[\u{1F300}-\u{1FAFF}]/u.test(text)) score += 12;
            if (/AI研究员|账号|用户|作者|达人|商家|客服$/.test(text)) score -= 12;
            if (text.includes('#') && !hasAny(text, whitelistKeywords)) score -= 15;
            candidates.push({
                text,
                looksLikeComment: true,
                source,
                score,
                context,
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            });
        };

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent || !visible(parent)) continue;
            const text = normalize(node.nodeValue);
            pushCandidate(text, parent, 'text-node', 10);
        }

        for (const element of Array.from(document.querySelectorAll('div, li, tr, section'))) {
            if (!visible(element)) continue;
            const rect = element.getBoundingClientRect();
            if (rect.x < 260 || rect.y < 120) continue;
            const text = normalize(element.innerText || element.textContent);
            if (parsingMode === 'rules' && preset === 'strict' && !/回复|删除/.test(text)) continue;
            if (parsingMode === 'rules' && preset === 'strict' && !/分钟前|小时前|刚刚|天前|今天|昨天/.test(text)) continue;
            const parts = text
                .split(/\s+/)
                .map(normalize)
                .filter(Boolean);
            const rowComment = commentTextFromRow(element);
            if (rowComment) {
                pushCandidate(rowComment, element, 'comment-row', 20);
            } else {
                for (const part of parts) {
                    pushCandidate(part, element, 'comment-row', 20);
                }
            }
        }

        const seen = new Set();
        const comments = [];
        for (const item of candidates.sort((a, b) => (b.score - a.score) || (a.y - b.y) || (a.x - b.x))) {
            if (seen.has(item.text)) continue;
            seen.add(item.text);
            comments.push(item);
            if (comments.length >= limit) break;
        }
        return {
            url: location.href,
            title: document.title,
            totalCandidates: candidates.length,
            comments,
            pageTextSample: normalize(document.body.innerText).slice(0, 800),
        };
    }"""


def _douyin_message_scan_script():
    return r"""(limit) => {
        const normalize = (value) => String(value || '')
            .replace(/\s+/g, ' ')
            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
            .trim();
        const visible = (node) => {
            if (!node || !node.getBoundingClientRect) return false;
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
        };
        const hasReadableChar = (text) => /[\u4e00-\u9fa5a-zA-Z0-9]/.test(text) || /[\u{1F300}-\u{1FAFF}]/u.test(text);
        const exactNoise = new Set([
            '发布作品', '作品管理', '数据中心', '创作者服务中心',
            '首页', '活动管理', '内容管理', '互动管理', '变现中心',
            '创作中心', '通知', '网址', '抖音', '发送', '搜索',
            '全部', '加载中', '暂无', '高清发布', '发布视频', '发布图文',
            '站内信', '星图', '客服', '平台', '下线通知',
            '关注管理', '粉丝管理', '评论管理', '弹幕管理', '私信管理',
            '我知道了', '稍后再看', '关闭', '加载中，请稍候...', '加载中',
            '抖音社区自律公约', '账号授权协议', '用户服务协议', '隐私政策',
            '账号找回', '联系我们', '中国互联网举报中心'
        ]);
        const containsNoise = [
            '你收到一条新类型消息',
            '请打开抖音app查看',
            '请打开抖音 app 查看',
            '请打开抖音APP查看',
            '分享[视频]',
            '[视频]',
            '[图片]',
            '新增「共创中心」模块',
            '管理你的共创作品',
            '创作者您好',
            '感谢您的理解与支持',
            '如有疑问',
            '星图平台',
            '集中发布与展示',
            '本通知发布',
            '平台通知',
            '系统通知',
            '功能介绍',
            '该消息类型暂不支持',
            '抖音社区自律公约',
            '账号授权协议',
            '用户服务协议',
            '隐私政策',
            '账号找回',
            '北京抖音科技有限公司',
            '京ICP',
            '京B2',
            '举报',
            '网络文化经营许可证',
        ];
        const statPattern = /^\d+$|^\d{1,2}:\d{2}$|^\d+分钟前$|^\d+小时前$|^\d+天前$|^刚刚$|^今天$|^昨天$/;
        const isNoise = (text) => {
            if (!text || text.length < 2 || text.length > 180) return true;
            if (!hasReadableChar(text)) return true;
            if (exactNoise.has(text)) return true;
            if (containsNoise.some((item) => text.includes(item))) return true;
            if (/^[\u4e00-\u9fa5A-Za-z0-9_·\-]{1,24}(?:📷|✅|✔|V)?$/.test(text) && !/[？?吗呢吧呀哦]|预约|价格|多少|怎么|哪里|联系|电话|微信|私信|在吗|在哪|要|买|发|帮|看/.test(text)) return true;
            if (statPattern.test(text)) return true;
            return false;
        };
        const candidates = [];
        const rowSelectors = '[role="gridcell"], li, tr, [class*="chat"], [class*="Chat"], [class*="message"], [class*="Message"], [class*="conversation"], [class*="Conversation"], [class*="item"], [class*="Item"]';
        const rowLooksUnreplyable = (text) =>
            /你收到一条新类型消息|请打开抖音\s*app\s*查看|分享\[视频\]|\[视频\]|\[图片\]|该消息类型暂不支持|当前版本暂不支持/.test(text);
        const rowLooksLikeSessionList = (text) =>
            /全部|朋友私信|陌生人私信|群消息|全选/.test(text) && /你收到一条新类型消息|请打开抖音\s*app\s*查看|分享\[视频\]|昨天|\d{1,2}:\d{2}/.test(text) && text.length > 260;
        const messageTimePattern = '(?:刚刚|今天|昨天|星期[一二三四五六日天]|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d+分钟前|\\d+小时前)';
        const stripRowPrefix = (value) => {
            let text = normalize(value);
            text = text.replace(/^(?:全选\s+)?\d+\s+/, '');
            text = text.replace(new RegExp('^陌生人消息\\s+' + messageTimePattern + '\\s*', 'i'), '');
            text = text.replace(new RegExp('^[^\\s:：]{1,60}\\s+' + messageTimePattern + '\\s+', 'i'), '');
            text = text.replace(/^[^:：]{1,80}[:：]\s*/, '');
            return normalize(text);
        };
        const contactFromRow = (value) => {
            const text = normalize(value).replace(/^(?:全选\s+)?\d+\s+/, '');
            if (text.startsWith('陌生人消息')) {
                const match = text.match(new RegExp('^陌生人消息\\s+' + messageTimePattern + '\\s*([^:：]{1,80})[:：]'));
                return normalize(match?.[1] || '陌生人消息');
            }
            const match = text.match(new RegExp('^(.{1,60}?)\\s+' + messageTimePattern + '\\s+'));
            return normalize(match?.[1] || '');
        };
        const leafMessageFromRow = (row) => {
            const textNodes = [];
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                const parent = node.parentElement;
                if (!parent || !visible(parent)) continue;
                const text = normalize(node.nodeValue);
                if (!text || isNoise(text)) continue;
                const rect = parent.getBoundingClientRect();
                textNodes.push({ text, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            }
            const contact = contactFromRow(row.innerText || row.textContent || '');
            return textNodes
                .filter((item) => item.text !== contact)
                .filter((item) => !/^全选$/.test(item.text))
                .sort((a, b) => (b.y - a.y) || (b.x - a.x))[0]?.text || '';
        };
        const pushCandidate = (text, node, source, baseScore = 0) => {
            text = normalize(text);
            if (isNoise(text)) return;
            const rect = node.getBoundingClientRect();
            if (rect.x < 170 || rect.y < 110) return;
            const row = node.closest(rowSelectors) || node.parentElement || node;
            const rowText = normalize(row.innerText || row.textContent || '');
            if (rowLooksLikeSessionList(rowText) && source !== 'message-row') return;
            if (rowLooksUnreplyable(rowText)) return;
            const leafMessage = leafMessageFromRow(row);
            const messageText = source === 'message-row' && leafMessage ? leafMessage : stripRowPrefix(text);
            if (messageText && messageText !== text && !isNoise(messageText)) {
                text = messageText;
            }
            const context = rowText.slice(0, 260);
            let score = baseScore;
            if (/私信|消息|回复|分钟前|刚刚|未读/.test(context)) score += 20;
            if (/[？?吗呢吧呀哦]|预约|价格|多少|怎么|哪里|联系|电话|微信|私信/.test(text)) score += 18;
            if (/[\u{1F300}-\u{1FAFF}]/u.test(text)) score += 8;
            candidates.push({
                text,
                looksLikeMessage: true,
                source,
                score,
                context,
                contactName: contactFromRow(rowText),
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            });
        };

        for (const row of Array.from(document.querySelectorAll(rowSelectors)).filter(visible)) {
            const rect = row.getBoundingClientRect();
            if (rect.x < 170 || rect.y < 110 || rect.width < 180 || rect.height < 28) continue;
            const rowText = normalize(row.innerText || row.textContent);
            if (!rowText || rowLooksUnreplyable(rowText)) continue;
            const messageText = stripRowPrefix(rowText);
            if (messageText && !isNoise(messageText)) {
                pushCandidate(messageText, row, 'message-row', 35);
            }
        }

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent || !visible(parent)) continue;
            const row = parent.closest(rowSelectors) || parent.parentElement || parent;
            const rowText = normalize(row.innerText || row.textContent || '');
            if (rowLooksLikeSessionList(rowText)) continue;
            pushCandidate(node.nodeValue, parent, 'text-node', 10);
        }

        const seen = new Set();
        const messages = [];
        for (const item of candidates.sort((a, b) => (b.score - a.score) || (a.y - b.y) || (a.x - b.x))) {
            if (seen.has(item.text)) continue;
            seen.add(item.text);
            messages.push(item);
            if (messages.length >= limit) break;
        }
        return {
            url: location.href,
            title: document.title,
            totalCandidates: candidates.length,
            messages,
            emptyState: /还没有收到私信|暂无私信|暂无消息|没有收到私信|没有私信|暂无会话/.test(normalize(document.body.innerText)),
            emptyReason: (normalize(document.body.innerText).match(/还没有收到私信|暂无私信|暂无消息|没有收到私信|没有私信|暂无会话/) || [])[0],
            pageTextSample: normalize(document.body.innerText).slice(0, 800),
        };
    }"""


def _douyin_message_load_blocked_summary(scan_result):
    if not scan_result.get("loadBlocked"):
        return None
    return {
        "totalCandidates": scan_result.get("totalCandidates") or 0,
        "usableCount": 0,
        "emptyReason": scan_result.get("loadBlockedReason") or "抖音私信页会话列表持续加载，未进入可读取状态。",
        "blocked": True,
        "blockedReason": "message_list_loading",
        "nextAction": "请打开抖音创作者后台私信页确认会话列表能正常显示，再回到系统重试；如果页面一直转圈，先刷新或重新登录抖音账号。",
    }


async def _douyin_message_page_blocked_summary(page, scan_result=None):
    scan_blocked = _douyin_message_load_blocked_summary(scan_result or {})
    if scan_blocked:
        return scan_blocked
    try:
        state = await page.evaluate(
            r"""() => {
                const normalize = (value) => String(value || '')
                    .replace(/\s+/g, ' ')
                    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                    .trim();
                const visible = (node) => {
                    if (!node || !node.getBoundingClientRect) return false;
                    const rect = node.getBoundingClientRect();
                    const style = window.getComputedStyle(node);
                    return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                        && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
                };
                const text = normalize(document.body.innerText || '');
                const hasEditor = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]')).some(visible);
                const visibleLoaders = Array.from(document.querySelectorAll('[class*="loading"], [class*="Loading"], [class*="spin"], [class*="Spin"], .semi-spin, .semi-spin-wrapper, svg'))
                    .filter((node) => {
                        if (!visible(node)) return false;
                        const rect = node.getBoundingClientRect();
                        return rect.x > 240 && rect.y > 100 && rect.width <= 180 && rect.height <= 180;
                    }).length;
                return {
                    hasEditor,
                    visibleLoaders,
                    hasLoadingText: /加载中|请稍候|正在加载/.test(text),
                    pageTextSample: text.slice(0, 800),
                };
            }"""
        )
    except Exception:
        return None
    if state.get("hasEditor"):
        return None
    if state.get("visibleLoaders", 0) > 0 or state.get("hasLoadingText"):
        return {
            "totalCandidates": (scan_result or {}).get("totalCandidates") or 0,
            "usableCount": len((scan_result or {}).get("messages") or []),
            "emptyReason": "抖音私信页仍在加载，未进入可回复状态。",
            "blocked": True,
            "blockedReason": "message_page_loading",
            "nextAction": "请刷新抖音创作者后台私信页，确认会话列表和输入框正常显示后重试；如果持续加载，请重新登录该抖音账号。",
            "pageTextSample": state.get("pageTextSample") or "",
        }
    return None


async def _open_wechat_channel_page(account_row, storage_path, target_kind):
    acc_id = account_row[0]
    target_url = (
        "https://channels.weixin.qq.com/platform/interaction/comment"
        if target_kind == "comments"
        else "https://channels.weixin.qq.com/platform/private_msg"
    )
    session = await _ensure_interaction_context(
        "wechat-channel",
        acc_id,
        storage_path,
        target_url,
    )
    page = session["page"]
    await page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
    try:
        await page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    await page.wait_for_timeout(2500)
    labels = (
        ["评论管理", "互动管理", "评论", "留言管理"]
        if target_kind == "comments"
        else ["私信管理", "消息管理", "互动管理", "私信", "消息", "用户消息"]
    )
    for label in labels:
        try:
            await page.get_by_text(label, exact=True).first.click(timeout=2500)
            await page.wait_for_timeout(1200)
        except Exception:
            pass
    try:
        await reveal_page_window(page)
    except Exception as e:
        print(f"[interaction/wechat-channel/{target_kind}] reveal failed: {e}")
    return session, page


async def _wechat_channel_content_frame(page, target_kind, timeout_ms=8000):
    expected = (
        "micro/interaction/comment"
        if target_kind == "comments"
        else "micro/interaction/private_msg"
    )
    deadline = time.time() + (timeout_ms / 1000)
    while time.time() < deadline:
        for frame in page.frames:
            if expected in (frame.url or ""):
                return frame
        await page.wait_for_timeout(250)
    return page


async def _select_wechat_channel_comment_work(page, target_text=None):
    """Open the detail pane for a work that has comments before scanning/replying."""
    try:
        frame = await _wechat_channel_content_frame(page, "comments")
        result = await frame.evaluate(
            r"""({ targetText }) => {
                const normalize = (value) => String(value || '')
                    .replace(/\s+/g, ' ')
                    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                    .trim();
                const visible = (node) => {
                    if (!node || !node.getBoundingClientRect) return false;
                    const rect = node.getBoundingClientRect();
                    const style = window.getComputedStyle(node);
                    return rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        Number(style.opacity) !== 0;
                };
                const bodyText = normalize(document.body.innerText || document.body.textContent || '');
                if (targetText && bodyText.includes(targetText)) {
                    return { clicked: false, reason: 'target-already-visible' };
                }
                const parseCommentCount = (text) => {
                    const normalized = normalize(text);
                    const numbers = (normalized.match(/\b\d+\b/g) || []).map(Number);
                    if (!numbers.length) return 0;
                    return numbers[numbers.length - 1] || 0;
                };
                const rows = Array.from(document.querySelectorAll('li, tr, section, div'))
                    .filter((node) => {
                        if (!visible(node)) return false;
                        const rect = node.getBoundingClientRect();
                        if (rect.x < 260 || rect.x > window.innerWidth * 0.58) return false;
                        if (rect.y < 130 || rect.width < 160 || rect.height < 42 || rect.height > 220) return false;
                        const text = normalize(node.innerText || node.textContent);
                        if (!text || text.length > 320) return false;
                        if (!/20\d{2}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}:\d{2}/.test(text)) return false;
                        return parseCommentCount(text) > 0;
                    })
                    .map((node) => {
                        const rect = node.getBoundingClientRect();
                        const text = normalize(node.innerText || node.textContent);
                        return {
                            node,
                            text,
                            commentCount: parseCommentCount(text),
                            x: Math.round(rect.x),
                            y: Math.round(rect.y),
                            width: Math.round(rect.width),
                            height: Math.round(rect.height),
                        };
                    })
                    .sort((a, b) => (a.y - b.y) || (b.commentCount - a.commentCount) || (a.height - b.height));
                const row = rows[0];
                if (!row) return { clicked: false, reason: 'no-work-with-comments' };
                row.node.scrollIntoView({ block: 'center', inline: 'nearest' });
                row.node.click();
                return {
                    clicked: true,
                    selectedText: row.text.slice(0, 220),
                    commentCount: row.commentCount,
                    candidates: rows.slice(0, 6).map(({ text, commentCount, x, y, width, height }) => ({
                        text: text.slice(0, 180),
                        commentCount,
                        x,
                        y,
                        width,
                        height,
                    })),
                };
            }""",
            {"targetText": target_text or ""},
        )
        if result and result.get("clicked"):
            await page.wait_for_timeout(2800)
        return result or {}
    except Exception as e:
        print(f"[interaction/wechat-channel/comments] select work failed: {e}")
        return {"clicked": False, "reason": str(e)}


async def _prepare_wechat_channel_message_tab(page, target_text=None):
    """Search both normal private messages and greeting messages."""
    frame = await _wechat_channel_content_frame(page, "messages")

    async def has_target_or_items():
        try:
            return await frame.evaluate(
                r"""({ targetText }) => {
                    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
                    const text = normalize(document.body.innerText || document.body.textContent || '');
                    if (targetText && text.includes(targetText)) return { matchedTarget: true, hasItems: true };
                    const empty = /暂无私信|暂无消息|还没有收到私信|没有私信/.test(text);
                    const hasListSignal = /今天|昨天|\d{1,2}:\d{2}|分钟前|小时前|未读|回复/.test(text);
                    return { matchedTarget: false, hasItems: hasListSignal && !empty };
                }""",
                {"targetText": target_text or ""},
            )
        except Exception:
            return {"matchedTarget": False, "hasItems": False}

    current = await has_target_or_items()
    if current.get("matchedTarget") or (current.get("hasItems") and not target_text):
        return {"selectedTab": "current", **current}

    for label in ["打招呼消息", "私信", "全部私信"]:
        try:
            clicked = await frame.evaluate(
                r"""(label) => {
                    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
                    const visible = (node) => {
                        if (!node || !node.getBoundingClientRect) return false;
                        const rect = node.getBoundingClientRect();
                        const style = window.getComputedStyle(node);
                        return rect.width > 0 && rect.height > 0 &&
                            style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            Number(style.opacity) !== 0;
                    };
                    const nodes = Array.from(document.querySelectorAll('button, [role="button"], div, span, a'))
                        .filter((node) => visible(node) && normalize(node.innerText || node.textContent) === label)
                        .sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y);
                    if (!nodes.length) return false;
                    nodes[0].click();
                    return true;
                }""",
                label,
            )
            if not clicked:
                continue
            await page.wait_for_timeout(2200)
            state = await has_target_or_items()
            if state.get("matchedTarget") or state.get("hasItems"):
                return {"selectedTab": label, **state}
        except Exception as e:
            print(f"[interaction/wechat-channel/messages] switch tab {label} failed: {e}")
    return {"selectedTab": "none", **(await has_target_or_items())}


async def _click_wechat_channel_message_tab(page, label):
    frame = await _wechat_channel_content_frame(page, "messages")
    try:
        clicked = await frame.evaluate(
            r"""(label) => {
                const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
                const visible = (node) => {
                    if (!node || !node.getBoundingClientRect) return false;
                    const rect = node.getBoundingClientRect();
                    const style = window.getComputedStyle(node);
                    return rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        Number(style.opacity) !== 0;
                };
                const nodes = Array.from(document.querySelectorAll('button, [role="button"], div, span, a'))
                    .filter((node) => visible(node) && normalize(node.innerText || node.textContent) === label)
                    .sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y);
                if (!nodes.length) return false;
                nodes[0].click();
                return true;
            }""",
            label,
        )
        if clicked:
            await page.wait_for_timeout(2600)
        return {"selectedTab": label, "clicked": bool(clicked)}
    except Exception as e:
        print(f"[interaction/wechat-channel/messages] click tab {label} failed: {e}")
        return {"selectedTab": label, "clicked": False, "error": str(e)}


async def _open_wechat_channel_message_session(page, target_text=None):
    frame = await _wechat_channel_content_frame(page, "messages")
    try:
        result = await frame.evaluate(
            r"""({ targetText }) => {
                const normalize = (value) => String(value || '')
                    .replace(/\s+/g, ' ')
                    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                    .trim();
                const visible = (node) => {
                    if (!node || !node.getBoundingClientRect) return false;
                    const rect = node.getBoundingClientRect();
                    const style = window.getComputedStyle(node);
                    return rect.width > 0 && rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        Number(style.opacity) !== 0;
                };
                const looksOwnReply = (text) => /收到，看到你发的是|你把具体想咨询的问题发我|有具体问题直接发我|我按实际情况/.test(text);
                const rows = Array.from(document.querySelectorAll('.session-wrap, .scroll-list .session-wrap, [class*="session-wrap"], [class*="SessionWrap"]'))
                    .filter((node) => visible(node))
                    .map((node) => {
                        const rect = node.getBoundingClientRect();
                        const text = normalize(node.innerText || node.textContent);
                        const author = normalize(node.querySelector('.name, [class*="name"], [class*="Name"], .title')?.innerText || '');
                        const content = normalize(node.querySelector('.feed-info, [class*="feed-info"], [class*="content"], [class*="Content"], [class*="desc"], [class*="Desc"]')?.innerText || '');
                        const cls = String(node.className || '').toLowerCase();
                        return {
                            node,
                            text,
                            author,
                            content,
                            unread: /未读|新消息/.test(text) || /unread|new/.test(cls),
                            targetMatched: targetText ? text.includes(targetText) : false,
                            ownReply: looksOwnReply(content),
                            y: rect.y,
                        };
                    })
                    .sort((a, b) =>
                        (b.targetMatched ? 1 : 0) - (a.targetMatched ? 1 : 0) ||
                        (b.unread ? 1 : 0) - (a.unread ? 1 : 0) ||
                        (a.ownReply ? 1 : 0) - (b.ownReply ? 1 : 0) ||
                        a.y - b.y
                    );
                const row = rows[0];
                if (!row) return { clicked: false, reason: 'no-session-row' };
                row.node.scrollIntoView({ block: 'center', inline: 'nearest' });
                row.node.click();
                return {
                    clicked: true,
                    author: row.author,
                    content: row.content,
                    unread: row.unread,
                    ownReply: row.ownReply,
                    selectedText: row.text.slice(0, 240),
                };
            }""",
            {"targetText": target_text or ""},
        )
        if result and result.get("clicked"):
            await page.wait_for_timeout(2400)
        return result or {}
    except Exception as e:
        print(f"[interaction/wechat-channel/messages] open session failed: {e}")
        return {"clicked": False, "reason": str(e)}


async def _ensure_wechat_channel_ready_page(page, target_label):
    url = (page.url or "").lower()
    try:
        body_text = await page.locator("body").inner_text(timeout=3000)
    except Exception:
        body_text = ""
    logged_out = (
        "login" in url
        or ("一站式服务" in body_text and "让创作更简单" in body_text and "多人运营" in body_text)
    )
    if logged_out:
        raise RuntimeError(f"视频号账号未登录，不能读取或回复{target_label}。请先重新登录视频号账号。")


def _scan_wechat_channel_script(item_key):
    return r"""({ limit, itemKey }) => {
        const hidden = (node) => {
            const style = window.getComputedStyle(node);
            return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
        };
        const normalize = (value) => String(value || '')
            .replace(/\s+/g, ' ')
            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
            .trim();
        const noise = [
            '视频号助手', '首页', '发表记录', '动态管理', '评论管理', '私信管理',
            '消息管理', '数据中心', '创作者中心', '通知', '设置', '搜索',
            '筛选', '全部', '全部私信', '暂无', '加载中', '发送', '回复', '取消', '确定',
            '微信', '视频号', '发表视频', '发表直播', '原创声明', '合集管理',
            '没有更多了', '暂无评论', '暂无消息', '暂无私信', '暂无打招呼消息',
            '一站式服务', '让创作更简单', '助力优质内容', '加速作者成长',
            '加热视频', '加热直播', '企业账户', '订单分析', '人群分析'
        ];
        const systemNotice = [
            '平台通知', '系统通知', '功能介绍', '使用说明', '隐私', '协议',
            '违规', '处罚', '审核', '申诉', '该消息类型暂不支持'
        ];
        const isComment = String(itemKey || '').toLowerCase().includes('comment');
        const statPattern = /^\d+$|^\d{1,2}:\d{2}$|^\d{4}[/-]\d{1,2}[/-]\d{1,2}$|^\d+分钟前$|^\d+小时前$|^\d+天前$|^刚刚$|^昨天$|^今天$/;
        const rowSelectors = 'li, tr, section, [class*="comment"], [class*="Comment"], [class*="message"], [class*="Message"], [class*="item"], [class*="Item"], div';
        const hasReadableChar = (text) => /[\u4e00-\u9fa5a-zA-Z0-9]/.test(text) || /[\u{1F300}-\u{1FAFF}]/u.test(text);
        const isNoise = (text) => {
            if (!text || text.length > 220) return true;
            if (!hasReadableChar(text)) return true;
            if (statPattern.test(text)) return true;
            if (noise.some(item => text === item || (text.length > 8 && text.includes(item)))) return true;
            if (systemNotice.some(item => text.includes(item))) return true;
            if (/^共\d+个$/.test(text)) return true;
            if (/收到，看到你发的是|你把具体想咨询的问题发我|有具体问题直接发我|我按实际情况/.test(text)) return true;
            if (/不再接收对方消息|扫描二维码后|填写投诉/.test(text)) return true;
            return false;
        };
        const rowLooksUseful = (rowText) => {
            if (isComment) {
                return /回复|删除|点赞|评论|分钟前|小时前|刚刚|昨天|今天|\d{1,2}:\d{2}/.test(rowText);
            }
            return /私信|消息|回复|未读|打招呼|刚刚|今天|昨天|\d{1,2}:\d{2}|分钟前|小时前/.test(rowText);
        };
        const candidates = [];
        if (!isComment) {
            const unreadSessionRows = Array.from(document.querySelectorAll('.session-wrap, .scroll-list .session-wrap, [class*="session-wrap"], [class*="SessionWrap"]'))
                .filter((node) => !hidden(node))
                .filter((node) => {
                    const text = normalize(node.innerText || node.textContent);
                    const cls = String(node.className || '').toLowerCase();
                    return /未读|新消息/.test(text) || /unread|new/.test(cls);
                })
                .map((node) => {
                    const rect = node.getBoundingClientRect();
                    const text = normalize(node.innerText || node.textContent);
                    const authorNode = node.querySelector('.name, [class*="name"], [class*="Name"], .title');
                    const dateNode = node.querySelector('.date, [class*="date"], [class*="Date"], time');
                    const contentNode = node.querySelector('.feed-info, [class*="feed-info"], [class*="content"], [class*="Content"], [class*="desc"], [class*="Desc"]');
                    const author = normalize(authorNode?.innerText || authorNode?.textContent || '');
                    const timestamp = normalize(dateNode?.innerText || dateNode?.textContent || '');
                    const content = normalize(contentNode?.innerText || contentNode?.textContent || '');
                    if (!author || !timestamp || !content || rect.width <= 0 || rect.height <= 0) return null;
                    return {
                        text: content,
                        author,
                        timestamp,
                        context: text.slice(0, 260),
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        sessionRow: true,
                        unread: true,
                        source: 'wechat-channel-dom-unread-session-row',
                        score: 98,
                    };
                })
                .filter(Boolean)
                .filter((item) => !isNoise(item.text) && !isNoise(item.author));
            for (const item of unreadSessionRows) {
                item[itemKey] = true;
                candidates.push(item);
            }
            const leftBubbles = Array.from(document.querySelectorAll('.bubble-left, [class*="bubble-left"], .content-left .bubble, [class*="content-left"] [class*="bubble"], .content-left, [class*="content-left"]'))
                .filter((node) => !hidden(node))
                .map((node) => {
                    const rect = node.getBoundingClientRect();
                    const text = normalize(node.innerText || node.textContent);
                    if (!text || rect.x < window.innerWidth * 0.42 || rect.width <= 0 || rect.height <= 0) return null;
                    const dialog = node.closest('.session-dialog, [class*="session-dialog"], [class*="dialog"]') || document.body;
                    const header = normalize(dialog.querySelector('.header, [class*="header"]')?.innerText || '');
                    if (header && text === header) return null;
                    return {
                        text,
                        author: header,
                        context: normalize(dialog.innerText || dialog.textContent).slice(0, 260),
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        messageBubble: true,
                        source: 'wechat-channel-dom-left-bubble',
                        score: 96,
                    };
                })
                .filter(Boolean)
                .filter((item) => !isNoise(item.text));
            for (const item of leftBubbles) {
                item[itemKey] = true;
                candidates.push(item);
            }
            const sessionRows = Array.from(document.querySelectorAll('.session-wrap, .scroll-list .session-wrap, [class*="session-wrap"], [class*="SessionWrap"], [class*="session-item"], [class*="SessionItem"], [class*="chat-item"], [class*="ChatItem"]'))
                .filter((node) => !hidden(node))
                .map((node) => {
                    const rect = node.getBoundingClientRect();
                    const text = normalize(node.innerText || node.textContent);
                    const authorNode = node.querySelector('.name, [class*="name"], [class*="Name"], .title, [class*="nick"], [class*="Nick"]');
                    const dateNode = node.querySelector('.date, [class*="date"], [class*="Date"], time, [class*="time"], [class*="Time"]');
                    const contentNode = node.querySelector('.feed-info, [class*="feed-info"], [class*="content"], [class*="Content"], [class*="desc"], [class*="Desc"], [class*="msg"], [class*="Msg"], [class*="last"], [class*="Last"]');
                    const directAuthor = normalize(authorNode?.innerText || authorNode?.textContent || '');
                    const directTimestamp = normalize(dateNode?.innerText || dateNode?.textContent || '');
                    const directContent = normalize(contentNode?.innerText || contentNode?.textContent || '');
                    const match = text.match(/^(.+?)\s+(\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}|今天\s*\d{1,2}:\d{2}|昨天\s*\d{1,2}:\d{2}|\d{1,2}:\d{2})\s+(.+)$/)
                        || text.match(/^(.+?)\s+(.+?)\s+(\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}|今天|昨天|\d+分钟前|\d+小时前)$/);
                    const author = directAuthor || normalize(match?.[1]);
                    const timestamp = directTimestamp || normalize(match?.[2]);
                    const content = directContent || normalize(match?.[3]);
                    if (!author || !content || rect.width <= 0 || rect.height <= 0) return null;
                    return {
                        text: content,
                        author,
                        timestamp: timestamp || '',
                        context: text.slice(0, 260),
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        sessionRow: true,
                        source: 'wechat-channel-dom-session-row',
                        score: 92,
                    };
                })
                .filter(Boolean)
                .filter((item) => !isNoise(item.text) && !isNoise(item.author));
            for (const item of sessionRows) {
                item[itemKey] = true;
                candidates.push(item);
            }
        }
        const nodes = Array.from(document.querySelectorAll('div, span, p, a, li, td, section'));
        for (const node of nodes) {
            if (hidden(node)) continue;
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            if (rect.x < 160) continue;
            const text = normalize(node.innerText || node.textContent);
            if (isNoise(text)) continue;
            const row = node.closest(rowSelectors) || node.parentElement || node;
            const rowText = normalize(row.innerText || row.textContent || '');
            if (!rowLooksUseful(rowText)) continue;
            if (isComment && rowText.includes(text) && !/回复|删除|点赞/.test(rowText) && /\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(rowText)) {
                continue;
            }
            const item = {
                text,
                context: rowText.slice(0, 260),
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            };
            item[itemKey] = true;
            candidates.push(item);
        }
        const seen = new Set();
        const items = [];
        for (const item of candidates.sort((a, b) => {
            const sessionPriority = isComment ? 0 : ((a.sessionRow ? 0 : 1) - (b.sessionRow ? 0 : 1));
            return sessionPriority || (a.y - b.y) || (a.x - b.x);
        })) {
            if (seen.has(item.text)) continue;
            seen.add(item.text);
            items.push(item);
            if (items.length >= limit) break;
        }
        return {
            url: location.href,
            title: document.title,
            totalCandidates: candidates.length,
            items,
            pageTextSample: normalize(document.body.innerText).slice(0, 600),
        };
    }"""


async def _read_wechat_channel_items(account_row, storage_path, target_kind, limit):
    acc_id, acc_type, file_path, user_name, status = account_row
    session, page = await _open_wechat_channel_page(account_row, storage_path, target_kind)
    trace_client, trace = await _start_interaction_network_trace(
        session["context"],
        page,
        patterns=["channels.weixin", "weixin", "finder", "comment", "message", "session"],
    )
    try:
        label = "评论" if target_kind == "comments" else "私信"
        await _ensure_wechat_channel_ready_page(page, label)
        content_frame = await _wechat_channel_content_frame(page, target_kind)
        item_key = "looksLikeComment" if target_kind == "comments" else "looksLikeMessage"
        scan_result = None
        navigation_state = {}
        items = []
        if target_kind == "comments":
            navigation_state = await _select_wechat_channel_comment_work(page)
            await _wait_interaction_network_bodies(trace, timeout_ms=2200)
            scan_result = await content_frame.evaluate(
                _scan_wechat_channel_script(item_key),
                {"limit": limit, "itemKey": item_key},
            )
            items = _merge_wechat_channel_candidates(scan_result.get("items") or [], trace, target_kind, limit)
        else:
            tab_states = []
            for label_name in ["current", "私信", "打招呼消息"]:
                if label_name == "current":
                    tab_state = await _prepare_wechat_channel_message_tab(page)
                else:
                    tab_state = await _click_wechat_channel_message_tab(page, label_name)
                session_state = await _open_wechat_channel_message_session(page)
                await _wait_interaction_network_bodies(trace, timeout_ms=1800)
                content_frame = await _wechat_channel_content_frame(page, target_kind)
                current_scan = await content_frame.evaluate(
                    _scan_wechat_channel_script(item_key),
                    {"limit": limit, "itemKey": item_key},
                )
                current_items = _merge_wechat_channel_candidates(current_scan.get("items") or [], trace, target_kind, limit)
                tab_states.append({
                    **(tab_state or {}),
                    "session": session_state,
                    "usableCount": len(current_items),
                    "totalCandidates": current_scan.get("totalCandidates") or 0,
                })
                scan_result = current_scan
                if current_items:
                    items = current_items
                    navigation_state = {"tabs": tab_states, "selectedTab": label_name}
                    break
            if not navigation_state:
                navigation_state = {"tabs": tab_states, "selectedTab": "none"}
            if scan_result is None:
                scan_result = {"url": page.url, "title": "", "items": [], "totalCandidates": 0, "pageTextSample": ""}
        evidence = await _capture_interaction_screenshot(
            page,
            f"wechat-channel-{target_kind}-read-{acc_id}",
            f"视频号{label}读取截图",
        )
        return {
            "accountId": acc_id,
            "accountName": user_name,
            "platformType": acc_type,
            "platformName": "视频号",
            "url": scan_result.get("url"),
            "title": scan_result.get("title"),
            "comments" if target_kind == "comments" else "messages": items,
            "summary": _interaction_read_summary(max(scan_result.get("totalCandidates") or 0, len(items)), items, label),
            "navigationState": navigation_state,
            "pageTextSample": scan_result.get("pageTextSample") or "",
            "evidence": evidence,
            "readAt": datetime.now().isoformat(),
            **_interaction_runtime_fields(session, trace),
        }
    finally:
        if trace_client:
            try:
                await trace_client.detach()
            except Exception:
                pass


async def _fill_or_send_wechat_channel_reply(account_row, storage_path, target_kind, target_text, reply_text, send):
    acc_id, acc_type, file_path, user_name, status = account_row
    session, page = await _open_wechat_channel_page(account_row, storage_path, target_kind)
    trace_client, trace = await _start_interaction_network_trace(
        session["context"],
        page,
        patterns=["channels.weixin", "weixin", "finder", "comment", "message", "session"],
    )
    try:
        item_label = "评论" if target_kind == "comments" else "私信"
        await _ensure_wechat_channel_ready_page(page, item_label)
        if target_kind == "comments":
            await _select_wechat_channel_comment_work(page, target_text)
        else:
            await _prepare_wechat_channel_message_tab(page, target_text)
            await _open_wechat_channel_message_session(page, target_text)
        content_frame = await _wechat_channel_content_frame(page, target_kind)
        await _wait_interaction_network_bodies(trace, timeout_ms=2500)
        trace_target = _find_wechat_channel_trace_candidate(trace, target_kind, target_text)
        missing_status = "comment_missing" if target_kind == "comments" else "message_missing"
        action_result = await content_frame.evaluate(
            r"""async ({ targetText, replyText, send, missingStatus, traceTarget }) => {
                const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                const normalize = (value) => String(value || '')
                    .replace(/\s+/g, ' ')
                    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                    .trim();
                const visible = (node) => {
                    if (!node || !node.getBoundingClientRect) return false;
                    const rect = node.getBoundingClientRect();
                    const style = window.getComputedStyle(node);
                    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
                };
                const setEditorValue = (editor, value) => {
                    editor.focus();
                    if ('value' in editor) {
                        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')?.set;
                        if (setter) setter.call(editor, value);
                        else editor.value = value;
                        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
                        editor.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        editor.textContent = value;
                        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
                    }
                };
                const editorValue = (editor) => normalize('value' in editor ? editor.value : editor.innerText || editor.textContent);
                const allNodes = Array.from(document.querySelectorAll('div, span, p, li, td'));
                const targetAuthor = normalize(traceTarget?.author || '');
                const isMessageTarget = missingStatus === 'message_missing';
                const normalizedTarget = normalize(targetText);
                const targetVariants = Array.from(new Set([
                    normalizedTarget,
                    normalizedTarget.replace(/\]\[/g, '] ['),
                ].filter(Boolean)));
                const includesTarget = (node) => {
                    const text = normalize(node.innerText || node.textContent);
                    return targetVariants.some((variant) => text.includes(variant));
                };
                let targetNode = null;
                if (isMessageTarget) {
                    const existingBubble = allNodes
                        .filter((node) => visible(node) && includesTarget(node))
                        .sort((a, b) => {
                            const ar = a.getBoundingClientRect();
                            const br = b.getBoundingClientRect();
                            const aBubble = /bubble|content-left|message/i.test(String(a.className || '')) ? 0 : 1;
                            const bBubble = /bubble|content-left|message/i.test(String(b.className || '')) ? 0 : 1;
                            return aBubble - bBubble || (ar.width * ar.height) - (br.width * br.height);
                        })[0];
                    if (existingBubble) {
                        targetNode = existingBubble;
                    }
                }
                if (isMessageTarget && !targetNode) {
                    const sessionRows = Array.from(document.querySelectorAll('.session-wrap, [class*="session"], [class*="Session"]'))
                        .filter((node) => visible(node))
                        .filter((node) => {
                            const text = normalize(node.innerText || node.textContent);
                            const hasTargetText = targetVariants.some((variant) => text.includes(variant));
                            const hasTargetAuthor = targetAuthor && text.includes(targetAuthor);
                            return hasTargetText || (hasTargetAuthor && !/暂无私信|暂无消息/.test(text));
                        })
                        .sort((a, b) => {
                            const ar = a.getBoundingClientRect();
                            const br = b.getBoundingClientRect();
                            const exactPriority = (includesTarget(a) ? 0 : 1) - (includesTarget(b) ? 0 : 1);
                            const classPriority = (String(a.className || '').includes('session-wrap') ? 0 : 1) -
                                (String(b.className || '').includes('session-wrap') ? 0 : 1);
                            return exactPriority || classPriority || (a.contains(b) ? 1 : b.contains(a) ? -1 : 0) || (ar.y - br.y);
                        });
                    targetNode = sessionRows[0] || null;
                }
                if (!targetNode) {
                    targetNode = allNodes
                        .filter((node) => visible(node) && includesTarget(node))
                        .sort((a, b) => {
                            const ar = a.getBoundingClientRect();
                            const br = b.getBoundingClientRect();
                            return (ar.width * ar.height) - (br.width * br.height);
                        })[0];
                }
                if (!targetNode && targetAuthor) {
                    targetNode = allNodes
                        .filter((node) => visible(node) && normalize(node.innerText || node.textContent).includes(targetAuthor))
                        .sort((a, b) => {
                            const ar = a.getBoundingClientRect();
                            const br = b.getBoundingClientRect();
                            return (a.className?.toString?.().includes('comment-item') ? 0 : 1) -
                                (b.className?.toString?.().includes('comment-item') ? 0 : 1) ||
                                (ar.width * ar.height - br.width * br.height);
                        })[0];
                }
                if (!targetNode) {
                    return { status: missingStatus, sent: false, message: '未在当前视频号页面找到目标对象，未操作。' };
                }
                try {
                    targetNode.scrollIntoView({ block: 'center', inline: 'nearest' });
                    targetNode.click();
                } catch {}
                await delay(isMessageTarget ? 1400 : 700);
                const root = isMessageTarget
                    ? document.body
                    : targetNode.closest('.comment-item, tr, li, [class*="comment"], [class*="Comment"], [class*="message"], [class*="Message"], [class*="item"], [class*="Item"]') || document.body;
                if (!isMessageTarget) {
                    const replyTriggers = Array.from(root.querySelectorAll('.action-item, button, [role="button"], span, div'))
                        .filter((node) => visible(node) && normalize(node.innerText || node.textContent) === '回复')
                        .sort((a, b) => {
                            const ar = a.getBoundingClientRect();
                            const br = b.getBoundingClientRect();
                            const actionPriority = (a.className?.toString?.().includes('action-item') ? 0 : 1) -
                                (b.className?.toString?.().includes('action-item') ? 0 : 1);
                            return actionPriority || ((ar.width * ar.height) - (br.width * br.height));
                        });
                    if (replyTriggers.length) {
                        const trigger = replyTriggers[0];
                        trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                        trigger.click();
                        trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        await delay(1000);
                    }
                }
                const findEditor = () => {
                    const selectors = ['textarea.edit_area', 'textarea', '[contenteditable="true"]', 'input[type="text"]', '[role="textbox"]'];
                    for (const selector of selectors) {
                        const nodes = Array.from(document.querySelectorAll(selector)).filter(visible);
                        const scoped = nodes.find((node) => root.contains(node));
                        if (scoped) return scoped;
                        if (nodes.length) return nodes[nodes.length - 1];
                    }
                    return null;
                };
                const editor = findEditor();
                if (!editor) {
                    return { status: 'editor_missing', sent: false, message: '已找到目标对象，但没有找到可编辑回复框。' };
                }
                if (!send) {
                    setEditorValue(editor, replyText);
                    await delay(500);
                    return { status: 'draft_filled', sent: false, message: '视频号回复草稿已填入，未点击发送。', editorTag: editor.tagName };
                }
                const editorRect = editor.getBoundingClientRect();
                return {
                    status: 'editor_found',
                    sent: false,
                    message: '已找到视频号回复框，准备输入并发送。',
                    editorTag: editor.tagName,
                    editorRect: {
                        x: editorRect.x,
                        y: editorRect.y,
                        width: editorRect.width,
                        height: editorRect.height,
                    },
                };
            }""",
            {
                "targetText": target_text,
                "replyText": reply_text,
                "send": bool(send),
                "missingStatus": missing_status,
                "traceTarget": trace_target,
            },
        )

        if send and action_result.get("status") == "editor_found":
            editor_rect = action_result.get("editorRect") or {}
            await page.mouse.click(
                editor_rect.get("x", 0) + min(max(editor_rect.get("width", 1) / 2, 2), 180),
                editor_rect.get("y", 0) + max(editor_rect.get("height", 1) / 2, 1),
            )
            await page.keyboard.press("Meta+A")
            await page.keyboard.press("Backspace")
            await page.keyboard.insert_text(reply_text)
            await page.wait_for_timeout(800)
            action_result = await content_frame.evaluate(
                r"""async ({ replyText, traceTarget }) => {
                const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                const normalize = (value) => String(value || '')
                    .replace(/\s+/g, ' ')
                    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                    .trim();
                const visible = (node) => {
                    if (!node || !node.getBoundingClientRect) return false;
                    const rect = node.getBoundingClientRect();
                    const style = window.getComputedStyle(node);
                    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
                };
                const editorValue = (editor) => normalize('value' in editor ? editor.value : editor.innerText || editor.textContent);
                const editors = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]'))
                    .filter(visible)
                    .map((node) => {
                        const rect = node.getBoundingClientRect();
                        const value = editorValue(node);
                        return { node, rect, value };
                    })
                    .filter((item) => item.value.includes(replyText.slice(0, Math.min(replyText.length, 12))))
                    .sort((a, b) => b.rect.y - a.rect.y);
                const editor = editors[0];
                if (!editor) {
                    return { status: 'editor_missing', sent: false, message: '回复内容没有进入视频号回复框。' };
                }
                const editorRect = editor.rect;
                const isDisabled = (node) => {
                    const aria = String(node.getAttribute('aria-disabled') || '').toLowerCase();
                    return node.disabled || aria === 'true' || /disabled/.test(String(node.className || '').toLowerCase());
                };
                const candidates = Array.from(document.querySelectorAll('button, [role="button"], span, div'))
                    .filter((node) => {
                        if (!visible(node) || isDisabled(node)) return false;
                        const text = normalize(node.innerText || node.textContent);
                        if (!/^(发送|回复|提交|评论)$/.test(text)) return false;
                        const rect = node.getBoundingClientRect();
                        const isRealButton = node.tagName === 'BUTTON' || node.getAttribute('role') === 'button';
                        if (!isRealButton && (rect.width > 180 || rect.height > 64)) return false;
                        return Math.abs(rect.y - editorRect.y) <= 260;
                    })
                    .map((node) => {
                        const rect = node.getBoundingClientRect();
                        const priority = node.tagName === 'BUTTON' ? 0 : node.getAttribute('role') === 'button' ? 1 : node.tagName === 'SPAN' ? 2 : 3;
                        return { node, text: normalize(node.innerText || node.textContent), priority, distance: Math.abs(rect.y - editorRect.y) + Math.abs(rect.x - editorRect.x) };
                    })
                    .sort((a, b) => (a.priority - b.priority) || (a.distance - b.distance));
                if (!candidates.length) {
                    return { status: 'send_failed', sent: false, message: '回复已写入，但没有识别到视频号发送按钮。', editorTag: editor.tagName };
                }
                candidates[0].node.click();
                await delay(2500);
                const editorAttached = document.contains(editor.node);
                const currentEditorValue = editorAttached ? editorValue(editor.node) : '';
                const editorCleared = !editorAttached || currentEditorValue.length === 0;
                const replyPrefix = replyText.slice(0, Math.min(replyText.length, 12));
                const bodyHasReply = normalize(document.body.innerText).includes(replyPrefix);
                const sent = editorCleared || bodyHasReply;
                const createdReply = traceTarget?.text === replyText ? traceTarget.text : (bodyHasReply ? replyText : '');
                return {
                    status: sent ? 'sent' : 'send_failed',
                    sent,
                    message: sent ? '视频号回复已点击发送，已在页面看到回复内容或输入框已清空。' : '已点击发送，但输入框仍保留内容且页面未看到回复，未确认发出。',
                    editorTag: editor.node.tagName,
                    sendButtonText: candidates[0]?.text || '',
                    editorCleared,
                    replyVisible: bodyHasReply,
                    readbackText: createdReply,
                };
            }""",
                {"replyText": reply_text, "traceTarget": trace_target},
            )
        try:
            await reveal_page_window(page)
        except Exception as e:
            print(f"[interaction/wechat-channel/{target_kind}] reveal failed: {e}")
        evidence = await _capture_interaction_screenshot(
            page,
            f"wechat-channel-{target_kind}-{'send' if send else 'draft'}-{acc_id}",
            f"视频号{item_label}{'发送' if send else '草稿'}{'截图' if action_result.get('sent') or action_result.get('status') == 'draft_filled' else '失败截图'}",
        )
        if send and action_result.get("sent"):
            _mark_interaction_sent("wechat-channel", acc_id, target_kind, target_text, reply_text)
        return {
            "accountId": acc_id,
            "accountName": user_name,
            "platformType": acc_type,
            "platformName": "视频号",
            "url": page.url,
            "status": action_result.get("status"),
            "sent": bool(action_result.get("sent")),
            "message": action_result.get("message"),
            "targetText": target_text,
            "replyText": reply_text,
            "editorTag": action_result.get("editorTag"),
            "sendButtonText": action_result.get("sendButtonText"),
            "editorCleared": action_result.get("editorCleared"),
            "replyVisible": action_result.get("replyVisible"),
            "readbackText": action_result.get("readbackText") or (reply_text if action_result.get("replyVisible") else None),
            "evidence": evidence,
            "draftedAt": datetime.now().isoformat(),
            "sentAt": datetime.now().isoformat() if action_result.get("sent") else None,
            **_interaction_runtime_fields(session, trace),
        }
    finally:
        if trace_client:
            try:
                await trace_client.detach()
            except Exception:
                pass


@app.route('/interaction/wechat-channel/comments/read', methods=['POST'])
def read_wechat_channel_comments():
    data = request.get_json() or {}
    account_row, storage_path, error_response = _load_wechat_channel_interaction_account(data.get('accountId'))
    if error_response:
        return error_response
    try:
        limit = max(1, min(int(data.get('limit', 10)), 20))
    except Exception:
        limit = 10
    try:
        result = _run_interaction_async(_read_wechat_channel_items(account_row, storage_path, "comments", limit))
        return jsonify({"code": 200, "msg": None, "data": result}), 200
    except Exception as e:
        if account_row:
            _drop_interaction_context("wechat-channel", account_row[0])
        return jsonify({"code": 500, "msg": f"视频号评论读取失败：{e}", "data": None}), 200


@app.route('/interaction/wechat-channel/messages/read', methods=['POST'])
def read_wechat_channel_messages():
    data = request.get_json() or {}
    account_row, storage_path, error_response = _load_wechat_channel_interaction_account(data.get('accountId'))
    if error_response:
        return error_response
    try:
        limit = max(1, min(int(data.get('limit', 10)), 20))
    except Exception:
        limit = 10
    try:
        result = _run_interaction_async(_read_wechat_channel_items(account_row, storage_path, "messages", limit))
        return jsonify({"code": 200, "msg": None, "data": result}), 200
    except Exception as e:
        if account_row:
            _drop_interaction_context("wechat-channel", account_row[0])
        return jsonify({"code": 500, "msg": f"视频号私信读取失败：{e}", "data": None}), 200


@app.route('/interaction/wechat-channel/comments/draft', methods=['POST'])
def draft_wechat_channel_comment_reply():
    return _handle_wechat_channel_reply_action("comments", False)


@app.route('/interaction/wechat-channel/comments/send', methods=['POST'])
def send_wechat_channel_comment_reply():
    return _handle_wechat_channel_reply_action("comments", True)


@app.route('/interaction/wechat-channel/messages/draft', methods=['POST'])
def draft_wechat_channel_message_reply():
    return _handle_wechat_channel_reply_action("messages", False)


@app.route('/interaction/wechat-channel/messages/send', methods=['POST'])
def send_wechat_channel_message_reply():
    return _handle_wechat_channel_reply_action("messages", True)


def _handle_wechat_channel_reply_action(target_kind, send):
    data = request.get_json() or {}
    target_text = (data.get('targetText') or '').strip()
    reply_text = (data.get('replyText') or '').strip()
    account_row, storage_path, error_response = _load_wechat_channel_interaction_account(data.get('accountId'))
    if error_response:
        return error_response
    if not target_text:
        return jsonify({"code": 400, "msg": "targetText required", "data": None}), 200
    if not reply_text:
        return jsonify({"code": 400, "msg": "replyText required", "data": None}), 200
    label = "评论" if target_kind == "comments" else "私信"
    try:
        result = _run_interaction_async(_fill_or_send_wechat_channel_reply(account_row, storage_path, target_kind, target_text, reply_text, send))
        return jsonify({"code": 200, "msg": None, "data": result}), 200
    except Exception as e:
        if account_row:
            _drop_interaction_context("wechat-channel", account_row[0])
        action = "自动发送" if send else "草稿填入"
        return jsonify({"code": 500, "msg": f"视频号{label}{action}失败：{e}", "data": None}), 200


@app.route('/interaction/douyin/comments/draft', methods=['POST'])
def draft_douyin_comment_reply():
    data = request.get_json() or {}
    account_id = data.get('accountId')
    target_text = (data.get('targetText') or '').strip()
    reply_text = (data.get('replyText') or '').strip()

    if not account_id or not str(account_id).isdigit():
        return jsonify({
            "code": 400,
            "msg": "accountId required",
            "data": None
        }), 200

    if not target_text:
        return jsonify({
            "code": 400,
            "msg": "targetText required",
            "data": None
        }), 200

    if not reply_text:
        return jsonify({
            "code": 400,
            "msg": "replyText required",
            "data": None
        }), 200

    account_id = int(account_id)
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, type, filePath, userName, status FROM user_info WHERE id = ?",
            (account_id,)
        )
        row = cursor.fetchone()

    if not row:
        return jsonify({
            "code": 404,
            "msg": "account not found",
            "data": None
        }), 200

    acc_id, acc_type, file_path, user_name, status = row
    if acc_type != 3:
        return jsonify({
            "code": 400,
            "msg": "account platform mismatch, expected 抖音",
            "data": {
                "accountId": acc_id,
                "accountType": acc_type,
                "expectedType": 3,
            }
        }), 200

    storage_path = Path(BASE_DIR / "cookiesFile" / file_path)
    if not storage_path.exists():
        return jsonify({
            "code": 404,
            "msg": "account cookie file not found",
            "data": None
        }), 200

    async def draft_reply_async():
        session = await _ensure_interaction_context(
            "douyin",
            acc_id,
            storage_path,
            "https://creator.douyin.com/creator-micro/content/manage",
        )
        context = session["context"]
        page = session["page"]
        trace_client, trace = await _start_interaction_network_trace(
            context,
            page,
            patterns=["douyin", "bytedance", "comment", "creator-micro", "aweme"],
        )
        try:
            await _open_douyin_comment_page(page)
            scan_result = await _choose_douyin_comment_work_with_candidates(page, 15, 12, target_text)
            comment_exists = _douyin_comment_scan_has_target(scan_result, target_text)
            if not comment_exists:
                evidence = await _capture_interaction_screenshot(
                    page,
                    f"douyin-comments-draft-missing-{acc_id}",
                    "评论草稿失败截图",
                )
                return {
                    "accountId": acc_id,
                    "accountName": user_name,
                    "platformType": acc_type,
                    "platformName": "抖音",
                    "url": page.url,
                    "status": "comment_missing",
                    "message": "已扫描可见作品评论，但未找到目标评论，未填入草稿。",
                    "targetText": target_text,
                    "replyText": reply_text,
                    "selectedWorkTitle": scan_result.get("selectedWorkTitle"),
                    "selectedWorkIndex": scan_result.get("selectedWorkIndex"),
                    "scannedWorks": scan_result.get("scannedWorks"),
                    "evidence": evidence,
                    "draftedAt": datetime.now().isoformat(),
                    **_interaction_runtime_fields(session, trace),
                }

            draft_result = await page.evaluate(
                r"""({ targetText, replyText }) => {
                    const normalize = (value) => String(value || '')
                        .replace(/\s+/g, ' ')
                        .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                        .trim();
                    const visible = (node) => {
                        const rect = node.getBoundingClientRect();
                        const style = window.getComputedStyle(node);
                        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
                    };
                    const allNodes = Array.from(document.querySelectorAll('div, span, p, li, td'));
                    const commentNode = allNodes.find((node) => visible(node) && normalize(node.innerText || node.textContent).includes(targetText));
                    if (!commentNode) {
                        return { status: 'comment_missing', message: '未找到目标评论节点' };
                    }
                    const root = commentNode.closest('tr, li, [class*="comment"], [class*="Comment"], [class*="item"], [class*="Item"]') || commentNode.parentElement || document.body;
                    const replyTriggers = Array.from(root.querySelectorAll('button, [role="button"], span, div'))
                        .filter((node) => visible(node) && /回复/.test(normalize(node.innerText || node.textContent)));
                    if (replyTriggers.length) {
                        replyTriggers[0].click();
                    }
                    const findEditor = () => {
                        const selectors = [
                            'textarea',
                            '[contenteditable="true"]',
                            'input[type="text"]',
                            '[role="textbox"]'
                        ];
                        for (const selector of selectors) {
                            const nodes = Array.from(document.querySelectorAll(selector)).filter(visible);
                            const scoped = nodes.find((node) => root.contains(node));
                            if (scoped) return scoped;
                            if (nodes.length) return nodes[nodes.length - 1];
                        }
                        return null;
                    };
                    const editor = findEditor();
                    if (!editor) {
                        return { status: 'editor_missing', message: '已找到目标评论，但没有找到可编辑回复框。' };
                    }
                    editor.focus();
                    if ('value' in editor) {
                        editor.value = replyText;
                        editor.dispatchEvent(new Event('input', { bubbles: true }));
                        editor.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        editor.textContent = replyText;
                        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replyText }));
                    }
                    return {
                        status: 'draft_filled',
                        message: '回复草稿已填入，未点击发送。',
                        editorTag: editor.tagName,
                    };
                }""",
                {"targetText": target_text, "replyText": reply_text},
            )
            try:
                await reveal_page_window(page)
            except Exception as e:
                print(f"[interaction/douyin/comments/draft] reveal failed: {e}")
            evidence = await _capture_interaction_screenshot(
                page,
                f"douyin-comments-draft-{acc_id}",
                "评论草稿截图",
            )
            if draft_result.get("status") == "draft_filled":
                _mark_interaction_sent("douyin", acc_id, "comments", target_text, reply_text)
            return {
                "accountId": acc_id,
                "accountName": user_name,
                "platformType": acc_type,
                "platformName": "抖音",
                "url": page.url,
                "status": draft_result.get("status"),
                "message": draft_result.get("message"),
                "targetText": target_text,
                "replyText": reply_text,
                "editorTag": draft_result.get("editorTag"),
                "evidence": evidence,
                "draftedAt": datetime.now().isoformat(),
                **_interaction_runtime_fields(session, trace),
            }
        finally:
            if trace_client:
                try:
                    await trace_client.detach()
                except Exception:
                    pass

    try:
        result = _run_interaction_async(draft_reply_async())
        return jsonify({
            "code": 200,
            "msg": None,
            "data": result
        }), 200
    except Exception as e:
        _drop_interaction_context("douyin", acc_id)
        return jsonify({
            "code": 500,
            "msg": f"抖音回复草稿填入失败：{e}",
            "data": None
        }), 200


async def _fill_and_send_douyin_comment_reply_on_page(page, target_text, reply_text):
    target = await page.evaluate(
        r"""({ targetText }) => {
            const normalize = (value) => String(value || '')
                .replace(/\s+/g, ' ')
                .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                .trim();
            const visible = (node) => {
                if (!node || !node.getBoundingClientRect) return false;
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                    && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
            };
            const scoreRoot = (node) => {
                let current = node;
                const roots = [];
                for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
                    if (!visible(current)) continue;
                    const rect = current.getBoundingClientRect();
                    const text = normalize(current.innerText || current.textContent);
                    const className = String(current.className || '');
                    if (!text.includes(targetText)) continue;
                    if (rect.x < 240 || rect.y < 180 || rect.width < 180 || rect.height < 24) continue;
                    const looksLikeCommentRow =
                        /cmt-item|comment|Comment|item|Item/.test(className) ||
                        (/回复/.test(text) && /删除|举报|\d{1,2}:\d{2}|昨天|今天|分钟前|小时前/.test(text));
                    if (!looksLikeCommentRow) continue;
                    roots.push({
                        node: current,
                        rect,
                        text,
                        score:
                            (className.includes('cmt-item') ? 120 : 0) +
                            (text.includes('回复') ? 30 : 0) +
                            (text.includes('删除') ? 20 : 0) -
                            Math.min(text.length, 600) / 8 -
                            (rect.width * rect.height) / 90000,
                    });
                }
                roots.sort((a, b) => b.score - a.score);
                return roots[0] || null;
            };
            const nodes = Array.from(document.querySelectorAll('div, span, p, li, td'))
                .filter((node) => visible(node) && normalize(node.innerText || node.textContent).includes(targetText))
                .map((node) => {
                    const rect = node.getBoundingClientRect();
                    return { node, rect, text: normalize(node.innerText || node.textContent) };
                })
                .filter((item) => item.rect.x > 240 && item.rect.y > 180)
                .sort((a, b) => (a.text.length - b.text.length) || ((a.rect.width * a.rect.height) - (b.rect.width * b.rect.height)));
            for (const item of nodes) {
                const root = scoreRoot(item.node);
                if (!root) continue;
                const replyNodes = Array.from(root.node.querySelectorAll('button, [role="button"], span, div'))
                    .filter((node) => visible(node) && normalize(node.innerText || node.textContent) === '回复')
                    .map((node) => {
                        const rect = node.getBoundingClientRect();
                        return { node, rect };
                    })
                    .sort((a, b) => b.rect.y - a.rect.y);
                const reply = replyNodes[0];
                if (!reply) continue;
                return {
                    status: 'target_found',
                    targetText: root.text.slice(0, 260),
                    replyRect: {
                        x: reply.rect.x,
                        y: reply.rect.y,
                        width: reply.rect.width,
                        height: reply.rect.height,
                    },
                    rootRect: {
                        x: root.rect.x,
                        y: root.rect.y,
                        width: root.rect.width,
                        height: root.rect.height,
                    },
                };
            }
            return { status: 'comment_missing', message: '未找到目标评论行或评论行回复按钮。' };
        }""",
        {"targetText": target_text},
    )
    if target.get("status") != "target_found":
        return {
            "status": target.get("status") or "comment_missing",
            "sent": False,
            "message": target.get("message") or "未在当前评论管理页找到目标评论，未发送。",
        }

    reply_rect = target.get("replyRect") or {}
    root_rect = target.get("rootRect") or {}
    await page.mouse.click(
        reply_rect.get("x", 0) + max(reply_rect.get("width", 1) / 2, 1),
        reply_rect.get("y", 0) + max(reply_rect.get("height", 1) / 2, 1),
    )
    await page.wait_for_timeout(1500)

    reply_opened = await page.evaluate(
        r"""({ targetText, rootRect }) => {
            const normalize = (value) => String(value || '')
                .replace(/\s+/g, ' ')
                .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                .trim();
            const visible = (node) => {
                if (!node || !node.getBoundingClientRect) return false;
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                    && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
            };
            const isTargetReplyEditor = (node) => {
                if (!visible(node)) return false;
                const rect = node.getBoundingClientRect();
                const placeholder = normalize(node.getAttribute('placeholder'));
                const nearTarget =
                    rect.y >= (rootRect.y - 20) &&
                    rect.y <= (rootRect.y + rootRect.height + 140) &&
                    rect.x >= (rootRect.x - 20);
                return nearTarget && (/^回复/.test(placeholder) || rect.y > rootRect.y);
            };
            const hasTargetEditor = () => Array.from(document.querySelectorAll(
                'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]'
            )).some(isTargetReplyEditor);
            if (hasTargetEditor()) return { opened: true, method: 'mouse' };

            const roots = Array.from(document.querySelectorAll('li, div, section'))
                .filter((node) => visible(node) && normalize(node.innerText || node.textContent).includes(targetText))
                .map((node) => {
                    const rect = node.getBoundingClientRect();
                    return { node, rect, text: normalize(node.innerText || node.textContent) };
                })
                .filter((item) =>
                    item.rect.x >= rootRect.x - 5 &&
                    item.rect.y >= rootRect.y - 5 &&
                    item.rect.y <= rootRect.y + 5 &&
                    item.rect.width >= Math.min(rootRect.width, 180)
                )
                .sort((a, b) => a.text.length - b.text.length);
            const root = roots[0]?.node;
            if (!root) return { opened: false, method: 'mouse', message: '未能重新定位目标评论行。' };

            const reply = Array.from(root.querySelectorAll('button, [role="button"], span, div'))
                .filter((node) => visible(node) && normalize(node.innerText || node.textContent) === '回复')
                .sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y)[0];
            if (!reply) return { opened: false, method: 'mouse', message: '未能重新定位目标评论回复按钮。' };

            for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
                reply.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            }
            return { opened: hasTargetEditor(), method: 'dom-event' };
        }""",
        {"targetText": target_text, "rootRect": root_rect},
    )
    if not reply_opened.get("opened"):
        await page.wait_for_timeout(1000)

    editor = await page.evaluate(
        r"""({ targetText, rootRect }) => {
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const visible = (node) => {
                if (!node || !node.getBoundingClientRect) return false;
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                    && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
            };
            
            // 策略1：在包含目标文本的评论行附近找编辑器
            const allEditors = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]'))
                .filter(visible)
                .map((node) => {
                    const rect = node.getBoundingClientRect();
                    const placeholder = normalize(node.getAttribute('placeholder'));
                    return { node, rect, placeholder };
                })
                .filter((item) => item.rect.width > 50 && item.rect.height > 20);
            
            if (allEditors.length === 0) {
                return { status: 'editor_missing', message: '点击回复后没有找到任何可编辑输入框。' };
            }
            
            // 优先使用目标评论下方出现的行内回复框；抖音有时还会保留顶部评论输入框。
            const rootY = rootRect?.y || 0;
            const rootX = rootRect?.x || 0;
            const rootHeight = rootRect?.height || 0;
            const targetReplyEditors = allEditors
                .filter((item) =>
                    item.rect.y >= rootY - 20 &&
                    item.rect.y <= rootY + rootHeight + 140 &&
                    item.rect.x >= rootX - 20
                )
                .sort((a, b) => {
                    const aReply = /^回复/.test(a.placeholder) ? 0 : 1;
                    const bReply = /^回复/.test(b.placeholder) ? 0 : 1;
                    const aEditable = String(a.node.getAttribute('contenteditable') || '').toLowerCase() === 'true' ? 0 : 1;
                    const bEditable = String(b.node.getAttribute('contenteditable') || '').toLowerCase() === 'true' ? 0 : 1;
                    return (aEditable - bEditable) || (aReply - bReply) || (a.rect.y - b.rect.y);
                });
            if (targetReplyEditors.length > 0) {
                const editor = targetReplyEditors[0];
                editor.node.focus();
                if (typeof editor.node.select === 'function') {
                    editor.node.select();
                }
                return {
                    status: 'editor_found',
                    rect: {
                        x: editor.rect.x,
                        y: editor.rect.y,
                        width: editor.rect.width,
                        height: editor.rect.height,
                    },
                };
            }

            // 如果目标行输入框没有出现，再退回到距离评论行最近的编辑器。
            const sorted = allEditors
                .map((item) => ({
                    ...item,
                    distance: Math.abs(item.rect.y - rootY) + Math.abs(item.rect.x - rootX)
                }))
                .sort((a, b) => a.distance - b.distance);
            
            const editor = sorted[0];
            editor.node.focus();
            if (typeof editor.node.select === 'function') {
                editor.node.select();
            }
            return {
                status: 'editor_found',
                rect: {
                    x: editor.rect.x,
                    y: editor.rect.y,
                    width: editor.rect.width,
                    height: editor.rect.height,
                },
            };
        }""",
        {"targetText": target_text, "rootRect": root_rect},
    )
    if editor.get("status") != "editor_found":
        return {
            "status": editor.get("status") or "editor_missing",
            "sent": False,
            "message": editor.get("message") or "已找到目标评论，但没有找到可编辑回复框。",
        }

    editor_rect = editor.get("rect") or {}
    active_editor = await page.evaluate(
        r"""({ rootRect }) => {
            const visible = (node) => {
                if (!node || !node.getBoundingClientRect) return false;
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                    && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
            };
            const rootY = rootRect?.y || 0;
            const rootX = rootRect?.x || 0;
            const rootHeight = rootRect?.height || 0;
            const editors = Array.from(document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"], [role="textbox"]'))
                .filter(visible)
                .map((node) => {
                    const rect = node.getBoundingClientRect();
                    const inTargetRow =
                        rect.y >= rootY - 20 &&
                        rect.y <= rootY + rootHeight + 140 &&
                        rect.x >= rootX - 20;
                    const editable = String(node.getAttribute('contenteditable') || '').toLowerCase() === 'true';
                    const placeholder = String(node.getAttribute('placeholder') || '');
                    const priority = (inTargetRow ? 0 : 20) + (editable ? 0 : 5) + (/^回复/.test(placeholder) ? 0 : 3);
                    return { node, rect, priority };
                })
                .sort((a, b) => a.priority - b.priority || b.rect.width - a.rect.width);
            const editor = editors[0]?.node;
            if (!editor) return { status: 'editor_missing' };
            editor.focus();
            for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
                editor.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            }
            const rect = editor.getBoundingClientRect();
            return {
                status: 'editor_active',
                tag: editor.tagName,
                contenteditable: editor.getAttribute('contenteditable'),
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
        }""",
        {"rootRect": root_rect},
    )
    active_rect = (active_editor.get("rect") if active_editor.get("status") == "editor_active" else None) or editor_rect
    await page.mouse.click(
        active_rect.get("x", 0) + max(active_rect.get("width", 1) / 2, 1),
        active_rect.get("y", 0) + max(active_rect.get("height", 1) / 2, 1),
    )
    await page.keyboard.press("Meta+A")
    await page.keyboard.press("Backspace")
    await page.keyboard.insert_text(reply_text)
    await page.wait_for_timeout(800)

    await page.evaluate(
        r"""({ replyText, rootRect }) => {
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const visible = (node) => {
                if (!node || !node.getBoundingClientRect) return false;
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                    && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
            };
            const editorValue = (node) => normalize('value' in node ? node.value : node.innerText || node.textContent);
            const replyPrefix = replyText.slice(0, Math.min(replyText.length, 12));
            const rootY = rootRect?.y || 0;
            const rootX = rootRect?.x || 0;
            const rootHeight = rootRect?.height || 0;
            const editors = Array.from(document.querySelectorAll(
                'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]'
            ))
                .filter(visible)
                .map((node) => {
                    const rect = node.getBoundingClientRect();
                    const placeholder = normalize(node.getAttribute('placeholder'));
                    const targetDistance = Math.abs(rect.y - rootY) + Math.abs(rect.x - rootX);
                    const inTargetRow =
                        rect.y >= rootY - 20 &&
                        rect.y <= rootY + rootHeight + 140 &&
                        rect.x >= rootX - 20;
                    const priority =
                        (inTargetRow ? 0 : 20) +
                        (/^回复/.test(placeholder) ? 0 : 5) +
                        (String(node.getAttribute('contenteditable') || '').toLowerCase() === 'true' ? 0 : 2);
                    return { node, rect, priority, targetDistance, value: editorValue(node) };
                })
                .sort((a, b) => a.priority - b.priority || a.targetDistance - b.targetDistance);
            if (editors.some((item) => item.value.includes(replyPrefix))) {
                return { status: 'already_has_text' };
            }
            const editor = editors[0]?.node;
            if (!editor) return { status: 'editor_missing' };

            editor.focus();
            if ('value' in editor) {
                const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value');
                if (descriptor?.set) {
                    descriptor.set.call(editor, replyText);
                } else {
                    editor.value = replyText;
                }
            } else {
                editor.textContent = replyText;
            }
            for (const type of ['input', 'change', 'compositionend']) {
                editor.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
            }
            return { status: 'filled_by_dom' };
        }""",
        {"replyText": reply_text, "rootRect": root_rect},
    )
    await page.wait_for_timeout(500)

    send_button = await page.evaluate(
        r"""({ replyText }) => {
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const visible = (node) => {
                if (!node || !node.getBoundingClientRect) return false;
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                    && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
            };
            const disabled = (node) => {
                const aria = String(node.getAttribute('aria-disabled') || '').toLowerCase();
                return Boolean(node.disabled) || aria === 'true' || /disabled/.test(String(node.className || '').toLowerCase());
            };
            
            // 找所有可见编辑器，优先找包含回复内容的
            const allEditors = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]'))
                .filter(visible)
                .map((node) => {
                    const rect = node.getBoundingClientRect();
                    const value = normalize('value' in node ? node.value : node.innerText || node.textContent);
                    return { node, rect, value };
                })
                .filter((item) => item.rect.width > 50 && item.rect.height > 20);
            
            const replyPrefix = replyText.slice(0, Math.min(replyText.length, 12));
            const editor = allEditors.find((item) => item.value.includes(replyPrefix)) || allEditors[0];
            if (!editor) return { status: 'editor_missing', message: '回复内容没有进入目标回复框。' };
            
            // 在整个页面找"发送"按钮，优先找距离编辑器最近的
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"], span, div'))
                .filter((node) => {
                    if (!visible(node)) return false;
                    const text = normalize(node.innerText || node.textContent);
                    if (!/^(发送|回复|提交)$/.test(text)) return false;
                    const rect = node.getBoundingClientRect();
                    const tag = String(node.tagName || '').toUpperCase();
                    const role = String(node.getAttribute('role') || '').toLowerCase();
                    const isRealButton = tag === 'BUTTON' || role === 'button';
                    return isRealButton || (rect.width <= 90 && rect.height <= 40);
                })
                .map((node) => {
                    const rect = node.getBoundingClientRect();
                    const tag = String(node.tagName || '').toUpperCase();
                    const role = String(node.getAttribute('role') || '').toLowerCase();
                    return {
                        node,
                        rect,
                        text: normalize(node.innerText || node.textContent),
                        priority: tag === 'BUTTON' ? 0 : role === 'button' ? 1 : 2,
                        isDisabled: disabled(node),
                        distance: Math.abs(rect.y - editor.rect.y) + Math.abs(rect.x - editor.rect.x),
                    };
                })
                .filter((item) => item.rect.width > 20 && item.rect.height > 15)
                .sort((a, b) => a.priority - b.priority || a.distance - b.distance);
            
            const button = allButtons[0];
            if (!button) return { status: 'send_button_missing', message: '回复已输入，但没有找到发送按钮。' };
            return {
                status: button.isDisabled ? 'send_button_disabled' : 'send_button_ready',
                message: button.isDisabled ? '回复已输入，但发送按钮仍是禁用态。' : '回复已输入，发送按钮可点击。',
                editorValue: editor.value,
                rect: {
                    x: button.rect.x,
                    y: button.rect.y,
                    width: button.rect.width,
                    height: button.rect.height,
                },
            };
        }""",
        {"replyText": reply_text},
    )
    if send_button.get("status") != "send_button_ready":
        return {
            "status": send_button.get("status") or "send_failed",
            "sent": False,
            "message": send_button.get("message") or "回复已输入，但发送按钮不可用。",
            "editorTag": "TEXTAREA",
        }

    button_rect = send_button.get("rect") or {}
    # 点击发送按钮中心位置，而不是左边缘
    button_x = button_rect.get("x", 0) + max(button_rect.get("width", 1) / 2, 1)
    button_y = button_rect.get("y", 0) + max(button_rect.get("height", 1) / 2, 1)
    
    # 点击前先短暂等待，确保按钮完全渲染
    await page.wait_for_timeout(300)
    
    # 使用更可靠的点击方式：先移动鼠标到按钮位置，再点击
    await page.mouse.move(button_x, button_y)
    await page.wait_for_timeout(100)
    await page.mouse.click(button_x, button_y)
    
    # 点击后等待一段时间让页面响应
    await page.wait_for_timeout(500)
    verify = await page.evaluate(
        r"""async ({ targetText, replyText }) => {
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const visible = (node) => {
                if (!node || !node.getBoundingClientRect) return false;
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                    && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
            };
            const replyPrefix = replyText.slice(0, Math.min(replyText.length, 12));
            const readState = () => {
                const bodyText = normalize(document.body.innerText);
                const visibleEditors = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]'))
                    .filter(visible)
                    .map((node) => normalize('value' in node ? node.value : node.innerText || node.textContent));
                const rows = Array.from(document.querySelectorAll('[class*="cmt-item"], [class*="comment"], [class*="Comment"], [class*="item"], [class*="Item"], li, tr, section, div'))
                    .filter((node) => visible(node) && normalize(node.innerText || node.textContent).includes(targetText));
                const editors = rows.flatMap((row) => Array.from(row.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]')))
                    .filter(visible)
                    .map((node) => normalize('value' in node ? node.value : node.innerText || node.textContent));
                const replyStillInEditor = editors.some((value) => value.includes(replyPrefix));
                const visibleEditorHasReply = visibleEditors.some((value) => value.includes(replyPrefix));
                const bodyHasReply = bodyText.includes(replyPrefix);
                const bodyOnlyReplyVisible = bodyHasReply && !visibleEditorHasReply;
                const identityVerificationRequired =
                    bodyText.includes('身份验证') &&
                    (bodyText.includes('接收短信验证') || bodyText.includes('扫码验证') || bodyText.includes('保障账号安全'));
                // 检查编辑器是否完全消失（发送成功后编辑器通常会关闭）
                const editorGone = editors.length === 0;
                return { replyStillInEditor, bodyHasReply, bodyOnlyReplyVisible, editorGone, editors, identityVerificationRequired };
            };
            let state = readState();
            for (let i = 0; i < 10; i += 1) {
                if (state.identityVerificationRequired) return state;
                // 成功条件：回复不在编辑器中 且 (页面有回复内容 或 编辑器已消失)
                if (state.bodyOnlyReplyVisible || (!state.replyStillInEditor && (state.bodyHasReply || state.editorGone))) return state;
                await delay(600);
                state = readState();
            }
            return state;
        }""",
        {"targetText": target_text, "replyText": reply_text},
    )
    # 成功条件：回复不在编辑器中 且 (页面有回复内容 或 编辑器已消失)
    sent = bool(verify.get("bodyOnlyReplyVisible")) or (
        (not verify.get("replyStillInEditor")) and (bool(verify.get("bodyHasReply")) or bool(verify.get("editorGone")))
    )
    if verify.get("identityVerificationRequired"):
        return {
            "status": "identity_verification_required",
            "sent": False,
            "message": "已点击发送按钮，但抖音弹出身份验证，需要完成短信或扫码验证后才能继续发送。",
            "editorTag": "TEXTAREA",
            "selected": {"text": target_text},
            "sendButtonText": "发送",
            "editorCleared": not verify.get("replyStillInEditor"),
            "replyVisible": bool(verify.get("bodyHasReply")),
            "editorGone": bool(verify.get("editorGone")),
        }
    return {
        "status": "sent" if sent else "send_failed",
        "sent": sent,
        "message": "评论回复已点击发送，并已在抖音页面看到回复内容。" if sent else "已点击发送按钮，但抖音页面未看到回复内容或编辑器未关闭，未确认真实发出。",
        "editorTag": "TEXTAREA",
        "selected": {"text": target_text},
        "sendButtonText": "发送",
        "editorCleared": not verify.get("replyStillInEditor"),
        "replyVisible": bool(verify.get("bodyHasReply")),
        "editorGone": bool(verify.get("editorGone")),
        "readbackText": reply_text if verify.get("bodyHasReply") else None,
    }


@app.route('/interaction/douyin/comments/send', methods=['POST'])
def send_douyin_comment_reply():
    data = request.get_json() or {}
    target_text = (data.get('targetText') or '').strip()
    reply_text = (data.get('replyText') or '').strip()
    parsing_rules = data.get('parsingRules') or data.get('replyRule') or None
    account_row, storage_path, error_response = _load_douyin_interaction_account(data.get('accountId'))
    if error_response:
        return error_response
    if not target_text:
        return jsonify({"code": 400, "msg": "targetText required", "data": None}), 200
    if not reply_text:
        return jsonify({"code": 400, "msg": "replyText required", "data": None}), 200

    acc_id, acc_type, file_path, user_name, status = account_row

    async def send_reply_async():
        session = await _ensure_interaction_context(
            "douyin",
            acc_id,
            storage_path,
            "https://creator.douyin.com/creator-micro/content/manage",
        )
        context = session["context"]
        page = session["page"]
        trace_client, trace = await _start_interaction_network_trace(
            context,
            page,
            patterns=["douyin", "bytedance", "comment", "creator-micro", "aweme"],
        )
        try:
            await _open_douyin_comment_page(page)
            scan_result = await _choose_douyin_comment_work_with_candidates(page, 15, 12, target_text, parsing_rules)
            if not _douyin_comment_scan_has_target(scan_result, target_text):
                print(f"[interaction/douyin/comments/send] target not in scanned works, stop sending target={target_text}")
                evidence = await _capture_interaction_screenshot(
                    page,
                    f"douyin-comments-send-missing-{acc_id}",
                    "评论发送目标缺失截图",
                )
                return {
                    "accountId": acc_id,
                    "accountName": user_name,
                    "platformType": acc_type,
                    "platformName": "抖音",
                    "url": page.url,
                    "status": "comment_missing",
                    "sent": False,
                    "message": "已扫描可见作品评论，但未找到目标评论，未发送。",
                    "targetText": target_text,
                    "replyText": reply_text,
                    "selectedWorkTitle": scan_result.get("selectedWorkTitle"),
                    "selectedWorkIndex": scan_result.get("selectedWorkIndex"),
                    "scannedWorks": scan_result.get("scannedWorks"),
                    "evidence": evidence,
                    "draftedAt": datetime.now().isoformat(),
                    "sentAt": None,
                    **_interaction_runtime_fields(session, trace),
                }

            send_result = await _fill_and_send_douyin_comment_reply_on_page(page, target_text, reply_text)
            try:
                await reveal_page_window(page)
            except Exception as e:
                print(f"[interaction/douyin/comments/send] reveal failed: {e}")
            evidence = await _capture_interaction_screenshot(
                page,
                f"douyin-comments-send-{acc_id}",
                "评论发送截图" if send_result.get("sent") else "评论发送失败截图",
            )
            if send_result.get("sent"):
                _mark_interaction_sent("douyin", acc_id, "comments", target_text, reply_text)
            return {
                "accountId": acc_id,
                "accountName": user_name,
                "platformType": acc_type,
                "platformName": "抖音",
                "url": page.url,
                "status": send_result.get("status"),
                "sent": bool(send_result.get("sent")),
                "message": send_result.get("message"),
                "targetText": target_text,
                "replyText": reply_text,
                "editorTag": send_result.get("editorTag"),
                "sendButtonText": send_result.get("sendButtonText"),
                "editorCleared": send_result.get("editorCleared"),
                "replyVisible": send_result.get("replyVisible"),
                "readbackText": send_result.get("readbackText") or (reply_text if send_result.get("replyVisible") else None),
                "evidence": evidence,
                "draftedAt": datetime.now().isoformat(),
                "sentAt": datetime.now().isoformat() if send_result.get("sent") else None,
                **_interaction_runtime_fields(session, trace),
            }
        finally:
            if trace_client:
                try:
                    await trace_client.detach()
                except Exception:
                    pass

    try:
        result = _run_interaction_async(send_reply_async())
        return jsonify({"code": 200, "msg": None, "data": result}), 200
    except Exception as e:
        _drop_interaction_context("douyin", acc_id)
        return jsonify({
            "code": 500,
            "msg": f"抖音评论自动发送失败：{e}",
            "data": None
        }), 200


@app.route('/interaction/douyin/messages/draft', methods=['POST'])
def draft_douyin_message_reply():
    data = request.get_json() or {}
    account_id = data.get('accountId')
    target_text = (data.get('targetText') or '').strip()
    reply_text = (data.get('replyText') or '').strip()

    if not account_id or not str(account_id).isdigit():
        return jsonify({
            "code": 400,
            "msg": "accountId required",
            "data": None
        }), 200

    if not target_text:
        return jsonify({
            "code": 400,
            "msg": "targetText required",
            "data": None
        }), 200

    if not reply_text:
        return jsonify({
            "code": 400,
            "msg": "replyText required",
            "data": None
        }), 200

    account_id = int(account_id)
    with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, type, filePath, userName, status FROM user_info WHERE id = ?",
            (account_id,)
        )
        row = cursor.fetchone()

    if not row:
        return jsonify({
            "code": 404,
            "msg": "account not found",
            "data": None
        }), 200

    acc_id, acc_type, file_path, user_name, status = row
    if acc_type != 3:
        return jsonify({
            "code": 400,
            "msg": "account platform mismatch, expected 抖音",
            "data": {
                "accountId": acc_id,
                "accountType": acc_type,
                "expectedType": 3,
            }
        }), 200

    storage_path = Path(BASE_DIR / "cookiesFile" / file_path)
    if not storage_path.exists():
        return jsonify({
            "code": 404,
            "msg": "account cookie file not found",
            "data": None
        }), 200

    async def draft_message_async():
        session = await _ensure_interaction_context(
            "douyin",
            acc_id,
            storage_path,
            "https://creator.douyin.com/creator-micro/data/following/chat",
        )
        context = session["context"]
        page = session["page"]
        trace_client, trace = await _start_interaction_network_trace(
            context,
            page,
            patterns=["douyin", "bytedance", "snssdk", "im", "message", "chat", "conversation"],
        )
        route_capture = None
        try:
            route_capture = await _install_douyin_im_route_capture(context, trace)
            await _install_douyin_im_window_capture(page)
            await _open_douyin_message_page(page)
            scan_result = await _scan_douyin_message_tabs(page, 10, target_text)
            await _collect_douyin_im_window_capture(page, trace, 10)
            load_blocked = await _douyin_message_page_blocked_summary(page, scan_result)
            if load_blocked:
                try:
                    await reveal_page_window(page)
                except Exception as e:
                    print(f"[interaction/douyin/messages/draft] reveal failed: {e}")
                evidence = await _capture_interaction_screenshot(
                    page,
                    f"douyin-messages-draft-loading-{acc_id}",
                    "私信页面加载阻断截图",
                )
                return {
                    "accountId": acc_id,
                    "accountName": user_name,
                    "platformType": acc_type,
                    "platformName": "抖音",
                    "url": page.url,
                    "status": "message_missing",
                    "message": load_blocked.get("emptyReason"),
                    "targetText": target_text,
                    "replyText": reply_text,
                    "editorTag": None,
                    "nextAction": load_blocked.get("nextAction"),
                    "summary": load_blocked,
                    "evidence": evidence,
                    "draftedAt": datetime.now().isoformat(),
                    **_interaction_runtime_fields(session, trace),
                }

            draft_result = await page.evaluate(
                """({ targetText, targetVariants = [], replyText }) => {
                    const normalize = (value) => String(value || '')
                        .replace(/\\s+/g, ' ')
                        .replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '')
                        .trim();
                    const visible = (node) => {
                        const rect = node.getBoundingClientRect();
                        const style = window.getComputedStyle(node);
                        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
                    };
                    const targetCandidates = Array.from(new Set([targetText, ...targetVariants].map(normalize).filter(Boolean)));
                    const textMatchesTarget = (text) => {
                        const normalized = normalize(text);
                        return targetCandidates.some((target) => normalized.includes(target) || target.includes(normalized));
                    };
                    const allNodes = Array.from(document.querySelectorAll('div, span, p, li, td'));
                    const messageNode = allNodes.find((node) => visible(node) && textMatchesTarget(node.innerText || node.textContent));
                    if (!messageNode) {
                        return { status: 'message_missing', message: '未在当前私信页找到目标私信，未填入草稿。' };
                    }
                    try {
                        messageNode.scrollIntoView({ block: 'center', inline: 'nearest' });
                        messageNode.click();
                    } catch {}
                    const root = messageNode.closest('main, section, [class*="chat"], [class*="Chat"], [class*="message"], [class*="Message"]') || document.body;
                    const findEditor = () => {
                        const selectors = [
                            'textarea',
                            '[contenteditable="true"]',
                            'input[type="text"]',
                            '[role="textbox"]'
                        ];
                        for (const selector of selectors) {
                            const nodes = Array.from(document.querySelectorAll(selector)).filter(visible);
                            const scoped = nodes.find((node) => root.contains(node));
                            if (scoped) return scoped;
                            if (nodes.length) return nodes[nodes.length - 1];
                        }
                        return null;
                    };
                    const editor = findEditor();
                    if (!editor) {
                        return { status: 'editor_missing', message: '已找到目标私信，但没有找到可编辑回复框。' };
                    }
                    editor.focus();
                    if ('value' in editor) {
                        editor.value = replyText;
                        editor.dispatchEvent(new Event('input', { bubbles: true }));
                        editor.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        editor.textContent = replyText;
                        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replyText }));
                    }
                    return {
                        status: 'draft_filled',
                        message: '私信回复草稿已填入，未点击发送。',
                        editorTag: editor.tagName,
                    };
                }""",
                {"targetText": target_text, "targetVariants": _interaction_text_variants(target_text), "replyText": reply_text},
            )
            try:
                await reveal_page_window(page)
            except Exception as e:
                print(f"[interaction/douyin/messages/draft] reveal failed: {e}")
            evidence = await _capture_interaction_screenshot(
                page,
                f"douyin-messages-draft-{acc_id}",
                "私信草稿截图",
            )
            return {
                "accountId": acc_id,
                "accountName": user_name,
                "platformType": acc_type,
                "platformName": "抖音",
                "url": page.url,
                "status": draft_result.get("status"),
                "message": draft_result.get("message"),
                "targetText": target_text,
                "replyText": reply_text,
                "editorTag": draft_result.get("editorTag"),
                "evidence": evidence,
                "draftedAt": datetime.now().isoformat(),
                **_interaction_runtime_fields(session, trace),
            }
        finally:
            await _detach_douyin_im_route_capture(context, route_capture)
            if trace_client:
                try:
                    await trace_client.detach()
                except Exception:
                    pass

    try:
        result = _run_interaction_async(draft_message_async())
        return jsonify({
            "code": 200,
            "msg": None,
            "data": result
        }), 200
    except Exception as e:
        _drop_interaction_context("douyin", acc_id)
        return jsonify({
            "code": 500,
            "msg": f"抖音私信草稿填入失败：{e}",
            "data": None
        }), 200


@app.route('/interaction/douyin/messages/send', methods=['POST'])
def send_douyin_message_reply():
    data = request.get_json() or {}
    target_text = (data.get('targetText') or '').strip()
    reply_text = (data.get('replyText') or '').strip()
    account_row, storage_path, error_response = _load_douyin_interaction_account(data.get('accountId'))
    if error_response:
        return error_response
    if not target_text:
        return jsonify({"code": 400, "msg": "targetText required", "data": None}), 200
    if not reply_text:
        return jsonify({"code": 400, "msg": "replyText required", "data": None}), 200

    acc_id, acc_type, file_path, user_name, status = account_row

    async def send_message_async():
        session = await _ensure_interaction_context(
            "douyin",
            acc_id,
            storage_path,
            "https://creator.douyin.com/creator-micro/data/following/chat",
        )
        context = session["context"]
        page = session["page"]
        trace_client, trace = await _start_interaction_network_trace(
            context,
            page,
            patterns=["douyin", "bytedance", "snssdk", "im", "message", "chat", "conversation"],
        )
        route_capture = None
        try:
            route_capture = await _install_douyin_im_route_capture(context, trace)
            await _install_douyin_im_window_capture(page)
            await _open_douyin_message_page(page)
            scan_result = await _scan_douyin_message_tabs(page, 10, target_text)
            await _collect_douyin_im_window_capture(page, trace, 10)
            load_blocked = _douyin_message_load_blocked_summary(scan_result)
            if load_blocked and not (scan_result.get("messages") or []):
                try:
                    await reveal_page_window(page)
                except Exception as e:
                    print(f"[interaction/douyin/messages/send] reveal failed: {e}")
                evidence = await _capture_interaction_screenshot(
                    page,
                    f"douyin-messages-send-loading-{acc_id}",
                    "私信页面加载阻断截图",
                )
                return {
                    "accountId": acc_id,
                    "accountName": user_name,
                    "platformType": acc_type,
                    "platformName": "抖音",
                    "url": page.url,
                    "status": "message_missing",
                    "sent": False,
                    "message": load_blocked.get("emptyReason"),
                    "targetText": target_text,
                    "replyText": reply_text,
                    "editorTag": None,
                    "sendButtonText": None,
                    "editorCleared": False,
                    "replyVisible": False,
                    "nextAction": load_blocked.get("nextAction"),
                    "summary": load_blocked,
                    "evidence": evidence,
                    "draftedAt": datetime.now().isoformat(),
                    "sentAt": None,
                    **_interaction_runtime_fields(session, trace),
                }

            send_result = await page.evaluate(
                r"""async ({ targetText, targetVariants = [], replyText }) => {
                    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                    const normalize = (value) => String(value || '')
                        .replace(/\s+/g, ' ')
                        .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                        .trim();
                    const visible = (node) => {
                        if (!node || !node.getBoundingClientRect) return false;
                        const rect = node.getBoundingClientRect();
                        const style = window.getComputedStyle(node);
                        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
                    };
                    const targetCandidates = Array.from(new Set([targetText, ...targetVariants].map(normalize).filter(Boolean)));
                    const textMatchesTarget = (text) => {
                        const normalized = normalize(text);
                        return targetCandidates.some((target) => normalized.includes(target) || target.includes(normalized));
                    };
                    const rowSelectors = '[role="gridcell"], [role="row"], [role="listitem"], li, tr, [class*="chat"], [class*="Chat"], [class*="message"], [class*="Message"], [class*="conversation"], [class*="Conversation"], [class*="item"], [class*="Item"]';
                    const rowLooksUnreplyable = (text) =>
                        /你收到一条新类型消息|请打开抖音\s*app\s*查看|分享\[视频\]|\[视频\]|\[图片\]|该消息类型暂不支持|当前版本暂不支持/.test(text);
                    const rowLooksTooBroad = (text) =>
                        /全部|朋友私信|陌生人私信|群消息|全选/.test(text) && text.length > 260;
                    const rectPayload = (node) => {
                        const rect = node.getBoundingClientRect();
                        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                    };
                    const scoreClickTarget = (node, sourceNode) => {
                        const rect = node.getBoundingClientRect();
                        const text = normalize(node.innerText || node.textContent);
                        const className = String(node.className || '');
                        let score = 0;
                        if (node === sourceNode) score += 4;
                        if (node.matches(rowSelectors)) score += 20;
                        if (/(chat|message|conversation|session|item|list)/i.test(className)) score += 14;
                        if (rect.width >= 260) score += 24;
                        if (rect.height >= 44 && rect.height <= 150) score += 42;
                        if (rect.x >= 220 && rect.y >= 100) score += 10;
                        if (/刚刚|今天|昨天|星期[一二三四五六日天]|\d{1,2}:\d{2}|\d+分钟前|\d+小时前/.test(text)) score += 8;
                        if (text.length > 260) score -= 26;
                        if (rect.height > 260) score -= 38;
                        if (rowLooksTooBroad(text)) score -= 60;
                        return score;
                    };
                    const allNodes = Array.from(document.querySelectorAll(rowSelectors + ', div, span, p, td'));
                    const targetNodes = allNodes.filter((node) => visible(node) && textMatchesTarget(node.innerText || node.textContent));
                    const scoredTargets = [];
                    const seenTargets = new Set();
                    for (const sourceNode of targetNodes) {
                        let node = sourceNode;
                        for (let depth = 0; node && node !== document.body && depth < 9; depth += 1, node = node.parentElement) {
                            if (!visible(node)) continue;
                            const text = normalize(node.innerText || node.textContent);
                            if (!textMatchesTarget(text)) continue;
                            const rect = node.getBoundingClientRect();
                            if (rect.width <= 0 || rect.height <= 0) continue;
                            const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${text.slice(0, 40)}`;
                            if (seenTargets.has(key)) continue;
                            seenTargets.add(key);
                            scoredTargets.push({
                                node,
                                text,
                                score: scoreClickTarget(node, sourceNode),
                                rect: rectPayload(node),
                            });
                        }
                    }
                    scoredTargets.sort((a, b) =>
                        b.score - a.score ||
                        (Math.abs(a.rect.height - 72) - Math.abs(b.rect.height - 72)) ||
                        (a.rect.y - b.rect.y)
                    );
                    const bestTarget = scoredTargets[0];
                    const messageNode = bestTarget?.node;
                    if (!messageNode) {
                        return { status: 'message_missing', sent: false, message: '未在当前私信页找到目标私信，未发送。' };
                    }
                    const rowText = bestTarget.text || normalize(messageNode.innerText || messageNode.textContent);
                    if (rowLooksUnreplyable(rowText)) {
                        return { status: 'message_unreplyable', sent: false, message: '目标私信是抖音当前网页不可回复的消息类型，未发送。', selected: { text: targetText, context: rowText.slice(0, 180) } };
                    }
                    let clickRect = bestTarget.rect;
                    try {
                        messageNode.scrollIntoView({ block: 'center', inline: 'nearest' });
                        await delay(350);
                        const rect = messageNode.getBoundingClientRect();
                        clickRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                        const x = rect.x + Math.min(Math.max(rect.width / 2, 30), 220);
                        const y = rect.y + rect.height / 2;
                        const eventTarget = document.elementFromPoint(x, y) || messageNode;
                        eventTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
                        eventTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
                        eventTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
                        eventTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
                    } catch {}
                    await delay(2200);
                    const root = messageNode.closest('main, section, [class*="chat"], [class*="Chat"], [class*="message"], [class*="Message"]') || document.body;
                    const findEditor = () => {
                        const selectors = ['textarea', '[contenteditable="true"]', 'input[type="text"]', '[role="textbox"]'];
                        for (const selector of selectors) {
                            const nodes = Array.from(document.querySelectorAll(selector)).filter(visible);
                            const scoped = nodes.find((node) => root.contains(node));
                            if (scoped) return scoped;
                            if (nodes.length) return nodes[nodes.length - 1];
                        }
                        return null;
                    };
                    const editor = findEditor();
                    if (!editor) {
                        return {
                            status: 'editor_missing',
                            sent: false,
                            message: '已找到目标私信，但当前抖音网页入口没有打开可编辑回复框，未发送。',
                            selected: { text: targetText, context: rowText.slice(0, 180) },
                            targetClickRect: clickRect,
                            pageTextSample: normalize(document.body.innerText).slice(0, 500),
                        };
                    }
                    const editorRect = editor.getBoundingClientRect();
                    editor.scrollIntoView({ block: 'center', inline: 'nearest' });
                    editor.focus();
                    return {
                        status: 'editor_ready',
                        sent: false,
                        message: '已打开目标私信输入框，准备键盘输入回复。',
                        editorTag: editor.tagName,
                        selected: { text: targetText, context: rowText.slice(0, 180) },
                        targetClickRect: clickRect,
                        editorRect: {
                            x: editorRect.x,
                            y: editorRect.y,
                            width: editorRect.width,
                            height: editorRect.height,
                        },
                    };
                }""",
                {"targetText": target_text, "targetVariants": _interaction_text_variants(target_text), "replyText": reply_text},
            )
            if send_result.get("status") == "editor_missing" and send_result.get("targetClickRect"):
                target_rect = send_result.get("targetClickRect") or {}
                target_x = target_rect.get("x", 0) + min(max(target_rect.get("width", 1) / 2, 40), 220)
                target_y = target_rect.get("y", 0) + max(target_rect.get("height", 1) / 2, 1)
                await page.mouse.click(target_x, target_y)
                await page.wait_for_timeout(2600)
                retry_editor = await page.evaluate(
                    r"""() => {
                        const normalize = (value) => String(value || '')
                            .replace(/\s+/g, ' ')
                            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                            .trim();
                        const visible = (node) => {
                            if (!node || !node.getBoundingClientRect) return false;
                            const rect = node.getBoundingClientRect();
                            const style = window.getComputedStyle(node);
                            return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                                && style.visibility !== 'hidden' && Number(style.opacity) !== 0
                                && style.pointerEvents !== 'none';
                        };
                        const nodes = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]'))
                            .filter(visible)
                            .map((node) => {
                                const rect = node.getBoundingClientRect();
                                const value = normalize('value' in node ? node.value : node.innerText || node.textContent);
                                return {
                                    tag: node.tagName,
                                    value,
                                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                                };
                            })
                            .sort((a, b) => b.rect.y - a.rect.y);
                        const editor = nodes[0];
                        if (!editor) {
                            return {
                                status: 'editor_missing',
                                message: '真实点击目标会话后仍未打开抖音私信输入框。',
                                pageTextSample: normalize(document.body.innerText).slice(0, 500),
                            };
                        }
                        return {
                            status: 'editor_ready',
                            message: '真实点击目标会话后已打开抖音私信输入框。',
                            editorTag: editor.tag,
                            editorRect: editor.rect,
                        };
                    }""",
                )
                send_result = {**send_result, **retry_editor}
            if send_result.get("status") == "editor_ready" and send_result.get("editorRect"):
                editor_rect = send_result.get("editorRect") or {}
                editor_x = editor_rect.get("x", 0) + min(max(editor_rect.get("width", 1) / 2, 2), 160)
                editor_y = editor_rect.get("y", 0) + max(editor_rect.get("height", 1) / 2, 1)
                await page.mouse.click(editor_x, editor_y)
                await page.keyboard.press("Meta+A")
                await page.keyboard.press("Backspace")
                await page.keyboard.insert_text(reply_text)
                await page.wait_for_timeout(900)
                send_button = await page.evaluate(
                    r"""({ replyText }) => {
                        const normalize = (value) => String(value || '')
                            .replace(/\s+/g, ' ')
                            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                            .trim();
                        const visible = (node) => {
                            if (!node || !node.getBoundingClientRect) return false;
                            const rect = node.getBoundingClientRect();
                            const style = window.getComputedStyle(node);
                            return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                                && style.visibility !== 'hidden' && Number(style.opacity) !== 0
                                && style.pointerEvents !== 'none';
                        };
                        const editorValue = (editor) => normalize('value' in editor ? editor.value : editor.innerText || editor.textContent);
                        const isDisabled = (node) => {
                            const aria = String(node.getAttribute('aria-disabled') || '').toLowerCase();
                            return Boolean(node.disabled) || aria === 'true' || /disabled/.test(String(node.className || '').toLowerCase());
                        };
                        const replyPrefix = replyText.slice(0, Math.min(replyText.length, 12));
                        const editors = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]'))
                            .filter(visible)
                            .map((node) => {
                                const rect = node.getBoundingClientRect();
                                const value = editorValue(node);
                                return { node, rect, value };
                            })
                            .sort((a, b) => {
                                const aHasReply = a.value.includes(replyPrefix) ? 0 : 1;
                                const bHasReply = b.value.includes(replyPrefix) ? 0 : 1;
                                return aHasReply - bHasReply || b.rect.y - a.rect.y;
                            });
                        const editor = editors[0];
                        if (!editor || !editor.value.includes(replyPrefix)) {
                            return {
                                status: 'editor_input_failed',
                                sent: false,
                                message: '回复没有真实进入抖音私信输入框，未发送。',
                                editorValue: editor?.value || '',
                            };
                        }
                        const candidates = Array.from(document.querySelectorAll('button, [role="button"], span, div'))
                            .filter((node) => {
                                if (!visible(node) || isDisabled(node)) return false;
                                const text = normalize(node.innerText || node.textContent);
                                if (!/^(发送|回复|提交)$/.test(text)) return false;
                                const rect = node.getBoundingClientRect();
                                const tag = String(node.tagName || '').toUpperCase();
                                const role = String(node.getAttribute('role') || '').toLowerCase();
                                const isRealButton = tag === 'BUTTON' || role === 'button';
                                if (!isRealButton && (rect.width > 180 || rect.height > 64)) return false;
                                return Math.abs(rect.y - editor.rect.y) <= 260 || rect.y > editor.rect.y - 80;
                            })
                            .map((node) => {
                                const rect = node.getBoundingClientRect();
                                const text = normalize(node.innerText || node.textContent);
                                const tag = String(node.tagName || '').toUpperCase();
                                const role = String(node.getAttribute('role') || '').toLowerCase();
                                const priority =
                                    tag === 'BUTTON' ? 0 :
                                    role === 'button' ? 1 :
                                    tag === 'SPAN' ? 2 :
                                    3;
                                const distance = Math.abs(rect.y - editor.rect.y) + Math.abs(rect.x - editor.rect.x);
                                return {
                                    text,
                                    tag,
                                    priority,
                                    distance,
                                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                                };
                            })
                            .sort((a, b) => a.priority - b.priority || a.distance - b.distance);
                        const button = candidates[0];
                        if (!button) {
                            return {
                                status: 'send_button_missing',
                                sent: false,
                                message: '回复已输入，但没有找到抖音私信发送按钮。',
                                editorValue: editor.value,
                            };
                        }
                        return {
                            status: 'ready_to_click_send',
                            sent: false,
                            message: '回复已通过键盘输入，发送按钮可点击。',
                            editorTag: editor.node.tagName,
                            sendButtonText: button.text,
                            sendButtonRect: button.rect,
                            editorValue: editor.value,
                        };
                    }""",
                    {"replyText": reply_text},
                )
                send_result = {**send_result, **send_button}
            if send_result.get("status") == "ready_to_click_send" and send_result.get("sendButtonRect"):
                button_rect = send_result.get("sendButtonRect") or {}
                button_x = button_rect.get("x", 0) + max(button_rect.get("width", 1) / 2, 1)
                button_y = button_rect.get("y", 0) + max(button_rect.get("height", 1) / 2, 1)
                await page.mouse.click(button_x, button_y)
                verify = await page.evaluate(
                    r"""async ({ replyText }) => {
                        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                        const normalize = (value) => String(value || '')
                            .replace(/\s+/g, ' ')
                            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                            .trim();
                        const visible = (node) => {
                            if (!node || !node.getBoundingClientRect) return false;
                            const rect = node.getBoundingClientRect();
                            const style = window.getComputedStyle(node);
                            return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                                && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
                        };
                        const replyPrefix = replyText.slice(0, Math.min(replyText.length, 12));
                        const readState = () => {
                            const editors = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]'))
                                .filter(visible)
                                .map((node) => normalize('value' in node ? node.value : node.innerText || node.textContent));
                            const replyStillInEditor = editors.some((value) => value.includes(replyPrefix));
                            const bodyText = normalize(document.body.innerText);
                            return {
                                replyStillInEditor,
                                bodyHasReply: bodyText.includes(replyPrefix),
                                readbackText: bodyText.includes(replyPrefix) ? replyText : '',
                                editors,
                            };
                        };
                        let state = readState();
                        for (let i = 0; i < 8; i += 1) {
                            if (!state.replyStillInEditor && state.bodyHasReply) return state;
                            await delay(750);
                            state = readState();
                        }
                        return state;
                    }""",
                    {"replyText": reply_text},
                )
                sent = (not verify.get("replyStillInEditor")) and bool(verify.get("bodyHasReply"))
                send_result = {
                    **send_result,
                    "status": "sent" if sent else "send_failed",
                    "sent": sent,
                    "message": "私信回复已点击发送，并已在抖音页面看到回复内容。" if sent else "已点击发送按钮，但抖音页面未看到回复内容，未确认真实发出。",
                    "editorCleared": not verify.get("replyStillInEditor"),
                    "replyVisible": bool(verify.get("bodyHasReply")),
                    "readbackText": verify.get("readbackText") if sent else "",
                }
            try:
                await reveal_page_window(page)
            except Exception as e:
                print(f"[interaction/douyin/messages/send] reveal failed: {e}")
            evidence = await _capture_interaction_screenshot(
                page,
                f"douyin-messages-send-{acc_id}",
                "私信发送截图" if send_result.get("sent") else "私信发送失败截图",
            )
            if send_result.get("sent"):
                _mark_interaction_sent("douyin", acc_id, "messages", target_text, reply_text)
            return {
                "accountId": acc_id,
                "accountName": user_name,
                "platformType": acc_type,
                "platformName": "抖音",
                "url": page.url,
                "status": send_result.get("status"),
                "sent": bool(send_result.get("sent")),
                "message": send_result.get("message"),
                "targetText": target_text,
                "replyText": reply_text,
                "editorTag": send_result.get("editorTag"),
                "sendButtonText": send_result.get("sendButtonText"),
                "editorCleared": send_result.get("editorCleared"),
                "replyVisible": send_result.get("replyVisible"),
                "readbackText": send_result.get("readbackText"),
                "evidence": evidence,
                "draftedAt": datetime.now().isoformat(),
                "sentAt": datetime.now().isoformat() if send_result.get("sent") else None,
                **_interaction_runtime_fields(session, trace),
            }
        finally:
            await _detach_douyin_im_route_capture(context, route_capture)
            if trace_client:
                try:
                    await trace_client.detach()
                except Exception:
                    pass

    try:
        result = _run_interaction_async(send_message_async())
        return jsonify({"code": 200, "msg": None, "data": result}), 200
    except Exception as e:
        _drop_interaction_context("douyin", acc_id)
        return jsonify({
            "code": 500,
            "msg": f"抖音私信自动发送失败：{e}",
            "data": None
        }), 200


@app.route('/interaction/wechat/desktop/status', methods=['GET'])
def get_wechat_desktop_status():
    try:
        return jsonify({
            "code": 200,
            "msg": None,
            "data": {
                **_detect_wechat_desktop(),
                "checkedAt": datetime.now().isoformat(),
            }
        }), 200
    except Exception as e:
        return jsonify({
            "code": 500,
            "msg": f"微信桌面状态检测失败：{e}",
            "data": None
        }), 200


@app.route('/interaction/wechat/draft', methods=['POST'])
def draft_wechat_reply():
    data = request.get_json() or {}
    reply_text = (data.get('replyText') or '').strip()
    target_text = (data.get('targetText') or '').strip()

    if not reply_text:
        return jsonify({
            "code": 400,
            "msg": "replyText required",
            "data": None
        }), 200

    desktop = _detect_wechat_desktop()
    if not desktop.get("available"):
        return jsonify({
            "code": 200,
            "msg": None,
            "data": {
                "status": "wechat_missing",
                "message": desktop.get("message") or "未检测到桌面微信。",
                "targetText": target_text,
                "replyText": reply_text,
                "desktop": desktop,
                "confirmsDraftOnly": True,
                "requiresManualSend": True,
                "draftedAt": datetime.now().isoformat(),
            }
        }), 200

    app_name = desktop.get("appName") or "WeChat"
    escaped_reply = json.dumps(reply_text)
    script = f'''
        set replyText to {escaped_reply}
        tell application "{app_name}" to activate
        delay 0.4
        set the clipboard to replyText
        tell application "System Events"
            keystroke "v" using command down
        end tell
    '''
    try:
        result = _run_osascript(script, timeout=10)
    except Exception as e:
        return jsonify({
            "code": 200,
            "msg": None,
            "data": {
                "status": "desktop_permission_missing",
                "message": f"无法控制桌面微信：{e}",
                "targetText": target_text,
                "replyText": reply_text,
                "desktop": desktop,
                "confirmsDraftOnly": True,
                "requiresManualSend": True,
                "draftedAt": datetime.now().isoformat(),
            }
        }), 200

    if result.returncode != 0:
        return jsonify({
            "code": 200,
            "msg": None,
            "data": {
                "status": "desktop_permission_missing",
                "message": (result.stderr or result.stdout or "桌面粘贴失败，请检查辅助功能权限。").strip(),
                "targetText": target_text,
                "replyText": reply_text,
                "desktop": desktop,
                "confirmsDraftOnly": True,
                "requiresManualSend": True,
                "draftedAt": datetime.now().isoformat(),
            }
        }), 200

    return jsonify({
        "code": 200,
        "msg": None,
        "data": {
            "status": "draft_filled",
            "message": "微信回复草稿已粘贴到当前会话输入框，未点击发送。",
            "targetText": target_text,
            "replyText": reply_text,
            "desktop": desktop,
            "confirmsDraftOnly": True,
            "requiresManualSend": True,
            "draftedAt": datetime.now().isoformat(),
        }
    }), 200


@app.route('/updateUserinfo', methods=['POST'])
def updateUserinfo():
    # 获取JSON数据
    data = request.get_json()

    # 从JSON数据中提取 type 和 userName
    user_id = data.get('id')
    type = data.get('type')
    userName = data.get('userName')
    try:
        # 获取数据库连接
        with sqlite3.connect(Path(BASE_DIR / "db" / "database.db")) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # 更新数据库记录
            cursor.execute('''
                           UPDATE user_info
                           SET type     = ?,
                               userName = ?
                           WHERE id = ?;
                           ''', (type, userName, user_id))
            conn.commit()

        return jsonify({
            "code": 200,
            "msg": "account update successfully",
            "data": None
        }), 200

    except Exception as e:
        return jsonify({
            "code": 500,
            "msg": str("update failed!"),
            "data": None
        }), 500

@app.route('/postVideoBatch', methods=['POST'])
def postVideoBatch():
    data_list = request.get_json()

    if not isinstance(data_list, list):
        return jsonify({"code": 400, "msg": "Expected a JSON array", "data": None}), 400
    data_list = sorted(
        data_list,
        key=_publish_platform_sort_key,
    )
    validation_failed_by_index = {}
    for index, data in enumerate(data_list):
        validation_errors = _validate_publish_payload(data)
        if validation_errors:
            validation_failed_by_index[index] = validation_errors

    if validation_failed_by_index:
        messages = [
            message
            for errors in validation_failed_by_index.values()
            for message in errors
        ]
        return jsonify({
            "code": 400,
            "msg": "；".join(messages),
            "data": {
                "reason": "publish_payload_invalid",
                "results": _build_publish_preflight_results(data_list, validation_failed_by_index),
            }
        }), 200

    account_check = _validate_publish_accounts_before_run(data_list)
    if account_check["messages"]:
        failed_keys = {
            (item["type"], item["filePath"]): item
            for item in account_check["failures"]
        }
        results = []
        for data in data_list:
            platform_type = int(data.get("type"))
            account_file = (data.get("accountList") or [""])[0]
            failed_item = failed_keys.get((platform_type, account_file))
            if failed_item:
                results.append({
                    "type": platform_type,
                    "ok": False,
                    "message": failed_item["message"],
                    "platform": failed_item["platform"],
                    "account": failed_item["account"],
                })
            else:
                results.append({
                    "type": platform_type,
                    "ok": None,
                    "message": "账号检查通过，因本次存在失败账号，发布流程未执行",
                    "platform": PLATFORM_NAME_MAP.get(platform_type, f"平台 {platform_type}"),
                    "account": account_file,
                })
        return jsonify({
            "code": 409,
            "msg": "；".join(account_check["messages"]),
            "data": {
                "reason": "account_preflight_failed",
                "results": results,
            }
        }), 200

    all_debug_dry_run = all(
        DEBUG_SKIP_FINAL_PUBLISH if 'debugDryRun' not in data else bool(data.get('debugDryRun'))
        for data in data_list
    )
    task_ids = _create_publish_tasks(data_list, dry_run=all_debug_dry_run)
    if all_debug_dry_run:
        try:
            batch_results = post_video_batch_dry_run_tabs(data_list)
        except Exception as e:
            print(f"postVideoBatch dry-run tabs failed: {e}")
            _update_publish_tasks(task_ids, status="failed", message=f"预发布检查失败：{e}")
            return jsonify({
                "code": 500,
                "msg": f"预发布检查失败：{e}",
                "data": {"taskIds": task_ids}
            }), 200
        _update_publish_tasks(task_ids, results=batch_results, status="success", message="预发布检查完成")
        return jsonify({
            "code": 200,
            "msg": None,
            "data": {
                "results": batch_results,
                "taskIds": task_ids
            }
        }), 200

    try:
        batch_results = post_video_batch_tabs(data_list, dry_run=False)
    except Exception as e:
        print(f"postVideoBatch shared-browser publish failed: {e}")
        _update_publish_tasks(task_ids, status="failed", message=f"发布失败：{e}")
        return jsonify({
            "code": 500,
            "msg": f"发布失败：{e}",
            "data": {"taskIds": task_ids}
        }), 200

    _update_publish_tasks(task_ids, results=batch_results, status="success", message="发布完成")
    return jsonify({
        "code": 200,
        "msg": None,
        "data": {
            "results": batch_results,
            "taskIds": task_ids
        }
    }), 200

# 包装函数：在线程中运行异步函数
def run_async_function(type,id,status_queue, update_mode=False, record_id=None, cancel_event=None):
    cookiesFile_dir = Path(BASE_DIR / "cookiesFile")
    cookiesFile_dir.mkdir(parents=False, exist_ok=True)
    login_task_map = {
        '1': xiaohongshu_cookie_gen,
        '2': get_tencent_cookie,
        '3': douyin_cookie_gen,
        '4': get_ks_cookie,
        '5': bilibili_cookie_gen,
    }
    login_task = login_task_map.get(str(type))
    if not login_task:
        status_queue.put(f"ERROR: 不支持的平台类型：{type}")
        status_queue.put("500")
        return

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(login_task(id, status_queue, update_mode, record_id, cancel_event))
    except Exception as e:
        print(f"login task failed: type={type} id={id} err={e}")
        status_queue.put(f"ERROR: 登录页面初始化失败：{e}")
        status_queue.put("500")
    finally:
        loop.close()

# SSE 流生成器函数
def sse_stream(status_queue, first_event_timeout=60, session_key=None):
    started_at = time.time()
    has_sent_first_event = False
    try:
        while True:
            try:
                msg = status_queue.get(timeout=0.5)
            except Empty:
                if not has_sent_first_event and time.time() - started_at > first_event_timeout:
                    yield "data: ERROR: 登录页面加载超时，未获取到二维码。请关闭弹窗后重试，或检查平台登录页是否改版、浏览器是否被拦截。\n\n"
                    yield "data: 500\n\n"
                    break
                yield ": ping\n\n"
                continue

            has_sent_first_event = True
            yield f"data: {msg}\n\n"
            if str(msg) in ("200", "500", "CANCELLED"):
                break
    finally:
        if session_key:
            active_login_sessions.pop(session_key, None)

if __name__ == '__main__':
    initialize_database()
    _quiet_local_server_startup_noise()
    app.run(host='0.0.0.0' ,port=5409)
