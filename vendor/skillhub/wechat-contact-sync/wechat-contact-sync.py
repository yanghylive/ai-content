#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path


CONTACT_ICON_OFFSET_X = int(os.environ.get("AI_CONTENT_WECHAT_CONTACT_ICON_OFFSET_X", "20"))
CONTACT_ICON_OFFSET_Y = int(os.environ.get("AI_CONTENT_WECHAT_CONTACT_ICON_OFFSET_Y", "125"))
CONTACT_LIST_OFFSET_X = int(os.environ.get("AI_CONTENT_WECHAT_CONTACT_LIST_OFFSET_X", "72"))
CONTACT_LIST_OFFSET_Y = int(os.environ.get("AI_CONTENT_WECHAT_CONTACT_LIST_OFFSET_Y", "92"))
CONTACT_LIST_WIDTH = int(os.environ.get("AI_CONTENT_WECHAT_CONTACT_LIST_WIDTH", "320"))
SCROLL_PAGES = max(1, min(int(os.environ.get("AI_CONTENT_WECHAT_CONTACT_SCROLL_PAGES", "8")), 30))
ALL_SCROLL_PAGES = max(
    SCROLL_PAGES,
    min(int(os.environ.get("AI_CONTENT_WECHAT_CONTACT_ALL_SCROLL_PAGES", "30")), 60),
)
SKIP_SYSTEM_EVENTS = os.environ.get("AI_CONTENT_WECHAT_SKIP_SYSTEM_EVENTS", "").strip() == "1"
CLICLICK = os.environ.get("AI_CONTENT_CLICLICK_PATH", "cliclick").strip() or "cliclick"
SWIFT = os.environ.get("AI_CONTENT_SWIFT_PATH", "swift").strip() or "swift"
WECHAT_WINDOW_ID = None
WECHAT_WINDOW_RECT = None


def run(cmd, timeout=20):
    return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)


def has_command(name):
    if "/" in name:
        return Path(name).is_file()
    return subprocess.run(["which", name], capture_output=True).returncode == 0


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


def fail(message):
    print(json.dumps({"ok": False, "error": message, "contacts": []}, ensure_ascii=False))
    sys.exit(1)


def focus_wechat():
    opened = run(["open", "-b", "com.tencent.xinWeChat"], timeout=10)
    if opened.returncode != 0:
        run(["open", "-a", "WeChat"], timeout=10)
    activate_script = """
delay 0.8
try
  tell application "微信" to activate
on error
  try
    tell application "WeChat" to activate
  end try
end try
delay 0.3
"""
    run(["osascript", "-e", activate_script], timeout=10)
    if SKIP_SYSTEM_EVENTS:
        return
    raise_script = """
try
  tell application "System Events" to set visible of process "Finder" to false
end try
tell application "System Events"
  if not (exists process "WeChat") then error "微信未运行"
  tell process "WeChat"
    set frontmost to true
    try
      set mainWindow to missing value
      try
        set mainWindow to window "微信"
      end try
      repeat with w in windows
        set windowName to name of w
        set windowSize to size of w
        if mainWindow is missing value and windowName is not "朋友圈" and (item 1 of windowSize > 520 and item 2 of windowSize > 500) then
          set mainWindow to w
          exit repeat
        end if
      end repeat
      if mainWindow is not missing value then
        set position of mainWindow to {90, 45}
        set size of mainWindow to {1280, 920}
        perform action "AXRaise" of mainWindow
      end if
    end try
  end tell
end tell
"""
    run(["osascript", "-e", raise_script], timeout=15)


def parse_window_rect(parts, raw):
    if len(parts) < 4:
        fail(f"微信窗口位置返回异常：{raw.strip()}")
    try:
        x, y, width, height = [int(float(item)) for item in parts[:4]]
    except ValueError:
        fail(f"微信窗口位置不可解析：{raw.strip()}")
    title = parts[4].strip() if len(parts) > 4 else ""
    if width < 520 or height < 500:
        fail(f"微信窗口尺寸异常：{width}x{height}，请先打开并放大微信主窗口")
    if title and title != "微信" and width < 700:
        fail(f"当前读取到的是微信子窗口「{title}」，不是微信主窗口。")
    return {
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "title": title,
    }


