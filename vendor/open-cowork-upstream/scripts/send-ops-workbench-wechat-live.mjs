import { execFile as execFileCallback } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ALIGN_SCRIPT_PATH = resolve(SCRIPT_DIR, 'align-ops-workbench-wechat-contact-live.mjs');

const PYTHON =
  process.env.KAYPAL_AGENT_S_PYTHON ||
  process.env.PYTHON ||
  'python3';
const SCREENSHOT_PATH = '/private/tmp/wechat-ops-workbench-send-live.png';
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

const expectedDraft =
  (() => {
    const index = process.argv.indexOf('--expected');
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
delay 0.8
tell application "System Events" to get name of first process whose frontmost is true
`;
  const { stdout } = await execFile('osascript', ['-e', appleScript]);
  return stdout.trim();
}

async function captureScreenshot() {
  const code = `
import os
import tempfile
import pyautogui
from PIL import ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True
fd, tmp_path = tempfile.mkstemp(prefix="wechat-send-", suffix=".png", dir="/private/tmp")
os.close(fd)
img = pyautogui.screenshot()
img.save(tmp_path, format="PNG")
os.replace(tmp_path, ${JSON.stringify(SCREENSHOT_PATH)})
print(f"{img.size[0]}x{img.size[1]}")
`;
  const { stdout } = await execFile(PYTHON, ['-c', code]);
  return stdout.trim();
}

function parseSize(text) {
  const [w, h] = String(text || '')
    .trim()
    .split('x')
    .map((value) => Number.parseInt(value, 10));
  return {
    width: Number.isFinite(w) ? w : 3024,
    height: Number.isFinite(h) ? h : 1964,
  };
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
        width > 0 && height > 0 && (height <= 120 || width <= 420) && /搜一搜|Search|搜索/.test(title);
      const isGenericShellWindow = /\(窗口\)/.test(title);
      const isPrimaryNamedWindow = title === '微信';
      return {
        row,
        area,
        isSearchOverlay,
        isGenericShellWindow,
        isPrimaryNamedWindow,
      };
    })
    .sort((a, b) => {
      if (a.isSearchOverlay !== b.isSearchOverlay) return a.isSearchOverlay ? 1 : -1;
      if (a.isPrimaryNamedWindow !== b.isPrimaryNamedWindow) return a.isPrimaryNamedWindow ? -1 : 1;
      if (a.isGenericShellWindow !== b.isGenericShellWindow) return a.isGenericShellWindow ? 1 : -1;
      return b.area - a.area;
    });

  return scored[0]?.row || rows[0] || null;
}

function computeInputPoint(windowBounds, screenshotSize) {
  const screenWidthPoints = 1512;
  const screenHeightPoints = 982;
  const width = screenshotSize.width || 3024;
  const height = screenshotSize.height || 1964;
  const screenshotScaleX = width / screenWidthPoints;
  const screenshotScaleY = height / screenHeightPoints;
  const left = Math.max(0, Math.min(screenWidthPoints - 1, Math.round(windowBounds?.X || 0)));
  const top = Math.max(0, Math.min(screenHeightPoints - 1, Math.round(windowBounds?.Y || 0)));
  const winWidth = Math.max(
    160,
    Math.min(screenWidthPoints - left, Math.round(windowBounds?.Width || 1000))
  );
  const winHeight = Math.max(
    160,
    Math.min(screenHeightPoints - top, Math.round(windowBounds?.Height || 800))
  );

  return {
    x: Math.round(left + winWidth * 0.66),
    y: Math.round(top + winHeight * 0.96),
    screenshotX: Math.round((left + winWidth * 0.66) * screenshotScaleX),
    screenshotY: Math.round((top + winHeight * 0.96) * screenshotScaleY),
  };
}

async function readClipboard() {
  const { stdout } = await execFile('pbpaste');
  return stdout;
}

async function writeClipboard(text) {
  await execFile(
    'osascript',
    [
      '-e',
      `
set the clipboard to ${JSON.stringify(text)}
return "clipboard_set"
      `.trim(),
    ],
    { maxBuffer: 4 * 1024 * 1024 }
  );
}

async function readBackDraftFromInput(x, y, clipboardSentinel) {
  await writeClipboard(clipboardSentinel);
  const script = `
import pyautogui, time
pyautogui.click(${x}, ${y}, clicks=2, interval=0.18)
time.sleep(0.35)
pyautogui.hotkey('command', 'a')
time.sleep(0.25)
pyautogui.hotkey('command', 'c')
time.sleep(0.6)
pyautogui.press('right')
time.sleep(0.1)
print("copied")
`;
  await execFile(PYTHON, ['-c', script]);
  return readClipboard();
}

async function pressWechatSend() {
  const script = `
import pyautogui, time
pyautogui.press('enter')
time.sleep(1.0)
print("sent")
`;
  const { stdout } = await execFile(PYTHON, ['-c', script]);
  return stdout.trim();
}

async function main() {
  if (!targetContact) {
    throw new Error('Missing --target');
  }

  const { stdout: alignStdout } = await execFile(
    process.execPath,
    [ALIGN_SCRIPT_PATH, '--target', targetContact],
    {
      cwd: SCRIPT_DIR,
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  const alignPayload = JSON.parse(alignStdout);
  const currentConversation = String(
    alignPayload.currentConversation || alignPayload.selectedConversation || ''
  ).trim();
  const activeConversation = String(alignPayload.activeConversation || '').trim();
  const matchedTarget = String(alignPayload.matchedTarget || '').trim();
  const entityType = alignPayload.entityType === 'contact' ? 'contact' : alignPayload.entityType || 'unknown';
  const guardPassed =
    Boolean(alignPayload.aligned) &&
    entityType === 'contact' &&
    currentConversation === targetContact &&
    activeConversation === targetContact &&
    matchedTarget === targetContact;

  if (!guardPassed) {
    console.log(
      JSON.stringify(
        {
          ok: Boolean(alignPayload.ok),
          stage: 'contact_not_ready',
          sent: false,
          targetContact,
          currentConversation,
          activeConversation,
          matchedTarget,
          entityType,
          screenshotPath: alignPayload.screenshotPath || '',
          screenshotExists: Boolean(alignPayload.screenshotExists),
          note: '微信现场联系人还没完全对齐到目标对象，当前不允许真实发送。',
        },
        null,
        2
      )
    );
    return;
  }

  await activateWechat();
  const windowRows = parseWechatWindows(await readWechatWindows());
  const wechatWindow = pickPrimaryWechatWindow(windowRows);
  if (!wechatWindow?.bounds) {
    throw new Error('Unable to locate primary WeChat window');
  }

  const screenshotSizeText = await captureScreenshot();
  const screenshotSize = parseSize(screenshotSizeText);
  const inputPoint = computeInputPoint(wechatWindow.bounds, screenshotSize);
  const originalClipboard = await readClipboard().catch(() => '');
  const beforeSentinel = '__wechat_send_before__';
  const afterSentinel = '__wechat_send_after__';

  try {
    const readbackBefore = (await readBackDraftFromInput(inputPoint.x, inputPoint.y, beforeSentinel)).trim();
    if (!readbackBefore || readbackBefore === beforeSentinel) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            stage: 'draft_not_ready',
            sent: false,
            targetContact,
            currentConversation,
            activeConversation,
            matchedTarget,
            entityType,
            readbackText: '',
            screenshotPath: SCREENSHOT_PATH,
            screenshotExists: true,
            screenshotSize: screenshotSizeText,
            inputPoint,
            note: '微信输入框当前没有可发送的现场草稿，已阻断真实发送。',
          },
          null,
          2
        )
      );
      return;
    }

    if (expectedDraft && readbackBefore !== expectedDraft.trim()) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            stage: 'draft_not_ready',
            sent: false,
            targetContact,
            currentConversation,
            activeConversation,
            matchedTarget,
            entityType,
            readbackText: readbackBefore,
            screenshotPath: SCREENSHOT_PATH,
            screenshotExists: true,
            screenshotSize: screenshotSizeText,
            inputPoint,
            note: '微信现场草稿与作战台预期内容不一致，已阻断真实发送。',
          },
          null,
          2
        )
      );
      return;
    }

    await pressWechatSend();
    const readbackAfter = (await readBackDraftFromInput(inputPoint.x, inputPoint.y, afterSentinel)).trim();
    const finalScreenshotSizeText = await captureScreenshot();
    const inputCleared = !readbackAfter || readbackAfter === afterSentinel;

    console.log(
      JSON.stringify(
        {
          ok: inputCleared,
          stage: inputCleared ? 'sent' : 'send_failed',
          sent: inputCleared,
          targetContact,
          currentConversation,
          activeConversation,
          matchedTarget,
          entityType,
          readbackText: readbackBefore,
          postSendReadbackText: inputCleared ? '' : readbackAfter,
          screenshotPath: SCREENSHOT_PATH,
          screenshotExists: true,
          screenshotSize: finalScreenshotSizeText || screenshotSizeText,
          inputPoint,
          note: inputCleared
            ? '微信现场草稿已真实发出，并确认输入框已清空。'
            : '已触发发送动作，但输入框里仍有内容，当前需要人工复核是否真正发出。',
        },
        null,
        2
      )
    );
  } finally {
    await writeClipboard(originalClipboard).catch(() => {});
  }
}

main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        ok: false,
        stage: 'error',
        sent: false,
        targetContact,
        note: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(0);
});
