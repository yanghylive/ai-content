import { execFile as execFileCallback } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const execFile = promisify(execFileCallback);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const VALIDATE_SCRIPT_PATH = resolve(SCRIPT_DIR, 'validate-ops-workbench-wechat-live.mjs');
const PYTHON =
  process.env.KAYPAL_AGENT_S_PYTHON ||
  process.env.PYTHON ||
  'python3';
const SCREENSHOT_PATH = '/private/tmp/wechat-ops-workbench-live.png';

const targetContact =
  (() => {
    const index = process.argv.indexOf('--target');
    if (index >= 0 && process.argv[index + 1]) {
      return process.argv[index + 1].trim();
    }
    return '';
  })() || '';

async function trySelectWechatContact(contactName) {
  const script = `
tell application "System Events"
  if not (exists process "WeChat") then return "process_missing"
  set the clipboard to ${JSON.stringify(contactName)}
  tell process "WeChat"
    set frontmost to true
    delay 0.5
    key code 53
    delay 0.2
    key code 53
    delay 0.2
    keystroke "f" using command down
    delay 0.6
    keystroke "a" using command down
    delay 0.1
    key code 51
    delay 0.2
    keystroke "v" using command down
    delay 1.2
    key code 125
    delay 0.3
    key code 36
    delay 2.2
    return "attempted"
  end tell
end tell
`;
  const { stdout } = await execFile('osascript', ['-e', script], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

async function clickWechatSearchResult(contactName) {
  const screenshotExists = await fs
    .stat(SCREENSHOT_PATH)
    .then(() => true)
    .catch(() => false);
  if (!screenshotExists) {
    return 'no_screenshot';
  }

  const swiftCode = `
import Vision
import AppKit

let path = ${JSON.stringify(SCREENSHOT_PATH)}
let contact = ${JSON.stringify(contactName)}
guard let image = NSImage(contentsOfFile: path),
      let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let cg = rep.cgImage else {
  print("")
  exit(0)
}

let width = CGFloat(cg.width)
let height = CGFloat(cg.height)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["zh-Hans", "en-US"]
req.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try? handler.perform([req])

  var bestLine: String?
  var bestScore: CGFloat = -1

for obs in req.results ?? [] {
  guard let cand = obs.topCandidates(1).first else { continue }
  let text = cand.string.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { continue }
  if !text.contains(contact) { continue }
  let b = obs.boundingBox
  let x = b.origin.x * width
  let y = (1 - b.origin.y - b.size.height) * height
  let w = b.size.width * width
  let h = b.size.height * height
  if x < 120 || x > width * 0.55 { continue }
  if y < height * 0.18 || y > height * 0.82 { continue }

  let isTopSearchEcho = y < height * 0.23
  let isRightSuggestion = x > width * 0.42
  if isTopSearchEcho || isRightSuggestion { continue }

  let isLikelyPrimaryResult = text.contains("账号") || text.contains("公众号")
  let clickX = Int(max(220, min(width * 0.44, x + max(50, min(w * 0.28, 120)))))
  let clickY = Int(y + max(22, min(h * 0.65, 68)))
  let score =
    (isLikelyPrimaryResult ? 4000 : 0) +
    (height * 0.80 - y) +
    (width * 0.40 - x)
  if score > bestScore {
    bestScore = score
    bestLine = "\\(clickX),\\(clickY)|\\(text)"
  }
}

print(bestLine ?? "")
`;

  const { stdout } = await execFile('swift', ['-'], {
    input: swiftCode,
    maxBuffer: 8 * 1024 * 1024,
  });

  const line = stdout.trim();
  if (!line) {
    return 'no_match';
  }

  const [coords] = line.split('|');
  const [xText, yText] = coords.split(',');
  const x = Number.parseInt(xText || '', 10);
  const y = Number.parseInt(yText || '', 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return 'bad_match';
  }

  await execFile(PYTHON, [
    '-c',
    `
import pyautogui
pyautogui.click(${x}, ${y})
print("clicked")
    `.trim(),
  ]);
  await execFile(PYTHON, [
    '-c',
    `
import pyautogui, time
time.sleep(0.35)
pyautogui.click(${x}, ${y})
print("clicked_twice")
    `.trim(),
  ]);
  return `clicked:${x},${y}`;
}

async function clickWechatConversationFromList(contactName) {
  const screenshotExists = await fs
    .stat('/private/tmp/wechat-left-active-live.png')
    .then(() => true)
    .catch(() => false);
  if (!screenshotExists) {
    return 'no_list_crop';
  }

  const swiftCode = `
import Vision
import AppKit

let path = "/private/tmp/wechat-left-active-live.png"
let contact = ${JSON.stringify(contactName)}
guard let image = NSImage(contentsOfFile: path),
      let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let cg = rep.cgImage else {
  print("")
  exit(0)
}

let width = CGFloat(cg.width)
let height = CGFloat(cg.height)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["zh-Hans", "en-US"]
req.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try? handler.perform([req])

var bestLine: String?
var bestScore: CGFloat = -1
for obs in req.results ?? [] {
  guard let cand = obs.topCandidates(1).first else { continue }
  let text = cand.string.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty || !text.contains(contact) { continue }
  let b = obs.boundingBox
  let x = b.origin.x * width
  let y = (1 - b.origin.y - b.size.height) * height
  let w = b.size.width * width
  let h = b.size.height * height
  let clickX = Int(max(120, min(width - 40, x + min(max(w * 0.18, 50), 90))))
  let clickY = Int(max(40, min(height - 30, y + max(min(h * 0.8, 48), 24))))
  let score = (height - y) - x
  if score > bestScore {
    bestScore = score
    bestLine = "\\(clickX),\\(clickY)|\\(text)"
  }
}

print(bestLine ?? "")
`;

  const { stdout } = await execFile('swift', ['-'], {
    input: swiftCode,
    maxBuffer: 8 * 1024 * 1024,
  });
  const line = stdout.trim();
  if (!line) {
    return 'no_contact_in_list';
  }

  const [coords] = line.split('|');
  const [cropXText, cropYText] = coords.split(',');
  const cropX = Number.parseInt(cropXText || '', 10);
  const cropY = Number.parseInt(cropYText || '', 10);
  if (!Number.isFinite(cropX) || !Number.isFinite(cropY)) {
    return 'bad_list_match';
  }

  const screenX = 370 * 2 + 80 + cropX;
  const screenY = 129 * 2 + 98 + cropY;
  await execFile(PYTHON, [
    '-c',
    `
import pyautogui
pyautogui.click(${screenX}, ${screenY})
print("clicked_list")
    `.trim(),
  ]);
  return `clicked_list:${screenX},${screenY}`;
}

function isWechatSearchState(payload) {
  const headerTexts = Array.isArray(payload?.headerTexts) ? payload.headerTexts : [];
  const listTexts = Array.isArray(payload?.listTexts) ? payload.listTexts : [];
  const currentConversation = String(payload?.currentConversation || '');
  return (
    headerTexts.some((text) => typeof text === 'string' && text.includes('搜一搜')) ||
    listTexts.some((text) => typeof text === 'string' && (text.includes('AI搜索') || text.startsWith('全部'))) ||
    currentConversation.includes('搜一搜')
  );
}

async function main() {
  if (!targetContact) {
    throw new Error('Missing --target');
  }

  const alignAttempt = await trySelectWechatContact(targetContact).catch((error) => {
    return error instanceof Error ? `error:${error.message}` : `error:${String(error)}`;
  });

  const { stdout } = await execFile(
    process.execPath,
    [VALIDATE_SCRIPT_PATH, '--target', targetContact],
    {
      cwd: SCRIPT_DIR,
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  const payload = JSON.parse(stdout);
  const looksLikeSearchOverlay = isWechatSearchState(payload);
  const headerLooksBroken =
    typeof payload.currentConversation === 'string' &&
    payload.currentConversation.trim().length > 0 &&
    payload.currentConversation.trim().length <= 4 &&
    !payload.matchedTarget;
  let resolvedPayload = payload;
  let fallbackResult = '';

  if (
    looksLikeSearchOverlay ||
    headerLooksBroken ||
    payload.entityType === 'search-result' ||
    String(payload.currentConversation || '').includes('搜一搜') ||
    !payload.matchedTarget
  ) {
    fallbackResult = await clickWechatSearchResult(targetContact);
    if (fallbackResult.startsWith('clicked:')) {
      const retry = await execFile(
        process.execPath,
        [VALIDATE_SCRIPT_PATH, '--target', targetContact],
        {
          cwd: SCRIPT_DIR,
          maxBuffer: 8 * 1024 * 1024,
        }
      );
      resolvedPayload = JSON.parse(retry.stdout);
      if (isWechatSearchState(resolvedPayload)) {
        fallbackResult = `${fallbackResult}|retry_search_state`;
        const secondClickResult = await clickWechatSearchResult(targetContact);
        if (secondClickResult.startsWith('clicked:')) {
          const secondRetry = await execFile(
            process.execPath,
            [VALIDATE_SCRIPT_PATH, '--target', targetContact],
            {
              cwd: SCRIPT_DIR,
              maxBuffer: 8 * 1024 * 1024,
            }
          );
          resolvedPayload = JSON.parse(secondRetry.stdout);
          fallbackResult = `${fallbackResult}|${secondClickResult}`;
        } else {
          fallbackResult = `${fallbackResult}|${secondClickResult}`;
        }
      }
    }
  }

  if (!resolvedPayload.matchedTarget) {
    const listClickResult = await clickWechatConversationFromList(targetContact);
    fallbackResult = fallbackResult ? `${fallbackResult}|${listClickResult}` : listClickResult;
    if (listClickResult.startsWith('clicked_list:')) {
      const postListClick = await execFile(
        process.execPath,
        [VALIDATE_SCRIPT_PATH, '--target', targetContact],
        {
          cwd: SCRIPT_DIR,
          maxBuffer: 8 * 1024 * 1024,
        }
      );
      resolvedPayload = JSON.parse(postListClick.stdout);
    }
  }

  const resolvedLooksLikeSearchOverlay = isWechatSearchState(resolvedPayload);
  const resolvedHeaderLooksBroken =
    typeof resolvedPayload.currentConversation === 'string' &&
    resolvedPayload.currentConversation.trim().length > 0 &&
    resolvedPayload.currentConversation.trim().length <= 4 &&
    !resolvedPayload.matchedTarget;
  const currentConversationMatches =
    String(resolvedPayload.currentConversation || '').trim() === targetContact;
  const activeConversationMatches =
    String(resolvedPayload.activeConversation || '').trim() === targetContact;
  const aligned =
    resolvedPayload.matchedTarget === targetContact &&
    currentConversationMatches &&
    activeConversationMatches &&
    !resolvedLooksLikeSearchOverlay &&
    !String(resolvedPayload.currentConversation || '').includes('搜一搜');
  const entityType =
    resolvedPayload.entityType === 'contact' || resolvedPayload.entityType === 'search-result'
      ? resolvedPayload.entityType
      : aligned
        ? 'contact'
        : resolvedLooksLikeSearchOverlay
          ? 'search-result'
          : 'unknown';

  const result = {
    ok: Boolean(resolvedPayload.ok),
    targetContact,
    alignAttempted: true,
    aligned,
    entityType,
    attemptResult: alignAttempt,
    fallbackResult,
    screenshotPath: resolvedPayload.screenshotPath,
    screenshotExists: Boolean(resolvedPayload.screenshotExists),
    activeConversation: resolvedPayload.activeConversation || '',
    currentConversation: resolvedPayload.currentConversation || '',
    selectedConversation: resolvedPayload.selectedConversation || '',
    matchedTarget: resolvedPayload.matchedTarget || '',
    headerTexts: resolvedPayload.headerTexts || [],
    listTexts: resolvedPayload.listTexts || [],
    noteFlags: {
      looksLikeSearchOverlay: resolvedLooksLikeSearchOverlay,
      headerLooksBroken: resolvedHeaderLooksBroken,
    },
    note: aligned
      ? `已切到目标联系人“${targetContact}”。`
      : resolvedLooksLikeSearchOverlay || resolvedHeaderLooksBroken
        ? `已尝试切到目标联系人“${targetContact}”，但当前仍停留在搜索/过渡态，需要继续等待或二次确认。`
        : `已尝试切到目标联系人“${targetContact}”，但当前会话仍未对齐。`,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
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
