// local-engine 微信联系人同步簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；跨块依赖走 WechatContactsSyncHost 接口：
// 全部 32 个跨块方法均来自 contact 簇（WechatContactsHost 成员），utils 函数来自 wechat-command.utils。

import { BadRequestException } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';

import type {
  SyncWechatChatHistoryInput,
  WechatContact,
  WechatContactsReadinessCheck,
  WechatContactsReadinessResult,
  WechatContactsResult,
  WechatContactsSyncDiagnostics,
  WechatContactsSyncInput,
  WechatContactsSyncMode,
} from './local-engine.types';

type WechatContactsCacheShape = {
  source: string;
  items: WechatContact[];
  currentWechatId?: string;
  plannedWechatId?: string;
  syncedAt?: string;
  screenshotPath?: string;
  diagnostics?: WechatContactsSyncDiagnostics;
};
import {
  getRuntimePlatform,
  resolveWechatNativeRuntimePath,
} from './local-engine.wechat-command.utils';

/** 微信联系人同步簇的 host 接口：簇方法访问的 service 成员（真实签名复制自 contact 簇 WechatContactsHost） */
export interface WechatContactsSyncHost {
  getWechatContactsDiagnosticsPath(): string;
  readWechatContactSyncDiagnosticsFile(): Promise<
    Record<string, unknown> | undefined
  >;
  normalizeWechatContactsSyncDiagnostics(
    value: unknown,
    defaults?: Partial<WechatContactsSyncDiagnostics>,
  ): WechatContactsSyncDiagnostics | undefined;
  withWechatContactsCacheAccountGuard(
    cached: WechatContactsCacheShape,
    diagnostics?: WechatContactsSyncDiagnostics,
  ): WechatContactsCacheShape;
  readWechatContactsCache(): Promise<WechatContactsCacheShape>;
  normalizeWechatContactList(
    value: unknown,
    defaults?: Partial<WechatContact>,
  ): WechatContact[];
  getWechatContactDisplay(contact: WechatContact): string;
  getWechatContactSyncLowConfidenceReason(
    result: Record<string, unknown>,
    mode: WechatContactsSyncMode,
  ): string;
  isPollutedWechatContactCandidateBatch(
    candidates: string[],
    source?: string,
  ): boolean;
  extractWechatContactCandidateTexts(value: unknown): string[];
  isWechatContactCacheAccountMismatch(
    cached: WechatContactsCacheShape,
    diagnostics?: WechatContactsSyncDiagnostics,
  ): boolean;
  buildWechatContactsCacheFallbackResult(
    cached: WechatContactsCacheShape,
    error: unknown,
    runtimePlatform: string,
    mode: WechatContactsSyncMode,
  ): Promise<WechatContactsResult | null>;
  buildWechatContactsBlockedResult(
    cached: WechatContactsCacheShape,
    reason: string,
    diagnosticsInput: WechatContactsSyncDiagnostics | null | undefined,
    source: string,
    mode: WechatContactsSyncMode,
    options?: { includeCachedItems?: boolean },
  ): Promise<WechatContactsResult>;
  normalizeWechatContactsSyncMode(value: unknown): WechatContactsSyncMode;
  resolveWechatEnginePath(): string;
  resolveWechatSqliteCliPath(): string;
  resolveWechatDbHelperPath(): string;
  resolveWechatContactSyncScriptPath(): string;
  runWechatContactSyncScript(
    scriptPath: string,
    mode?: WechatContactsSyncMode,
  ): Promise<Record<string, unknown>>;
  runWechatWindowsContactSyncScript(
    mode?: WechatContactsSyncMode,
  ): Promise<Record<string, unknown>>;
  writeWechatContactsCache(input: WechatContactsCacheShape): Promise<void>;
  buildWechatContactsResult(
    input: WechatContactsCacheShape,
  ): WechatContactsResult;
  probeWechatNativeContactRuntime(
    nativeRuntimePath: string,
  ): Promise<WechatContactsSyncDiagnostics | undefined>;
  tryRunWechatContactVisionFallback(
    error: unknown,
  ): Promise<WechatContactsResult | null>;
  tryRunWechatContactOcrFallback(
    error: unknown,
  ): Promise<WechatContactsResult | null>;
  humanizeWechatContactSyncErrorMessage(
    error: unknown,
    runtimePlatform?: string,
  ): string;
  wechatContactSyncLastFailureMessage(
    lastFailure: Record<string, unknown>,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
    runtimePlatform: string,
  ): string;
  toWechatContactsSyncException(error: unknown, runtimePlatform: string): Error;
  mergeWechatContactsSyncDiagnostics(
    ...values: unknown[]
  ): WechatContactsSyncDiagnostics | undefined;
  resolveMacWechatCommandRunners(): Record<string, unknown>;
  buildMacWechatToolReadinessCheck(): WechatContactsReadinessCheck;
  buildWechatNativeCommandRunnerReadinessCheck(
    commandRunners: Record<string, unknown> | undefined,
    platformName: string,
  ): WechatContactsReadinessCheck;
  resolveWechatContactAccountId(
    result: Record<string, unknown> | undefined,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
    fallback?: string,
  ): string | undefined;
}

