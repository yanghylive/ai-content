import asyncio
import time
from datetime import datetime


DOUYIN_COMMENT_URL = "https://creator.douyin.com/creator-micro/interactive/comment"
DOUYIN_MESSAGE_URL = "https://creator.douyin.com/creator-micro/data/following/chat"
DOUYIN_CONTENT_URL = "https://creator.douyin.com/creator-micro/content/manage"

DOUYIN_IM_PATTERNS = [
    "imapi.snssdk.com",
    "mcs.snssdk.com",
    "creator.douyin.com",
    "bytedance",
    "snssdk",
    "im",
    "message",
    "chat",
    "conversation",
    "comment",
    "aweme",
]

DOUYIN_SYSTEM_NOISE = (
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

DOUYIN_TAB_LABELS = ["全部", "朋友私信", "陌生人私信", "群消息"]


def is_douyin_customer_text(text):
    text = str(text or "").strip()
    if not text or len(text) < 2 or len(text) > 240:
        return False
    if not any(('\u4e00' <= ch <= '\u9fff') or ch.isalnum() for ch in text):
        return False
    if any(fragment.lower() in text.lower() for fragment in DOUYIN_SYSTEM_NOISE):
        return False
    if text in {"全部", "朋友私信", "陌生人私信", "群消息", "发送", "搜索", "抖音", "首页"}:
        return False
    if text.isdigit():
        return False
    return True


def translate_douyin_network_diagnostic(trace_events):
    diagnostics = []
    for event in trace_events or []:
        url = str(event.get("url") or "").lower()
        kind = event.get("kind") or ""
        status = event.get("status")
        error = event.get("errorText") or ""

        if "imapi.snssdk.com" in url:
            if kind == "failed" or (status and status >= 400):
                diagnostics.append({
                    "level": "error",
                    "message": f"私信接口加载失败：{error or f'HTTP {status}'}",
                })
            elif kind == "response" and status and status < 400:
                diagnostics.append({
                    "level": "info",
                    "message": "私信接口响应正常",
                })
        elif "creator.douyin.com" in url and "im" in url:
            if kind == "failed":
                diagnostics.append({
                    "level": "warning",
                    "message": "抖音 IM 页面接口加载失败",
                })

    return diagnostics


async def wait_for_douyin_page_stable(page, timeout_ms=8000):
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


async def check_douyin_login_state(page):
    try:
        text = await page.evaluate("() => document.body ? document.body.innerText : ''")
        text_sample = str(text or "")[:500]
        if any(fragment in text_sample for fragment in (
            "扫码登录", "验证码登录", "密码登录", "登录/注册", "登录或注册",
        )):
            return False, "页面疑似未登录，请在浏览器中完成登录"
        return True, None
    except Exception as e:
        return False, f"登录状态检测失败：{e}"


def build_douyin_comment_runtime_fields(session, trace=None):
    return {
        "runtimeMode": session.get("runtimeMode") or "persistent-cdp-browser",
        "profileDir": session.get("profileDir"),
        "cdpPort": session.get("cdpPort"),
        "browser": session.get("browser"),
        "browserReused": bool(session.get("reused")),
        "currentUrl": session.get("currentUrl"),
        "networkTrace": list(trace or [])[-30:],
    }


def build_douyin_message_runtime_fields(session, trace=None):
    return build_douyin_comment_runtime_fields(session, trace)
