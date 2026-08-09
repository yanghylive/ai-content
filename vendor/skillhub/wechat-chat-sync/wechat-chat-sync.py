#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


CHAT_OFFSET_X = int(os.environ.get("AI_CONTENT_WECHAT_CHAT_OFFSET_X", "238"))
CHAT_OFFSET_Y = int(os.environ.get("AI_CONTENT_WECHAT_CHAT_OFFSET_Y", "86"))
CHAT_BOTTOM_PADDING = int(os.environ.get("AI_CONTENT_WECHAT_CHAT_BOTTOM_PADDING", "180"))
CHAT_RIGHT_PADDING = int(os.environ.get("AI_CONTENT_WECHAT_CHAT_RIGHT_PADDING", "32"))
SWIFT = os.environ.get("AI_CONTENT_SWIFT_PATH", "swift").strip() or "swift"

NON_WECHAT_CONTAMINATION = re.compile(
    r"系统配置中心|完整检查项|本机服务状态|任务中心总览|"
    r"发布中心\s*(?:/|·|>|）)?\s*平台账号|"
    r"KAYPAL AI\s*智能运营系统"
)
NOISE = re.compile(
    r"^(微信|搜索|聊天信息|发送|表情|截图|文件|语音输入|朋友圈|视频号|通讯录|收藏|聊天|"
    r"置顶|免打扰|更多|今天|昨天|星期[一二三四五六日天]|[0-2]?\d:[0-5]\d)$"
)


def run(cmd, timeout=20):
    return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)


def active_wechat_account_id():
    pgrep = run(["pgrep", "-x", "WeChat"], timeout=5)
    if pgrep.returncode != 0:
        return ""
    account_counts = {}
    for raw_pid in pgrep.stdout.splitlines():
        pid = raw_pid.strip()
        if not pid.isdigit():
            continue
        lsof_path = "/usr/sbin/lsof" if Path("/usr/sbin/lsof").exists() else "lsof"
        opened = run([lsof_path, "-Fn", "-p", pid], timeout=15)
        if opened.returncode != 0:
            continue
        for match in re.finditer(r"/xwechat_files/([^/\n]+)/db_storage/", opened.stdout):
            account_id = match.group(1).strip()
            if account_id and account_id not in {"all_users", "Backup"}:
                account_counts[account_id] = account_counts.get(account_id, 0) + 1
    if not account_counts:
        return ""
    return max(account_counts, key=account_counts.get)


def output(payload, exit_code=0):
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(exit_code)


def fail(message, blockers=None, warnings=None, exit_code=0):
    output(
        {
            "ok": False,
            "source": "macos-wechat-rpa-ocr",
            "sessions": [],
            "messages": [],
            "blockers": blockers or [message],
            "warnings": warnings or [],
            "checkedAt": datetime.now(timezone.utc).isoformat(),
            "message": message,
        },
        exit_code,
    )


def focus_wechat():
    opened = run(["open", "-b", "com.tencent.xinWeChat"], timeout=10)
    if opened.returncode != 0:
        run(["open", "-a", "WeChat"], timeout=10)
    script = """
delay 0.5
try
  tell application "微信" to activate
on error
  try
    tell application "WeChat" to activate
  end try
end try
delay 0.3
tell application "System Events"
  if not (exists process "WeChat") then error "微信未运行"
  tell process "WeChat"
    set frontmost to true
    set bestWindow to missing value
    set bestArea to 0
    repeat with w in windows
      set windowName to name of w
      set windowSize to size of w
      set windowArea to (item 1 of windowSize) * (item 2 of windowSize)
      if windowName is not "朋友圈" and item 1 of windowSize > 620 and item 2 of windowSize > 520 and windowArea > bestArea then
        set bestArea to windowArea
        set bestWindow to w
      end if
    end repeat
    if bestWindow is missing value then error "没有找到微信主窗口"
    set position of bestWindow to {90, 45}
    set size of bestWindow to {1280, 920}
    perform action "AXRaise" of bestWindow
  end tell
end tell
"""
    result = run(["osascript", "-e", script], timeout=15)
    if result.returncode != 0:
        fail((result.stderr or result.stdout or "无法聚焦微信").strip())


def get_wechat_window_rect():
    script = """
tell application "System Events"
  if not (exists process "WeChat") then error "微信未运行"
  tell process "WeChat"
    set bestWindow to missing value
    set bestArea to 0
    repeat with w in windows
      set windowName to name of w
      set windowSize to size of w
      set windowArea to (item 1 of windowSize) * (item 2 of windowSize)
      if windowName is not "朋友圈" and item 1 of windowSize > 620 and item 2 of windowSize > 520 and windowArea > bestArea then
        set bestArea to windowArea
        set bestWindow to w
      end if
    end repeat
    if bestWindow is missing value then error "没有找到微信主窗口"
    set p to position of bestWindow
    set s to size of bestWindow
    set t to name of bestWindow
    return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text) & "," & t
  end tell
end tell
"""
    result = run(["osascript", "-e", script], timeout=10)
    if result.returncode != 0:
        fail((result.stderr or result.stdout or "无法读取微信窗口位置").strip())
    parts = result.stdout.strip().split(",", 4)
    if len(parts) < 4:
        fail(f"微信窗口位置返回异常：{result.stdout.strip()}")
    try:
        x, y, width, height = [int(float(item)) for item in parts[:4]]
    except ValueError:
        fail(f"微信窗口位置不可解析：{result.stdout.strip()}")
    return {
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "title": parts[4].strip() if len(parts) > 4 else "微信",
    }