export async function getWechatContacts(
  this: WechatContactsSyncHost,
): Promise<WechatContactsResult> {
  const lastFailure = await this.readWechatContactSyncDiagnosticsFile();
  const lastDiagnostics = this.normalizeWechatContactsSyncDiagnostics(
    lastFailure?.diagnostics || lastFailure,
  );
  const cached = this.withWechatContactsCacheAccountGuard(
    await this.readWechatContactsCache(),
    lastDiagnostics,
  );
  return this.buildWechatContactsResult(cached);
}

export async function getWechatContactsReadiness(
  this: WechatContactsSyncHost,
): Promise<WechatContactsReadinessResult> {
  const checkedAt = new Date().toISOString();
  const platformName = getRuntimePlatform();
  const nativeRuntimePath = resolveWechatNativeRuntimePath();
  const enginePath = this.resolveWechatEnginePath();
  const sqlitePath = this.resolveWechatSqliteCliPath();
  const dbHelperPath = this.resolveWechatDbHelperPath();
  const lastFailure = await this.readWechatContactSyncDiagnosticsFile();
  const lastDiagnostics = this.normalizeWechatContactsSyncDiagnostics(
    lastFailure?.diagnostics || lastFailure,
  );
  const cached = this.withWechatContactsCacheAccountGuard(
    await this.readWechatContactsCache(),
    lastDiagnostics,
  );
  const checks: WechatContactsReadinessCheck[] = [];
  const addCheck = (check: WechatContactsReadinessCheck) => {
    checks.push(check);
  };

  addCheck({
    key: 'platform',
    name: '桌面系统',
    status:
      platformName === 'win32'
        ? 'ready'
        : platformName === 'darwin'
          ? 'ready'
          : 'blocked',
    message:
      platformName === 'win32'
        ? '当前是 Windows，可执行微信通讯录同步。'
        : platformName === 'darwin'
          ? '当前是 macOS，可通过已登录的微信窗口同步通讯录。'
          : '当前系统不支持微信桌面通讯录同步。',
    nextAction:
      platformName === 'win32' || platformName === 'darwin'
        ? undefined
        : '请切换到已登录微信的 macOS 或 Windows 桌面系统。',
    details: { platform: platformName },
  });

  let nativeDiagnostics: WechatContactsSyncDiagnostics | undefined;
  if (platformName === 'win32') {
    addCheck({
      key: 'native-runtime',
      name: 'Kaypal 原生通讯录运行时',
      status: nativeRuntimePath ? 'ready' : 'warning',
      message: nativeRuntimePath
        ? '已找到 native runtime，会优先使用数据库/UIA 组合采集。'
        : '未找到 native runtime，会退回 legacy engine 或 PowerShell/OCR。',
      nextAction: nativeRuntimePath
        ? undefined
        : '请安装包含 desktop/runtime/wechat-native-runtime 的完整安装包。',
      details: nativeRuntimePath ? { path: nativeRuntimePath } : undefined,
    });

    addCheck({
      key: 'legacy-engine',
      name: 'Legacy 微信引擎',
      status: enginePath ? 'ready' : 'warning',
      message: enginePath
        ? '已找到 legacy wechat-engine，可作为 native runtime 失败后的备用通道。'
        : '未找到 legacy wechat-engine，只能依赖 PowerShell/OCR 兜底。',
      nextAction: enginePath
        ? undefined
        : '请确认安装包内带有 desktop/runtime/wechat-engine。',
      details: enginePath ? { path: enginePath } : undefined,
    });

    addCheck({
      key: 'sqlite-cli',
      name: 'SQLite 读取工具',
      status: sqlitePath ? 'ready' : 'warning',
      message: sqlitePath
        ? '已找到 sqlite3，可读取明文 contact.db。'
        : '未找到 sqlite3，明文数据库通道会跳过。',
      nextAction: sqlitePath
        ? undefined
        : '请随安装包携带 sqlite3.exe，或配置 AI_CONTENT_SQLITE_EXE。',
      details: sqlitePath ? { path: sqlitePath } : undefined,
    });

    addCheck({
      key: 'db-helper',
      name: '微信数据库 helper',
      status: dbHelperPath ? 'ready' : 'warning',
      message: dbHelperPath
        ? '已找到微信数据库 helper，可提升联系人读取成功率。'
        : '未找到微信数据库 helper，加密数据库只能靠 native runtime 或 UIA/OCR。',
      nextAction: dbHelperPath
        ? undefined
        : '请随安装包携带 wechat-db-helper/wechat-dump-rs，或配置 AI_CONTENT_WECHAT_DB_HELPER。',
      details: dbHelperPath ? { path: dbHelperPath } : undefined,
    });

    if (nativeRuntimePath) {
      nativeDiagnostics =
        await this.probeWechatNativeContactRuntime(nativeRuntimePath);
      if (nativeDiagnostics) {
        const hasBlockingSignal =
          /blocked|failed|error/i.test(
            nativeDiagnostics.platformStatus || '',
          ) ||
          /blocked|failed|error/i.test(nativeDiagnostics.windowStatus || '') ||
          /blocked|failed|error/i.test(nativeDiagnostics.helperStatus || '');
        addCheck({
          key: 'native-diagnose',
          name: 'Native runtime 诊断',
          status: hasBlockingSignal ? 'warning' : 'ready',
          message: hasBlockingSignal
            ? 'Native runtime 可启动，但诊断里有异常信号。'
            : 'Native runtime 诊断命令可启动并返回结构化结果。',
          nextAction: hasBlockingSignal
            ? '请先处理诊断里的窗口、权限或 helper 异常，再同步联系人。'
            : undefined,
          details: {
            stage: nativeDiagnostics.stage,
            windowStatus: nativeDiagnostics.windowStatus,
            dbStatus: nativeDiagnostics.dbStatus,
            helperStatus: nativeDiagnostics.helperStatus,
            uiaStatus: nativeDiagnostics.uiaStatus,
          },
        });
      } else {
        addCheck({
          key: 'native-diagnose',
          name: 'Native runtime 诊断',
          status: 'warning',
          message: 'Native runtime 存在，但诊断命令没有返回可解析结果。',
          nextAction: '安装包需要重新检查 native runtime 是否完整可执行。',
        });
      }
    }
  }

  if (platformName === 'darwin') {
    addCheck(this.buildMacWechatToolReadinessCheck());
  }

  addCheck(
    this.buildWechatNativeCommandRunnerReadinessCheck(
      platformName === 'darwin'
        ? this.resolveMacWechatCommandRunners()
        : nativeDiagnostics?.externalCommandRunners ||
            lastDiagnostics?.externalCommandRunners ||
            cached.diagnostics?.externalCommandRunners,
      platformName,
    ),
  );

  const cachedContactsNeedReview =
    /low-confidence|needs-review|review-required/i.test(
      [cached.diagnostics?.uiaStatus, ...(cached.diagnostics?.warnings || [])]
        .filter(Boolean)
        .join(' '),
    );
  addCheck({
    key: 'cached-contacts',
    name: '本地联系人缓存',
    status: cached.items.length
      ? cachedContactsNeedReview
        ? 'warning'
        : 'ready'
      : 'warning',
    message: cached.items.length
      ? cachedContactsNeedReview
        ? `本机已有 ${cached.items.length} 个联系人，来自窗口文字识别，使用前需要复核姓名。`
        : `本机已有 ${cached.items.length} 个联系人缓存。`
      : '本机还没有可用联系人缓存。',
    nextAction: cached.items.length
      ? cachedContactsNeedReview
        ? '请在微信工作台复核联系人姓名，删除误识别项后再用于批量任务。'
        : undefined
      : '首次使用请先点“同步联系人”，成功后群发/朋友圈营销才能直接填入名单。',
    details: {
      count: cached.items.length,
      source: cached.source,
      syncedAt: cached.syncedAt,
    },
  });

  if (lastFailure) {
    const lastFailureMessage =
      this.wechatContactSyncLastFailureMessage(
        lastFailure,
        lastDiagnostics,
        platformName,
      ) || '存在最近一次失败诊断。';
    addCheck({
      key: 'last-failure',
      name: '最近一次同步失败',
      status: 'warning',
      message: lastFailureMessage,
      nextAction: '点“导出诊断”把最近一次失败记录导出来排查。',
      details: {
        stage: lastDiagnostics?.stage,
        source: lastDiagnostics?.source,
        failureReason: lastDiagnostics?.failureReason,
        fallbackReason: lastDiagnostics?.fallbackReason,
        screenshotPath: lastDiagnostics?.screenshotPath,
      },
    });
  }

  const blockers = checks.filter((check) => check.status === 'blocked');
  const warnings = checks.filter((check) => check.status === 'warning');
  const status = blockers.length
    ? 'blocked'
    : warnings.length
      ? 'warning'
      : 'ready';

  return {
    ready: !blockers.length,
    status,
    checkedAt,
    platform: platformName,
    modeSupport: {
      random: platformName === 'win32' || platformName === 'darwin',
      all: platformName === 'win32' || platformName === 'darwin',
    },
    cached: {
      count: cached.items.length,
      source: cached.source,
      syncedAt: cached.syncedAt,
    },
    paths: {
      nativeRuntimePath,
      enginePath,
      sqlitePath,
      dbHelperPath,
    },
    checks,
    blockers,
    warnings,
    diagnostics: lastDiagnostics || cached.diagnostics,
    lastFailure,
    nextAction: blockers.length
      ? blockers[0].nextAction || blockers[0].message
      : warnings.length
        ? warnings[0].nextAction || warnings[0].message
        : '可以同步联系人。',
  };
}