def get_wechat_window_rect_with_system_events():
    script = """
tell application "System Events"
  if not (exists process "WeChat") then error "微信未运行"
  tell process "WeChat"
    if (count of windows) is 0 then error "没有找到微信主窗口"
    set bestWindow to missing value
    set bestArea to 0
    try
      set bestWindow to window "微信"
    end try
    repeat with w in windows
      set windowName to name of w
      set windowSize to size of w
      set windowArea to (item 1 of windowSize) * (item 2 of windowSize)
      if bestWindow is missing value and windowName is not "朋友圈" and item 1 of windowSize > 520 and item 2 of windowSize > 500 and windowArea > bestArea then
        set bestArea to windowArea
        set bestWindow to w
      end if
    end repeat
    if bestWindow is missing value then error "没有找到微信主窗口"
    try
      perform action "AXRaise" of bestWindow
    end try
    set p to position of bestWindow
    set s to size of bestWindow
    set t to name of bestWindow
    return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text) & "," & t
  end tell
end tell
"""
    result = run(["osascript", "-e", script], timeout=10)
    if result.returncode != 0:
        return None, (result.stderr or result.stdout or "无法读取微信窗口位置").strip()
    parts = result.stdout.strip().split(",", 4)
    return parse_window_rect(parts, result.stdout), ""


def get_wechat_window_rect_with_cgwindow():
    swift = r'''
import CoreGraphics
import Foundation

func number(_ value: Any?) -> Double {
  if let number = value as? NSNumber { return number.doubleValue }
  if let double = value as? Double { return double }
  if let int = value as? Int { return Double(int) }
  return 0
}

let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
var best: [String: Any]? = nil
var bestArea = 0.0

for window in windows {
  let owner = window[kCGWindowOwnerName as String] as? String ?? ""
  let title = window[kCGWindowName as String] as? String ?? ""
  if !(owner.contains("WeChat") || owner.contains("微信") || title.contains("WeChat") || title.contains("微信")) {
    continue
  }
  if title.contains("朋友圈") { continue }
  let layer = Int(number(window[kCGWindowLayer as String]))
  if layer != 0 { continue }
  guard let bounds = window[kCGWindowBounds as String] as? [String: Any] else { continue }
  let width = number(bounds["Width"])
  let height = number(bounds["Height"])
  if width < 520 || height < 500 { continue }
  let area = width * height
    if area > bestArea {
    bestArea = area
    best = [
      "id": Int(number(window[kCGWindowNumber as String])),
      "x": Int(number(bounds["X"])),
      "y": Int(number(bounds["Y"])),
      "width": Int(width),
      "height": Int(height),
      "title": title.isEmpty ? owner : title
    ]
  }
}

guard let selected = best else {
  fputs("没有找到微信主窗口\n", stderr)
  exit(3)
}
let data = try JSONSerialization.data(withJSONObject: selected, options: [])
print(String(data: data, encoding: .utf8)!)
'''
    with tempfile.NamedTemporaryFile("w", suffix=".swift", delete=False) as f:
        f.write(swift)
        swift_path = f.name
    try:
        result = run([SWIFT, swift_path], timeout=20)
    finally:
        try:
            os.unlink(swift_path)
        except OSError:
            pass
    if result.returncode != 0:
        return None, (result.stderr or result.stdout or "无法读取微信窗口位置").strip()
    try:
        data = json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        return None, f"微信窗口位置不可解析：{result.stdout.strip()}"
    return parse_window_rect(
        [
            str(data.get("x", "")),
            str(data.get("y", "")),
            str(data.get("width", "")),
            str(data.get("height", "")),
            str(data.get("title", "")),
        ],
        result.stdout,
    ) | {"windowId": str(data.get("id", ""))}, ""


def get_wechat_window_rect():
    global WECHAT_WINDOW_ID
    global WECHAT_WINDOW_RECT
    errors = []
    rect, error = get_wechat_window_rect_with_cgwindow()
    if rect:
        WECHAT_WINDOW_ID = rect.get("windowId") or WECHAT_WINDOW_ID
        WECHAT_WINDOW_RECT = rect
        return rect
    if error:
        errors.append(error)
    if not SKIP_SYSTEM_EVENTS:
        rect, error = get_wechat_window_rect_with_system_events()
        if rect:
            WECHAT_WINDOW_RECT = rect
            return rect
        if error:
            errors.append(error)
    fail("；".join(errors) or "无法读取微信窗口位置")


