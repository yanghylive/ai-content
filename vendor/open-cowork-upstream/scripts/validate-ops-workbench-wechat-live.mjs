import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const execFile = promisify(execFileCallback);
const PYTHON =
  process.env.KAYPAL_AGENT_S_PYTHON ||
  process.env.PYTHON ||
  'python3';
const SCREENSHOT_PATH = '/private/tmp/wechat-ops-workbench-live.png';
const LEFT_CROP_PATH = '/private/tmp/wechat-left-active-live.png';
const RIGHT_CROP_PATH = '/private/tmp/wechat-right-top-live.png';
const LEFT_SELECTED_ROW_PATH = '/private/tmp/wechat-left-selected-row-live.png';
const WECHAT_APP_PATH =
  process.env.KAYPAL_WECHAT_APP_PATH || '/Applications/微信.app';
const WECHAT_PROCESS_NAMES = ['WeChat', '微信'];
const targetContact =
  (() => {
    const index = process.argv.indexOf('--target');
    if (index >= 0 && process.argv[index + 1]) {
      return process.argv[index + 1].trim();
    }
    return '';
  })() || '';

async function activateWechat() {
  await execFile('open', [WECHAT_APP_PATH]);
  const appleScript = `
tell application "System Events"
  repeat with processName in {${WECHAT_PROCESS_NAMES.map((name) => `"${name}"`).join(', ')}}
    if exists process processName then
      set frontmost of process processName to true
      exit repeat
    end if
  end repeat
end tell
delay 1
tell application "System Events" to get name of first process whose frontmost is true
`;
  const { stdout } = await execFile('osascript', ['-e', appleScript]);
  return stdout.trim();
}

async function readFrontmostApp() {
  const code = `
from AppKit import NSWorkspace
print(NSWorkspace.sharedWorkspace().frontmostApplication().localizedName() or "")
`;
  const { stdout } = await execFile(PYTHON, ['-c', code]);
  return stdout.trim();
}

async function readWechatWindows() {
  const code = `
from Quartz import CGWindowListCopyWindowInfo, kCGWindowListOptionOnScreenOnly, kCGNullWindowID
rows = []
for w in CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID):
    owner = w.get("kCGWindowOwnerName")
    if owner and ("WeChat" in owner or "微信" in owner):
        rows.append({
            "owner": owner,
            "name": w.get("kCGWindowName") or "",
            "layer": w.get("kCGWindowLayer"),
            "alpha": w.get("kCGWindowAlpha"),
            "bounds": dict(w.get("kCGWindowBounds") or {}),
        })
print(rows)
`;
  const { stdout } = await execFile(PYTHON, ['-c', code]);
  return stdout.trim();
}