export async function syncWechatContacts(
  this: WechatContactsSyncHost,
  input: boolean | WechatContactsSyncInput = false,
): Promise<WechatContactsResult> {
  const force = typeof input === 'boolean' ? input : Boolean(input?.force);
  const mode = this.normalizeWechatContactsSyncMode(
    typeof input === 'boolean' ? undefined : input?.mode,
  );
  const runtimePlatform = getRuntimePlatform();
  if (runtimePlatform !== 'darwin' && runtimePlatform !== 'win32') {
    throw new BadRequestException(
      '当前通讯录同步仅支持 macOS/Windows 微信桌面版，请在已登录微信的桌面系统上重试。',
    );
  }
  const lastFailure = await this.readWechatContactSyncDiagnosticsFile();
  const lastDiagnostics = this.normalizeWechatContactsSyncDiagnostics(
    lastFailure?.diagnostics || lastFailure,
  );
  const cached = this.withWechatContactsCacheAccountGuard(
    await this.readWechatContactsCache(),
    lastDiagnostics,
  );
  if (!force && cached.items.length && cached.syncedAt) {
    return {
      ...this.buildWechatContactsResult(cached),
      cached: true,
    };
  }

  let result: Record<string, unknown>;
  try {
    result =
      runtimePlatform === 'win32'
        ? await this.runWechatWindowsContactSyncScript(mode)
        : await this.runWechatContactSyncScript(
            this.resolveWechatContactSyncScriptPath(),
            mode,
          );
  } catch (error) {
    if (runtimePlatform === 'win32') {
      // 本地 OCR 兜底（离线，不依赖 AI 网关）优先于 AI 视觉兜底
      const ocrResult = await this.tryRunWechatContactOcrFallback(error);
      if (ocrResult) {
        result = ocrResult;
      } else {
        const visionResult = await this.tryRunWechatContactVisionFallback(error);
        if (visionResult) {
          result = visionResult;
        } else {
          const cachedFallback =
            await this.buildWechatContactsCacheFallbackResult(
              cached,
              error,
              runtimePlatform,
              mode,
            );
          if (cachedFallback) {
            return cachedFallback;
          }
          throw this.toWechatContactsSyncException(error, runtimePlatform);
        }
      }
    } else {
      const cachedFallback = await this.buildWechatContactsCacheFallbackResult(
        cached,
        error,
        runtimePlatform,
        mode,
      );
      if (cachedFallback) {
        return cachedFallback;
      }
      if (force) {
        const diagnostics = this.normalizeWechatContactsSyncDiagnostics(
          (error as { diagnostics?: unknown })?.diagnostics,
        );
        if (this.isWechatContactCacheAccountMismatch(cached, diagnostics)) {
          const message = this.humanizeWechatContactSyncErrorMessage(
            error,
            runtimePlatform,
          );
          return this.buildWechatContactsBlockedResult(
            cached,
            message,
            diagnostics,
            diagnostics?.source || 'wechat-contact-cache-account-guard',
            mode,
            { includeCachedItems: false },
          );
        }
      }
      throw this.toWechatContactsSyncException(error, runtimePlatform);
    }
  }
  const syncedAt = new Date().toISOString();
  const rawContactCandidates = this.extractWechatContactCandidateTexts(
    Array.isArray(result.items) ? result.items : result.contacts,
  );
  const contaminatedCandidates = rawContactCandidates.filter((item) =>
    /抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|刷新状态|绑定平台/.test(
      item,
    ),
  );
  if (contaminatedCandidates.length) {
    throw new BadRequestException(
      `微信通讯录同步结果包含非微信页面内容，已拒绝写入：${contaminatedCandidates.slice(0, 3).join('、')}`,
    );
  }
  const shellCandidates = rawContactCandidates
    .map((item) => item.trim())
    .filter((item) => /^(微信|WeChat|Weixin|通讯录|联系人)$/i.test(item));
  if (
    shellCandidates.length &&
    shellCandidates.length === rawContactCandidates.length
  ) {
    throw new BadRequestException(
      `微信通讯录同步结果只包含窗口标题或导航文本，已拒绝写入：${shellCandidates.slice(0, 3).join('、')}`,
    );
  }
  const source =
    typeof result.source === 'string' ? result.source : 'macos-wechat-ocr';
  const normalizedResultDiagnostics =
    this.normalizeWechatContactsSyncDiagnostics(result.diagnostics, {
      source,
      screenshotPath:
        typeof result.screenshotPath === 'string' ? result.screenshotPath : '',
    });
  const lowConfidenceReason = this.getWechatContactSyncLowConfidenceReason(
    result,
    mode,
  );
  if (lowConfidenceReason) {
    const diagnostics = this.mergeWechatContactsSyncDiagnostics(
      result.diagnostics,
      {
        source,
        failureLayer: 'quality-gate',
        failureReason: lowConfidenceReason,
        fallbackReason: lowConfidenceReason,
      },
    );
    const qualityGateError = new BadRequestException(
      `微信通讯录同步结果可信度不足，已拒绝覆盖本地名单：${lowConfidenceReason}`,
    ) as BadRequestException & { diagnostics?: unknown };
    qualityGateError.diagnostics = diagnostics;
    if (
      runtimePlatform !== 'win32' &&
      /微信账号标识|macOS OCR/i.test(lowConfidenceReason)
    ) {
      await this.buildWechatContactsBlockedResult(
        cached,
        lowConfidenceReason,
        diagnostics,
        source,
        mode,
        { includeCachedItems: false },
      );
      throw qualityGateError;
    }
    if (force && runtimePlatform === 'win32') {
      return this.buildWechatContactsBlockedResult(
        cached,
        lowConfidenceReason,
        diagnostics,
        source,
        mode,
        { includeCachedItems: false },
      );
    }
    const cachedFallback = await this.buildWechatContactsCacheFallbackResult(
      cached,
      qualityGateError,
      runtimePlatform,
      mode,
    );
    if (cachedFallback) {
      return cachedFallback;
    }
    return this.buildWechatContactsBlockedResult(
      cached,
      lowConfidenceReason,
      diagnostics,
      source,
      mode,
    );
  }
  const currentWechatId = this.resolveWechatContactAccountId(
    result,
    normalizedResultDiagnostics,
  );
  const plannedWechatId =
    typeof result.plannedWechatId === 'string'
      ? result.plannedWechatId
      : cached.plannedWechatId;
  const items = this.normalizeWechatContactList(
    Array.isArray(result.items) ? result.items : result.contacts,
    {
      syncedAt,
      currentWechatId,
      plannedWechatId,
    },
  );
  if (
    this.isPollutedWechatContactCandidateBatch(rawContactCandidates, source)
  ) {
    throw new BadRequestException(
      '微信通讯录同步结果疑似混入新闻、公众号或系统界面文字，已拒绝覆盖本地名单。',
    );
  }
  if (!items.length) {
    throw new BadRequestException(
      '微信通讯录同步没有读取到真实联系人，已拒绝覆盖本地名单。',
    );
  }
  const invalidContacts = items
    .flatMap((item) => [item.wxid, item.nickname, item.remark])
    .filter((item): item is string => Boolean(item))
    .filter((item) =>
      /抖音|发布中心|平台账号|视频工坊|内容素材|知识库|刷新状态|绑定平台/.test(
        item,
      ),
    );
  if (invalidContacts.length) {
    throw new BadRequestException(
      `微信通讯录同步结果包含非微信页面内容，已拒绝写入：${invalidContacts.slice(0, 3).join('、')}`,
    );
  }
  const shellContacts = items
    .map((item) => this.getWechatContactDisplay(item).trim())
    .filter((item) => /^(微信|WeChat|Weixin|通讯录|联系人)$/i.test(item));
  if (shellContacts.length) {
    throw new BadRequestException(
      `微信通讯录同步结果只包含窗口标题或导航文本，已拒绝写入：${shellContacts.slice(0, 3).join('、')}`,
    );
  }
  const cache = {
    source,
    items,
    currentWechatId,
    plannedWechatId,
    syncedAt,
    screenshotPath:
      typeof result.screenshotPath === 'string' ? result.screenshotPath : '',
    diagnostics: normalizedResultDiagnostics,
  };
  await this.writeWechatContactsCache(cache);
  await rm(this.getWechatContactsDiagnosticsPath(), { force: true }).catch(
    () => undefined,
  );

  return {
    ...this.buildWechatContactsResult(cache),
    cached: false,
  };
}