def contact_list_region(rect):
    width = max(220, min(CONTACT_LIST_WIDTH, rect["width"] - CONTACT_LIST_OFFSET_X - 40))
    return (
        rect["x"] + CONTACT_LIST_OFFSET_X,
        rect["y"] + CONTACT_LIST_OFFSET_Y,
        width,
        min(860, max(420, rect["height"] - CONTACT_LIST_OFFSET_Y - 32)),
    )


def click_contacts_tab(rect):
    shortcut = run(
        [
            "osascript",
            "-e",
            'tell application "微信" to activate',
            "-e",
            "delay 0.2",
            "-e",
            'tell application "System Events" to keystroke "2" using {command down}',
        ],
        timeout=10,
    )
    if shortcut.returncode == 0:
        time.sleep(0.8)
        return
    x = rect["x"] + CONTACT_ICON_OFFSET_X
    y = rect["y"] + CONTACT_ICON_OFFSET_Y
    if has_command(CLICLICK):
        run([CLICLICK, f"c:{x},{y}"], timeout=10)
        time.sleep(0.8)


def capture(label, region):
    out_dir = Path(tempfile.gettempdir()) / "ai-content-wechat-contact-sync"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{label}-{int(time.time() * 1000)}.png"
    window_error = capture_wechat_window_region(label, path, region, out_dir)
    if path.exists():
        return path

    region_arg = ",".join(str(int(item)) for item in region)
    result = run(["/usr/sbin/screencapture", "-x", "-R", region_arg, str(path)], timeout=15)
    if result.returncode == 0 and path.exists():
        return path

    full_path = out_dir / f"{label}-full-{int(time.time() * 1000)}.png"
    full_result = run(["/usr/sbin/screencapture", "-x", "-m", str(full_path)], timeout=15)
    if full_result.returncode != 0 or not full_path.exists():
        message = (
            full_result.stderr
            or full_result.stdout
            or result.stderr
            or result.stdout
            or window_error
            or "通讯录截图失败"
        ).strip()
        fail(f"{message}（区域 {region_arg}）")
    crop_region(full_path, path, region)
    return path


def capture_wechat_window_region(label, output_path, region, out_dir):
    if not WECHAT_WINDOW_ID or not WECHAT_WINDOW_RECT:
        return "没有可用的微信窗口 ID"
    window_path = out_dir / f"{label}-window-{int(time.time() * 1000)}.png"
    result = run(
        ["/usr/sbin/screencapture", "-x", "-o", f"-l{WECHAT_WINDOW_ID}", str(window_path)],
        timeout=15,
    )
    if result.returncode != 0 or not window_path.exists():
        return (result.stderr or result.stdout or "微信窗口截图失败").strip()
    local_region = (
        int(region[0]) - int(WECHAT_WINDOW_RECT["x"]),
        int(region[1]) - int(WECHAT_WINDOW_RECT["y"]),
        int(region[2]),
        int(region[3]),
    )
    crop_region(window_path, output_path, local_region)
    return ""


def crop_region(source_path, output_path, region):
    swift = r'''
import AppKit
import Foundation

let source = CommandLine.arguments[1]
let output = CommandLine.arguments[2]
let x = Double(CommandLine.arguments[3]) ?? 0
let y = Double(CommandLine.arguments[4]) ?? 0
let width = Double(CommandLine.arguments[5]) ?? 1
let height = Double(CommandLine.arguments[6]) ?? 1

guard let image = NSImage(contentsOfFile: source),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fputs("无法读取整屏截图\n", stderr)
  exit(2)
}

let scale = NSScreen.main?.backingScaleFactor ?? 1
let pixelX = max(0, Int((x * scale).rounded()))
let pixelY = max(0, Int((y * scale).rounded()))
let pixelWidth = max(1, Int((width * scale).rounded()))
let pixelHeight = max(1, Int((height * scale).rounded()))
let cropRect = CGRect(
  x: pixelX,
  y: pixelY,
  width: min(pixelWidth, max(1, cgImage.width - pixelX)),
  height: min(pixelHeight, max(1, cgImage.height - pixelY))
)

guard let cropped = cgImage.cropping(to: cropRect) else {
  fputs("无法裁剪通讯录截图\n", stderr)
  exit(3)
}

let bitmap = NSBitmapImageRep(cgImage: cropped)
guard let data = bitmap.representation(using: .png, properties: [:]) else {
  fputs("无法生成通讯录截图\n", stderr)
  exit(4)
}
try data.write(to: URL(fileURLWithPath: output))
'''
    with tempfile.NamedTemporaryFile("w", suffix=".swift", delete=False) as f:
        f.write(swift)
        swift_path = f.name
    try:
        result = run(
            [
                SWIFT,
                swift_path,
                str(source_path),
                str(output_path),
                str(int(region[0])),
                str(int(region[1])),
                str(int(region[2])),
                str(int(region[3])),
            ],
            timeout=30,
        )
    finally:
        try:
            os.unlink(swift_path)
        except OSError:
            pass
    if result.returncode != 0 or not output_path.exists():
        fail((result.stderr or result.stdout or "通讯录截图裁剪失败").strip())


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
        fail((result.stderr or result.stdout or "OCR 读取通讯录失败").strip())
    return result.stdout.strip()


