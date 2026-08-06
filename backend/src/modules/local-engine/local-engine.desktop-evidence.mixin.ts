/**
 * desktop 证据簇 mixin（截图/窗口帧/无障碍读取/OCR 差异检测）。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式。
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { platform } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

import type {
  LocalEngineDesktopScreenshotEvidence,
  UpdateWechatSessionConfirmationInput,
} from './local-engine.types';

/** desktop 证据簇的 host 接口 */
export interface DesktopEvidenceHost {
  desktopEvidence: LocalEngineDesktopScreenshotEvidence[];
  wechatSessionConfirmation: UpdateWechatSessionConfirmationInput & {
    updatedAt?: string;
    takeoverActive?: boolean;
    stoppedAt?: string;
    stopReason?: string;
    lockedWindowTitle?: string | null;
    lockCapturedAt?: string;
    alignment?: {
      ok?: boolean;
      lockedWindowTitle?: string | null;
      targetContact?: string;
      trusted?: boolean;
      capturedAt?: string;
      pageTextSample?: string;
      screenshotPath?: string;
    };
    contactAmbiguityResolved?: boolean;
  };
  captureDesktopScreenshot(
    label: string,
  ): Promise<LocalEngineDesktopScreenshotEvidence>;
  readWechatWindowFrame(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null>;
  readWechatWindowFrameFromAccessibility(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null>;
  readWechatWindowFrameFromCoreGraphics(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null>;
  readWechatWindowCaptureInfo(frame: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<{ windowId?: number; shareable?: boolean } | null>;
  readDesktopScreenshotText(imagePath: string): Promise<string>;
  detectWechatScreenshotMismatch(textSample: string): string | null;
  hasTrustedWechatAlignmentLock();
  isWechatScreenshotSoftDiagnostic(diagnostic?: string | null);
  detectWechatScreenshotSessionBlocker(
    textSample?: string | null,
  ): string | null;
  runCommand(command: string, args: string[], timeoutMs: number);
  rememberDesktopEvidence(evidence?: LocalEngineDesktopScreenshotEvidence);
  getProjectLogRoot(): string;
}

export async function captureDesktopScreenshot(
  this: DesktopEvidenceHost,
  label: string,
): Promise<LocalEngineDesktopScreenshotEvidence> {
  if (platform() !== 'darwin') {
    return {
      type: 'text',
      label,
      value: `当前系统 ${platform()} 不支持桌面截图。`,
      capturedAt: new Date().toISOString(),
    };
  }

  const evidenceDir = join(this.getProjectLogRoot(), 'evidence');
  await mkdir(evidenceDir, { recursive: true });
  const capturedAt = new Date();
  const filename = `desktop-wechat-${capturedAt.toISOString().replace(/[:.]/g, '-')}.png`;
  const screenshotPath = join(evidenceDir, filename);
  const frame = await this.readWechatWindowFrame();
  if (!frame) {
    return {
      type: 'text',
      label,
      value: '未读取到可截图的桌面微信主窗口；已拒绝抓取全屏作为微信证据。',
      capturedAt: capturedAt.toISOString(),
      trusted: false,
      diagnostic: '未读取到桌面微信主窗口，不能把全屏截图当作微信会话证据。',
    };
  }
  if (frame.shareable === false) {
    return {
      type: 'text',
      label,
      value:
        '桌面微信主窗口当前禁止屏幕采集或内容不可见；已拒绝把下层窗口截图当作微信证据。',
      capturedAt: capturedAt.toISOString(),
      trusted: false,
      diagnostic:
        '桌面微信主窗口当前禁止屏幕采集或内容不可见，不能确认是真实微信会话窗口。',
    };
  }

  await this.runCommand(
    'screencapture',
    frame.windowId
      ? ['-x', '-l', String(frame.windowId), screenshotPath]
      : [
          '-x',
          '-R',
          `${frame.x},${frame.y},${frame.width},${frame.height}`,
          screenshotPath,
        ],
    3000,
  );
  const textSample = await this.readDesktopScreenshotText(screenshotPath);
  const diagnostic =
    textSample.trim().length === 0
      ? '当前微信窗口截图没有识别到可验证内容，不能确认是真实微信会话窗口。'
      : this.detectWechatScreenshotMismatch(textSample);
  return {
    type: 'screenshot',
    label,
    value: screenshotPath,
    capturedAt: capturedAt.toISOString(),
    trusted: diagnostic ? false : true,
    diagnostic: diagnostic || undefined,
    textSample: textSample || undefined,
  };
}

export async function readWechatWindowFrame(
  this: DesktopEvidenceHost,
): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  windowId?: number;
  shareable?: boolean;
} | null> {
  if (platform() !== 'darwin') {
    return null;
  }
  const coreGraphicsFrame = await this.readWechatWindowFrameFromCoreGraphics();
  if (coreGraphicsFrame) {
    return coreGraphicsFrame;
  }
  return this.readWechatWindowFrameFromAccessibility();
}

export async function readWechatWindowFrameFromAccessibility(
  this: DesktopEvidenceHost,
): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  windowId?: number;
  shareable?: boolean;
} | null> {
  const script = [
    'tell application "System Events"',
    'tell process "微信"',
    'repeat with appWindow in windows',
    'set windowNameText to ""',
    'set windowDescriptionText to ""',
    'set windowPositionValue to {0, 0}',
    'set windowSizeValue to {0, 0}',
    'try',
    'set windowNameText to name of appWindow as text',
    'end try',
    'try',
    'set windowDescriptionText to description of appWindow as text',
    'end try',
    'try',
    'set windowPositionValue to position of appWindow',
    'set windowSizeValue to size of appWindow',
    'end try',
    'if (item 1 of windowSizeValue) > 200 and (item 2 of windowSizeValue) > 200 and (windowNameText is "微信" or windowDescriptionText is "标准窗口") then',
    'return (item 1 of windowPositionValue as text) & "," & (item 2 of windowPositionValue as text) & "," & (item 1 of windowSizeValue as text) & "," & (item 2 of windowSizeValue as text)',
    'end if',
    'end repeat',
    'end tell',
    'end tell',
    'return ""',
  ].join('\n');
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });
    const values = String(stdout || '')
      .trim()
      .split(',')
      .map((value) => Number.parseInt(value, 10));
    if (
      values.length !== 4 ||
      values.some((value) => Number.isNaN(value) || value < 0)
    ) {
      return null;
    }
    const [x, y, width, height] = values;
    const windowInfo = await this.readWechatWindowCaptureInfo({
      x,
      y,
      width,
      height,
    });
    return {
      x,
      y,
      width,
      height,
      windowId: windowInfo?.windowId,
      shareable: windowInfo?.shareable,
    };
  } catch {
    return null;
  }
}