export function runWechatChatHistorySyncScript(
  this: WechatContactsSyncHost,
  scriptPath: string,
  input: SyncWechatChatHistoryInput,
): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const args = [scriptPath];
    if (input.sessionId) {
      args.push('--session-id', input.sessionId);
    }
    if (input.limit && Number.isFinite(Number(input.limit))) {
      args.push('--limit', String(Math.floor(Number(input.limit))));
    }
    const pythonCommand =
      process.env.AI_CONTENT_PYTHON_PATH?.trim() ||
      process.env.PYTHON?.trim() ||
      'python3';
    const child = spawn(pythonCommand, args, {
      env: {
        ...process.env,
        PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('微信聊天历史同步执行超时'));
    }, 180000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      const output = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);
      if (code !== 0) {
        reject(
          new Error(
            (stderr || stdout || `微信聊天历史同步退出码 ${code}`).trim(),
          ),
        );
        return;
      }
      if (!output) {
        reject(new Error('微信聊天历史同步没有返回结果'));
        return;
      }
      try {
        resolvePromise(JSON.parse(output) as Record<string, unknown>);
      } catch (error) {
        reject(
          new Error(
            `微信聊天历史同步返回结果不可解析：${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  });
}

export const wechatContactsSyncMethods = {
  getWechatContacts,
  getWechatContactsReadiness,
  syncWechatContacts,
  runWechatChatHistorySyncScript,
  tryRunWechatContactOcrFallback,
};

/**
 * 本地 OCR 兜底：DB 读取失败且已有截图时，用 RapidOcrOnnx 离线识别截图中的联系人昵称。
 * 不依赖 AI 网关（vision 兜底依赖），是 Windows 真机的离线兜底层。
 * 依赖安装包内 resources/wechat-ocr（RapidOcrOnnx.exe + models）与 helper 的 ocr-contacts 命令。
 */
export async function tryRunWechatContactOcrFallback(
  this: WechatContactsSyncHost,
  error: unknown,
): Promise<WechatContactsResult | null> {
  const diagnostics = this.normalizeWechatContactsSyncDiagnostics(
    (error as { diagnostics?: unknown })?.diagnostics,
  );
  const screenshotPath = diagnostics?.screenshotPath;
  if (!screenshotPath || !existsSync(screenshotPath)) {
    return null;
  }
  const helperPath = this.resolveWechatDbHelperPath();
  if (!helperPath || !existsSync(helperPath)) {
    return null;
  }
  // helper 在 resources/wechat-db-helper/，OCR 引擎在 resources/wechat-ocr/
  const ocrDir = join(dirname(helperPath), '..', 'wechat-ocr');
  if (!existsSync(join(ocrDir, 'RapidOcrOnnx.exe'))) {
    return null;
  }

  try {
    const output = await new Promise<{
      ok?: boolean;
      contacts?: Array<{ name?: string; score?: number }>;
      textLines?: string[];
      error?: string;
    }>((resolvePromise, reject) => {
      const child = spawn(
        process.execPath,
        [
          helperPath,
          'ocr-contacts',
          '--screenshot',
          screenshotPath,
          '--ocr-dir',
          ocrDir,
        ],
        {
          cwd: dirname(helperPath),
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          timeout: 120000,
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.on('error', reject);
      child.on('close', () => {
        try {
          resolvePromise(JSON.parse(stdout) as { ok?: boolean; contacts?: Array<{ name?: string }>; textLines?: string[] });
        } catch {
          reject(
            new Error(
              `OCR helper 输出不可解析: ${(stderr || stdout).slice(0, 200)}`,
            ),
          );
        }
      });
    });

    const rawContacts = Array.isArray(output?.contacts)
      ? output.contacts.filter((c) => c && typeof c.name === 'string' && c.name.trim().length > 0)
      : [];
    if (rawContacts.length === 0) {
      return null;
    }
    const items = this.normalizeWechatContactList(
      rawContacts.map((c) => ({ name: c?.name || '' })),
      {},
    );
    if (items.length === 0) {
      return null;
    }
    await this.writeWechatContactsCache({
      source: 'wechat-ocr-fallback',
      items,
      syncedAt: new Date().toISOString(),
      screenshotPath,
    });
    return this.buildWechatContactsResult({
      source: 'wechat-ocr-fallback',
      items,
      screenshotPath,
      diagnostics: {
        source: 'wechat-ocr-fallback',
        engine: 'rapid-ocr',
        enginePath: join(ocrDir, 'RapidOcrOnnx.exe'),
        screenshotPath,
        ocrContactCount: items.length,
        ocrTextLines: Array.isArray(output?.textLines) ? output.textLines : [],
        fallbackReason: '本地 OCR 兜底识别通讯录截图',
      },
    });
  } catch {
    return null;
  }
}
