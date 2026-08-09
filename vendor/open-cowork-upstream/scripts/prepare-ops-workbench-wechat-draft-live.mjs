import { execFile as execFileCallback } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ALIGN_SCRIPT_PATH = resolve(SCRIPT_DIR, 'align-ops-workbench-wechat-contact-live.mjs');
const VALIDATE_SCRIPT_PATH = resolve(SCRIPT_DIR, 'validate-ops-workbench-wechat-live.mjs');

const PYTHON =
  process.env.KAYPAL_AGENT_S_PYTHON ||
  process.env.PYTHON ||
  'python3';
const SCREENSHOT_PATH = '/private/tmp/wechat-ops-workbench-draft-live.png';
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

const draftText =
  (() => {
    const index = process.argv.indexOf('--draft');
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
fd, tmp_path = tempfile.mkstemp(prefix="wechat-draft-", suffix=".png", dir="/private/tmp")
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
  const [w, h] = String(text || '').trim().split('x').map((value) => Number.parseInt(value, 10));
  return {
    width: Number.isFinite(w) ? w : 3024,
    height: Number.isFinite(h) ? h : 1964,
  };
}

function computeInputPoint(windowBounds, screenshotSize) {
  const screenWidthPoints = 1512;
  const screenHeightPoints = 982;
  const width = screenshotSize.width || 3024;
  const height = screenshotSize.height || 1964;
  const screenshotScaleX = width / screenWidthPoints;
  const screenshotScaleY = height / screenHeightPoints;
  const left = Math.max(
    0,
    Math.min(screenWidthPoints - 1, Math.round(windowBounds?.X || 0))
  );
  const top = Math.max(
    0,
    Math.min(screenHeightPoints - 1, Math.round(windowBounds?.Y || 0))
  );
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

async function clearAndPasteDraft(x, y, draft) {
  const script = `
import pyautogui, time
pyautogui.click(${x}, ${y}, clicks=3, interval=0.18)
time.sleep(0.35)
pyautogui.hotkey('command', 'a')
time.sleep(0.25)
pyautogui.press('backspace')
time.sleep(0.2)
pyautogui.hotkey('command', 'v')
time.sleep(0.9)
print("draft_pasted")
`;
  const { stdout } = await execFile(PYTHON, ['-c', script]);
  return stdout.trim();
}

async function readBackDraftFromInput(x, y) {
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

async function main() {
  if (!targetContact) {
    throw new Error('Missing --target');
  }
  if (!draftText) {
    throw new Error('Missing --draft');
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
  const entityType = alignPayload.entityType === 'contact' ? 'contact' : alignPayload.entityType || 'unknown';
  const canPrepare =
    Boolean(alignPayload.aligned) &&
    entityType === 'contact' &&
    currentConversation === targetContact &&
    activeConversation === targetContact;

  if (!canPrepare) {
    console.log(
      JSON.stringify(
        {
          ok: Boolean(alignPayload.ok),
          stage: 'contact_not_ready',
          targetContact,
          draftText,
          draftInserted: false,
          inputReady: false,
          currentConversation,
          activeConversation,
          matchedTarget: alignPayload.matchedTarget || '',
          entityType,
          screenshotPath: alignPayload.screenshotPath || '',
          note: '微信现场联系人还没完全对齐到目标对象，当前不执行现场草稿准备。',
        },
        null,
        2
      )
    );
    return;
  }

  await activateWechat();
  const { stdout: liveStdout } = await execFile(
    process.execPath,
    [VALIDATE_SCRIPT_PATH, '--target', targetContact],
    {
      cwd: SCRIPT_DIR,
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  const livePayload = JSON.parse(liveStdout);
  const wechatWindow = livePayload?.activeWechatWindow;
  if (!wechatWindow?.bounds) {
    throw new Error('Unable to locate primary WeChat window from live snapshot');
  }

  const screenshotSizeText = await captureScreenshot();
  const screenshotSize = parseSize(screenshotSizeText);
  const inputPoint = computeInputPoint(wechatWindow.bounds, screenshotSize);
  const originalClipboard = await readClipboard().catch(() => '');

  try {
    await writeClipboard(draftText);
    await clearAndPasteDraft(inputPoint.x, inputPoint.y, draftText);
    const readback = (await readBackDraftFromInput(inputPoint.x, inputPoint.y)).trim();
    const finalScreenshotSizeText = await captureScreenshot();

    console.log(
      JSON.stringify(
        {
          ok: true,
          stage: readback.includes(draftText) ? 'draft_ready_for_send_confirmation' : 'draft_readback_incomplete',
          targetContact,
          draftText,
          draftInserted: readback.includes(draftText),
          inputReady: true,
          readbackText: readback,
          currentConversation,
          activeConversation,
          matchedTarget: alignPayload.matchedTarget || '',
          entityType,
          screenshotPath: SCREENSHOT_PATH,
          screenshotExists: true,
          screenshotSize: finalScreenshotSizeText || screenshotSizeText,
          inputPoint,
          note: readback.includes(draftText)
            ? '现场草稿已真实写入微信输入框，并完成回读；当前停在发送前。'
            : '现场草稿已尝试写入微信输入框，但回读不完整，需要人工复核。',
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