export async function readWechatWindowFrameFromCoreGraphics(
  this: DesktopEvidenceHost,
): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  windowId?: number;
  shareable?: boolean;
} | null> {
  const swiftSource = [
    'import Foundation',
    'import CoreGraphics',
    'struct Candidate { let title: String; let owner: String; let id: Int; let x: Int; let y: Int; let width: Int; let height: Int; let shareable: Bool? }',
    'let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []',
    'var candidates = [Candidate]()',
    'for window in windows {',
    '  let owner = window[kCGWindowOwnerName as String] as? String ?? ""',
    '  let title = window[kCGWindowName as String] as? String ?? ""',
    '  guard owner.contains("微信") || owner.contains("WeChat") || title.contains("微信") || title.contains("WeChat") else { continue }',
    '  let layer = window[kCGWindowLayer as String] as? Int ?? 0',
    '  guard layer == 0 else { continue }',
    '  guard let bounds = window[kCGWindowBounds as String] as? [String: Any] else { continue }',
    '  let width = Int(bounds["Width"] as? Double ?? Double(bounds["Width"] as? Int ?? 0))',
    '  let height = Int(bounds["Height"] as? Double ?? Double(bounds["Height"] as? Int ?? 0))',
    '  let x = Int(bounds["X"] as? Double ?? Double(bounds["X"] as? Int ?? 0))',
    '  let y = Int(bounds["Y"] as? Double ?? Double(bounds["Y"] as? Int ?? 0))',
    '  guard width >= 240 && height >= 240 else { continue }',
    '  let id = window[kCGWindowNumber as String] as? Int ?? 0',
    '  guard id > 0 else { continue }',
    '  let sharing = window[kCGWindowSharingState as String] as? Int ?? -1',
    '  let shareable: Bool? = sharing < 0 ? nil : sharing > 0',
    '  candidates.append(Candidate(title: title, owner: owner, id: id, x: x, y: y, width: width, height: height, shareable: shareable))',
    '}',
    'func rank(_ item: Candidate) -> Int {',
    '  let title = item.title.isEmpty ? item.owner : item.title',
    '  if item.title == "微信 (窗口)" || item.title == "微信" || item.title == "WeChat" { return 4 }',
    '  if item.title.contains("朋友圈") { return 3 }',
    '  if item.title.isEmpty { return 1 }',
    '  return 1',
    '}',
    'if let best = candidates.sorted(by: {',
    '  let leftRank = rank($0)',
    '  let rightRank = rank($1)',
    '  if leftRank != rightRank { return leftRank > rightRank }',
    '  let leftShareable = ($0.shareable ?? true) ? 1 : 0',
    '  let rightShareable = ($1.shareable ?? true) ? 1 : 0',
    '  if leftShareable != rightShareable { return leftShareable > rightShareable }',
    '  return ($0.width * $0.height) > ($1.width * $1.height)',
    '}).first {',
    '  print([String(best.x), String(best.y), String(best.width), String(best.height), String(best.id), best.shareable == false ? "blocked" : "shareable"].joined(separator: ","))',
    '}',
  ].join('\n');
  try {
    const { stdout } = await execFileAsync('swift', ['-e', swiftSource], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const [xRaw, yRaw, widthRaw, heightRaw, idRaw, stateRaw] = String(
      stdout || '',
    )
      .trim()
      .split(',');
    const values = [xRaw, yRaw, widthRaw, heightRaw].map((value) =>
      Number.parseInt(value || '', 10),
    );
    if (
      values.length !== 4 ||
      values.some((value) => Number.isNaN(value) || value < 0)
    ) {
      return null;
    }
    const windowId = Number.parseInt(idRaw || '', 10);
    return {
      x: values[0],
      y: values[1],
      width: values[2],
      height: values[3],
      windowId:
        Number.isFinite(windowId) && windowId > 0 ? windowId : undefined,
      shareable:
        stateRaw?.trim() === 'blocked'
          ? false
          : stateRaw?.trim() === 'shareable'
            ? true
            : undefined,
    };
  } catch {
    return null;
  }
}

export async function readWechatWindowCaptureInfo(
  this: DesktopEvidenceHost,
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
): Promise<{ windowId?: number; shareable?: boolean } | null> {
  const swiftSource = [
    'import Foundation',
    'import CoreGraphics',
    'let args = CommandLine.arguments',
    'guard args.count >= 5,',
    '  let expectedX = Int(args[1]),',
    '  let expectedY = Int(args[2]),',
    '  let expectedWidth = Int(args[3]),',
    '  let expectedHeight = Int(args[4]) else { exit(2) }',
    'struct Candidate { let title: String; let owner: String; let id: Int; let sharing: Int?; let area: Int }',
    'let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []',
    'var candidates = [Candidate]()',
    'for window in windows {',
    '  let owner = window[kCGWindowOwnerName as String] as? String ?? ""',
    '  let name = window[kCGWindowName as String] as? String ?? ""',
    '  guard owner.contains("微信") || owner.contains("WeChat") || name.contains("微信") || name.contains("WeChat") else { continue }',
    '  guard let bounds = window[kCGWindowBounds as String] as? [String: Any] else { continue }',
    '  let x = Int(bounds["X"] as? Double ?? Double(bounds["X"] as? Int ?? -1))',
    '  let y = Int(bounds["Y"] as? Double ?? Double(bounds["Y"] as? Int ?? -1))',
    '  let width = Int(bounds["Width"] as? Double ?? Double(bounds["Width"] as? Int ?? -1))',
    '  let height = Int(bounds["Height"] as? Double ?? Double(bounds["Height"] as? Int ?? -1))',
    '  guard abs(x - expectedX) <= 2, abs(y - expectedY) <= 2, abs(width - expectedWidth) <= 2, abs(height - expectedHeight) <= 2 else { continue }',
    '  let windowId = window[kCGWindowNumber as String] as? Int ?? 0',
    '  guard windowId > 0 else { continue }',
    '  let sharingState = window[kCGWindowSharingState as String] as? Int',
    '  candidates.append(Candidate(title: name, owner: owner, id: windowId, sharing: sharingState, area: width * height))',
    '}',
    'func rank(_ item: Candidate) -> Int {',
    '  let title = item.title.isEmpty ? item.owner : item.title',
    '  if title == "微信 (窗口)" || title == "微信" || title == "WeChat" { return 4 }',
    '  if item.title.isEmpty { return 1 }',
    '  if title.contains("微信") || title.contains("WeChat") { return 2 }',
    '  return 0',
    '}',
    'if let best = candidates.sorted(by: {',
    '  let leftRank = rank($0)',
    '  let rightRank = rank($1)',
    '  if leftRank != rightRank { return leftRank > rightRank }',
    '  let leftShareable = ($0.sharing ?? 1) > 0 ? 1 : 0',
    '  let rightShareable = ($1.sharing ?? 1) > 0 ? 1 : 0',
    '  if leftShareable != rightShareable { return leftShareable > rightShareable }',
    '  return $0.area > $1.area',
    '}).first {',
    '  let state = best.sharing == nil ? "unknown" : ((best.sharing ?? 0) > 0 ? "shareable" : "blocked")',
    '  print("\\(best.id),\\(state)")',
    '} else {',
    '  print("0,unknown")',
    '}',
  ].join('\n');
  try {
    const { stdout } = await execFileAsync(
      'swift',
      [
        '-e',
        swiftSource,
        String(frame.x),
        String(frame.y),
        String(frame.width),
        String(frame.height),
      ],
      {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      },
    );
    const [idRaw, stateRaw] = String(stdout || '')
      .trim()
      .split(',');
    const windowId = Number.parseInt(idRaw || '', 10);
    const state = stateRaw?.trim();
    return {
      windowId:
        Number.isFinite(windowId) && windowId > 0 ? windowId : undefined,
      shareable:
        state === 'blocked' ? false : state === 'shareable' ? true : undefined,
    };
  } catch {
    return null;
  }
}

export async function readDesktopScreenshotText(
  this: DesktopEvidenceHost,
  imagePath: string,
): Promise<string> {
  if (!imagePath || !existsSync(imagePath) || platform() !== 'darwin') {
    return '';
  }
  const swiftSource = [
    'import Foundation',
    'import Vision',
    'import AppKit',
    'let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""',
    'let url = URL(fileURLWithPath: path)',
    'guard let image = NSImage(contentsOf: url), let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let cg = bitmap.cgImage else { exit(0) }',
    'var output = [String]()',
    'let request = VNRecognizeTextRequest { request, error in',
    '  if error != nil { return }',
    '  output = (request.results as? [VNRecognizedTextObservation] ?? []).compactMap { $0.topCandidates(1).first?.string }',
    '}',
    'request.recognitionLanguages = ["zh-Hans", "en-US"]',
    'request.recognitionLevel = .accurate',
    'request.usesLanguageCorrection = true',
    'let handler = VNImageRequestHandler(cgImage: cg, options: [:])',
    'try? handler.perform([request])',
    'print(output.joined(separator: "\\n"))',
  ].join('\n');
  try {
    const { stdout } = await execFileAsync(
      'swift',
      ['-e', swiftSource, imagePath],
      {
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return String(stdout || '')
      .trim()
      .slice(0, 1200);
  } catch {
    return '';
  }
}

export function detectWechatScreenshotMismatch(
  this: DesktopEvidenceHost,
  textSample: string,
): string | null {
  const normalized = textSample.replace(/\s+/g, '');
  if (!normalized) {
    return null;
  }
  const browserMarkers = [
    'codex.maynor1024.live',
    'test.kaypal.cn/api/desktop-auth/authorize',
    'desktop-auth/authorize',
    '已允许连接',
    '可以回到KaypalDesktop',
    'KaypalDesktop',
    'Kaypal内容工作台',
    '豆包',
    '扣子空间',
    'DeepSeek',
    'MiniMax',
    'nuwax-ai',
    '我的订阅',
    'API密钥',
    'API-Red',
    '使用记录',
    '渠道状态',
    'OpenAI',
    'Chrome',
    '所有书签',
    '微信公众平台',
    'localhost:3010',
    '127.0.0.1:3010',
  ];
  const decisiveBrowserMarkers = [
    'codex.maynor1024.live',
    'test.kaypal.cn/api/desktop-auth/authorize',
    'desktop-auth/authorize',
    '已允许连接',
    '可以回到KaypalDesktop',
    'KaypalDesktop',
    'Kaypal内容工作台',
  ];
  const strongWechatMarkers = [
    '文件传输助手',
    '通讯录',
    '朋友圈',
    '聊天信息',
    '订阅号',
    '服务号',
    '群聊',
    '发送',
    '语音输入',
    '表情',
  ];
  const looksLikeBrowser = browserMarkers.some((marker) =>
    normalized.includes(marker.replace(/\s+/g, '')),
  );
  const hasDecisiveBrowserMarker = decisiveBrowserMarkers.some((marker) =>
    normalized.includes(marker.replace(/\s+/g, '')),
  );
  const looksLikeWechat = strongWechatMarkers.some((marker) =>
    normalized.includes(marker.replace(/\s+/g, '')),
  );
  if (looksLikeBrowser && (hasDecisiveBrowserMarker || !looksLikeWechat)) {
    if (normalized.includes('codex.maynor1024.live')) {
      return '当前截图识别到浏览器订阅页内容，不是可验证的微信会话窗口。';
    }
    if (
      normalized.includes('desktop-auth/authorize') ||
      normalized.includes('已允许连接') ||
      normalized.includes('可以回到KaypalDesktop')
    ) {
      return '当前截图识别到 Kaypal 授权页内容，不是可验证的微信会话窗口。';
    }
    return '当前截图识别到浏览器页面内容，不是可验证的微信会话窗口。';
  }
  return null;
}

export function hasTrustedWechatAlignmentLock(this: DesktopEvidenceHost) {
  const alignment = this.wechatSessionConfirmation.alignment;
  return (
    alignment?.ok === true &&
    this.wechatSessionConfirmation.currentWindowConfirmed === true &&
    this.wechatSessionConfirmation.contactConfirmed === true &&
    this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
    this.wechatSessionConfirmation.contactAmbiguityResolved === true &&
    Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
    Boolean(
      alignment.pageTextSample?.trim() || alignment.screenshotPath?.trim(),
    )
  );
}

export function isWechatScreenshotSoftDiagnostic(
  this: DesktopEvidenceHost,
  diagnostic?: string | null,
) {
  const value = String(diagnostic || '');
  if (!value.trim()) return false;
  return (
    /没有识别到可验证内容|OCR|文字/.test(value) &&
    !/浏览器|授权页|登录|二维码|文件传输助手|下层窗口|不可见/.test(value)
  );
}

export function detectWechatScreenshotSessionBlocker(
  this: DesktopEvidenceHost,
  textSample?: string | null,
): string | null {
  const normalized = String(textSample || '').replace(/\s+/g, '');
  if (!normalized) {
    return null;
  }
  if (
    normalized.includes('微信文件传输助手网页版') ||
    (normalized.includes('文件传输助手') &&
      (normalized.includes('网页版') || normalized.includes('二维码')))
  ) {
    return '当前是微信文件传输助手网页版二维码，不是桌面微信聊天会话。';
  }
  if (
    normalized.includes('进入微信') ||
    normalized.includes('切换账号') ||
    normalized.includes('仅传输文件')
  ) {
    return '当前停在微信登录/选择账号页，不是桌面微信聊天会话。';
  }
  if (
    normalized.includes('扫码登录') ||
    normalized.includes('请使用微信扫描二维码') ||
    normalized.includes('二维码登录')
  ) {
    return '当前停在扫码登录页，不是桌面微信聊天会话。';
  }
  return null;
}

export function runCommand(
  this: DesktopEvidenceHost,
  command: string,
  args: string[],
  timeoutMs: number,
) {
  return new Promise<void>((resolveResult, rejectResult) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectResult(new Error(`${command} 执行超时`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectResult(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolveResult();
        return;
      }
      rejectResult(new Error(`${command} 退出码 ${code}`));
    });
  });
}

export function rememberDesktopEvidence(
  this: DesktopEvidenceHost,
  evidence?: LocalEngineDesktopScreenshotEvidence,
) {
  if (!evidence) {
    return;
  }
  this.desktopEvidence.push(evidence);
  if (this.desktopEvidence.length > 30) {
    this.desktopEvidence.splice(0, this.desktopEvidence.length - 30);
  }
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const desktopEvidenceMethods = {
  captureDesktopScreenshot,
  readWechatWindowFrame,
  readWechatWindowFrameFromAccessibility,
  readWechatWindowFrameFromCoreGraphics,
  readWechatWindowCaptureInfo,
  readDesktopScreenshotText,
  detectWechatScreenshotMismatch,
  hasTrustedWechatAlignmentLock,
  isWechatScreenshotSoftDiagnostic,
  detectWechatScreenshotSessionBlocker,
  runCommand,
  rememberDesktopEvidence,
};