function parseWechatWindows(raw) {
  try {
    return JSON.parse(raw.replace(/'/g, '"'));
  } catch {
    try {
      return Function(`"use strict"; return (${raw});`)();
    } catch {
      return [];
    }
  }
}

function pickPrimaryWechatWindow(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const scored = rows
    .filter((row) => row && row.layer === 0 && row.alpha !== 0)
    .map((row) => {
      const bounds = row?.bounds || {};
      const width = Number(bounds.Width || 0);
      const height = Number(bounds.Height || 0);
      const area = Math.max(0, width) * Math.max(0, height);
      const title = String(row?.name || '');
      const isSearchOverlay =
        width > 0 &&
        height > 0 &&
        (height <= 120 || width <= 420) &&
        /搜一搜|Search|搜索/.test(title);
      const isGenericShellWindow = /\(窗口\)/.test(title);
      const isPrimaryNamedWindow = title === '微信';
      return {
        row,
        area,
        width,
        height,
        title,
        isSearchOverlay,
        isGenericShellWindow,
        isPrimaryNamedWindow,
      };
    })
    .sort((a, b) => {
      if (a.isSearchOverlay !== b.isSearchOverlay) {
        return a.isSearchOverlay ? 1 : -1;
      }
      if (a.isPrimaryNamedWindow !== b.isPrimaryNamedWindow) {
        return a.isPrimaryNamedWindow ? -1 : 1;
      }
      if (a.isGenericShellWindow !== b.isGenericShellWindow) {
        return a.isGenericShellWindow ? 1 : -1;
      }
      return b.area - a.area;
    });

  return scored[0]?.row || rows[0] || null;
}

async function captureScreenshot() {
  const code = `
import os
import tempfile
import pyautogui
from PIL import ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True
fd, tmp_path = tempfile.mkstemp(prefix="wechat-ops-", suffix=".png", dir="/private/tmp")
os.close(fd)
img = pyautogui.screenshot()
img.save(tmp_path, format="PNG")
os.replace(tmp_path, ${JSON.stringify(SCREENSHOT_PATH)})
print(f"{img.size[0]}x{img.size[1]}")
`;
  const { stdout } = await execFile(PYTHON, ['-c', code]);
  return stdout.trim();
}

function cropWechatScreenshot(windowBounds) {
  const code = `
from PIL import Image
from PIL import ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True
img = Image.open(${JSON.stringify(SCREENSHOT_PATH)})
img.load()
width, height = img.size
screen_width_pts = 1512
screen_height_pts = 982
scale_x = width / screen_width_pts if screen_width_pts else 1
scale_y = height / screen_height_pts if screen_height_pts else 1
window_left = max(0, min(width - 1, int((${windowBounds?.X ?? 0}) * scale_x)))
window_top = max(0, min(height - 1, int((${windowBounds?.Y ?? 0}) * scale_y)))
window_width = max(300, min(width - window_left, int((${windowBounds?.Width ?? 1000}) * scale_x)))
window_height = max(300, min(height - window_top, int((${windowBounds?.Height ?? 800}) * scale_y)))
window_right = min(width, window_left + window_width)
window_bottom = min(height, window_top + window_height)

# WeChat main content window is smaller and visually anchored inside the outer shell.
# The left region should target the visible conversation list text rows,
# and the right region should tightly crop the chat header title, not the blank padding.
sidebar_width = max(48, min(74, int(window_width * 0.08)))
search_row_height = max(42, min(64, int(window_height * 0.10)))
list_left = window_left + sidebar_width + 18
list_right = window_left + int(window_width * 0.46)
list_top = window_top + search_row_height + 34
list_bottom = window_top + int(window_height * 0.88)

content_left = window_left + int(window_width * 0.51)
content_right = window_left + int(window_width * 0.66)
content_top = window_top + 56
content_bottom = window_top + 116

left = img.crop((
  max(window_left, min(window_right - 30, list_left)),
  max(window_top, min(window_bottom - 30, list_top)),
  max(window_left + 30, min(window_right, list_right)),
  max(window_top + 30, min(window_bottom, list_bottom))
))
right = img.crop((
  max(window_left, min(window_right - 30, content_left)),
  max(window_top, min(window_bottom - 30, content_top)),
  max(window_left + 30, min(window_right, content_right)),
  max(window_top + 30, min(window_bottom, content_bottom))
))
left.save(${JSON.stringify(LEFT_CROP_PATH)})
right.save(${JSON.stringify(RIGHT_CROP_PATH)})
print("ok")
`;
  execFileSync(PYTHON, ['-c', code], { encoding: 'utf8' });
}

function runVisionOcr(path) {
  const swiftCode = `
import Vision
import AppKit

let path = ${JSON.stringify(path)}
guard let image = NSImage(contentsOfFile: path) else {
  print("")
  exit(0)
}
guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let cg = rep.cgImage else {
  print("")
  exit(0)
}

let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["zh-Hans", "en-US"]
req.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try? handler.perform([req])
let texts = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(texts.joined(separator: "\\n"))
`;
  const stdout = execFileSync('swift', ['-'], {
    input: swiftCode,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function runVisionOcrWithBoxes(path) {
  const swiftCode = `
import Vision
import AppKit

struct Row: Encodable {
  let text: String
  let x: Double
  let y: Double
  let w: Double
  let h: Double
}

let path = ${JSON.stringify(path)}
guard let image = NSImage(contentsOfFile: path) else {
  print("[]")
  exit(0)
}
guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let cg = rep.cgImage else {
  print("[]")
  exit(0)
}

let width = Double(cg.width)
let height = Double(cg.height)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["zh-Hans", "en-US"]
req.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try? handler.perform([req])

let rows: [Row] = (req.results ?? []).compactMap { obs in
  guard let cand = obs.topCandidates(1).first else { return nil }
  let text = cand.string.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { return nil }
  let b = obs.boundingBox
  return Row(
    text: text,
    x: Double(b.origin.x) * width,
    y: (1 - Double(b.origin.y) - Double(b.size.height)) * height,
    w: Double(b.size.width) * width,
    h: Double(b.size.height) * height
  )
}

let encoder = JSONEncoder()
if let data = try? encoder.encode(rows), let text = String(data: data, encoding: .utf8) {
  print(text)
} else {
  print("[]")
}
`;
  const stdout = execFileSync('swift', ['-'], {
    input: swiftCode,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  try {
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}

function detectHighlightedConversation(path) {
  const code = `
from PIL import Image
img = Image.open(${JSON.stringify(path)}).convert('RGB')
width, height = img.size
scan_width = min(width, 240)
rows = []
for y in range(height):
    total = 0
    count = 0
    for x in range(scan_width):
        r,g,b = img.getpixel((x,y))
        total += r + g + b
        count += 3
    rows.append(total / count if count else 255)

threshold = min(220, sum(rows) / len(rows) - 18 if rows else 220)
best_start = best_end = None
best_len = 0
cur_start = None
for idx, value in enumerate(rows):
    if value < threshold:
        if cur_start is None:
            cur_start = idx
    else:
        if cur_start is not None:
            cur_len = idx - cur_start
            if cur_len > best_len:
                best_start, best_end, best_len = cur_start, idx, cur_len
            cur_start = None
if cur_start is not None:
    cur_len = len(rows) - cur_start
    if cur_len > best_len:
        best_start, best_end, best_len = cur_start, len(rows), cur_len

print(f"{best_start or 0},{best_end or 0},{threshold:.2f}")
`;
  const stdout = execFileSync(PYTHON, ['-c', code], { encoding: 'utf8' }).trim();
  const [startText, endText] = stdout.split(',');
  const start = Number.parseInt(startText || '', 10);
  const end = Number.parseInt(endText || '', 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 28) {
    return '';
  }

  const cropCode = `
from PIL import Image
img = Image.open(${JSON.stringify(path)})
row = img.crop((0, ${start}, img.size[0], ${end}))
row.save(${JSON.stringify(LEFT_SELECTED_ROW_PATH)})
print("ok")
`;
  execFileSync(PYTHON, ['-c', cropCode], { encoding: 'utf8' });

  const boxes = runVisionOcrWithBoxes(LEFT_SELECTED_ROW_PATH);
  const best = boxes
    .map((row) => ({
      text: String(row?.text || '').trim(),
      score:
        String(row?.text || '').trim().length * 10 -
        (/\d{1,2}:\d{2}/.test(String(row?.text || '')) ? 30 : 0) -
        (/^\[.*\]$/.test(String(row?.text || '')) ? 20 : 0),
    }))
    .filter((row) => row.text && !/^\d{1,2}:\d{2}$/.test(row.text))
    .sort((a, b) => b.score - a.score)[0];

  return best?.text || '';
}

function normalizeRecognizedTexts(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const text = row.trim();
    if (!text) return false;
    if (seen.has(text)) return false;
    if (
      text.includes('搜索') ||
      text.includes('Kaypal Desktop') ||
      text.includes('new_home_page') ||
      text.includes('home_page') ||
      text.includes('.com/') ||
      text.includes('新对话') ||
      text === '>' ||
      text === '<' ||
      text === '+' ||
      text === 'K' ||
      text === '十' ||
      text === 'Q'
    ) {
      return false;
    }
    if (text.length === 1 && /^[A-Za-z0-9]$/.test(text)) return false;
    if (/^[A-Za-z0-9._/-]{5,}$/.test(text)) return false;
    seen.add(text);
    return true;
  });
}

function looksLikeTimeLabel(text) {
  return /^\d{1,2}:\d{2}$/.test(String(text || '').trim());
}

function looksLikeConversationPreview(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (looksLikeTimeLabel(value)) return true;
  if (value.includes('⋯') || value.includes('…')) return true;
  if (/^[P◎D]\s*\d{1,2}:\d{2}/.test(value)) return true;
  if (/^\[.*条\]/.test(value)) return true;
  if (value.includes('：') && value.length > 10) return true;
  return false;
}

function pickLikelyConversationName(listTexts) {
  return (
    (Array.isArray(listTexts) ? listTexts : []).find((text) => {
      const value = String(text || '').trim();
      if (!value) return false;
      if (looksLikeConversationPreview(value)) return false;
      if (
        value.includes('AI搜索') ||
        value === '服务号' ||
        value === '公众号' ||
        value === '视频号' ||
        value === '账号'
      ) {
        return false;
      }
      return true;
    }) || ''
  );
}

async function readAccessibilitySummary() {
  const appleScript = `
tell application "System Events"
  if not (exists process "WeChat") then return "process_missing"
  tell process "WeChat"
    set frontState to frontmost as string
    set winNames to {}
    try
      repeat with w in windows
        try
          set end of winNames to name of w
        end try
      end repeat
    end try
    return frontState & linefeed & (winNames as string)
  end tell
end tell
`;
  const { stdout } = await execFile('osascript', ['-e', appleScript]);
  return stdout.trim();
}

async function main() {
  let activatedApp = '';
  let frontmostApp = '';
  let wechatWindowsRaw = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    activatedApp = await activateWechat();
    frontmostApp = await readFrontmostApp();
    wechatWindowsRaw = await readWechatWindows();
    if (
      (activatedApp === '微信' || activatedApp === 'WeChat') &&
      (frontmostApp === '微信' || frontmostApp === 'WeChat' || wechatWindowsRaw.includes('owner'))
    ) {
      break;
    }
  }
  const screenshotSize = await captureScreenshot();
  const parsedWechatWindows = parseWechatWindows(wechatWindowsRaw);
  const activeWechatWindow = pickPrimaryWechatWindow(parsedWechatWindows);
  cropWechatScreenshot(activeWechatWindow?.bounds || null);
  const listTexts = normalizeRecognizedTexts(runVisionOcr(LEFT_CROP_PATH));
  const headerTexts = normalizeRecognizedTexts(runVisionOcr(RIGHT_CROP_PATH));
  const highlightedConversation = detectHighlightedConversation(LEFT_CROP_PATH);
  const accessibilitySummary = await readAccessibilitySummary();
  const screenshotExists = await fs
    .stat(SCREENSHOT_PATH)
    .then(() => true)
    .catch(() => false);

  const activationSucceeded = activatedApp === '微信' || activatedApp === 'WeChat';
  const frontmostWechat = frontmostApp === '微信' || frontmostApp === 'WeChat';
  const wechatWindowVisible = wechatWindowsRaw.includes('owner');
  const looksReady = activationSucceeded && wechatWindowVisible && screenshotExists;
  const fallbackConversationName = pickLikelyConversationName(listTexts);
  const highlightedLooksLikePreview = looksLikeConversationPreview(highlightedConversation);
  const provisionalCurrentConversation = headerTexts[0] || '';
  const provisionalActiveConversation =
    (!highlightedLooksLikePreview && highlightedConversation) ||
    fallbackConversationName ||
    listTexts[0] ||
    '';
  const currentConversation = provisionalCurrentConversation || highlightedConversation || '';
  const activeConversation = provisionalActiveConversation;
  const selectedConversation = currentConversation || activeConversation || '';
  const matchedTarget =
    targetContact &&
    [currentConversation, activeConversation, selectedConversation].includes(targetContact)
      ? targetContact
      : '';
  const currentLooksLikeSearchResult =
    currentConversation.includes('搜一搜') ||
    activeConversation.includes('搜一搜') ||
    [currentConversation, activeConversation, highlightedConversation]
      .filter(Boolean)
      .some(
        (text) =>
          typeof text === 'string' &&
          (text.includes('AI搜索') ||
            text.includes('公众号') ||
            text.includes('视频号') ||
            text.includes('账号'))
      );
  const entityType =
    headerTexts.some((text) => typeof text === 'string' && text.includes('搜一搜')) ||
    currentLooksLikeSearchResult
      ? 'search-result'
      : matchedTarget &&
          currentConversation === targetContact &&
          activeConversation === targetContact
        ? 'contact'
        : 'unknown';

  const result = {
    ok: looksReady,
    stage: looksReady ? 'wechat_front_window_ready' : 'wechat_front_window_incomplete',
    activatedApp,
    frontmostApp,
    frontmostWechat,
    activationSucceeded,
    wechatWindowVisible,
    screenshotPath: SCREENSHOT_PATH,
    screenshotExists,
    screenshotSize,
    entityType,
    currentConversation,
    activeConversation,
    selectedConversation,
    highlightedConversation,
    matchedTarget,
    headerTexts,
    listTexts,
    activeWechatWindow: activeWechatWindow || undefined,
    wechatWindowsRaw,
    accessibilitySummary,
    nextStep:
      '当前脚本已增加微信现场会话快照读取，用于验证当前会话头与目标联系人是否一致；仍未触发真实发送。Codex/Electron 调试窗口可能会重新抢回前台，因此 frontmostWechat 只作为辅助信号。',
  };

  console.log(JSON.stringify(result, null, 2));
  if (!looksReady) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage: 'error',
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