def capture_chat_region(rect):
    region = (
        rect["x"] + CHAT_OFFSET_X,
        rect["y"] + CHAT_OFFSET_Y,
        max(360, rect["width"] - CHAT_OFFSET_X - CHAT_RIGHT_PADDING),
        max(280, rect["height"] - CHAT_OFFSET_Y - CHAT_BOTTOM_PADDING),
    )
    out_dir = Path(tempfile.gettempdir()) / "ai-content-wechat-chat-sync"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"chat-{int(time.time() * 1000)}.png"
    region_arg = ",".join(str(int(item)) for item in region)
    result = run(["/usr/sbin/screencapture", "-x", "-R", region_arg, str(path)], timeout=15)
    if result.returncode != 0 or not path.exists():
        fail((result.stderr or result.stdout or "聊天截图失败").strip())
    return path


def ocr(path):
    swift = r'''
import Foundation
import Vision
import AppKit

let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  exit(2)
}

let request = VNRecognizeTextRequest()
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = true
request.recognitionLevel = .accurate

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])
let results = request.results ?? []
let lines = results.compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
'''
    with tempfile.NamedTemporaryFile("w", suffix=".swift", delete=False) as f:
        f.write(swift)
        swift_path = f.name
    try:
        result = run([SWIFT, swift_path, str(path)], timeout=45)
    finally:
        try:
            os.unlink(swift_path)
        except OSError:
            pass
    if result.returncode != 0:
        fail((result.stderr or result.stdout or "OCR 读取聊天失败").strip())
    return result.stdout.strip()


def clean_line(line):
    value = re.sub(r"\s+", " ", line).strip()
    value = re.sub(r"^[•·\\-\\s]+", "", value).strip()
    if not value or NOISE.fullmatch(value):
        return ""
    if re.fullmatch(r"(?:昨天|今天|星期[一二三四五六日天])\s*\d{1,2}:\d{2}", value):
        return ""
    if "微信电脑版" in value and len(value) < 16:
        return ""
    if NON_WECHAT_CONTAMINATION.search(value):
        return "__CONTAMINATION__"
    if len(value) < 2 or len(value) > 500:
        return ""
    if re.fullmatch(r"[\d:：.。/\\|｜)(（）\\[\\]{}]+", value):
        return ""
    if len(re.findall(r"[\u4e00-\u9fffA-Za-z0-9]", value)) < 3:
        return ""
    return value


def build_messages(lines, session_id, limit):
    messages = []
    for index, line in enumerate(lines[-limit:]):
        messages.append(
            {
                "id": f"{session_id}-{index + 1}",
                "sessionId": session_id,
                "direction": "unknown",
                "content": line,
                "contentType": "text",
                "sentAt": datetime.now(timezone.utc).isoformat(),
                "source": "macos-wechat-rpa-ocr",
            }
        )
    return messages


def main():
    parser = argparse.ArgumentParser(description="Sync visible WeChat chat history via macOS OCR.")
    parser.add_argument("--session-id", default="")
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()
    limit = max(1, min(args.limit, 200))

    focus_wechat()
    current_wechat_id = active_wechat_account_id()
    if not current_wechat_id:
        fail(
            "无法确认当前登录的微信账号，已停止同步聊天记录。",
            blockers=["当前微信账号未识别。"],
        )
    rect = get_wechat_window_rect()
    screenshot_path = capture_chat_region(rect)
    text = ocr(screenshot_path)
    raw_lines = [line.strip() for line in text.splitlines() if line.strip()]
    cleaned = []
    for line in raw_lines:
        value = clean_line(line)
        if value == "__CONTAMINATION__":
            fail(
                "已拒绝同步聊天记录：当前画面疑似是系统工作台，不是微信聊天窗口。",
                blockers=["当前窗口内容不是微信聊天记录，已停止写入。"],
                warnings=[f"screenshotPath={screenshot_path}"],
            )
        if value:
            cleaned.append(value)

    if not cleaned:
        fail(
            "未识别到可写入的微信聊天消息，请打开目标微信会话后重试。",
            blockers=["微信聊天 OCR 结果为空。"],
            warnings=[f"screenshotPath={screenshot_path}"],
        )

    session_id = args.session_id or f"visible-wechat-chat-{int(time.time())}"
    title = rect["title"] if rect["title"] and rect["title"] != "微信" else "当前微信会话"
    session = {
        "id": session_id,
        "title": title,
        "contactName": title,
        "lastMessage": cleaned[-1],
        "lastMessageAt": datetime.now(timezone.utc).isoformat(),
        "messageCount": min(len(cleaned), limit),
        "source": "macos-wechat-rpa-ocr",
    }
    messages = build_messages(cleaned, session_id, limit)
    output(
        {
            "ok": True,
            "source": "macos-wechat-rpa-ocr",
            "currentWechatId": current_wechat_id,
            "sessions": [session],
            "messages": messages,
            "blockers": [],
            "warnings": [
                "当前为可见聊天区域 OCR 采集；若需全量历史，需要接入微信 DB/滚动 RPA。",
                f"screenshotPath={screenshot_path}",
            ],
            "requestedSessionId": args.session_id or None,
            "requestedLimit": limit,
            "diagnostics": {
                "selectedDbAccountFolder": current_wechat_id,
                "selectedDbBaseWxid": current_wechat_id,
                "screenshotPath": str(screenshot_path),
            },
            "checkedAt": datetime.now(timezone.utc).isoformat(),
            "message": f"已同步当前可见微信会话 {len(messages)} 条消息。",
        }
    )


if __name__ == "__main__":
    main()
