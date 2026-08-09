import asyncio
import time
from datetime import datetime


CHANNEL_COMMENT_URL = "https://channels.weixin.qq.com/platform/post/comment"
CHANNEL_MESSAGE_URL = "https://channels.weixin.qq.com/platform/post/message"
CHANNEL_HOME_URL = "https://channels.weixin.qq.com/platform"

CHANNEL_NETWORK_PATTERNS = [
    "channels.weixin.qq.com",
    "weixin.qq.com",
    "wx.qq.com",
    "qq.com",
    "cgi-bin",
    "comment",
    "private",
    "message",
    "msg",
    "session",
    "post_list",
]

CHANNEL_SYSTEM_NOISE = (
    "视频号助手",
    "首页",
    "发表记录",
    "动态管理",
    "评论管理",
    "私信管理",
    "微信视频号运营规范",
    "微信",
    "视频号",
    "发表视频",
    "发表直播",
    "原创声明",
    "合集管理",
    "加载中",
    "暂无数据",
    "暂无评论",
    "暂无消息",
)


def is_channel_customer_text(text):
    text = str(text or "").strip()
    if not text or len(text) < 2 or len(text) > 240:
        return False
    if not any(('\u4e00' <= ch <= '\u9fff') or ch.isalnum() for ch in text):
        return False
    if any(fragment.lower() in text.lower() for fragment in CHANNEL_SYSTEM_NOISE):
        return False
    if text in {"首页", "发表记录", "动态管理", "评论管理", "私信管理", "视频号助手"}:
        return False
    if text.isdigit():
        return False
    return True


def translate_channel_network_diagnostic(trace_events):
    diagnostics = []
    for event in trace_events or []:
        url = str(event.get("url") or "").lower()
        kind = event.get("kind") or ""
        status = event.get("status")
        error = event.get("errorText") or ""

        if "channels.weixin.qq.com" in url and "cgi-bin" in url:
            if kind == "failed" or (status and status >= 400):
                diagnostics.append({
                    "level": "error",
                    "message": f"视频号接口加载失败：{error or f'HTTP {status}'}",
                })
            elif kind == "response" and status and status < 400:
                if any(fragment in url for fragment in ("comment", "message", "session")):
                    diagnostics.append({
                        "level": "info",
                        "message": "视频号互动接口响应正常",
                    })

    return diagnostics


async def wait_for_channel_page_stable(page, timeout_ms=8000):
    deadline = time.time() + (timeout_ms / 1000)
    last_length = -1
    stable_count = 0
    while time.time() < deadline:
        try:
            text = await page.evaluate("() => document.body ? document.body.innerText.length : 0")
            if text == last_length and text > 100:
                stable_count += 1
                if stable_count >= 3:
                    return True
            else:
                stable_count = 0
            last_length = text
        except Exception:
            pass
        await asyncio.sleep(0.5)
    return False


async def check_channel_login_state(page):
    try:
        text = await page.evaluate("() => document.body ? document.body.innerText : ''")
        text_sample = str(text or "")[:500]
        if any(fragment in text_sample for fragment in (
            "扫码登录", "请扫码", "二维码", "登录/注册", "登录或注册",
            "请先登录", "未登录",
        )):
            return False, "视频号后台疑似未登录，请在浏览器中扫码登录"
        return True, None
    except Exception as e:
        return False, f"登录状态检测失败：{e}"


def build_channel_runtime_fields(session, trace=None):
    return {
        "runtimeMode": session.get("runtimeMode") or "persistent-cdp-browser",
        "profileDir": session.get("profileDir"),
        "cdpPort": session.get("cdpPort"),
        "browser": session.get("browser"),
        "browserReused": bool(session.get("reused")),
        "currentUrl": session.get("currentUrl"),
        "networkTrace": list(trace or [])[-30:],
    }
