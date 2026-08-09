#!/usr/bin/env python3
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


CONTEXT = sys.argv[1].strip() if len(sys.argv) > 1 else ""
MODE = sys.argv[2].strip() if len(sys.argv) > 2 else "auto-send"
EXTERNAL_REPLY = sys.argv[3].strip() if len(sys.argv) > 3 else ""
WECHAT_INPUT_X = int(os.environ.get("AI_CONTENT_WECHAT_INPUT_X", "1040"))
WECHAT_INPUT_Y = int(os.environ.get("AI_CONTENT_WECHAT_INPUT_Y", "1110"))
WECHAT_REGION = os.environ.get("AI_CONTENT_WECHAT_CAPTURE_REGION", "90,45,1620,1165")


def run(cmd, timeout=20):
    return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)


def fail(message):
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    sys.exit(1)


def focus_wechat():
    run(["open", "-b", "com.tencent.xinWeChat"], timeout=10)
    script = '''
tell application id "com.tencent.xinWeChat" to activate
delay 0.8
tell application "System Events"
  if not (exists process "WeChat") then error "微信未运行"
  tell process "WeChat"
    set frontmost to true
    try
      set position of window 1 to {90, 45}
      set size of window 1 to {1620, 1165}
    end try
  end tell
end tell
'''
    result = run(["osascript", "-e", script], timeout=15)
    if result.returncode != 0:
        fail((result.stderr or result.stdout or "无法聚焦微信").strip())


def capture(label):
    out_dir = Path(tempfile.gettempdir()) / "ai-content-wechat-live"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{label}-{int(time.time() * 1000)}.png"
    result = run(["/usr/sbin/screencapture", "-x", "-R", WECHAT_REGION, str(path)], timeout=15)
    if result.returncode != 0 or not path.exists():
        fail((result.stderr or result.stdout or "微信截图失败").strip())
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
        result = run(["swift", swift_path, str(path)], timeout=40)
    finally:
        try:
            os.unlink(swift_path)
        except OSError:
            pass
    if result.returncode != 0:
        fail((result.stderr or result.stdout or "OCR 读取微信窗口失败").strip())
    return result.stdout.strip()


def clean_lines(text):
    noise = re.compile(
        r"^(微信|搜索|通讯录|收藏|文件传输助手|订阅号|服务通知|视频号|搜一搜|看一看|小程序|朋友圈|"
        r"发送|表情|截图|聊天信息|置顶|消息免打扰|全部|通讯录)$"
    )
    lines = []
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if not line or len(line) <= 1:
            continue
        if re.fullmatch(r"\d{1,2}:\d{2}|昨天|前天|周[一二三四五六日天]", line):
            continue
        if noise.search(line):
            continue
        lines.append(line)
    return lines


def build_reply(lines):
    text = "\n".join(lines[-12:])
    if not text:
        fail("没有从当前微信聊天读取到可回复内容")
    if any(word in text for word in ["价格", "多少钱", "费用", "收费"]):
        return "您好，价格会根据您的具体需求和服务项目确认。我先了解一下您的情况，再给您一个准确方案。"
    if any(word in text for word in ["地址", "在哪", "位置", "门店"]):
        return "您好，可以的。我把门店地址和营业时间发您，您看哪个时间方便过来。"
    if any(word in text for word in ["预约", "几点", "时间", "明天", "今天"]):
        return "您好，可以先帮您看下可预约时间。您方便说一下想安排的日期和大概时间段吗？"
    if any(word in text for word in ["在吗", "你好", "您好"]):
        return "您好，在的。您这边想咨询哪方面，我来帮您确认。"
    if CONTEXT:
        return f"您好，收到您的消息了。{CONTEXT[:60]}我这边先帮您确认一下。"
    return "您好，收到您的消息了。我先帮您确认一下，稍后给您回复。"


def paste_and_send(reply):
    script = f'''
set the clipboard to {json.dumps(reply, ensure_ascii=False)}
tell application "System Events" to keystroke "v" using {{command down}}
delay 0.2
tell application "System Events" to key code 36
'''
    result = run(["cliclick", f"c:{WECHAT_INPUT_X},{WECHAT_INPUT_Y}"], timeout=10)
    if result.returncode != 0:
        fail((result.stderr or result.stdout or "无法点击微信输入框").strip())
    time.sleep(0.2)
    result = run(["osascript", "-e", script], timeout=15)
    if result.returncode != 0:
        fail((result.stderr or result.stdout or "无法粘贴并发送微信回复").strip())


def main():
    if shutil.which("cliclick") is None:
        fail("缺少 cliclick，不能真实点击微信桌面")
    if MODE not in {"auto-send", "read-only"}:
        fail(f"不支持的执行模式: {MODE}")
    focus_wechat()
    before = capture("before")
    before_text = ocr(before)
    lines = clean_lines(before_text)
    read_text = "\n".join(lines[-8:])
    if MODE == "read-only":
        print(json.dumps({
            "ok": True,
            "mode": "read-only",
            "reply": "",
            "screenshotPath": str(before),
            "readText": read_text,
        }, ensure_ascii=False))
        return
    reply = EXTERNAL_REPLY or build_reply(lines)
    paste_and_send(reply)
    time.sleep(1.0)
    after = capture("after")
    after_text = ocr(after)
    if reply not in after_text:
        compact_reply = re.sub(r"\s+", "", reply)
        compact_after = re.sub(r"\s+", "", after_text)
        if compact_reply not in compact_after:
            fail("微信发送后没有在截图/OCR中确认到回复内容")
    print(json.dumps({
        "ok": True,
        "mode": MODE,
        "reply": reply,
        "screenshotPath": str(after),
        "readText": read_text,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