NOISE = re.compile(
    r"^(微信|通讯录|新的朋友|群聊|标签|公众号|企业微信联系人|搜索|收藏|文件传输助手|"
    r"朋友圈|视频号|订阅号|服务通知|小程序|更多|全部|联系人|群|朋友|添加朋友|"
    r"我的企业|星标朋友|公星标朋友|公 星标朋友)$"
)

CHAT_CONTAMINATION = re.compile(
    r"折叠的聊天|@所有人|\[\d+条\]|视频号|动画表情|个人名片|微信同步|置顶本群|"
    r"分钟前|昨天|今天|[0-2]?\d:[0-5]\d|要方案，找群草|代办健康证|招聘|招长期"
)

SYSTEM_WINDOW_CONTAMINATION = re.compile(
    r"应用程序|桌面|文稿|下载|iCloud|Macintosh|共享|个人收藏|位置|yanghy"
)

NON_WECHAT_CONTAMINATION = re.compile(
    r"抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站"
)

CONTACT_SUMMARY_LINE = re.compile(
    r"每月|满\d|元|小时|分钟前|小时前|昨天|今天|专业|速度|参与|赠|抽|送|"
    r"工资|电话|地址|联系人|招聘|招长期|工作内容|上班时间|"
    r"^\s*[\[［].*[\]］]|比赛|直播间|微信安全|[!！。；;]"
)


def clean_contact(line):
    value = re.sub(r"\s+", " ", line).strip()
    value = re.sub(r"^[•·\->＞〉›\s]+", "", value)
    value = re.sub(r"\s*(微信号|wxid|备注|标签)[:：].*$", "", value, flags=re.I).strip()
    value = re.sub(r"[.。…⋯]+$", "", value).strip()
    if not value or NOISE.fullmatch(value):
        return ""
    compact = re.sub(r"\s+", "", value)
    if compact in {"服务号", "公众号", "群聊", "企业微信联系人", "联系人", "我的企业", "星标朋友", "公星标朋友"}:
        return ""
    if "星标朋友" in compact or "我的企业" in compact:
        return ""
    if re.search(r"网友|腾讯新闻|新闻|福利小管|时惠叭|微信小店|东方甄选|Dock|Upgrade|Engine", value, re.I):
        return ""
    if NON_WECHAT_CONTAMINATION.search(value):
        return "__CONTAMINATION__"
    if CHAT_CONTAMINATION.search(value):
        return ""
    if CONTACT_SUMMARY_LINE.search(value):
        return ""
    if len(compact) < 2 or len(compact) > 40:
        return ""
    if re.fullmatch(r"[\d:：.。/\\|｜)(（）\[\]{}]+", compact):
        return ""
    if not re.search(r"[\u4e00-\u9fffA-Za-z0-9]", compact):
        return ""
    return value


def scroll_contacts(region):
    if has_command(CLICLICK):
        x = region[0] + max(20, int(region[2] / 2))
        y = region[1] + max(60, int(region[3] / 2))
        result = run([CLICLICK, f"m:{x},{y}", "kp:page-down"], timeout=6)
        if result.returncode == 0:
            time.sleep(0.5)
            return
    script = """
tell application "System Events"
  tell process "WeChat"
    try
      key code 125
    end try
  end tell
end tell
"""
    run(["osascript", "-e", script], timeout=5)
    time.sleep(0.35)


def validate_wechat_window(rect):
    full_region = (rect["x"], rect["y"], rect["width"], rect["height"])
    screenshot = capture("wechat-window-check", full_region)
    text = ocr(screenshot)
    if re.search(r"抖音|发布中心|平台账号|视频工坊|内容素材|知识库", text):
        fail("当前截图内容不是微信窗口，已拒绝同步通讯录，避免把其他 App 当作微信采集。")
    if not re.search(r"微信|WeChat|通讯录|聊天|搜索|文件传输助手|新的朋友|群聊|朋友圈", text):
        fail("没有识别到微信窗口特征，已拒绝同步通讯录。请把微信桌面客户端打开到主窗口后重试。")
    return str(screenshot), text


def validate_contacts_tab(region):
    screenshot = capture("contacts-tab-check", region)
    text = ocr(screenshot)
    if SYSTEM_WINDOW_CONTAMINATION.search(text):
        fail("当前截图被 Finder 或系统窗口遮挡，已拒绝同步通讯录。")
    if CHAT_CONTAMINATION.search(text):
        fail("当前仍停留在微信聊天列表，已拒绝把会话摘要当通讯录同步。")
    candidates = [clean_contact(line) for line in text.splitlines()]
    candidates = [item for item in candidates if item]
    if not re.search(r"新的朋友|群聊|标签|公众号|企业微信联系人|联系人", text) and len(candidates) < 3:
        fail("没有识别到微信通讯录列表特征，已拒绝同步通讯录。请确认微信左侧已切到通讯录。")
    return str(screenshot), text


def main():
    parser = argparse.ArgumentParser(description="Sync WeChat contacts from the visible macOS client.")
    parser.add_argument("--mode", choices=["random", "all"], default="random")
    args = parser.parse_args()
    scroll_pages = ALL_SCROLL_PAGES if args.mode == "all" else SCROLL_PAGES

    if not has_command(CLICLICK):
        fail("缺少 cliclick，不能真实操作微信通讯录")
    focus_wechat()
    current_wechat_id = active_wechat_account_id()
    if not current_wechat_id:
        fail("无法确认当前登录的微信账号，已停止同步，避免把其他账号的联系人写入本机名单。")
    rect = get_wechat_window_rect()
    validate_wechat_window(rect)
    click_contacts_tab(rect)
    rect = get_wechat_window_rect()
    region = contact_list_region(rect)
    validate_contacts_tab(region)

    contacts = []
    screenshots = []
    stale_pages = 0
    for index in range(scroll_pages):
        before_count = len(contacts)
        screenshot = capture(f"contacts-{index + 1}", region)
        screenshots.append(str(screenshot))
        text = ocr(screenshot)
        if SYSTEM_WINDOW_CONTAMINATION.search(text):
            fail("通讯录区域截图被 Finder 或系统窗口遮挡，已停止同步。")
        if NON_WECHAT_CONTAMINATION.search(text):
            fail("通讯录 OCR 结果疑似混入非微信页面或误读为抖音内容，已停止同步，避免写入错误联系人。")
        if CHAT_CONTAMINATION.search(text):
            fail("通讯录区域截图仍包含聊天列表摘要，已停止同步。")
        for line in text.splitlines():
            contact = clean_contact(line)
            if contact == "__CONTAMINATION__":
                fail("通讯录 OCR 结果疑似混入非微信页面或误读为抖音内容，已停止同步，避免写入错误联系人。")
            if contact and contact not in contacts:
                contacts.append(contact)
        if len(contacts) == before_count:
            stale_pages += 1
        else:
            stale_pages = 0
        if args.mode == "all" and stale_pages >= 2:
            break
        scroll_contacts(region)

    print(json.dumps({
        "ok": True,
        "source": "macos-wechat-ocr",
        "mode": args.mode,
        "currentWechatId": current_wechat_id,
        "contacts": contacts,
        "count": len(contacts),
        "screenshotPath": screenshots[-1] if screenshots else "",
        "screenshots": screenshots,
        "diagnostics": {
            "source": "macos-wechat-ocr",
            "stage": "macos-ocr-completed",
            "uiaStatus": "low-confidence",
            "confidence": "review-required",
            "pagesScanned": len(screenshots),
            "selectedDbAccountFolder": current_wechat_id,
            "selectedDbBaseWxid": current_wechat_id,
            "attemptedSources": ["macos-window-ocr"],
            "warnings": [
                "联系人来自当前登录微信窗口的文字识别结果，使用前请复核姓名；全量模式会滚动到连续两页无新增后停止。"
            ],
        },
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
