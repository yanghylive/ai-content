// local-engine 微信联系人同步簇（god class 拆解——mixin 化）

const WECHAT_CONTACT_RANDOM_SYNC_TIMEOUT_MS = 5 * 60 * 1000;
const WECHAT_CONTACT_ALL_SYNC_TIMEOUT_MS = 12 * 60 * 1000;

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

import {
  assertBackendRiskGate,
  type BackendRiskAuditEvent,
  type BackendRiskConfirmationInput,
  type BackendRiskContext,
} from '../auth/risk-control';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import type {
  InteractionTaskBillingIdentity,
  LocalEngineBrowserStatus,
  LocalEngineCapability,
  LocalEngineEntitlementUser,
  LocalEngineFileAccessStatus,
  LocalEngineCapabilityStatus,
  LocalEngineReadiness,
  LocalEngineRuntimeAction,
  LocalEngineRuntimeActionResult,
  LocalEngineRuntimeLog,
  LocalEngineRuntimeService,
  LocalEngineRuntimeServiceKey,
  LocalEngineRuntimeStatus,
  SyncWechatChatHistoryInput,
  SyncWechatChatHistoryResult,
  UpsertWechatContactInput,
  WechatChatHistoryCache,
  WechatChatHistoryCacheInfo,
  WechatChatHistoryResult,
  WechatChatHistorySource,
  WechatChatHistoryStatus,
  WechatChatMessage,
  WechatChatSession,
  WechatChatSessionsResult,
  WechatContact,
  WechatContactSyncAttempt,
  WechatContactsDiagnosticsExportResult,
  WechatContactsExportResult,
  WechatContactsReadinessCheck,
  WechatContactsSyncDiagnostics,
  WechatContactsSyncMode,
  WechatContactsResult,
} from './local-engine.types';
import {
  compactWechatContactSyncOutput,
  WECHAT_NATIVE_COMMAND_RUNNER_LABELS,
  findLastJsonLine,
  getRuntimePlatform,
  resolveFirstExistingLocalPath,
  resolveWechatNativeRuntimePath,
} from './local-engine.wechat-command.utils';
import {
  getProjectRoot,
  normalizeStringArray,
  normalizeWechatContactTags,
  optionalTrimmedText,
  resolveImageMimeType,
} from './local-engine.utils';

/** contact 簇的 host 接口 */
interface WechatContactsHost {
  aiClient: AiClientService;
  configService: ConfigService;
  defaultModels: DefaultModelsService;
  checkRequiredPlatformAccounts(
    browserStatus: LocalEngineBrowserStatus,
    capabilities: LocalEngineCapability[],
  ): { ready: boolean; message: string; nextAction: string };
  getBrowserStatus(): Promise<LocalEngineBrowserStatus>;
  getCapabilities(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability[]>;
  getFileAccessStatus(): Promise<LocalEngineFileAccessStatus>;
  getRuntimeServiceDefinitions(): LocalEngineRuntimeService[];
  inspectRuntimeService(
    service: Omit<
      LocalEngineRuntimeService,
      'online' | 'managedByScreen' | 'logExists' | 'message' | 'pid'
    >,
    screenSessions: Set<string>,
  ): Promise<LocalEngineRuntimeService>;
  isWechatReadinessSessionLocked(
    capabilities: LocalEngineCapability[],
  ): boolean;
  readManagedScreenSessions(logDir: string): Promise<Set<string>>;
  runWechatChatHistorySyncScript(
    scriptPath: string,
    input: SyncWechatChatHistoryInput,
  ): Promise<Record<string, unknown>>;
  getWechatContactsDiagnosticsPath(): string;
  getWechatContactsCachePath(): string;
  getWechatContactDisplay(wxid: string): string;
  parseWechatVisionContactsOutput(output: string): {
    contacts: string[];
    warnings: string[];
  };
  resolveWechatContactAccountId(
    result: Record<string, unknown> | undefined,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
    fallback?: string,
  ): string | undefined;
  isWechatContactsLegacyAccountlessRuntimeCache(input: {
    source?: string;
    items?: WechatContact[];
    currentWechatId?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  }): boolean;
  isWechatContactCacheAccountMismatch(
    cached: {
      currentWechatId?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    diagnostics?: WechatContactsSyncDiagnostics,
  ): boolean;
  withWechatContactsCacheAccountGuard(
    cached: {
      source: string;
      items: WechatContact[];
      currentWechatId?: string;
      plannedWechatId?: string;
      syncedAt?: string;
      screenshotPath?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    diagnostics?: WechatContactsSyncDiagnostics,
  ): {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  };
  buildWechatContactsCacheFallbackResult(
    cached: {
      source: string;
      items: WechatContact[];
      currentWechatId?: string;
      plannedWechatId?: string;
      syncedAt?: string;
      screenshotPath?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    error: unknown,
    runtimePlatform: ReturnType<typeof platform>,
    mode: WechatContactsSyncMode,
  ): Promise<WechatContactsResult | null>;
  buildWechatContactsBlockedResult(
    cached: {
      source: string;
      items: WechatContact[];
      currentWechatId?: string;
      plannedWechatId?: string;
      syncedAt?: string;
      screenshotPath?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    reason: string,
    diagnosticsInput: WechatContactsSyncDiagnostics | null | undefined,
    source: string,
    mode: WechatContactsSyncMode,
    options?: { includeCachedItems?: boolean },
  ): Promise<WechatContactsResult>;
  normalizeWechatContactsSyncMode(value: unknown): WechatContactsSyncMode;
  upsertWechatContact(
    input: UpsertWechatContactInput,
  ): Promise<WechatContactsResult>;
  removeWechatContact(wxid: string): Promise<WechatContactsResult>;
  clearWechatContacts(): Promise<WechatContactsResult>;
  exportWechatContacts(): Promise<WechatContactsExportResult>;
  exportWechatContactSyncDiagnostics(): Promise<WechatContactsDiagnosticsExportResult>;
  getWechatChatSessions(): Promise<WechatChatSessionsResult>;
  getWechatChatHistory(
    sessionId: string,
    limit?: number,
  ): Promise<WechatChatHistoryResult>;
  syncWechatChatHistory(
    input?: SyncWechatChatHistoryInput,
  ): Promise<SyncWechatChatHistoryResult>;
  getReadiness(
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineReadiness>;
  getRuntimeStatus(): Promise<LocalEngineRuntimeStatus>;
  runRuntimeAction(
    action: LocalEngineRuntimeAction,
    options?: {
      riskConfirmation?: BackendRiskConfirmationInput;
      riskContext?: BackendRiskContext;
    },
  ): Promise<
    LocalEngineRuntimeActionResult & { riskAudit: BackendRiskAuditEvent }
  >;
  getRuntimeLog(
    key: LocalEngineRuntimeServiceKey,
    lineCount?: string,
  ): Promise<LocalEngineRuntimeLog>;
  getProjectLogRoot(): string;
  getRuntimeStateRoot(): string;
  getMacWechatCommandRoot(): string;
  resolveWechatContactSyncScriptPath(): string;
  resolveWechatChatHistorySyncScriptPath(): string;
  getWechatContactsCachePath(): string;
  getWechatContactsDiagnosticsPath(): string;
  readWechatContactSyncDiagnosticsFile(): Promise<
    Record<string, unknown> | undefined
  >;
  getWechatChatHistoryCachePath(): string;
  readWechatContactsCache(): Promise<{
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  }>;
  writeWechatContactsCache(input: {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  }): Promise<void>;
  buildWechatContactsResult(input: {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  }): WechatContactsResult;
  readWechatChatHistoryCache(): Promise<WechatChatHistoryCache>;
  writeWechatChatHistoryCache(input: WechatChatHistoryCache): Promise<void>;
  buildWindowsWechatChatHistoryFromContacts(
    cached: WechatChatHistoryCache,
  ): Promise<WechatChatHistoryCache>;
  normalizeWechatChatHistoryCache(input: unknown): WechatChatHistoryCache;
  normalizeWechatChatSession(
    input: unknown,
    fallbackSource: WechatChatHistorySource,
  ): WechatChatSession | null;
  normalizeWechatChatMessage(
    input: unknown,
    fallbackSource: WechatChatHistorySource,
  ): WechatChatMessage | null;
  normalizeWechatChatHistorySource(
    value: unknown,
    fallback?: WechatChatHistorySource,
  ): WechatChatHistorySource;
  normalizeWechatMessageDirection(
    value: unknown,
  ): WechatChatMessage['direction'];
  normalizeWechatMessageContentType(
    value: unknown,
  ): WechatChatMessage['contentType'];
  buildWechatChatSessionsResult(
    cache: WechatChatHistoryCache,
    options: { cached: boolean },
  ): WechatChatSessionsResult;
  buildWechatChatHistoryCacheInfo(
    cache: WechatChatHistoryCache,
  ): WechatChatHistoryCacheInfo;
  resolveWechatChatHistoryStatus(
    cache: WechatChatHistoryCache,
    itemCount: number,
  ): WechatChatHistoryStatus;
  resolveWechatChatHistoryNextAction(cache: WechatChatHistoryCache): string;
  withWechatChatHistoryBlocker(
    cache: WechatChatHistoryCache,
    blocker: string,
  ): WechatChatHistoryCache;
  compareOptionalTime(left?: string, right?: string): number;
  normalizeWechatContactList(
    value: unknown,
    defaults?: Partial<WechatContact>,
  ): WechatContact[];
  extractWechatContactCandidateTexts(value: unknown): string[];
  isPollutedWechatContactCandidateBatch(
    candidates: string[],
    source?: string,
  ): boolean;
  isRejectedWechatContact(contact: WechatContact): boolean;
  normalizeWechatContact(
    value: unknown,
    defaults?: Partial<WechatContact>,
  ): WechatContact | null;
  getWechatContactDisplay(contact: WechatContact): string;
  normalizeWechatContactsSyncDiagnostics(
    value: unknown,
    defaults?: Partial<WechatContactsSyncDiagnostics>,
  ): WechatContactsSyncDiagnostics | undefined;
  isNonWechatContactSyncDiagnostics(
    diagnostics?: WechatContactsSyncDiagnostics,
  ): boolean;
  normalizeJsonRecord(value: unknown): Record<string, unknown>;
  normalizeInteractionTaskBillingIdentity(
    value: unknown,
  ): InteractionTaskBillingIdentity | undefined;
  buildWechatNativeCommandRunnerReadinessCheck(
    commandRunners: Record<string, unknown> | undefined,
    platformName: string,
  ): WechatContactsReadinessCheck;
  resolveMacWechatCommandRunners(): Record<string, unknown>;
  buildMacWechatToolReadinessCheck(): WechatContactsReadinessCheck;
  normalizeJsonRecordArray(
    value: unknown,
  ): Record<string, unknown>[] | undefined;
  mergeWechatDiagnosticStringArrays(
    ...values: Array<string[] | undefined>
  ): string[];
  mergeWechatContactsSyncDiagnostics(
    ...values: unknown[]
  ): WechatContactsSyncDiagnostics | undefined;
  isWechatContactVisionFallbackEnabled(): boolean;
  tryRunWechatContactVisionFallback(
    error: unknown,
  ): Promise<WechatContactsResult | null>;
  humanizeWechatContactSyncErrorMessage(
    error: unknown,
    runtimePlatform?: ReturnType<typeof platform>,
  ): string;
  wechatContactSyncLastFailureMessage(
    lastFailure: Record<string, unknown>,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
    runtimePlatform: ReturnType<typeof platform>,
  ): string;
  stringifyWechatDiagnosticMessage(value: unknown): string;
  optionalDiagnosticText(value: unknown): string | undefined;
  cleanWechatContactSyncUserMessage(
    value: string,
    runtimePlatform?: ReturnType<typeof platform>,
  ): string;
  shouldBlockWechatContactCacheFallback(
    diagnostics: WechatContactsSyncDiagnostics | undefined,
  ): boolean;
  toWechatContactsSyncException(
    error: unknown,
    runtimePlatform: ReturnType<typeof platform>,
  ): BadRequestException;
  runWechatContactSyncScript(
    scriptPath: string,
    mode?: WechatContactsSyncMode,
  ): Promise<Record<string, unknown>>;
  runWechatWindowsContactSyncScript(
    mode?: WechatContactsSyncMode,
  ): Promise<Record<string, unknown>>;
  resolveWechatEnginePath(): string;
  getWechatContactSyncResultCount(result: Record<string, unknown>): number;
  getWechatContactSyncLowConfidenceReason(
    result: Record<string, unknown>,
    mode: WechatContactsSyncMode,
  ): string;
  withWechatContactFallbackDiagnostics(
    result: Record<string, unknown>,
    fallbackDiagnostics: WechatContactsSyncDiagnostics[],
  ): Record<string, unknown>;
  tryRunWechatNativeContactSync(
    mode: WechatContactsSyncMode,
    sqliteCliPath: string,
    decryptionHelperPath: string,
  ): Promise<WechatContactSyncAttempt>;
  tryRunWechatEngineContactSync(
    mode: WechatContactsSyncMode,
    sqliteCliPath: string,
  ): Promise<WechatContactSyncAttempt>;
  probeWechatNativeContactRuntime(
    nativeRuntimePath: string,
  ): Promise<WechatContactsSyncDiagnostics | undefined>;
  runWechatEngineContactSyncScript(
    enginePath: string,
    mode: WechatContactsSyncMode,
    sqliteCliPath: string,
    runtimeName?: string,
  ): Promise<Record<string, unknown>>;
  resolveWechatDbHelperPath(): string;
  resolveWechatSqliteCliPath(): string;
  writeWechatContactSyncDiagnostics(
    payload: Record<string, unknown>,
  ): Promise<void>;
  buildWechatContactFailureRecord(
    payload: Record<string, unknown>,
    capturedAt: string,
  ): Record<string, unknown>;
  buildWechatContactDiagnosticEvidencePackage(
    payload: Record<string, unknown>,
    failureRecord: Record<string, unknown>,
    generatedAt: string,
  ): Record<string, unknown>;
  validateWechatContactDiagnosticEvidencePackage(
    failureRecord: Record<string, unknown>,
  ): { ok: boolean; errors: string[]; warnings: string[] };
  inferWechatContactFailureNextAction(
    payload: Record<string, unknown>,
    parsed: Record<string, unknown> | undefined,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
    message: string,
    screenshotPath: string,
  ): string;
  summarizeWechatContactFailureRaw(
    payload: Record<string, unknown>,
    parsed: Record<string, unknown> | undefined,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
  ): string;
  formatWechatContactsDiagnosticsForError(value: unknown): string;
  getWechatWindowsContactSyncScript(): string;
}

export function resolveWechatContactAccountId(
  this: WechatContactsHost,
  result: Record<string, unknown> | undefined,
  diagnostics: WechatContactsSyncDiagnostics | undefined,
  fallback = '',
) {
  return (
    optionalTrimmedText(result?.currentWechatId) ||
    optionalTrimmedText(result?.current_wechat_id) ||
    optionalTrimmedText(diagnostics?.selectedDbAccountFolder) ||
    optionalTrimmedText(diagnostics?.selectedDbBaseWxid) ||
    optionalTrimmedText(fallback) ||
    undefined
  );
}

export function isWechatContactsLegacyAccountlessRuntimeCache(
  this: WechatContactsHost,
  input: {
    source?: string;
    items?: WechatContact[];
    currentWechatId?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  },
) {
  if (!input.items?.length) {
    return false;
  }
  if (optionalTrimmedText(input.currentWechatId)) {
    return false;
  }
  if (
    optionalTrimmedText(input.diagnostics?.selectedDbAccountFolder) ||
    optionalTrimmedText(input.diagnostics?.selectedDbBaseWxid)
  ) {
    return false;
  }
  const sourceText = [
    input.source,
    input.diagnostics?.source,
    input.diagnostics?.resultSource,
    input.diagnostics?.stage,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    /wechat/i.test(sourceText) &&
    /windows|win32|native|helper|db|decrypted|ocr|uia|macos/i.test(sourceText)
  );
}

export function isWechatContactCacheAccountMismatch(
  this: WechatContactsHost,
  cached: {
    currentWechatId?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  },
  diagnostics?: WechatContactsSyncDiagnostics,
) {
  const cachedAccount =
    optionalTrimmedText(cached.currentWechatId) ||
    optionalTrimmedText(cached.diagnostics?.selectedDbAccountFolder) ||
    optionalTrimmedText(cached.diagnostics?.selectedDbBaseWxid);
  const activeAccount =
    optionalTrimmedText(diagnostics?.selectedDbAccountFolder) ||
    optionalTrimmedText(diagnostics?.selectedDbBaseWxid);
  return Boolean(
    cachedAccount && activeAccount && cachedAccount !== activeAccount,
  );
}

export function withWechatContactsCacheAccountGuard(
  this: WechatContactsHost,
  cached: {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  },
  diagnostics?: WechatContactsSyncDiagnostics,
) {
  if (!this.isWechatContactCacheAccountMismatch(cached, diagnostics)) {
    return cached;
  }
  return {
    ...cached,
    source: 'empty',
    items: [],
    syncedAt: undefined,
    screenshotPath: undefined,
    diagnostics: {
      ...(cached.diagnostics || {}),
      ...(diagnostics || {}),
      source: 'wechat-contact-cache-account-guard',
      stage: 'cache-account-mismatch',
      failureReason:
        '当前微信账号和本地联系人缓存账号不一致，已拒绝展示旧缓存。',
      warnings: this.mergeWechatDiagnosticStringArrays(
        cached.diagnostics?.warnings,
        diagnostics?.warnings,
        ['当前微信账号和本地联系人缓存账号不一致，已拒绝展示旧缓存。'],
      ),
    },
  };
}

export async function buildWechatContactsCacheFallbackResult(
  this: WechatContactsHost,
  cached: {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  },
  error: unknown,
  runtimePlatform: ReturnType<typeof platform>,
  mode: WechatContactsSyncMode,
): Promise<WechatContactsResult | null> {
  if (!cached.items.length) {
    return null;
  }
  const fallbackReason = this.humanizeWechatContactSyncErrorMessage(
    error,
    runtimePlatform,
  );
  const errorDiagnostics = this.normalizeWechatContactsSyncDiagnostics(
    (error as { diagnostics?: unknown })?.diagnostics,
    {
      source: 'wechat-contact-cache-fallback',
      stage: 'sync-cache-fallback',
      fallbackReason,
    },
  );
  if (this.shouldBlockWechatContactCacheFallback(errorDiagnostics)) {
    return this.buildWechatContactsBlockedResult(
      cached,
      fallbackReason,
      errorDiagnostics,
      errorDiagnostics?.source || 'wechat-contact-cache-blocked',
      mode,
      { includeCachedItems: false },
    );
  }
  if (this.isWechatContactCacheAccountMismatch(cached, errorDiagnostics)) {
    await this.writeWechatContactSyncDiagnostics({
      ok: false,
      fallback: 'blocked-account-mismatch',
      mode,
      error: '当前微信账号和本地联系人缓存账号不一致，已拒绝使用旧缓存。',
      cachedCount: cached.items.length,
      diagnostics: {
        ...(errorDiagnostics || {}),
        source: 'wechat-contact-cache-fallback',
        stage: 'sync-cache-account-mismatch',
        fallbackReason,
        failureReason:
          '当前微信账号和本地联系人缓存账号不一致，已拒绝使用旧缓存。',
      },
      capturedAt: new Date().toISOString(),
    });
    return null;
  }
  const diagnostics: WechatContactsSyncDiagnostics = {
    ...(cached.diagnostics || {}),
    ...(errorDiagnostics || {}),
    source: 'wechat-contact-cache-fallback',
    stage: 'sync-cache-fallback',
    fallbackReason,
    warnings: this.mergeWechatDiagnosticStringArrays(
      cached.diagnostics?.warnings,
      errorDiagnostics?.warnings,
      [
        '本次同步没有拿到新的通讯录结果，已保留本地联系人缓存。',
        fallbackReason,
      ],
    ),
  };
  const fallbackCache = {
    ...cached,
    diagnostics,
  };
  await this.writeWechatContactsCache(fallbackCache);
  await this.writeWechatContactSyncDiagnostics({
    ok: false,
    fallback: 'cache',
    mode,
    error: fallbackReason,
    cachedCount: cached.items.length,
    diagnostics,
    capturedAt: new Date().toISOString(),
  });
  return {
    ...this.buildWechatContactsResult(fallbackCache),
    cached: true,
    syncFallbackReason: fallbackReason,
  };
}

export async function buildWechatContactsBlockedResult(
  this: WechatContactsHost,
  cached: {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  },
  reason: string,
  diagnosticsInput: WechatContactsSyncDiagnostics | null | undefined,
  source: string,
  mode: WechatContactsSyncMode,
  options: { includeCachedItems?: boolean } = {},
): Promise<WechatContactsResult> {
  const cacheAccountMismatch = this.isWechatContactCacheAccountMismatch(
    cached,
    diagnosticsInput || undefined,
  );
  const includeCachedItems =
    options.includeCachedItems !== false && !cacheAccountMismatch;
  const blockedItems = includeCachedItems ? cached.items : [];
  const diagnostics: WechatContactsSyncDiagnostics = {
    ...(cached.diagnostics || {}),
    ...(diagnosticsInput || {}),
    source: source || diagnosticsInput?.source || 'wechat-contact-sync-blocked',
    stage: diagnosticsInput?.stage || 'sync-quality-gate',
    fallbackReason: reason,
    failureReason: reason,
    failureLayer: 'quality-gate',
    warnings: this.mergeWechatDiagnosticStringArrays(
      cached.diagnostics?.warnings,
      diagnosticsInput?.warnings,
      [
        '本次同步结果不可信，已拒绝覆盖本地联系人。',
        cacheAccountMismatch
          ? '当前微信账号和本地联系人缓存账号不一致，已拒绝使用旧缓存。'
          : '',
        reason,
      ],
    ),
  };

  await this.writeWechatContactSyncDiagnostics({
    ok: false,
    fallback: blockedItems.length ? 'cache' : 'blocked',
    mode,
    error: reason,
    cachedCount: blockedItems.length,
    diagnostics,
    capturedAt: new Date().toISOString(),
  });

  return {
    ...this.buildWechatContactsResult({
      source: blockedItems.length
        ? cached.source
        : diagnostics.source || source,
      items: blockedItems,
      currentWechatId: blockedItems.length ? cached.currentWechatId : undefined,
      plannedWechatId: blockedItems.length ? cached.plannedWechatId : undefined,
      syncedAt: blockedItems.length ? cached.syncedAt : undefined,
      screenshotPath:
        diagnostics.screenshotPath ||
        (blockedItems.length ? cached.screenshotPath : ''),
      diagnostics,
    }),
    cached: blockedItems.length > 0,
    syncFallbackReason: reason,
  };
}

export function normalizeWechatContactsSyncMode(
  this: WechatContactsHost,
  value: unknown,
): WechatContactsSyncMode {
  return value === 'all' ? 'all' : 'random';
}

export async function upsertWechatContact(
  this: WechatContactsHost,
  input: UpsertWechatContactInput,
): Promise<WechatContactsResult> {
  const cached = await this.readWechatContactsCache();
  const now = new Date().toISOString();
  const contact = this.normalizeWechatContact(input, {
    updatedAt: now,
    createdAt: now,
  });
  if (!contact) {
    throw new BadRequestException('请填写微信 wxid、昵称或备注。');
  }
  const existing = cached.items.find((item) => item.wxid === contact.wxid);
  const merged: WechatContact = existing
    ? {
        ...existing,
        ...contact,
        nickname: contact.nickname ?? existing.nickname,
        remark: contact.remark ?? existing.remark,
        tags: contact.tags.length ? contact.tags : existing.tags,
        currentWechatId: contact.currentWechatId ?? existing.currentWechatId,
        plannedWechatId: contact.plannedWechatId ?? existing.plannedWechatId,
        syncedAt: contact.syncedAt || existing.syncedAt,
        createdAt: existing.createdAt,
        updatedAt: now,
      }
    : contact;
  const items = existing
    ? cached.items.map((item) => (item.wxid === merged.wxid ? merged : item))
    : [...cached.items, merged];
  const cache = {
    ...cached,
    source: cached.source === 'empty' ? 'local-cache' : cached.source,
    items,
  };
  await this.writeWechatContactsCache(cache);
  return this.buildWechatContactsResult(cache);
}

export async function removeWechatContact(
  this: WechatContactsHost,
  wxid: string,
): Promise<WechatContactsResult> {
  const normalizedWxid = String(wxid || '').trim();
  if (!normalizedWxid) {
    throw new BadRequestException('请提供要删除的微信联系人 wxid。');
  }
  const cached = await this.readWechatContactsCache();
  const items = cached.items.filter((item) => item.wxid !== normalizedWxid);
  const cache = { ...cached, items };
  await this.writeWechatContactsCache(cache);
  return this.buildWechatContactsResult(cache);
}

export async function clearWechatContacts(
  this: WechatContactsHost,
): Promise<WechatContactsResult> {
  const cached = await this.readWechatContactsCache();
  const cache = {
    ...cached,
    source: 'local-cache',
    items: [],
    syncedAt: new Date().toISOString(),
  };
  await this.writeWechatContactsCache(cache);
  return this.buildWechatContactsResult(cache);
}

export async function exportWechatContacts(
  this: WechatContactsHost,
): Promise<WechatContactsExportResult> {
  const cached = await this.readWechatContactsCache();
  const exportedAt = new Date().toISOString();
  return {
    filename: `wechat-contacts-${exportedAt.slice(0, 10)}.json`,
    mimeType: 'application/json',
    content: JSON.stringify(this.buildWechatContactsResult(cached), null, 2),
    exportedAt,
    exportStatus: 'OK',
    count: cached.items.length,
  };
}

export async function exportWechatContactSyncDiagnostics(
  this: WechatContactsHost,
): Promise<WechatContactsDiagnosticsExportResult> {
  const exportedAt = new Date().toISOString();
  try {
    const content = await readFile(
      this.getWechatContactsDiagnosticsPath(),
      'utf8',
    );
    return {
      filename: `wechat-contact-sync-diagnostics-${exportedAt.slice(0, 10)}.json`,
      mimeType: 'application/json',
      content,
      exportedAt,
      exists: true,
    };
  } catch {
    return {
      filename: `wechat-contact-sync-diagnostics-${exportedAt.slice(0, 10)}.json`,
      mimeType: 'application/json',
      content: JSON.stringify(
        {
          exists: false,
          exportedAt,
          message: '还没有 Windows 微信通讯录同步失败诊断记录。',
        },
        null,
        2,
      ),
      exportedAt,
      exists: false,
    };
  }
}

export async function getWechatChatSessions(
  this: WechatContactsHost,
): Promise<WechatChatSessionsResult> {
  const cache = await this.readWechatChatHistoryCache();
  return this.buildWechatChatSessionsResult(cache, {
    cached: Boolean(cache.syncedAt || cache.sessions.length),
  });
}

export async function getWechatChatHistory(
  this: WechatContactsHost,
  sessionId: string,
  limit?: number,
): Promise<WechatChatHistoryResult> {
  const safeSessionId = String(sessionId || '').trim();
  if (!safeSessionId) {
    throw new BadRequestException('请提供要读取的微信会话 sessionId。');
  }

  const safeLimit =
    Number.isFinite(limit) && Number(limit) > 0
      ? Math.min(Math.floor(Number(limit)), 500)
      : 100;
  const cache = await this.readWechatChatHistoryCache();
  const session = cache.sessions.find((item) => item.id === safeSessionId);
  const messages = cache.messages
    .filter((item) => item.sessionId === safeSessionId)
    .sort((a, b) => this.compareOptionalTime(a.sentAt, b.sentAt))
    .slice(-safeLimit);
  const missingSessionWarning =
    session || cache.sessions.length === 0
      ? []
      : [`缓存中没有找到 sessionId=${safeSessionId} 的微信会话。`];
  const status = this.resolveWechatChatHistoryStatus(cache, messages.length);

  return {
    status: missingSessionWarning.length ? 'empty' : status,
    source: cache.source,
    sessionId: safeSessionId,
    session,
    messages,
    count: messages.length,
    syncedAt: cache.syncedAt,
    cached: Boolean(cache.syncedAt || messages.length),
    blockers: cache.blockers,
    warnings: [...cache.warnings, ...missingSessionWarning],
    nextAction: this.resolveWechatChatHistoryNextAction(cache),
    cache: this.buildWechatChatHistoryCacheInfo(cache),
  };
}

export async function syncWechatChatHistory(
  this: WechatContactsHost,
  input: SyncWechatChatHistoryInput = {},
): Promise<SyncWechatChatHistoryResult> {
  const force = input.force === true;
  const cached = await this.readWechatChatHistoryCache();
  const scriptPath = this.resolveWechatChatHistorySyncScriptPath() || '';

  if (!force && cached.sessions.length && cached.syncedAt) {
    const cachedBlocked = cached.blockers.length > 0;
    return {
      ...this.buildWechatChatSessionsResult(cached, { cached: true }),
      ok: !cachedBlocked,
      syncAttempted: false,
      scriptPath,
      errorCode: cachedBlocked ? 'not_integrated' : undefined,
      message: cachedBlocked
        ? '已返回微信聊天历史缓存，但缓存带有阻断原因，未视为真实同步成功。'
        : '已返回微信聊天历史缓存；传 force=true 可触发重新同步。',
    };
  }

  const runtimePlatform = getRuntimePlatform();
  if (runtimePlatform === 'win32') {
    const windowsCache =
      await this.buildWindowsWechatChatHistoryFromContacts(cached);
    if (windowsCache.sessions.length) {
      const blocked = this.withWechatChatHistoryBlocker(
        windowsCache,
        '当前 Windows 环境只能显示由联系人缓存生成的会话入口，无法读取聊天正文，因此不计为聊天历史同步成功。',
      );
      await this.writeWechatChatHistoryCache(blocked);
      return {
        ...this.buildWechatChatSessionsResult(blocked, {
          cached: false,
        }),
        ok: false,
        syncAttempted: true,
        scriptPath,
        errorCode: 'not_integrated',
        message:
          'Windows 微信聊天历史同步已阻断：会话入口来自联系人缓存，当前无法读取消息正文。',
      };
    }
    const blocked = this.withWechatChatHistoryBlocker(
      windowsCache,
      'Windows 会话历史暂未拿到真实联系人缓存；请先同步通讯录，或接入 Windows 微信 DB/RPA 读取器。',
    );
    return {
      ...this.buildWechatChatSessionsResult(blocked, {
        cached: Boolean(blocked.syncedAt || blocked.sessions.length),
      }),
      ok: false,
      syncAttempted: true,
      scriptPath,
      errorCode: 'target_missing',
      message: 'Windows 微信会话同步未写入新数据：当前没有可用联系人缓存。',
    };
  }

  if (runtimePlatform !== 'darwin') {
    const blocked = this.withWechatChatHistoryBlocker(
      cached,
      '当前聊天历史同步只支持 macOS 与 Windows；当前系统不支持真实采集。',
    );
    return {
      ...this.buildWechatChatSessionsResult(blocked, {
        cached: Boolean(blocked.syncedAt || blocked.sessions.length),
      }),
      ok: false,
      syncAttempted: false,
      scriptPath,
      errorCode: 'not_integrated',
      message: '微信聊天历史同步被阻断：当前系统暂不支持。',
    };
  }

  if (!scriptPath) {
    const blocked = this.withWechatChatHistoryBlocker(
      cached,
      '当前安装缺少微信聊天记录同步组件，请重新安装完整桌面版。',
    );
    return {
      ...this.buildWechatChatSessionsResult(blocked, {
        cached: Boolean(blocked.syncedAt || blocked.sessions.length),
      }),
      ok: false,
      syncAttempted: false,
      scriptPath,
      errorCode: 'not_integrated',
      message: '微信聊天记录同步组件未安装。',
    };
  }

  const result = await this.runWechatChatHistorySyncScript(scriptPath, input);
  if (result.ok === false) {
    const blocked = this.withWechatChatHistoryBlocker(
      cached,
      typeof result.error === 'string'
        ? result.error
        : '当前环境无法真实采集微信聊天历史。',
    );
    return {
      ...this.buildWechatChatSessionsResult(blocked, {
        cached: Boolean(blocked.syncedAt || blocked.sessions.length),
      }),
      ok: false,
      syncAttempted: true,
      scriptPath,
      errorCode: 'not_integrated',
      message:
        typeof result.message === 'string'
          ? result.message
          : '微信聊天历史同步未写入新数据。',
    };
  }

  const nextCache = this.normalizeWechatChatHistoryCache({
    source:
      typeof result.source === 'string' ? result.source : 'macos-wechat-rpa',
    sessions: result.sessions,
    messages: result.messages,
    syncedAt: new Date().toISOString(),
    blockers: Array.isArray(result.blockers) ? result.blockers : [],
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  });
  await this.writeWechatChatHistoryCache(nextCache);

  return {
    ...this.buildWechatChatSessionsResult(nextCache, { cached: false }),
    ok: true,
    syncAttempted: true,
    scriptPath,
    message: '微信聊天历史缓存已更新。',
  };
}

export async function getReadiness(
  this: WechatContactsHost,
  user?: LocalEngineEntitlementUser,
): Promise<LocalEngineReadiness> {
  const checkedAt = new Date().toISOString();
  const [browserStatus, fileStatus, capabilities] = await Promise.all([
    this.getBrowserStatus(),
    this.getFileAccessStatus(),
    this.getCapabilities(checkedAt, user),
  ]);
  const blockerStatuses: LocalEngineCapabilityStatus[] = [
    'blocked',
    'missing',
    'degraded',
  ];
  const warningStatuses: LocalEngineCapabilityStatus[] = [
    'warning',
    'developing',
  ];
  const rawBlockers = capabilities
    .filter(
      (capability) =>
        capability.required !== false &&
        blockerStatuses.includes(capability.status),
    )
    .map((capability) => ({
      capability: capability.name,
      message: capability.summary,
      nextAction: capability.nextAction,
    }));
  const warnings = capabilities
    .filter(
      (capability) =>
        warningStatuses.includes(capability.status) ||
        (capability.required === false &&
          blockerStatuses.includes(capability.status)),
    )
    .map((capability) => ({
      capability: capability.name,
      message: capability.summary,
      nextAction: capability.nextAction,
    }));
  const desktopReadinessLocked =
    this.isWechatReadinessSessionLocked(capabilities);
  const downgradedDesktopBlockers: Array<{
    capability: string;
    message: string;
    nextAction?: string;
  }> = [];
  const blockers = rawBlockers.filter((blocker) => {
    const isDesktopWindowLockBlocker =
      ['桌面控制', '微信完整执行链'].includes(blocker.capability) &&
      /无法确认当前前台窗口是唯一微信目标会话/.test(blocker.message);
    if (desktopReadinessLocked && isDesktopWindowLockBlocker) {
      downgradedDesktopBlockers.push(blocker);
      return false;
    }
    return true;
  });
  warnings.push(
    ...downgradedDesktopBlockers.map((blocker) => ({
      capability: blocker.capability,
      message: `${blocker.message}；已检测到微信执行器就绪且本机会话已确认，按受控执行风险提示处理。`,
      nextAction: blocker.nextAction,
    })),
  );

  if (
    !browserStatus.engineOnline &&
    !blockers.some((blocker) =>
      ['浏览器控制', '浏览器引擎'].includes(blocker.capability),
    )
  ) {
    blockers.push({
      capability: '浏览器引擎',
      message: browserStatus.engineMessage,
      nextAction:
        '请先启动 3011 本地 Runtime 和 Playwright MCP，再执行评论、私信或发布任务。',
    });
  }
  if (browserStatus.readyAccounts === 0) {
    warnings.push({
      capability: '平台账号',
      message:
        '当前没有可用的平台账号；抖音、小红书、视频号等平台任务需要登录，微信桌面任务不依赖平台账号。',
      nextAction:
        '需要平台发布或平台互动时，到发布中心的平台账号中重新登录或刷新账号状态。',
    });
  }
  const requiredAccountStatus = this.checkRequiredPlatformAccounts(
    browserStatus,
    capabilities,
  );
  if (!requiredAccountStatus.ready) {
    warnings.push({
      capability: '必需平台账号',
      message: requiredAccountStatus.message,
      nextAction: requiredAccountStatus.nextAction,
    });
  }
  if (fileStatus.summary.warnings > 0) {
    blockers.push({
      capability: '文件访问',
      message: `${fileStatus.summary.warnings} 个本地目录或文件不可访问。`,
      nextAction: '请到本地能力的文件访问页查看具体路径。',
    });
  }

  return {
    ready: blockers.length === 0,
    checkedAt,
    summary: {
      blockers: blockers.length,
      warnings: warnings.length,
      readyAccounts: browserStatus.readyAccounts,
      expiredAccounts: browserStatus.expiredAccounts,
      fileWarnings: fileStatus.summary.warnings,
    },
    blockers,
    warnings,
  };
}

export async function getRuntimeStatus(
  this: WechatContactsHost,
): Promise<LocalEngineRuntimeStatus> {
  const checkedAt = new Date().toISOString();
  const projectRoot = getProjectRoot();
  const logDir = this.getProjectLogRoot();
  const screenSessions = await this.readManagedScreenSessions(logDir);
  const services = await Promise.all(
    this.getRuntimeServiceDefinitions().map((service) =>
      this.inspectRuntimeService(service, screenSessions),
    ),
  );

  return {
    checkedAt,
    allOnline: services.every((service) => service.online),
    logDir,
    startScript: join(projectRoot, 'scripts', 'start-local-integration.sh'),
    stopScript: join(projectRoot, 'scripts', 'stop-local-integration.sh'),
    services,
  };
}

export function runRuntimeAction(
  this: WechatContactsHost,
  action: LocalEngineRuntimeAction,
  options: {
    riskConfirmation?: BackendRiskConfirmationInput;
    riskContext?: BackendRiskContext;
  } = {},
): LocalEngineRuntimeActionResult & { riskAudit: BackendRiskAuditEvent } {
  const projectRoot = getProjectRoot();
  const startScript = join(
    projectRoot,
    'scripts',
    'start-local-integration.sh',
  );
  const stopScript = join(projectRoot, 'scripts', 'stop-local-integration.sh');
  const submittedAt = new Date().toISOString();

  if (!['start', 'stop', 'restart'].includes(action)) {
    throw new BadRequestException('不支持的本机控制动作');
  }

  const riskAudit = assertBackendRiskGate({
    action: 'runtime-control',
    target: `local-engine-runtime:${action}`,
    riskLevel: action === 'start' ? 'medium' : 'high',
    requiresConfirmation: false,
    confirmation: options.riskConfirmation,
    context: options.riskContext,
    reason: '本地服务启停会影响后端、前端或 发布服务执行通道。',
  });

  const scriptPath = action === 'stop' ? stopScript : startScript;
  const command =
    action === 'restart'
      ? `sleep 0.5; '${stopScript}'; sleep 0.5; '${startScript}'`
      : `sleep 0.5; '${scriptPath}'`;

  const child = spawn('bash', ['-lc', command], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return {
    action,
    accepted: true,
    riskAudit,
    scriptPath,
    submittedAt,
    message:
      action === 'stop'
        ? '已提交停止本机服务动作，页面可能会短暂断开。'
        : action === 'restart'
          ? '已提交重启本机服务动作，请稍等后刷新状态。'
          : '已提交启动本机服务动作，请稍等后刷新状态。',
  };
}

export async function getRuntimeLog(
  this: WechatContactsHost,
  key: LocalEngineRuntimeServiceKey,
  lineCount = 80,
): Promise<LocalEngineRuntimeLog> {
  const service = this.getRuntimeServiceDefinitions().find(
    (item) => item.key === key,
  );
  if (!service) {
    throw new BadRequestException('不支持的本地服务日志');
  }

  const safeLineCount = Math.min(Math.max(lineCount, 20), 300);
  const exists = existsSync(service.logPath);
  const readAt = new Date().toISOString();

  if (!exists) {
    return {
      key: service.key,
      name: service.name,
      logPath: service.logPath,
      exists: false,
      lines: [],
      readAt,
    };
  }

  const content = await readFile(service.logPath, 'utf8');
  const lines = content.split(/\r?\n/).slice(-safeLineCount).filter(Boolean);

  return {
    key: service.key,
    name: service.name,
    logPath: service.logPath,
    exists: true,
    lines,
    readAt,
  };
}

export function getProjectLogRoot(this: WechatContactsHost) {
  const configured = process.env.KAYPAL_RUNTIME_LOG_ROOT?.trim();
  return configured
    ? resolve(configured)
    : join(getProjectRoot(), '.local-logs');
}

export function getRuntimeStateRoot(this: WechatContactsHost) {
  const configured = process.env.KAYPAL_RUNTIME_STATE_ROOT?.trim();
  return configured ? resolve(configured) : getProjectRoot();
}

export function getMacWechatCommandRoot(this: WechatContactsHost) {
  const configured =
    this.configService?.get<string>('KAYPAL_WECHAT_COMMAND_ROOT')?.trim() ||
    process.env.KAYPAL_WECHAT_COMMAND_ROOT?.trim() ||
    '';
  if (configured) {
    return configured;
  }
  const developmentRoot = join(
    getProjectRoot(),
    'desktop',
    'runtime',
    'wechat-macos',
    'bin',
  );
  return existsSync(developmentRoot) ? developmentRoot : '';
}

export function resolveWechatContactSyncScriptPath(this: WechatContactsHost) {
  const commandRoot = this.getMacWechatCommandRoot();
  const scriptPath = resolveFirstExistingLocalPath([
    this.configService
      ?.get<string>('AI_CONTENT_WECHAT_CONTACT_SYNC_SCRIPT')
      ?.trim(),
    process.env.AI_CONTENT_WECHAT_CONTACT_SYNC_SCRIPT?.trim(),
    commandRoot
      ? resolve(
          commandRoot,
          '..',
          'skillhub',
          'wechat-contact-sync',
          'wechat-contact-sync.py',
        )
      : undefined,
    join(
      getProjectRoot(),
      'vendor',
      'skillhub',
      'wechat-contact-sync',
      'wechat-contact-sync.py',
    ),
  ]);
  if (!scriptPath) {
    throw new BadRequestException(
      '当前安装缺少微信通讯录同步组件，请重新安装完整桌面版。',
    );
  }
  return scriptPath;
}

export function resolveWechatChatHistorySyncScriptPath(
  this: WechatContactsHost,
) {
  const commandRoot = this.getMacWechatCommandRoot();
  return resolveFirstExistingLocalPath([
    this.configService
      ?.get<string>('AI_CONTENT_WECHAT_CHAT_SYNC_SCRIPT')
      ?.trim(),
    process.env.AI_CONTENT_WECHAT_CHAT_SYNC_SCRIPT?.trim(),
    commandRoot
      ? resolve(
          commandRoot,
          '..',
          'skillhub',
          'wechat-chat-sync',
          'wechat-chat-sync.py',
        )
      : undefined,
    join(
      getProjectRoot(),
      'vendor',
      'skillhub',
      'wechat-chat-sync',
      'wechat-chat-sync.py',
    ),
  ]);
}

export function getWechatContactsCachePath(this: WechatContactsHost) {
  return join(this.getProjectLogRoot(), 'wechat-contacts.json');
}

export function getWechatContactsDiagnosticsPath(this: WechatContactsHost) {
  return join(this.getProjectLogRoot(), 'wechat-contact-sync-diagnostics.json');
}

export async function readWechatContactSyncDiagnosticsFile(
  this: WechatContactsHost,
): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(this.getWechatContactsDiagnosticsPath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function getWechatChatHistoryCachePath(this: WechatContactsHost) {
  return join(this.getProjectLogRoot(), 'wechat-chat-history.json');
}

export async function readWechatContactsCache(
  this: WechatContactsHost,
): Promise<{
  source: string;
  items: WechatContact[];
  currentWechatId?: string;
  plannedWechatId?: string;
  syncedAt?: string;
  screenshotPath?: string;
  diagnostics?: WechatContactsSyncDiagnostics;
}> {
  try {
    const raw = await readFile(this.getWechatContactsCachePath(), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const syncedAt =
      typeof parsed.syncedAt === 'string' ? parsed.syncedAt : undefined;
    const currentWechatId =
      typeof parsed.currentWechatId === 'string'
        ? parsed.currentWechatId
        : undefined;
    const plannedWechatId =
      typeof parsed.plannedWechatId === 'string'
        ? parsed.plannedWechatId
        : undefined;
    const source =
      typeof parsed.source === 'string' ? parsed.source : 'local-cache';
    const diagnostics = this.normalizeWechatContactsSyncDiagnostics(
      parsed.diagnostics,
      {
        source,
        screenshotPath:
          typeof parsed.screenshotPath === 'string'
            ? parsed.screenshotPath
            : undefined,
      },
    );
    const inferredCurrentWechatId =
      currentWechatId ||
      optionalTrimmedText(diagnostics?.selectedDbAccountFolder) ||
      optionalTrimmedText(diagnostics?.selectedDbBaseWxid) ||
      undefined;
    const rawContactInput = Array.isArray(parsed.items)
      ? parsed.items
      : parsed.contacts;
    const rawContactCandidates =
      this.extractWechatContactCandidateTexts(rawContactInput);
    const items = this.normalizeWechatContactList(rawContactInput, {
      syncedAt,
      currentWechatId: inferredCurrentWechatId,
      plannedWechatId,
    });
    const cacheLooksPolluted = this.isPollutedWechatContactCandidateBatch(
      rawContactCandidates,
      source,
    );
    const cacheIsLegacyAccountless =
      this.isWechatContactsLegacyAccountlessRuntimeCache({
        source,
        items,
        currentWechatId: inferredCurrentWechatId,
        diagnostics,
      });
    const cacheSafetyDiagnostics = cacheIsLegacyAccountless
      ? {
          ...(diagnostics || {}),
          source: 'wechat-contact-cache-account-guard',
          stage: 'legacy-cache-without-account-id',
          failureReason:
            '旧版本联系人缓存没有微信账号标识，已拒绝当作当前微信通讯录。',
          warnings: this.mergeWechatDiagnosticStringArrays(
            diagnostics?.warnings,
            ['旧版本联系人缓存没有微信账号标识，已拒绝当作当前微信通讯录。'],
          ),
        }
      : diagnostics;
    return {
      source,
      items: cacheLooksPolluted || cacheIsLegacyAccountless ? [] : items,
      currentWechatId: inferredCurrentWechatId,
      plannedWechatId,
      syncedAt,
      screenshotPath:
        typeof parsed.screenshotPath === 'string'
          ? parsed.screenshotPath
          : undefined,
      diagnostics: cacheSafetyDiagnostics,
    };
  } catch {
    return {
      source: 'empty',
      items: [],
    };
  }
}

export async function writeWechatContactsCache(
  this: WechatContactsHost,
  input: {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  },
) {
  const cachePath = this.getWechatContactsCachePath();
  await mkdir(resolve(cachePath, '..'), { recursive: true });
  await writeFile(
    cachePath,
    JSON.stringify(
      {
        ...input,
        contacts: input.items.map((item) => this.getWechatContactDisplay(item)),
      },
      null,
      2,
    ),
    'utf8',
  );
}

export function buildWechatContactsResult(
  this: WechatContactsHost,
  input: {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  },
): WechatContactsResult {
  return {
    source: input.source,
    contacts: input.items.map((item) => this.getWechatContactDisplay(item)),
    items: input.items,
    count: input.items.length,
    currentWechatId: input.currentWechatId,
    plannedWechatId: input.plannedWechatId,
    syncedAt: input.syncedAt,
    screenshotPath: input.screenshotPath,
    diagnostics: input.diagnostics,
  };
}

export async function readWechatChatHistoryCache(
  this: WechatContactsHost,
): Promise<WechatChatHistoryCache> {
  try {
    const raw = await readFile(this.getWechatChatHistoryCachePath(), 'utf8');
    return this.normalizeWechatChatHistoryCache(JSON.parse(raw));
  } catch {
    return this.normalizeWechatChatHistoryCache({
      source: 'empty',
      sessions: [],
      messages: [],
      blockers: ['本机还没有微信聊天历史缓存，当前无法从微信读取聊天正文。'],
      warnings: [],
    });
  }
}

export async function writeWechatChatHistoryCache(
  this: WechatContactsHost,
  input: WechatChatHistoryCache,
) {
  const cachePath = this.getWechatChatHistoryCachePath();
  await mkdir(resolve(cachePath, '..'), { recursive: true });
  await writeFile(cachePath, JSON.stringify(input, null, 2), 'utf8');
}

export async function buildWindowsWechatChatHistoryFromContacts(
  this: WechatContactsHost,
  cached: WechatChatHistoryCache,
): Promise<WechatChatHistoryCache> {
  const contactsCache = await this.readWechatContactsCache();
  const now = new Date().toISOString();
  const contactSessions = contactsCache.items.map((contact) => {
    const title = this.getWechatContactDisplay(contact);
    const id = `contact:${contact.wxid || title}`;
    return {
      id,
      title,
      contactName: title,
      unreadCount: 0,
      lastMessage: '已从 Windows 微信通讯录缓存建立会话入口。',
      lastMessageAt: contact.syncedAt || contact.updatedAt || now,
      updatedAt: contact.updatedAt || contact.syncedAt || now,
      source: 'windows-wechat-contact-cache' as WechatChatHistorySource,
      raw: {
        wxid: contact.wxid,
        nickname: contact.nickname,
        remark: contact.remark,
        tags: contact.tags,
        contactsSource: contactsCache.source,
        contactsSyncedAt: contactsCache.syncedAt,
      },
    };
  });
  const existingById = new Map(
    cached.sessions.map((session) => [session.id, session]),
  );
  for (const session of contactSessions) {
    existingById.set(session.id, {
      ...existingById.get(session.id),
      ...session,
    });
  }
  return this.normalizeWechatChatHistoryCache({
    source: contactSessions.length
      ? 'windows-wechat-contact-cache'
      : cached.source,
    sessions: [...existingById.values()],
    messages: cached.messages,
    syncedAt: contactSessions.length ? now : cached.syncedAt,
    blockers: contactSessions.length ? [] : cached.blockers,
    warnings: [
      ...cached.warnings,
      contactSessions.length
        ? 'Windows 当前先用联系人库生成会话列表；聊天消息正文需要 Windows 微信 DB/RPA 读取器后续接管。'
        : 'Windows 未找到联系人缓存，不能生成会话入口。',
    ],
  });
}

export function normalizeWechatChatHistoryCache(
  this: WechatContactsHost,
  input: unknown,
): WechatChatHistoryCache {
  const parsed =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const source = this.normalizeWechatChatHistorySource(parsed.source);
  const sessions = Array.isArray(parsed.sessions)
    ? parsed.sessions
        .map((item) => this.normalizeWechatChatSession(item, source))
        .filter((item): item is WechatChatSession => Boolean(item))
    : [];
  const messages = Array.isArray(parsed.messages)
    ? parsed.messages
        .map((item) => this.normalizeWechatChatMessage(item, source))
        .filter((item): item is WechatChatMessage => Boolean(item))
    : [];
  const sessionIds = new Set(sessions.map((item) => item.id));
  for (const message of messages) {
    if (!sessionIds.has(message.sessionId)) {
      sessions.push({
        id: message.sessionId,
        title: message.sessionId,
        unreadCount: 0,
        updatedAt: message.sentAt || message.createdAt,
        source: message.source,
      });
      sessionIds.add(message.sessionId);
    }
  }

  return {
    source,
    sessions,
    messages,
    syncedAt: typeof parsed.syncedAt === 'string' ? parsed.syncedAt : undefined,
    blockers: Array.isArray(parsed.blockers)
      ? parsed.blockers.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
  };
}

export function normalizeWechatChatSession(
  this: WechatContactsHost,
  input: unknown,
  fallbackSource: WechatChatHistorySource,
): WechatChatSession | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const item = input as Record<string, unknown>;
  const id =
    optionalTrimmedText(item.id) || optionalTrimmedText(item.sessionId) || '';
  const title =
    optionalTrimmedText(item.title) ||
    optionalTrimmedText(item.contactName) ||
    optionalTrimmedText(item.name) ||
    '';
  if (!id || !title) {
    return null;
  }
  return {
    id,
    title,
    contactName:
      typeof item.contactName === 'string' ? item.contactName : undefined,
    avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
    unreadCount: Number.isFinite(Number(item.unreadCount))
      ? Math.max(0, Math.floor(Number(item.unreadCount)))
      : 0,
    lastMessage:
      typeof item.lastMessage === 'string' ? item.lastMessage : undefined,
    lastMessageAt:
      typeof item.lastMessageAt === 'string' ? item.lastMessageAt : undefined,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
    source: this.normalizeWechatChatHistorySource(item.source, fallbackSource),
    raw:
      item.raw && typeof item.raw === 'object'
        ? (item.raw as Record<string, unknown>)
        : undefined,
  };
}

export function normalizeWechatChatMessage(
  this: WechatContactsHost,
  input: unknown,
  fallbackSource: WechatChatHistorySource,
): WechatChatMessage | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const item = input as Record<string, unknown>;
  const id = optionalTrimmedText(item.id) || '';
  const sessionId = optionalTrimmedText(item.sessionId) || '';
  const content =
    optionalTrimmedText(item.content) || optionalTrimmedText(item.text) || '';
  if (!id || !sessionId || !content) {
    return null;
  }
  return {
    id,
    sessionId,
    senderName:
      typeof item.senderName === 'string' ? item.senderName : undefined,
    direction: this.normalizeWechatMessageDirection(item.direction),
    content,
    contentType: this.normalizeWechatMessageContentType(item.contentType),
    sentAt: typeof item.sentAt === 'string' ? item.sentAt : undefined,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
    source: this.normalizeWechatChatHistorySource(item.source, fallbackSource),
    raw:
      item.raw && typeof item.raw === 'object'
        ? (item.raw as Record<string, unknown>)
        : undefined,
  };
}

export function normalizeWechatChatHistorySource(
  this: WechatContactsHost,
  value: unknown,
  fallback: WechatChatHistorySource = 'local-cache',
): WechatChatHistorySource {
  const source = optionalTrimmedText(value) || '';
  const allowed: WechatChatHistorySource[] = [
    'empty',
    'local-cache',
    'macos-wechat-rpa',
    'macos-wechat-ocr',
    'windows-wechat-contact-cache',
    'wechat-db',
    'manual-import',
  ];
  return allowed.includes(source as WechatChatHistorySource)
    ? (source as WechatChatHistorySource)
    : fallback;
}

export function normalizeWechatMessageDirection(
  this: WechatContactsHost,
  value: unknown,
): WechatChatMessage['direction'] {
  const direction = optionalTrimmedText(value) || '';
  return ['incoming', 'outgoing', 'system', 'unknown'].includes(direction)
    ? (direction as WechatChatMessage['direction'])
    : 'unknown';
}

export function normalizeWechatMessageContentType(
  this: WechatContactsHost,
  value: unknown,
): WechatChatMessage['contentType'] {
  const contentType = optionalTrimmedText(value) || '';
  return ['text', 'image', 'file', 'system', 'unknown'].includes(contentType)
    ? (contentType as WechatChatMessage['contentType'])
    : 'text';
}

export function buildWechatChatSessionsResult(
  this: WechatContactsHost,
  cache: WechatChatHistoryCache,
  options: { cached: boolean },
): WechatChatSessionsResult {
  const sessions = [...cache.sessions].sort((a, b) =>
    this.compareOptionalTime(
      b.lastMessageAt || b.updatedAt,
      a.lastMessageAt || a.updatedAt,
    ),
  );
  return {
    status: this.resolveWechatChatHistoryStatus(cache, sessions.length),
    source: cache.source,
    sessions,
    count: sessions.length,
    syncedAt: cache.syncedAt,
    cached: options.cached,
    blockers: cache.blockers,
    warnings: cache.warnings,
    nextAction: this.resolveWechatChatHistoryNextAction(cache),
    cache: this.buildWechatChatHistoryCacheInfo(cache),
  };
}

export function buildWechatChatHistoryCacheInfo(
  this: WechatContactsHost,
  cache: WechatChatHistoryCache,
) {
  return {
    path: this.getWechatChatHistoryCachePath(),
    cached: Boolean(
      cache.syncedAt || cache.sessions.length || cache.messages.length,
    ),
    syncedAt: cache.syncedAt,
    source: cache.source,
  };
}

export function resolveWechatChatHistoryStatus(
  this: WechatContactsHost,
  cache: WechatChatHistoryCache,
  itemCount: number,
): WechatChatHistoryStatus {
  if (cache.blockers.length > 0) {
    return 'blocked';
  }
  return itemCount > 0 ? 'ready' : 'empty';
}

export function resolveWechatChatHistoryNextAction(
  this: WechatContactsHost,
  cache: WechatChatHistoryCache,
): string {
  if (cache.blockers.length > 0) {
    return '接入真实微信 DB 读取、Agent-S/RPA 当前会话采集或 OCR 采集器后，再执行同步。';
  }
  if (!cache.sessions.length) {
    return '当前缓存为空；可先执行同步，或导入后续 RPA/OCR 产出的缓存文件。';
  }
  return '可按 sessionId 读取聊天历史；后续同步会复用同一缓存结构。';
}

export function withWechatChatHistoryBlocker(
  this: WechatContactsHost,
  cache: WechatChatHistoryCache,
  blocker: string,
): WechatChatHistoryCache {
  return {
    ...cache,
    blockers: [
      ...new Set(
        [...cache.blockers, blocker].map((item) => item.trim()).filter(Boolean),
      ),
    ],
  };
}

export function compareOptionalTime(
  this: WechatContactsHost,
  left?: string,
  right?: string,
) {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return (
    (Number.isFinite(leftTime) ? leftTime : 0) -
    (Number.isFinite(rightTime) ? rightTime : 0)
  );
}

export function normalizeWechatContactList(
  this: WechatContactsHost,
  value: unknown,
  defaults: Partial<WechatContact> = {},
): WechatContact[] {
  const rawItems = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const contacts: WechatContact[] = [];

  for (const rawItem of rawItems) {
    const contact = this.normalizeWechatContact(rawItem, defaults);
    if (!contact || this.isRejectedWechatContact(contact)) {
      continue;
    }
    const key = this.getWechatContactDisplay(contact);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    contacts.push(contact);
  }

  return contacts;
}

export function extractWechatContactCandidateTexts(
  this: WechatContactsHost,
  value: unknown,
) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((item: unknown) => {
      if (item && typeof item === 'object') {
        const raw = item as Record<string, unknown>;
        return [raw.wxid, raw.nickname, raw.remark, raw.id];
      }
      return [item];
    })
    .map((item: unknown) => optionalTrimmedText(item) || '')
    .filter(Boolean);
}

export function isPollutedWechatContactCandidateBatch(
  this: WechatContactsHost,
  candidates: string[],
  source?: string,
) {
  const items = candidates
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!items.length) {
    return false;
  }

  const shellPattern =
    /^(微信|WeChat|Weixin|通讯录|联系人|新的朋友|朋友|群聊|标签|公众号|服务号|企业微信联系人|搜索|聊天|收藏|文件传输助手|朋友圈|视频号|订阅号|服务通知|小程序|更多|全部|添加朋友|新的联系人|我的企业|星标朋友|公星标朋友)$/i;
  const hardNonWechatPattern =
    /抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|刷新状态|绑定平台/;
  const publicAccountNoisePattern =
    /微信小店助手|腾讯新闻|东方甄选|订阅号消息|微信团队|服务通知|公众号|服务号|福利小管|时惠叭|甄选/;
  const systemNoisePattern =
    /A new version of Dock|Upgrade plan|Engine starting|Macintosh|iCloud|Finder|Safari|Chrome|Edge|浏览器|This page could not be found|404/i;
  const chatOrNewsNoisePattern =
    /折叠的聊天|@所有人|\[\d+条\]|分钟前|昨天|今天|[0-2]?\d:[0-5]\d|招聘|工作内容|上班时间|微信同步|置顶|新闻|直播|链接|网友|茉莉奶/;

  const hardNonWechatCount = items.filter((item) =>
    hardNonWechatPattern.test(item),
  ).length;
  if (hardNonWechatCount > 0) {
    return true;
  }

  const pollutionCount = items.filter((item) => {
    const compact = item.replace(/\s+/g, '');
    return (
      shellPattern.test(compact) ||
      compact.includes('星标朋友') ||
      compact.includes('我的企业') ||
      publicAccountNoisePattern.test(item) ||
      systemNoisePattern.test(item) ||
      chatOrNewsNoisePattern.test(item) ||
      /^[【[［].*[】\]］]/.test(compact)
    );
  }).length;
  const likelyContactCount = items.filter((item) => {
    const compact = item.replace(/\s+/g, '');
    return (
      compact.length >= 2 &&
      compact.length <= 40 &&
      !shellPattern.test(compact) &&
      !compact.includes('星标朋友') &&
      !compact.includes('我的企业') &&
      !publicAccountNoisePattern.test(item) &&
      !systemNoisePattern.test(item) &&
      !chatOrNewsNoisePattern.test(item) &&
      !/^[【[［].*[】\]］]/.test(compact)
    );
  }).length;
  const sourceLooksLikeOcr = /wechat|weixin|ocr|uia|cache/i.test(source || '');

  if (likelyContactCount === 0 && pollutionCount > 0) {
    return true;
  }
  const pollutionRatio = pollutionCount / items.length;
  return (
    sourceLooksLikeOcr &&
    items.length >= 4 &&
    (pollutionRatio >= 0.8 || (pollutionCount >= 8 && pollutionRatio >= 0.5))
  );
}

export function isRejectedWechatContact(
  this: WechatContactsHost,
  contact: WechatContact,
) {
  const display = this.getWechatContactDisplay(contact).trim();
  const compact = display.replace(/\s+/g, '');
  if (!compact) {
    return true;
  }
  if (
    /^(微信|WeChat|Weixin|通讯录|联系人|新的朋友|朋友|群聊|标签|公众号|服务号|企业微信联系人|搜索|聊天|收藏|文件传输助手|朋友圈|视频号|订阅号|服务通知|小程序|更多|全部|添加朋友|新的联系人|我的企业|星标朋友|公星标朋友)$/i.test(
      compact,
    )
  ) {
    return true;
  }
  if (compact.includes('星标朋友') || compact.includes('我的企业')) {
    return true;
  }
  if (
    /抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|刷新状态|绑定平台/.test(
      display,
    )
  ) {
    return true;
  }
  if (
    /A new version of Dock|Upgrade plan|Engine starting|Macintosh|iCloud|Finder/i.test(
      display,
    )
  ) {
    return true;
  }
  if (
    /微信小店助手|腾讯新闻|东方甄选|服务通知|订阅号消息|微信团队|福利小管|时惠叭|网友|茉莉奶|新闻/.test(
      display,
    )
  ) {
    return true;
  }
  if (/^[【[［].*[】\]］]/.test(compact)) {
    return true;
  }
  if (
    /折叠的聊天|@所有人|\[\d+条\]|分钟前|昨天|今天|[0-2]?\d:[0-5]\d|招聘|工作内容|上班时间|微信同步|置顶/.test(
      display,
    )
  ) {
    return true;
  }
  return compact.length < 2 || compact.length > 40;
}

export function normalizeWechatContact(
  this: WechatContactsHost,
  value: unknown,
  defaults: Partial<WechatContact> = {},
): WechatContact | null {
  const now = new Date().toISOString();
  const raw =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : { nickname: value };
  const nickname = optionalTrimmedText(raw.nickname);
  const remark = optionalTrimmedText(raw.remark);
  const wxid =
    optionalTrimmedText(raw.wxid) ||
    optionalTrimmedText(raw.id) ||
    remark ||
    nickname;

  if (!wxid) {
    return null;
  }

  return {
    wxid,
    nickname,
    remark,
    tags: normalizeWechatContactTags(raw.tags),
    currentWechatId:
      optionalTrimmedText(raw.currentWechatId) || defaults.currentWechatId,
    plannedWechatId:
      optionalTrimmedText(raw.plannedWechatId) || defaults.plannedWechatId,
    syncedAt: optionalTrimmedText(raw.syncedAt) || defaults.syncedAt,
    updatedAt: optionalTrimmedText(raw.updatedAt) || defaults.updatedAt || now,
    createdAt: optionalTrimmedText(raw.createdAt) || defaults.createdAt || now,
  };
}

export function getWechatContactDisplay(
  this: WechatContactsHost,
  contact: WechatContact,
) {
  return contact.remark || contact.nickname || contact.wxid;
}

export function normalizeWechatContactsSyncDiagnostics(
  this: WechatContactsHost,
  value: unknown,
  defaults: Partial<WechatContactsSyncDiagnostics> = {},
): WechatContactsSyncDiagnostics | undefined {
  const raw =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const diagnostics: WechatContactsSyncDiagnostics = {
    ...defaults,
    stage: optionalTrimmedText(raw.stage) || defaults.stage,
    source: optionalTrimmedText(raw.source) || defaults.source,
    contractVersion:
      optionalTrimmedText(raw.contractVersion) || defaults.contractVersion,
    contactsContract:
      this.normalizeJsonRecord(raw.contactsContract) ||
      defaults.contactsContract,
    screenshotPath:
      optionalTrimmedText(raw.screenshotPath) || defaults.screenshotPath,
    engine: optionalTrimmedText(raw.engine) || defaults.engine,
    engineVersion:
      optionalTrimmedText(raw.engineVersion) || defaults.engineVersion,
    enginePath: optionalTrimmedText(raw.enginePath) || defaults.enginePath,
    nativeRuntimePath:
      optionalTrimmedText(raw.nativeRuntimePath) || defaults.nativeRuntimePath,
    nativeRuntimeVersion:
      optionalTrimmedText(raw.nativeRuntimeVersion) ||
      defaults.nativeRuntimeVersion,
    decryptionHelperPath:
      optionalTrimmedText(raw.decryptionHelperPath) ||
      defaults.decryptionHelperPath,
    fallbackReason:
      optionalTrimmedText(raw.fallbackReason) || defaults.fallbackReason,
    wechatVersion:
      optionalTrimmedText(raw.wechatVersion) || defaults.wechatVersion,
    dbKeyStatus: optionalTrimmedText(raw.dbKeyStatus) || defaults.dbKeyStatus,
    processName: optionalTrimmedText(raw.processName) || defaults.processName,
    windowTitle: optionalTrimmedText(raw.windowTitle) || defaults.windowTitle,
    os: optionalTrimmedText(raw.os) || defaults.os,
    attemptedSources: normalizeStringArray(
      raw.attemptedSources,
      defaults.attemptedSources,
    ),
    warnings: normalizeStringArray(raw.warnings, defaults.warnings),
    rawPreview: normalizeStringArray(raw.rawPreview, defaults.rawPreview),
    ocrPreview: normalizeStringArray(raw.ocrPreview, defaults.ocrPreview),
    runtimeCapabilities: normalizeStringArray(
      raw.runtimeCapabilities,
      defaults.runtimeCapabilities,
    ),
    dbPaths: normalizeStringArray(raw.dbPaths, defaults.dbPaths),
    dbCandidateDetails:
      this.normalizeJsonRecordArray(raw.dbCandidateDetails) ||
      defaults.dbCandidateDetails,
    dbCandidateResults:
      this.normalizeJsonRecordArray(raw.dbCandidateResults) ||
      defaults.dbCandidateResults,
    dbErrors: this.normalizeJsonRecordArray(raw.dbErrors) || defaults.dbErrors,
    dbError: optionalTrimmedText(raw.dbError) || defaults.dbError,
    selectedDbPath:
      optionalTrimmedText(raw.selectedDbPath) || defaults.selectedDbPath,
    selectedDbAccountFolder:
      optionalTrimmedText(raw.selectedDbAccountFolder) ||
      defaults.selectedDbAccountFolder,
    selectedDbBaseWxid:
      optionalTrimmedText(raw.selectedDbBaseWxid) ||
      defaults.selectedDbBaseWxid,
    selectedDbActiveMtime:
      optionalTrimmedText(raw.selectedDbActiveMtime) ||
      defaults.selectedDbActiveMtime,
    sqlitePath: optionalTrimmedText(raw.sqlitePath) || defaults.sqlitePath,
    dbHelper: optionalTrimmedText(raw.dbHelper) || defaults.dbHelper,
    helperError: optionalTrimmedText(raw.helperError) || defaults.helperError,
    keyHelperStatus:
      optionalTrimmedText(raw.keyHelperStatus) || defaults.keyHelperStatus,
    decryptionStatus:
      optionalTrimmedText(raw.decryptionStatus) || defaults.decryptionStatus,
    resultSource:
      optionalTrimmedText(raw.resultSource) || defaults.resultSource,
    externalKeyToolStatus:
      optionalTrimmedText(raw.externalKeyToolStatus) ||
      defaults.externalKeyToolStatus,
    externalRawKeyToolStatus:
      optionalTrimmedText(raw.externalRawKeyToolStatus) ||
      defaults.externalRawKeyToolStatus,
    externalKeyToolCandidates:
      this.normalizeJsonRecord(raw.externalKeyToolCandidates) ||
      defaults.externalKeyToolCandidates,
    externalKeyToolCompatibility:
      this.normalizeJsonRecordArray(raw.externalKeyToolCompatibility) ||
      defaults.externalKeyToolCompatibility,
    externalDbKeyAttempts:
      this.normalizeJsonRecordArray(raw.externalDbKeyAttempts) ||
      defaults.externalDbKeyAttempts,
    externalDumpRsPidAttempts:
      this.normalizeJsonRecordArray(raw.externalDumpRsPidAttempts) ||
      defaults.externalDumpRsPidAttempts,
    externalWxKeyDllAttempts:
      this.normalizeJsonRecordArray(raw.externalWxKeyDllAttempts) ||
      defaults.externalWxKeyDllAttempts,
    decryptAttempts:
      this.normalizeJsonRecordArray(raw.decryptAttempts) ||
      defaults.decryptAttempts,
    wechatProcessArchitectures:
      this.normalizeJsonRecordArray(raw.wechatProcessArchitectures) ||
      defaults.wechatProcessArchitectures,
    keyScanDiagnostics:
      optionalTrimmedText(raw.keyScanDiagnostics) ||
      defaults.keyScanDiagnostics,
    memoryScanStatus:
      optionalTrimmedText(raw.memoryScanStatus) || defaults.memoryScanStatus,
    blockedReasons: normalizeStringArray(
      raw.blockedReasons,
      defaults.blockedReasons,
    ),
    failureReason:
      optionalTrimmedText(raw.failureReason) || defaults.failureReason,
    failureLayer:
      optionalTrimmedText(raw.failureLayer) || defaults.failureLayer,
    platformStatus:
      optionalTrimmedText(raw.platformStatus) || defaults.platformStatus,
    windowStatus:
      optionalTrimmedText(raw.windowStatus) || defaults.windowStatus,
    dbStatus: optionalTrimmedText(raw.dbStatus) || defaults.dbStatus,
    helperStatus:
      optionalTrimmedText(raw.helperStatus) || defaults.helperStatus,
    uiaStatus: optionalTrimmedText(raw.uiaStatus) || defaults.uiaStatus,
    uiaStopReason:
      optionalTrimmedText(raw.uiaStopReason) || defaults.uiaStopReason,
    uiaContactNavigationAction:
      optionalTrimmedText(raw.uiaContactNavigationAction) ||
      defaults.uiaContactNavigationAction,
    uiaContactNavigationTarget:
      optionalTrimmedText(raw.uiaContactNavigationTarget) ||
      defaults.uiaContactNavigationTarget,
    layers: this.normalizeJsonRecord(raw.layers) || defaults.layers,
    externalCommandRunners:
      this.normalizeJsonRecord(raw.externalCommandRunners) ||
      defaults.externalCommandRunners,
    uiaPageSummaries:
      this.normalizeJsonRecordArray(raw.uiaPageSummaries) ||
      defaults.uiaPageSummaries,
  };
  for (const key of [
    'pagesScanned',
    'uiaContactCount',
    'ocrContactCount',
    'dbContactCount',
    'dbTotalContactCount',
    'rawTextCount',
    'processId',
    'uiaNodeCount',
    'uiaScrollResetAttempts',
    'selectedDbScore',
  ] as const) {
    const parsed = Number(raw[key]);
    if (Number.isFinite(parsed)) {
      diagnostics[key] = parsed;
    } else if (defaults[key] !== undefined) {
      diagnostics[key] = defaults[key];
    }
  }
  if (typeof raw.isCurrentProcessElevated === 'boolean') {
    diagnostics.isCurrentProcessElevated = raw.isCurrentProcessElevated;
  } else if (typeof defaults.isCurrentProcessElevated === 'boolean') {
    diagnostics.isCurrentProcessElevated = defaults.isCurrentProcessElevated;
  }
  for (const key of [
    'externalKeyToolCrash',
    'externalKeyToolTimeout',
    'externalKeyToolIncompatible',
    'externalKeyToolUnsupported',
    'currentAccountDbBlocked',
  ] as const) {
    if (typeof raw[key] === 'boolean') {
      diagnostics[key] = raw[key];
    } else if (typeof defaults[key] === 'boolean') {
      diagnostics[key] = defaults[key];
    }
  }
  if (raw.windowRect && typeof raw.windowRect === 'object') {
    const rect = raw.windowRect as Record<string, unknown>;
    const left = Number(rect.left);
    const top = Number(rect.top);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if ([left, top, width, height].every((item) => Number.isFinite(item))) {
      diagnostics.windowRect = { left, top, width, height };
    }
  } else if (defaults.windowRect) {
    diagnostics.windowRect = defaults.windowRect;
  }
  if (raw.screen && typeof raw.screen === 'object') {
    const screen = raw.screen as Record<string, unknown>;
    const width = Number(screen.width);
    const height = Number(screen.height);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      diagnostics.screen = { width, height };
    }
  } else if (defaults.screen) {
    diagnostics.screen = defaults.screen;
  }
  const hasUsefulValue = Object.values(diagnostics).some((item) =>
    Array.isArray(item) ? item.length > 0 : item !== undefined,
  );
  return hasUsefulValue ? diagnostics : undefined;
}

export function isNonWechatContactSyncDiagnostics(
  this: WechatContactsHost,
  diagnostics?: WechatContactsSyncDiagnostics,
) {
  if (!diagnostics) return false;
  const text = [
    diagnostics.failureReason,
    diagnostics.fallbackReason,
    diagnostics.windowTitle,
    ...(diagnostics.rawPreview || []),
    ...(diagnostics.ocrPreview || []),
    ...(diagnostics.warnings || []),
  ]
    .filter(Boolean)
    .join('\n');
  return /不是微信窗口|不是微信通讯录|非微信页面|抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|AI员工TOS|智能运营系统|增长获客/.test(
    text,
  );
}

export function normalizeJsonRecord(this: WechatContactsHost, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function normalizeInteractionTaskBillingIdentity(
  this: WechatContactsHost,
  value: unknown,
): InteractionTaskBillingIdentity | undefined {
  const record = this.normalizeJsonRecord(value);
  if (!record) return undefined;
  const sessionId = optionalTrimmedText(record.sessionId);
  const localUserId = optionalTrimmedText(record.localUserId);
  const kaypalUserId = optionalTrimmedText(record.kaypalUserId);
  const accessToken = optionalTrimmedText(record.kaypalDesktopAccessToken);
  const refreshToken = optionalTrimmedText(record.kaypalDesktopRefreshToken);
  if (
    !localUserId ||
    !kaypalUserId ||
    (!sessionId && !accessToken && !refreshToken)
  ) {
    return undefined;
  }
  return {
    sessionId,
    localUserId,
    kaypalUserId,
    kaypalDesktopAccessToken: accessToken,
    kaypalDesktopRefreshToken: refreshToken,
    kaypalDesktopTokenExpiresAt: optionalTrimmedText(
      record.kaypalDesktopTokenExpiresAt,
    ),
    kaypalDesktopDeviceId: optionalTrimmedText(record.kaypalDesktopDeviceId),
    kaypalPlan: optionalTrimmedText(record.kaypalPlan),
    kaypalRole: optionalTrimmedText(record.kaypalRole),
    kaypalPlatformRole: optionalTrimmedText(record.kaypalPlatformRole),
    commercialExecutionAllowed:
      typeof record.commercialExecutionAllowed === 'boolean'
        ? record.commercialExecutionAllowed
        : undefined,
    planMode: optionalTrimmedText(record.planMode),
    capturedAt:
      optionalTrimmedText(record.capturedAt) || new Date().toISOString(),
  };
}

export function buildWechatNativeCommandRunnerReadinessCheck(
  this: WechatContactsHost,
  commandRunners: Record<string, unknown> | undefined,
  platformName: string,
): WechatContactsReadinessCheck {
  const commands = Object.entries(WECHAT_NATIVE_COMMAND_RUNNER_LABELS).map(
    ([command, label]) => {
      const runner = this.normalizeJsonRecord(commandRunners?.[command]);
      const status = optionalTrimmedText(runner?.status) || 'missing';
      return {
        command,
        label,
        status,
        path: optionalTrimmedText(runner?.path),
        kind: optionalTrimmedText(runner?.kind),
        candidateCount: Array.isArray(runner?.candidates)
          ? runner.candidates.length
          : 0,
      };
    },
  );
  const readyCommands = commands.filter((item) => item.status === 'ready');
  const missingCommands = commands
    .filter((item) => item.status !== 'ready')
    .map((item) => item.label);
  const allReady = readyCommands.length === commands.length;
  const missingRunnerSummary = missingCommands.join('、');
  return {
    key: 'wechat-command-runners',
    name: '微信操作能力',
    status: allReady ? 'ready' : 'warning',
    message: allReady
      ? '群发、加好友、通过好友、朋友圈和会话历史能力已安装。'
      : `${missingRunnerSummary}尚未安装，相关微信操作会停止在执行前。`,
    nextAction: allReady
      ? undefined
      : platformName === 'win32'
        ? '请重新安装包含微信操作组件的完整桌面版，并完成 Windows 微信检查。'
        : '请重新安装包含微信操作组件的完整桌面版，并在本机授权辅助功能和屏幕录制。',
    details: {
      configuredCount: readyCommands.length,
      requiredCount: commands.length,
      commands,
      raw: commandRunners,
    },
  };
}

export function resolveMacWechatCommandRunners(this: WechatContactsHost) {
  const commandRoot = this.getMacWechatCommandRoot();
  const developmentRoot = join(
    getProjectRoot(),
    'desktop',
    'runtime',
    'wechat-macos',
    'bin',
  );
  const commandMap: Record<string, string> = {
    'group-broadcast': 'wechat-auto-reply',
    'contact-add': 'wechat-contact-add',
    'moments-publish': 'wechat-moments-publish',
    'moments-marketing': 'wechat-moments-marketing',
    'chat-history': 'wechat-chat-history',
  };
  return Object.fromEntries(
    Object.entries(commandMap).map(([command, executable]) => {
      const runnerPath = resolveFirstExistingLocalPath([
        commandRoot ? join(commandRoot, executable) : undefined,
        join(developmentRoot, executable),
        join(homedir(), '.local', 'bin', executable),
        join('/opt/homebrew/bin', executable),
        join('/usr/local/bin', executable),
      ]);
      return [
        command,
        {
          status: runnerPath ? 'ready' : 'missing',
          path: runnerPath,
          kind: runnerPath ? 'shell-script' : undefined,
          platform: 'darwin',
        },
      ];
    }),
  );
}

export function buildMacWechatToolReadinessCheck(
  this: WechatContactsHost,
): WechatContactsReadinessCheck {
  const commandRoot = this.getMacWechatCommandRoot();
  const developmentRoot = join(
    getProjectRoot(),
    'desktop',
    'runtime',
    'wechat-macos',
    'bin',
  );
  const tools = [
    {
      key: 'desktop-control',
      label: '桌面控制',
      path: resolveFirstExistingLocalPath([
        commandRoot ? join(commandRoot, 'cliclick') : undefined,
        join(developmentRoot, 'cliclick'),
      ]),
    },
    {
      key: 'python',
      label: '本机脚本服务',
      path: resolveFirstExistingLocalPath([
        process.env.PYTHON,
        '/usr/bin/python3',
        '/opt/homebrew/bin/python3',
        '/usr/local/bin/python3',
      ]),
    },
    {
      key: 'vision',
      label: '文字识别',
      path: resolveFirstExistingLocalPath([
        '/usr/bin/swift',
        '/Library/Developer/CommandLineTools/usr/bin/swift',
      ]),
    },
    {
      key: 'automation',
      label: '系统自动化',
      path: resolveFirstExistingLocalPath(['/usr/bin/osascript']),
    },
    {
      key: 'screenshot',
      label: '屏幕读取',
      path: resolveFirstExistingLocalPath(['/usr/sbin/screencapture']),
    },
  ];
  const missing = tools.filter((item) => !item.path);
  return {
    key: 'macos-wechat-tools',
    name: 'Mac 微信运行环境',
    status: missing.length ? 'warning' : 'ready',
    message: missing.length
      ? `${missing.map((item) => item.label).join('、')}不可用，部分微信操作会停止在执行前。`
      : '桌面控制、文字识别和屏幕读取能力均可用。',
    nextAction: missing.length
      ? '请安装完整桌面版并在系统设置中允许辅助功能和屏幕录制。'
      : undefined,
    details: { tools },
  };
}

export function normalizeJsonRecordArray(
  this: WechatContactsHost,
  value: unknown,
) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const records = value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  );
  return records.length ? records.slice(0, 100) : undefined;
}

export function mergeWechatDiagnosticStringArrays(
  this: WechatContactsHost,
  ...values: Array<string[] | undefined>
) {
  return [
    ...new Set(
      values
        .flatMap((items) => items || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  ].slice(0, 50);
}

export function mergeWechatContactsSyncDiagnostics(
  this: WechatContactsHost,
  ...values: unknown[]
): WechatContactsSyncDiagnostics | undefined {
  let merged: WechatContactsSyncDiagnostics | undefined;
  for (const value of values) {
    const normalized = this.normalizeWechatContactsSyncDiagnostics(value);
    if (!normalized) {
      continue;
    }
    const previous = merged;
    merged = this.normalizeWechatContactsSyncDiagnostics(normalized, previous);
    if (previous && merged) {
      merged.attemptedSources = this.mergeWechatDiagnosticStringArrays(
        previous.attemptedSources,
        normalized.attemptedSources,
      );
      merged.warnings = this.mergeWechatDiagnosticStringArrays(
        previous.warnings,
        normalized.warnings,
      );
      merged.rawPreview = this.mergeWechatDiagnosticStringArrays(
        previous.rawPreview,
        normalized.rawPreview,
      );
      merged.ocrPreview = this.mergeWechatDiagnosticStringArrays(
        previous.ocrPreview,
        normalized.ocrPreview,
      );
      merged.runtimeCapabilities = this.mergeWechatDiagnosticStringArrays(
        previous.runtimeCapabilities,
        normalized.runtimeCapabilities,
      );
      merged.dbPaths = this.mergeWechatDiagnosticStringArrays(
        previous.dbPaths,
        normalized.dbPaths,
      );
    }
  }
  return merged;
}

export function isWechatContactVisionFallbackEnabled(this: WechatContactsHost) {
  if (!this.configService) {
    return false;
  }
  const value = (
    this.configService.get<string>(
      'AI_CONTENT_WECHAT_CONTACT_VISION_FALLBACK',
    ) || ''
  )
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export async function tryRunWechatContactVisionFallback(
  this: WechatContactsHost,
  error: unknown,
) {
  if (
    !this.isWechatContactVisionFallbackEnabled() ||
    !this.aiClient ||
    !this.defaultModels
  ) {
    return null;
  }
  const diagnostics = this.normalizeWechatContactsSyncDiagnostics(
    (error as { diagnostics?: unknown })?.diagnostics,
  );
  if (this.isNonWechatContactSyncDiagnostics(diagnostics)) {
    await this.writeWechatContactSyncDiagnostics({
      ok: false,
      fallback: 'vision',
      skipped: true,
      reason: '本地诊断已确认当前焦点不是微信通讯录窗口，已跳过视觉兜底。',
      diagnostics,
      capturedAt: new Date().toISOString(),
    });
    return null;
  }
  const screenshotPath = diagnostics?.screenshotPath;
  if (!screenshotPath || !existsSync(screenshotPath)) {
    return null;
  }
  try {
    const defaults = await this.defaultModels.getDefaults();
    const modelId =
      this.configService
        .get<string>('AI_CONTENT_WECHAT_CONTACT_VISION_MODEL_ID')
        ?.trim() ||
      defaults.articleCreation ||
      defaults.topicSelection;
    if (!modelId) {
      return null;
    }
    const image = await readFile(screenshotPath);
    const maxBytes = Number(
      this.configService.get<string>(
        'AI_CONTENT_WECHAT_CONTACT_VISION_MAX_BYTES',
      ) || 7 * 1024 * 1024,
    );
    if (Number.isFinite(maxBytes) && image.length > maxBytes) {
      await this.writeWechatContactSyncDiagnostics({
        ok: false,
        fallback: 'vision',
        skipped: true,
        reason: `截图过大：${image.length} bytes`,
        diagnostics,
        capturedAt: new Date().toISOString(),
      });
      return null;
    }
    const output = await this.aiClient.generateWithImage(
      modelId,
      {
        system:
          '你是桌面微信通讯录截图识别器，只从图片中提取联系人或群聊名称。',
        prompt: [
          '请从这张 Windows 微信通讯录截图中提取可见联系人/群聊名称。',
          '只输出 JSON，不要解释。格式：{"contacts":["名称1","名称2"],"warnings":[]}',
          '不要输出“微信、通讯录、联系人、搜索、新的朋友、群聊、标签、公众号”等导航文字。',
          '不要猜测图片里没有出现的名字。',
        ].join('\n'),
        imageBase64: image.toString('base64'),
      },
      {
        mimeType: resolveImageMimeType(screenshotPath),
        temperature: 0,
        maxTokens: 900,
        detail: 'high',
        knowledgeMode: 'off',
      },
    );
    const parsed = this.parseWechatVisionContactsOutput(output);
    const contacts = this.normalizeWechatContactList(parsed.contacts, {
      syncedAt: new Date().toISOString(),
    });
    const names = contacts.map((item) => this.getWechatContactDisplay(item));
    if (!names.length) {
      await this.writeWechatContactSyncDiagnostics({
        ok: false,
        fallback: 'vision',
        skipped: false,
        reason: '视觉模型没有提取到联系人',
        modelId,
        output,
        diagnostics,
        capturedAt: new Date().toISOString(),
      });
      return null;
    }
    const mergedDiagnostics = {
      ...diagnostics,
      source: 'windows-wechat-vision',
      stage: 'vision-fallback-completed',
      screenshotPath,
      attemptedSources: [
        ...(diagnostics?.attemptedSources || []),
        'cloud-vision',
      ],
      warnings: [
        ...(diagnostics?.warnings || []),
        '已启用云端视觉兜底识别通讯录截图。',
        ...parsed.warnings,
      ],
    };
    await this.writeWechatContactSyncDiagnostics({
      ok: true,
      fallback: 'vision',
      modelId,
      contacts: names,
      diagnostics: mergedDiagnostics,
      capturedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      source: 'windows-wechat-vision',
      contacts: names,
      count: names.length,
      screenshotPath,
      diagnostics: mergedDiagnostics,
    };
  } catch (visionError) {
    await this.writeWechatContactSyncDiagnostics({
      ok: false,
      fallback: 'vision',
      error:
        visionError instanceof Error
          ? visionError.message
          : String(visionError || 'vision fallback failed'),
      diagnostics,
      capturedAt: new Date().toISOString(),
    });
    return null;
  }
}

export function parseWechatVisionContactsOutput(
  this: WechatContactsHost,
  output: string,
): {
  contacts: string[];
  warnings: string[];
} {
  const text = String(output || '').trim();
  const jsonText =
    text.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim() ||
    text.match(/```\s*([\s\S]*?)```/)?.[1]?.trim() ||
    text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const parsed = JSON.parse(jsonText || text) as Record<string, unknown>;
    return {
      contacts: normalizeStringArray(parsed.contacts),
      warnings: normalizeStringArray(parsed.warnings),
    };
  } catch {
    return {
      contacts: normalizeStringArray(
        text
          .split(/\r?\n|[,，、]/)
          .map((item) => item.replace(/^[-*\d.、\s]+/, '').trim()),
      ),
      warnings: ['视觉模型没有返回标准 JSON，已按文本行兜底解析。'],
    };
  }
}

export function humanizeWechatContactSyncErrorMessage(
  this: WechatContactsHost,
  error: unknown,
  runtimePlatform?: ReturnType<typeof platform>,
) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : this.stringifyWechatDiagnosticMessage(error);
  let message = rawMessage
    .replace(/\s+/g, ' ')
    .replace(/\/Users\/[^\s]+/g, '本机文件')
    .replace(/[A-Z]:\\[^\s]+/gi, '本机文件')
    .trim();
  if (!message) {
    message =
      runtimePlatform === 'win32'
        ? '请确认微信桌面版已登录并打开主窗口。'
        : '请确认微信已登录，并授权屏幕录制、辅助功能。';
  }
  if (/failed to fetch|fetch failed|networkerror/i.test(message)) {
    message =
      '本机微信通讯录同步服务暂时不可用，请确认本地运行时已启动并允许后端访问。';
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(message)) {
    message =
      '本机微信通讯录同步服务连接不上，请确认桌面运行时已启动后再重试。';
  }
  if (/spawn powershell\.exe ENOENT/i.test(message)) {
    message = '没有找到 Windows PowerShell，无法启动微信通讯录同步控制器。';
  }
  if (
    runtimePlatform === 'darwin' &&
    (/osascript.*不允许辅助访问|not allowed assistive access|not authorized to send Apple events|-25211/i.test(
      message,
    ) ||
      (message.includes('System Events') && message.includes('osascript')))
  ) {
    message =
      '本机没有授权桌面控制权限，系统已保留现有联系人名单，没有覆盖本地数据。';
  }
  message = this.cleanWechatContactSyncUserMessage(message, runtimePlatform);
  if (message.length > 600) {
    message = `${message.slice(0, 600)}...`;
  }
  return message;
}

export function wechatContactSyncLastFailureMessage(
  this: WechatContactsHost,
  lastFailure: Record<string, unknown>,
  diagnostics: WechatContactsSyncDiagnostics | undefined,
  runtimePlatform: ReturnType<typeof platform>,
) {
  const directMessage =
    this.optionalDiagnosticText(lastFailure.error) ||
    this.optionalDiagnosticText(lastFailure.reason) ||
    this.optionalDiagnosticText(lastFailure.message) ||
    this.optionalDiagnosticText(lastFailure.fallbackReason) ||
    this.optionalDiagnosticText(lastFailure.syncFallbackReason) ||
    this.optionalDiagnosticText(diagnostics?.failureReason) ||
    this.optionalDiagnosticText(diagnostics?.fallbackReason);
  if (directMessage) {
    return this.humanizeWechatContactSyncErrorMessage(
      directMessage,
      runtimePlatform,
    );
  }
  const formatted = this.formatWechatContactsDiagnosticsForError(
    diagnostics || lastFailure,
  );
  if (formatted) {
    return this.humanizeWechatContactSyncErrorMessage(
      formatted,
      runtimePlatform,
    );
  }
  return '';
}

export function stringifyWechatDiagnosticMessage(
  this: WechatContactsHost,
  value: unknown,
) {
  if (Array.isArray(value)) {
    return value.join(',');
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value === null || value === undefined) {
    return '';
  }
  const record = value as Record<string, unknown>;
  const direct =
    this.optionalDiagnosticText(record.message) ||
    this.optionalDiagnosticText(record.error) ||
    this.optionalDiagnosticText(record.reason) ||
    this.optionalDiagnosticText(record.failureReason) ||
    this.optionalDiagnosticText(record.fallbackReason);
  if (direct) return direct;
  const diagnostics = this.normalizeWechatContactsSyncDiagnostics(value);
  const formatted = this.formatWechatContactsDiagnosticsForError(diagnostics);
  return formatted || '';
}

export function optionalDiagnosticText(
  this: WechatContactsHost,
  value: unknown,
) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const text = String(value).trim();
  return text && text !== '[object Object]' ? text : undefined;
}

export function cleanWechatContactSyncUserMessage(
  this: WechatContactsHost,
  value: string,
  runtimePlatform?: ReturnType<typeof platform>,
) {
  const message = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const isWindows =
    runtimePlatform === 'win32' || /Windows|win32/i.test(message);
  const technicalBlocked =
    /native-db-helper-blocked|DB\/helper|db-helper|helper 主链路|数据库\/helper|UIA\/OCR screen collection was skipped|已跳过 UIA\/OCR|skipped-db-helper-required|failed-contract|failed-exit|helper exit|file is not a database|encrypted-or-locked|memory-key-missing|current-account-db-key-missing|wx_key\.dll|Dbkey|decrypt/i.test(
      message,
    );
  if (isWindows && technicalBlocked) {
    if (
      /windowStatus["']?\s*[:=]\s*["']?not-found|微信进程存在，但当前执行器拿不到可控窗口|not-found.*WeChat|window-not-found|not-logged-in/i.test(
        message,
      )
    ) {
      return '本机没有拿到可控的微信窗口，通讯录暂时没同步成功。请在当前登录的桌面会话打开微信并进入通讯录页，再重新同步。';
    }
    if (
      /encrypted-or-locked|memory-key-missing|current-account-db-key-missing|key-missing|file is not a database|wx_key\.dll|Dbkey|decrypt/i.test(
        message,
      )
    ) {
      return '本机没有读到当前微信账号的可用联系人。请确认电脑微信已登录当前账号并保持在线，必要时重启微信后重新同步。';
    }
    return '微信通讯录暂时没同步成功。请确认电脑微信已登录并保持在线，然后重新同步。';
  }
  return message
    .replace(/Windows 微信联系人(?:全量)?同步失败[:：]\s*/g, '')
    .replace(
      /数据库\/helper 主链路没有拿到联系人[，, ]*已跳过 UIA\/OCR 屏幕采集。?/gi,
      '本机没有读到可用联系人。',
    )
    .replace(
      /DB\/helper did not return contacts; UIA\/OCR screen collection is disabled by default/gi,
      '本机没有读到可用联系人。',
    )
    .replace(
      /UIA\/OCR screen collection was skipped; WeChat contacts must come from the database\/helper chain\.?/gi,
      '已使用安全读取策略。',
    );
}

export function shouldBlockWechatContactCacheFallback(
  this: WechatContactsHost,
  diagnostics: WechatContactsSyncDiagnostics | undefined,
) {
  if (!diagnostics) return false;
  const signal = [
    diagnostics.currentAccountDbBlocked ? 'current-account-db-blocked' : '',
    ...(diagnostics.blockedReasons || []),
    ...(diagnostics.dbErrors || []).map((item) =>
      [item.status, item.reason].filter(Boolean).join(' '),
    ),
  ]
    .filter(Boolean)
    .join(' ');
  return /current-account-db-(?:blocked|unreadable)|current-account-db-unreadable/i.test(
    signal,
  );
}

export function toWechatContactsSyncException(
  this: WechatContactsHost,
  error: unknown,
  runtimePlatform: ReturnType<typeof platform>,
) {
  const message = this.humanizeWechatContactSyncErrorMessage(
    error,
    runtimePlatform,
  );
  const prefix =
    runtimePlatform === 'win32'
      ? 'Windows 微信通讯录同步失败'
      : '微信通讯录同步失败';
  return new BadRequestException(`${prefix}：${message}`);
}

export function runWechatContactSyncScript(
  this: WechatContactsHost,
  scriptPath: string,
  mode: WechatContactsSyncMode = 'random',
): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const pythonCommand =
      process.env.AI_CONTENT_PYTHON_PATH?.trim() ||
      process.env.PYTHON?.trim() ||
      'python3';
    const child = spawn(pythonCommand, [scriptPath, '--mode', mode], {
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
      reject(new Error('微信联系人同步执行超时'));
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
      if (!output) {
        reject(new Error('微信联系人同步没有返回结果'));
        return;
      }
      try {
        const parsed = JSON.parse(output) as Record<string, unknown>;
        if (parsed.ok === false) {
          const parsedError = new Error(
            typeof parsed.error === 'string'
              ? parsed.error
              : '微信联系人同步失败',
          );
          (
            parsedError as Error & {
              diagnostics?: unknown;
              parsed?: unknown;
            }
          ).diagnostics = parsed.diagnostics;
          (
            parsedError as Error & {
              diagnostics?: unknown;
              parsed?: unknown;
            }
          ).parsed = parsed;
          reject(parsedError);
          return;
        }
        if (code !== 0) {
          reject(
            new Error(
              (stderr || stdout || `微信联系人同步退出码 ${code}`).trim(),
            ),
          );
          return;
        }
        resolvePromise(parsed);
      } catch (error) {
        if (code !== 0) {
          reject(
            new Error(
              (stderr || stdout || `微信联系人同步退出码 ${code}`).trim(),
            ),
          );
          return;
        }
        reject(
          new Error(
            `微信联系人同步返回结果不可解析：${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  });
}

export async function runWechatWindowsContactSyncScript(
  this: WechatContactsHost,
  mode: WechatContactsSyncMode = 'random',
): Promise<Record<string, unknown>> {
  const sqliteCliPath = this.resolveWechatSqliteCliPath();
  const wechatDbHelperPath = this.resolveWechatDbHelperPath();
  const fallbackDiagnostics: WechatContactsSyncDiagnostics[] = [];
  const nativeRuntimeAttempt = await this.tryRunWechatNativeContactSync(
    mode,
    sqliteCliPath,
    wechatDbHelperPath,
  );
  if (nativeRuntimeAttempt.result) {
    return nativeRuntimeAttempt.result;
  }
  if (nativeRuntimeAttempt.diagnostics) {
    fallbackDiagnostics.push(nativeRuntimeAttempt.diagnostics);
  }

  const engineAttempt = await this.tryRunWechatEngineContactSync(
    mode,
    sqliteCliPath,
  );
  if (engineAttempt.result) {
    return this.withWechatContactFallbackDiagnostics(
      engineAttempt.result,
      fallbackDiagnostics,
    );
  }
  if (engineAttempt.diagnostics) {
    fallbackDiagnostics.push(engineAttempt.diagnostics);
  }

  const scriptPath = join(
    tmpdir(),
    `ai-content-wechat-contact-sync-${Date.now()}.ps1`,
  );
  await writeFile(
    scriptPath,
    `\uFEFF${this.getWechatWindowsContactSyncScript()}`,
    'utf8',
  );

  const powershellResult = await new Promise<Record<string, unknown>>(
    (resolvePromise, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        {
          env: {
            ...process.env,
            AI_CONTENT_WECHAT_CONTACT_SYNC_MODE: mode,
            ...(wechatDbHelperPath
              ? { AI_CONTENT_WECHAT_DB_HELPER: wechatDbHelperPath }
              : {}),
            ...(sqliteCliPath ? { AI_CONTENT_SQLITE_EXE: sqliteCliPath } : {}),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      const timeoutMs =
        mode === 'all'
          ? WECHAT_CONTACT_ALL_SYNC_TIMEOUT_MS
          : WECHAT_CONTACT_RANDOM_SYNC_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new Error(
            mode === 'all'
              ? 'Windows 微信联系人全量同步执行超时'
              : 'Windows 微信联系人同步执行超时',
          ),
        );
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        void rm(scriptPath, { force: true });
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        void rm(scriptPath, { force: true });
        const output = findLastJsonLine(stdout);
        if (!output) {
          const detail = compactWechatContactSyncOutput(
            stderr || stdout || `退出码 ${code ?? 'unknown'}，没有输出`,
          );
          const diagnostics = {
            ok: false,
            code,
            mode,
            error: '微信通讯录暂时没同步成功',
            stderrTail: stderr.slice(-4000),
            stdoutTail: stdout.slice(-4000),
            outputTail: compactWechatContactSyncOutput(stderr || stdout, 4000),
            capturedAt: new Date().toISOString(),
          };
          const mergedDiagnostics = this.mergeWechatContactsSyncDiagnostics(
            ...fallbackDiagnostics,
            {
              stage: 'powershell-no-output',
              source: 'windows-wechat-powershell',
              fallbackReason: diagnostics.error,
            },
          );
          void this.writeWechatContactSyncDiagnostics({
            ...diagnostics,
            diagnostics: mergedDiagnostics,
          });
          const noOutputError = new Error(
            detail
              ? `微信通讯录暂时没同步成功：${detail}`
              : '微信通讯录暂时没同步成功',
          );
          (noOutputError as Error & { diagnostics?: unknown }).diagnostics =
            mergedDiagnostics;
          reject(noOutputError);
          return;
        }
        try {
          const parsed = JSON.parse(output) as Record<string, unknown>;
          if (parsed.ok === false) {
            const parsedErrorMessage =
              typeof parsed.error === 'string'
                ? this.humanizeWechatContactSyncErrorMessage(
                    parsed.error,
                    'win32',
                  )
                : '微信通讯录暂时没同步成功';
            const mergedDiagnostics = this.mergeWechatContactsSyncDiagnostics(
              ...fallbackDiagnostics,
              parsed.diagnostics,
              {
                stage: 'powershell-failed',
                source: 'windows-wechat-powershell',
                fallbackReason: parsedErrorMessage,
              },
            );
            void this.writeWechatContactSyncDiagnostics({
              ok: false,
              code,
              mode,
              parsed: { ...parsed, error: parsedErrorMessage },
              diagnostics: mergedDiagnostics,
              stderrTail: stderr.slice(-4000),
              stdoutTail: stdout.slice(-4000),
              capturedAt: new Date().toISOString(),
            });
            const diagnosticText =
              this.formatWechatContactsDiagnosticsForError(mergedDiagnostics);
            const parsedError = new Error(
              [parsedErrorMessage, diagnosticText].filter(Boolean).join('；'),
            );
            (
              parsedError as Error & {
                diagnostics?: unknown;
                parsed?: unknown;
              }
            ).diagnostics = mergedDiagnostics;
            (
              parsedError as Error & {
                diagnostics?: unknown;
                parsed?: unknown;
              }
            ).parsed = parsed;
            reject(parsedError);
            return;
          }
          if (code !== 0) {
            const detail = compactWechatContactSyncOutput(
              stderr || stdout || `Windows 微信联系人同步退出码 ${code}`,
            );
            reject(new Error(detail || `Windows 微信联系人同步退出码 ${code}`));
            return;
          }
          resolvePromise(parsed);
        } catch (error) {
          if (code !== 0) {
            const detail = compactWechatContactSyncOutput(
              stderr || stdout || `Windows 微信联系人同步退出码 ${code}`,
            );
            reject(new Error(detail || `Windows 微信联系人同步退出码 ${code}`));
            return;
          }
          const rawOutput = compactWechatContactSyncOutput(
            stdout || stderr,
            800,
          );
          reject(
            new Error(
              `Windows 微信联系人同步返回结果不可解析：${error instanceof Error ? error.message : String(error)}；原始输出：${rawOutput}`,
            ),
          );
          void this.writeWechatContactSyncDiagnostics({
            ok: false,
            code,
            mode,
            error:
              error instanceof Error
                ? error.message
                : String(error || 'JSON parse error'),
            stderrTail: stderr.slice(-4000),
            stdoutTail: stdout.slice(-4000),
            capturedAt: new Date().toISOString(),
          });
        }
      });
    },
  );
  return this.withWechatContactFallbackDiagnostics(
    powershellResult,
    fallbackDiagnostics,
  );
}

export function resolveWechatEnginePath(this: WechatContactsHost) {
  return resolveFirstExistingLocalPath([
    process.env.AI_CONTENT_WECHAT_ENGINE,
    join(process.cwd(), 'wechat-engine', 'kaypal-wechat-engine.exe'),
    join(process.cwd(), 'wechat-engine', 'kaypal-wechat-engine.js'),
    join(process.cwd(), 'kaypal-wechat-engine.exe'),
    join(process.cwd(), 'kaypal-wechat-engine.js'),
    join(
      getProjectRoot(),
      'desktop',
      'runtime',
      'wechat-engine',
      'kaypal-wechat-engine.exe',
    ),
    join(
      getProjectRoot(),
      'desktop',
      'runtime',
      'wechat-engine',
      'kaypal-wechat-engine.js',
    ),
  ]);
}

export function getWechatContactSyncResultCount(
  this: WechatContactsHost,
  result: Record<string, unknown>,
) {
  const declaredCount = Number(result.count);
  const itemCount = Array.isArray(result.items) ? result.items.length : 0;
  const contactCount = Array.isArray(result.contacts)
    ? result.contacts.length
    : 0;
  return Math.max(
    Number.isFinite(declaredCount) ? declaredCount : 0,
    itemCount,
    contactCount,
  );
}

export function getWechatContactSyncLowConfidenceReason(
  this: WechatContactsHost,
  result: Record<string, unknown>,
  mode: WechatContactsSyncMode,
) {
  const count = this.getWechatContactSyncResultCount(result);
  const diagnostics = this.normalizeWechatContactsSyncDiagnostics(
    result.diagnostics,
  );
  const source =
    typeof result.source === 'string'
      ? result.source
      : diagnostics?.source || '';
  const stage = diagnostics?.stage || '';
  const engine = diagnostics?.engine || '';
  const uiaStatus = diagnostics?.uiaStatus || '';
  const uiaStopReason = diagnostics?.uiaStopReason || '';
  const failureReason = diagnostics?.failureReason || '';
  const fallbackReason = diagnostics?.fallbackReason || '';
  const dbKeyStatus = diagnostics?.dbKeyStatus || '';
  const dbStatus = diagnostics?.dbStatus || '';
  const dbError = diagnostics?.dbError || '';
  const helperStatus = diagnostics?.helperStatus || '';
  const helperError = diagnostics?.helperError || '';
  const keyHelperStatus = diagnostics?.keyHelperStatus || '';
  const decryptionStatus = diagnostics?.decryptionStatus || '';
  const resultSource = diagnostics?.resultSource || '';
  const pagesScanned = Number(diagnostics?.pagesScanned) || 0;
  const uiaContactCount = Number(diagnostics?.uiaContactCount);
  const signal = [
    source,
    stage,
    engine,
    uiaStatus,
    uiaStopReason,
    failureReason,
    fallbackReason,
    ...(diagnostics?.warnings || []),
  ]
    .filter(Boolean)
    .join(' ');
  const looksLikeWindowsCollector =
    /windows|uia|powershell|wechat-engine|native-runtime|kaypal-wechat-engine/i.test(
      signal,
    );
  const isDatabaseResult =
    /native-db|engine-db|wechat-db|db-completed|database/i.test(
      `${source} ${stage}`,
    );
  const accountSignal =
    optionalTrimmedText(result.currentWechatId) ||
    optionalTrimmedText(result.current_wechat_id) ||
    optionalTrimmedText(diagnostics?.selectedDbAccountFolder) ||
    optionalTrimmedText(diagnostics?.selectedDbBaseWxid);
  const isMacosOcrResult = /macos-wechat-ocr/i.test(
    `${source} ${stage} ${resultSource}`,
  );
  if (isMacosOcrResult && count > 0 && !accountSignal) {
    return 'macOS OCR 通讯录结果没有微信账号标识，已拒绝写入，避免同步后页面又被账号守卫清空';
  }
  if (
    looksLikeWindowsCollector &&
    isDatabaseResult &&
    count > 0 &&
    !accountSignal
  ) {
    return '数据库通讯录结果没有微信账号标识，已拒绝写入，避免新账号继续显示旧账号名单';
  }
  const dbPrimaryState = [
    dbKeyStatus,
    dbStatus,
    dbError,
    helperStatus,
    helperError,
    keyHelperStatus,
    decryptionStatus,
    resultSource,
    JSON.stringify(diagnostics?.layers || {}),
  ]
    .filter(Boolean)
    .join(' ');
  const dbPrimaryBlocked =
    !isDatabaseResult &&
    /encrypted-or-locked|locked-or-permission-denied|decryptor-missing|memory-key-missing|helper.*(missing|failed|blocked)|db helper|database is locked|file is not a database|contact database not found|contacts-blocked/i.test(
      dbPrimaryState,
    );
  const dbPrimaryAttempted =
    !isDatabaseResult &&
    /db|sqlite|helper|decrypt|contact\.db|MicroMsg\.db|windows-db/i.test(
      dbPrimaryState,
    );
  const hasUiaEvidence =
    !isDatabaseResult &&
    (/uia|控制器|powershell|not-wechat-contacts-page|no-scrollable-container/i.test(
      signal,
    ) ||
      diagnostics?.uiaContactCount !== undefined);
  const hasBrokenUiaSignal =
    !isDatabaseResult &&
    /not-wechat-contacts-page|no-scrollable-container|scroll-no-progress|duplicate-page|window-not-found|不是微信通讯录|没有识别到微信窗口特征|UIA did not look/i.test(
      signal,
    );

  if (!looksLikeWindowsCollector) {
    return '';
  }
  if (hasBrokenUiaSignal && count <= 1) {
    return `采集器明确没有停在微信通讯录页，只识别到 ${count} 个联系人`;
  }
  if (mode === 'all') {
    if (hasUiaEvidence && count <= 1) {
      return `全量同步只识别到 ${count} 个联系人，低于可信阈值`;
    }
    if (hasUiaEvidence && count < 5 && pagesScanned >= 2) {
      return `全量同步扫描 ${pagesScanned} 页但只识别到 ${count} 个联系人`;
    }
    if (
      Number.isFinite(uiaContactCount) &&
      uiaContactCount > 0 &&
      uiaContactCount < 5 &&
      pagesScanned >= 2
    ) {
      return `全量 UIA 扫描 ${pagesScanned} 页但只产出 ${uiaContactCount} 个候选`;
    }
    if (
      count < 10 &&
      dbKeyStatus === 'encrypted-or-locked' &&
      helperStatus !== 'completed'
    ) {
      return '微信数据库加密或被占用，解密 helper 未完成，UIA 结果过少';
    }
  } else if (
    (dbPrimaryBlocked || dbPrimaryAttempted) &&
    hasUiaEvidence &&
    count <= 0
  ) {
    return '微信通讯录窗口同步没有识别到可用联系人';
  }
  return '';
}

export function withWechatContactFallbackDiagnostics(
  this: WechatContactsHost,
  result: Record<string, unknown>,
  fallbackDiagnostics: WechatContactsSyncDiagnostics[],
) {
  const source = typeof result.source === 'string' ? result.source : undefined;
  const diagnostics = this.mergeWechatContactsSyncDiagnostics(
    ...fallbackDiagnostics,
    result.diagnostics,
    source ? { source } : undefined,
  );
  return diagnostics ? { ...result, diagnostics } : result;
}

export async function tryRunWechatNativeContactSync(
  this: WechatContactsHost,
  mode: WechatContactsSyncMode,
  sqliteCliPath: string,
  decryptionHelperPath: string,
): Promise<WechatContactSyncAttempt> {
  const nativeRuntimePath = resolveWechatNativeRuntimePath();
  if (!nativeRuntimePath) {
    return { result: null };
  }
  const baseDiagnostics = this.normalizeWechatContactsSyncDiagnostics({
    source: 'kaypal-wechat-native-runtime',
    engine: 'kaypal-wechat-native-runtime',
    nativeRuntimePath,
    decryptionHelperPath,
    sqlitePath: sqliteCliPath,
    attemptedSources: ['native-runtime'],
  });
  try {
    const result = await this.runWechatEngineContactSyncScript(
      nativeRuntimePath,
      mode,
      sqliteCliPath,
      'kaypal-wechat-native-runtime',
    );
    const count = this.getWechatContactSyncResultCount(result);
    const diagnostics = this.mergeWechatContactsSyncDiagnostics(
      baseDiagnostics,
      result.diagnostics,
      typeof result.source === 'string' ? { source: result.source } : undefined,
    );
    const lowConfidenceReason = this.getWechatContactSyncLowConfidenceReason(
      diagnostics ? { ...result, diagnostics } : result,
      mode,
    );
    if (count > 0 && !lowConfidenceReason) {
      return {
        result: diagnostics ? { ...result, diagnostics } : result,
        diagnostics,
      };
    }
    const fallbackDiagnostics = this.mergeWechatContactsSyncDiagnostics(
      diagnostics,
      {
        fallbackReason:
          lowConfidenceReason ||
          'Native runtime 没有读到联系人，已自动回退到 legacy wechat-engine。',
        failureReason: lowConfidenceReason || undefined,
      },
    );
    await this.writeWechatContactSyncDiagnostics({
      ok: false,
      mode,
      fallback: 'wechat-engine',
      reason:
        lowConfidenceReason ||
        'Native runtime 没有读到联系人，已自动回退到 legacy wechat-engine。',
      parsed: result,
      diagnostics: fallbackDiagnostics,
      capturedAt: new Date().toISOString(),
    });
    return { result: null, diagnostics: fallbackDiagnostics };
  } catch (error) {
    const message = this.humanizeWechatContactSyncErrorMessage(error, 'win32');
    const diagnostics = this.mergeWechatContactsSyncDiagnostics(
      baseDiagnostics,
      (error as { diagnostics?: unknown })?.diagnostics,
      {
        fallbackReason: message,
        failureReason: message,
      },
    );
    await this.writeWechatContactSyncDiagnostics({
      ok: false,
      mode,
      fallback: 'wechat-engine',
      nativeRuntimePath,
      error: message,
      diagnostics,
      capturedAt: new Date().toISOString(),
    });
    return { result: null, diagnostics };
  }
}

export async function tryRunWechatEngineContactSync(
  this: WechatContactsHost,
  mode: WechatContactsSyncMode,
  sqliteCliPath: string,
): Promise<WechatContactSyncAttempt> {
  const enginePath = this.resolveWechatEnginePath();
  if (!enginePath) {
    return { result: null };
  }
  const baseDiagnostics = this.normalizeWechatContactsSyncDiagnostics({
    source: 'kaypal-wechat-engine',
    engine: 'kaypal-wechat-engine',
    enginePath,
    sqlitePath: sqliteCliPath,
    attemptedSources: ['wechat-engine'],
  });
  try {
    const result = await this.runWechatEngineContactSyncScript(
      enginePath,
      mode,
      sqliteCliPath,
    );
    const count = this.getWechatContactSyncResultCount(result);
    const diagnostics = this.mergeWechatContactsSyncDiagnostics(
      baseDiagnostics,
      result.diagnostics,
      typeof result.source === 'string' ? { source: result.source } : undefined,
    );
    const lowConfidenceReason = this.getWechatContactSyncLowConfidenceReason(
      diagnostics ? { ...result, diagnostics } : result,
      mode,
    );
    if (count > 0 && !lowConfidenceReason) {
      return {
        result: diagnostics ? { ...result, diagnostics } : result,
        diagnostics,
      };
    }
    const fallbackDiagnostics = this.mergeWechatContactsSyncDiagnostics(
      diagnostics,
      {
        fallbackReason:
          lowConfidenceReason ||
          'Legacy wechat-engine 没有读到联系人，已自动回退到 PowerShell/OCR 采集。',
        failureReason: lowConfidenceReason || undefined,
      },
    );
    await this.writeWechatContactSyncDiagnostics({
      ok: false,
      mode,
      fallback: 'powershell-legacy',
      reason:
        lowConfidenceReason ||
        'Legacy wechat-engine 没有读到联系人，已自动回退到 PowerShell/OCR 采集。',
      parsed: result,
      diagnostics: fallbackDiagnostics,
      capturedAt: new Date().toISOString(),
    });
    return { result: null, diagnostics: fallbackDiagnostics };
  } catch (error) {
    const message = this.humanizeWechatContactSyncErrorMessage(error, 'win32');
    const diagnostics = this.mergeWechatContactsSyncDiagnostics(
      baseDiagnostics,
      (error as { diagnostics?: unknown })?.diagnostics,
      {
        fallbackReason: message,
        failureReason: message,
      },
    );
    await this.writeWechatContactSyncDiagnostics({
      ok: false,
      mode,
      fallback: 'powershell-legacy',
      enginePath,
      error: message,
      diagnostics,
      capturedAt: new Date().toISOString(),
    });
    return { result: null, diagnostics };
  }
}

export function probeWechatNativeContactRuntime(
  this: WechatContactsHost,
  nativeRuntimePath: string,
): Promise<WechatContactsSyncDiagnostics | undefined> {
  const isNodeScript = extname(nativeRuntimePath).toLowerCase() === '.js';
  const command = isNodeScript ? process.execPath : nativeRuntimePath;
  const args = isNodeScript ? [nativeRuntimePath, 'diagnose'] : ['diagnose'];

  return new Promise((resolveProbe) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        AI_CONTENT_WECHAT_NATIVE_RUNTIME: nativeRuntimePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (value?: WechatContactsSyncDiagnostics) => {
      if (settled) return;
      settled = true;
      resolveProbe(value);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      settle(
        this.normalizeWechatContactsSyncDiagnostics({
          stage: 'native-diagnose-timeout',
          source: 'kaypal-wechat-native-runtime',
          nativeRuntimePath,
          fallbackReason: 'Native runtime 诊断超时。',
        }),
      );
    }, 15000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      settle(
        this.normalizeWechatContactsSyncDiagnostics({
          stage: 'native-diagnose-spawn-error',
          source: 'kaypal-wechat-native-runtime',
          nativeRuntimePath,
          fallbackReason: error.message,
        }),
      );
    });
    child.on('close', () => {
      clearTimeout(timeout);
      const jsonLine = findLastJsonLine(stdout);
      if (!jsonLine) {
        settle(
          this.normalizeWechatContactsSyncDiagnostics({
            stage: 'native-diagnose-no-output',
            source: 'kaypal-wechat-native-runtime',
            nativeRuntimePath,
            fallbackReason: compactWechatContactSyncOutput(
              stderr || stdout || 'Native runtime 诊断没有输出。',
            ),
          }),
        );
        return;
      }
      try {
        const parsed = JSON.parse(jsonLine) as Record<string, unknown>;
        settle(
          this.normalizeWechatContactsSyncDiagnostics(parsed.diagnostics, {
            stage:
              typeof parsed.stage === 'string'
                ? parsed.stage
                : 'native-diagnose',
            source: 'kaypal-wechat-native-runtime',
            nativeRuntimePath,
          }),
        );
      } catch (error) {
        settle(
          this.normalizeWechatContactsSyncDiagnostics({
            stage: 'native-diagnose-parse-error',
            source: 'kaypal-wechat-native-runtime',
            nativeRuntimePath,
            fallbackReason:
              error instanceof Error ? error.message : String(error),
          }),
        );
      }
    });
  });
}

export function runWechatEngineContactSyncScript(
  this: WechatContactsHost,
  enginePath: string,
  mode: WechatContactsSyncMode,
  sqliteCliPath: string,
  runtimeName = 'kaypal-wechat-engine',
): Promise<Record<string, unknown>> {
  const isNodeScript = extname(enginePath).toLowerCase() === '.js';
  const command = isNodeScript ? process.execPath : enginePath;
  const args = isNodeScript
    ? [enginePath, 'contacts', '--mode', mode]
    : ['contacts', '--mode', mode];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        AI_CONTENT_WECHAT_CONTACT_SYNC_MODE: mode,
        AI_CONTENT_WECHAT_ENGINE: enginePath,
        ...(runtimeName === 'kaypal-wechat-native-runtime'
          ? { AI_CONTENT_WECHAT_NATIVE_RUNTIME: enginePath }
          : process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME
            ? {
                AI_CONTENT_WECHAT_NATIVE_RUNTIME:
                  process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME,
              }
            : {}),
        ...(sqliteCliPath ? { AI_CONTENT_SQLITE_EXE: sqliteCliPath } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const timeoutMs =
      mode === 'all'
        ? WECHAT_CONTACT_ALL_SYNC_TIMEOUT_MS
        : WECHAT_CONTACT_RANDOM_SYNC_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      const timeoutError = new Error(
        mode === 'all'
          ? 'Windows 微信联系人引擎全量同步执行超时'
          : 'Windows 微信联系人引擎同步执行超时',
      ) as Error & { diagnostics?: unknown };
      timeoutError.diagnostics = {
        stage: 'engine-timeout',
        source: runtimeName,
        enginePath,
        fallbackReason: timeoutError.message,
      };
      settleReject(timeoutError);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      const engineError = new Error(
        `Windows 微信联系人引擎启动失败：${error.message}`,
      ) as Error & { diagnostics?: unknown };
      engineError.diagnostics = {
        stage: 'engine-spawn-error',
        source: runtimeName,
        enginePath,
        fallbackReason: error.message,
      };
      settleReject(engineError);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      const output = findLastJsonLine(stdout);
      if (!output) {
        const detail = compactWechatContactSyncOutput(
          stderr || stdout || `退出码 ${code ?? 'unknown'}，没有输出`,
        );
        const error = new Error(
          detail
            ? `Windows 微信联系人引擎没有返回结果：${detail}`
            : 'Windows 微信联系人引擎没有返回结果',
        ) as Error & { diagnostics?: unknown };
        error.diagnostics = {
          stage: 'engine-no-output',
          source: runtimeName,
          enginePath,
          fallbackReason: error.message,
          stderrTail: stderr.slice(-2000),
          stdoutTail: stdout.slice(-2000),
        };
        settleReject(error);
        return;
      }
      try {
        const parsed = JSON.parse(output) as Record<string, unknown>;
        if (parsed.ok === false || code !== 0) {
          const parsedErrorText =
            typeof parsed.error === 'string'
              ? parsed.error
              : `Windows 微信联系人引擎退出码 ${code ?? 'unknown'}`;
          const error = new Error(parsedErrorText) as Error & {
            diagnostics?: unknown;
            parsed?: unknown;
          };
          error.diagnostics = this.normalizeWechatContactsSyncDiagnostics(
            parsed.diagnostics,
            {
              stage: 'engine-failed',
              source: runtimeName,
              enginePath,
              fallbackReason: parsedErrorText,
            },
          );
          error.parsed = parsed;
          settleReject(error);
          return;
        }
        settled = true;
        resolvePromise(parsed);
      } catch (parseError) {
        const rawOutput = compactWechatContactSyncOutput(stdout || stderr, 800);
        const error = new Error(
          `Windows 微信联系人引擎返回结果不可解析：${parseError instanceof Error ? parseError.message : String(parseError)}；原始输出：${rawOutput}`,
        ) as Error & { diagnostics?: unknown };
        error.diagnostics = {
          stage: 'engine-parse-error',
          source: runtimeName,
          enginePath,
          fallbackReason: error.message,
        };
        settleReject(error);
      }
    });
  });
}

export function resolveWechatDbHelperPath(this: WechatContactsHost) {
  return resolveFirstExistingLocalPath([
    process.env.AI_CONTENT_WECHAT_DB_HELPER,
    join(process.cwd(), 'wechat-db-helper.exe'),
    join(process.cwd(), 'wechat-db-helper.js'),
    join(process.cwd(), 'bin', 'wechat-db-helper.exe'),
    join(process.cwd(), 'bin', 'wechat-db-helper.js'),
    join(process.cwd(), 'tools', 'wechat-db-helper.exe'),
    join(process.cwd(), 'tools', 'wechat-db-helper.js'),
    join(
      getProjectRoot(),
      'vendor',
      'wechat-db-helper',
      'wechat-db-helper.exe',
    ),
    join(getProjectRoot(), 'vendor', 'wechat-db-helper', 'wechat-db-helper.js'),
    join(getProjectRoot(), 'vendor', 'wechat-db-helper', 'wechat-dump-rs.exe'),
    join(
      getProjectRoot(),
      'vendor',
      'skillhub',
      'wechat-contact-sync',
      'bin',
      'wechat-db-helper.exe',
    ),
    join(
      getProjectRoot(),
      'vendor',
      'skillhub',
      'wechat-contact-sync',
      'bin',
      'wechat-db-helper.js',
    ),
    join(
      getProjectRoot(),
      'vendor',
      'skillhub',
      'wechat-contact-sync',
      'bin',
      'wechat-dump-rs.exe',
    ),
    join(
      getProjectRoot(),
      'desktop',
      'runtime',
      'wechat-db-helper',
      'wechat-db-helper.exe',
    ),
    join(
      getProjectRoot(),
      'desktop',
      'runtime',
      'wechat-db-helper',
      'wechat-db-helper.js',
    ),
    join(
      getProjectRoot(),
      'desktop',
      'runtime',
      'wechat-db-helper',
      'wechat-dump-rs.exe',
    ),
  ]);
}

export function resolveWechatSqliteCliPath(this: WechatContactsHost) {
  return resolveFirstExistingLocalPath([
    process.env.AI_CONTENT_SQLITE_EXE,
    process.env.SQLITE_EXE,
    join(process.cwd(), 'sqlite3.exe'),
    join(process.cwd(), 'bin', 'sqlite3.exe'),
    join(process.cwd(), 'tools', 'sqlite3.exe'),
    join(
      getProjectRoot(),
      'desktop',
      'runtime',
      'wechat-db-helper',
      'sqlite3.exe',
    ),
    join(getProjectRoot(), 'desktop', 'runtime', 'sqlite-tools', 'sqlite3.exe'),
    join(getProjectRoot(), 'vendor', 'sqlite-tools', 'sqlite3.exe'),
  ]);
}

export async function writeWechatContactSyncDiagnostics(
  this: WechatContactsHost,
  payload: Record<string, unknown>,
) {
  try {
    const diagnosticsPath = this.getWechatContactsDiagnosticsPath();
    const capturedAt =
      optionalTrimmedText(payload.capturedAt) || new Date().toISOString();
    const failureRecord = this.buildWechatContactFailureRecord(
      payload,
      capturedAt,
    );
    const evidencePackage = this.buildWechatContactDiagnosticEvidencePackage(
      payload,
      failureRecord,
      capturedAt,
    );
    await mkdir(resolve(diagnosticsPath, '..'), { recursive: true });
    await writeFile(
      diagnosticsPath,
      JSON.stringify(
        {
          ...payload,
          capturedAt,
          failureRecord,
          evidencePackage,
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    // Best-effort diagnostic persistence only.
  }
}

export function buildWechatContactFailureRecord(
  this: WechatContactsHost,
  payload: Record<string, unknown>,
  capturedAt: string,
) {
  const parsed = this.normalizeJsonRecord(payload.parsed);
  const diagnostics = this.mergeWechatContactsSyncDiagnostics(
    parsed?.diagnostics,
    payload.diagnostics,
  );
  const diagnosticsRecord = this.normalizeJsonRecord(diagnostics) || {};
  const command =
    optionalTrimmedText(payload.command) ||
    optionalTrimmedText(parsed?.command) ||
    optionalTrimmedText(diagnosticsRecord.command) ||
    'contacts';
  const runner =
    optionalTrimmedText(payload.runner) ||
    optionalTrimmedText(parsed?.runner) ||
    optionalTrimmedText(payload.fallback) ||
    optionalTrimmedText(diagnostics?.engine) ||
    optionalTrimmedText(diagnostics?.source) ||
    'wechat-contact-sync';
  const platformName =
    optionalTrimmedText(payload.platform) ||
    optionalTrimmedText(parsed?.platform) ||
    optionalTrimmedText(diagnosticsRecord.platform) ||
    optionalTrimmedText(diagnostics?.os) ||
    getRuntimePlatform();
  const screenshotPath =
    optionalTrimmedText(payload.screenshotPath) ||
    optionalTrimmedText(parsed?.screenshotPath) ||
    optionalTrimmedText(diagnostics?.screenshotPath) ||
    '';
  const message =
    optionalTrimmedText(payload.error) ||
    optionalTrimmedText(payload.reason) ||
    optionalTrimmedText(parsed?.error) ||
    optionalTrimmedText(parsed?.message) ||
    diagnostics?.failureReason ||
    diagnostics?.fallbackReason ||
    '微信联系人同步失败';
  const nextAction = this.inferWechatContactFailureNextAction(
    payload,
    parsed,
    diagnostics,
    message,
    screenshotPath,
  );
  const rawSummary = this.summarizeWechatContactFailureRaw(
    payload,
    parsed,
    diagnostics,
  );

  return {
    id: `wechat-${command}-${capturedAt.replace(/[^0-9A-Za-z]/g, '')}`,
    command,
    runner,
    platform: platformName,
    screenshotPath,
    rawSummary,
    nextAction,
    message,
    stage: diagnostics?.stage || '',
    errorCode:
      optionalTrimmedText(payload.errorCode) ||
      optionalTrimmedText(parsed?.errorCode) ||
      '',
    mode: optionalTrimmedText(payload.mode) || '',
    capturedAt,
  };
}

export function buildWechatContactDiagnosticEvidencePackage(
  this: WechatContactsHost,
  payload: Record<string, unknown>,
  failureRecord: Record<string, unknown>,
  generatedAt: string,
) {
  const validation =
    this.validateWechatContactDiagnosticEvidencePackage(failureRecord);
  return {
    schemaVersion: '2026-06-29.wechat-diagnostics-evidence-pack.v1',
    generatedAt,
    source: {
      kind: 'local-engine/wechat/contacts/diagnostics',
      diagnosticsPath: this.getWechatContactsDiagnosticsPath(),
    },
    summary: {
      status: validation.ok ? 'ready' : 'incomplete',
      failureCount: 1,
      command: failureRecord.command,
      runner: failureRecord.runner,
      platform: failureRecord.platform,
      screenshotPath: failureRecord.screenshotPath,
      nextAction: failureRecord.nextAction,
    },
    failureRecords: [failureRecord],
    validation,
    raw: {
      ok: payload.ok,
      code: payload.code,
      mode: payload.mode,
      fallback: payload.fallback,
    },
  };
}

export function validateWechatContactDiagnosticEvidencePackage(
  this: WechatContactsHost,
  failureRecord: Record<string, unknown>,
) {
  const requiredFields = [
    'command',
    'runner',
    'platform',
    'rawSummary',
    'nextAction',
  ];
  const errors = requiredFields
    .filter((field) => !optionalTrimmedText(failureRecord[field]))
    .map((field) => `failureRecord.${field} is required`);
  const warnings = optionalTrimmedText(failureRecord.screenshotPath)
    ? []
    : ['failureRecord.screenshotPath is empty; capture a screenshot on retry'];
  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function inferWechatContactFailureNextAction(
  this: WechatContactsHost,
  payload: Record<string, unknown>,
  parsed: Record<string, unknown> | undefined,
  diagnostics: WechatContactsSyncDiagnostics | undefined,
  message: string,
  screenshotPath: string,
) {
  const explicit =
    optionalTrimmedText(payload.nextAction) ||
    optionalTrimmedText(parsed?.nextAction);
  if (explicit) {
    return explicit;
  }
  const text = [
    message,
    diagnostics?.failureReason,
    diagnostics?.fallbackReason,
    diagnostics?.stage,
    diagnostics?.windowStatus,
    diagnostics?.platformStatus,
    diagnostics?.dbStatus,
    diagnostics?.helperStatus,
    diagnostics?.keyHelperStatus,
    diagnostics?.decryptionStatus,
    diagnostics?.externalKeyToolStatus,
    diagnostics?.externalRawKeyToolStatus,
    ...(diagnostics?.blockedReasons || []),
    ...(diagnostics?.decryptAttempts || []).map(
      (item) =>
        optionalTrimmedText(item.reason) || optionalTrimmedText(item.status),
    ),
    ...(diagnostics?.externalDbKeyAttempts || []).map(
      (item) =>
        optionalTrimmedText(item.reason) || optionalTrimmedText(item.status),
    ),
    ...(diagnostics?.externalDumpRsPidAttempts || []).map((item) =>
      optionalTrimmedText(item.status),
    ),
  ]
    .filter(Boolean)
    .join(' ');
  if (/unsupported|not-windows|只能在 Windows|非 Windows/i.test(text)) {
    return '请在 Windows 桌面端运行微信联系人同步，并保留本机诊断包。';
  }
  if (
    /完整好友同步.*Windows|全量同步.*Windows|macOS.*随机抽样读取/i.test(text)
  ) {
    return '当前电脑不能执行完整好友同步；请切换为随机抽样同步，或在已登录微信的 Windows 桌面环境执行完整同步。';
  }
  if (/permission|权限|辅助功能|屏幕录制|access/i.test(text)) {
    return '补齐桌面控制、屏幕录制或 UIA 权限后，重新打开微信通讯录再重试。';
  }
  if (
    /window-not-found|not running|未找到|没有识别到微信窗口|微信窗口/i.test(
      text,
    )
  ) {
    return '打开并登录桌面微信，固定到通讯录窗口后重新执行同步。';
  }
  if (/incompatible-and-unsupported/i.test(text)) {
    return '当前打包的取钥匙链路同时存在架构不匹配和微信版本不支持；需要补齐支持当前 WeChat 版本、同架构的原生 DB key helper。';
  }
  if (/architecture-mismatch|tool-incompatible|架构/i.test(text)) {
    return '当前微信进程和已打包的取钥匙组件架构不匹配；需要补齐同架构的原生 DB key helper 后再验收。';
  }
  if (
    /wechat-version-unsupported|unsupported-wechat|profile-layout|user info|phone type/i.test(
      text,
    )
  ) {
    return '当前打包的 DB key/dump 工具不适配这个微信版本；需要替换为支持当前 WeChat 数据结构的原生 helper。';
  }
  if (/db|sqlite|helper|encrypted|locked|数据库|解密/i.test(text)) {
    return '检查微信数据库 helper、sqlite 路径和微信占用状态；必要时先关闭微信后重试。';
  }
  if (!screenshotPath) {
    return '重新执行同步并保留截图路径，便于确认当前窗口、runner 和原始输出。';
  }
  return '查看 failureRecord.rawSummary、截图和 runner 状态，修复阻断项后重试。';
}

export function summarizeWechatContactFailureRaw(
  this: WechatContactsHost,
  payload: Record<string, unknown>,
  parsed: Record<string, unknown> | undefined,
  diagnostics: WechatContactsSyncDiagnostics | undefined,
) {
  const parts = [
    optionalTrimmedText(payload.rawSummary),
    optionalTrimmedText(payload.outputTail),
    optionalTrimmedText(payload.stderrTail),
    optionalTrimmedText(payload.stdoutTail),
    optionalTrimmedText(payload.error),
    optionalTrimmedText(payload.reason),
    optionalTrimmedText(parsed?.error),
    optionalTrimmedText(parsed?.message),
    diagnostics?.failureReason,
    diagnostics?.fallbackReason,
    diagnostics?.rawPreview?.length
      ? `rawPreview=${diagnostics.rawPreview.slice(0, 5).join(' / ')}`
      : '',
    diagnostics?.ocrPreview?.length
      ? `ocrPreview=${diagnostics.ocrPreview.slice(0, 5).join(' / ')}`
      : '',
  ].filter(Boolean);
  const text =
    parts.join(' | ') ||
    JSON.stringify({
      ok: payload.ok,
      code: payload.code,
      mode: payload.mode,
      fallback: payload.fallback,
    });
  return compactWechatContactSyncOutput(text, 600);
}

export function formatWechatContactsDiagnosticsForError(
  this: WechatContactsHost,
  value: unknown,
) {
  const diagnostics = this.normalizeWechatContactsSyncDiagnostics(value);
  if (!diagnostics) {
    return '';
  }
  const parts = [
    diagnostics.stage ? `阶段 ${diagnostics.stage}` : '',
    diagnostics.engine ? `引擎 ${diagnostics.engine}` : '',
    diagnostics.engineVersion ? `版本 ${diagnostics.engineVersion}` : '',
    diagnostics.failureReason ? `失败原因 ${diagnostics.failureReason}` : '',
    diagnostics.dbContactCount !== undefined
      ? `DB联系人 ${diagnostics.dbContactCount} 个`
      : '',
    diagnostics.dbError ? `DB错误 ${diagnostics.dbError}` : '',
    diagnostics.fallbackReason ? `回退原因 ${diagnostics.fallbackReason}` : '',
    diagnostics.windowTitle ? `窗口 ${diagnostics.windowTitle}` : '',
    diagnostics.rawTextCount !== undefined
      ? `UIA原文 ${diagnostics.rawTextCount} 条`
      : '',
    diagnostics.ocrPreview?.length
      ? `OCR预览 ${diagnostics.ocrPreview.slice(0, 3).join(' / ')}`
      : '',
    diagnostics.screenshotPath ? `截图 ${diagnostics.screenshotPath}` : '',
  ].filter(Boolean);
  return parts.length ? `诊断：${parts.join('，')}` : '';
}

export function getWechatWindowsContactSyncScript(this: WechatContactsHost) {
  return String.raw`
	$ErrorActionPreference = 'Stop'
	try {
	  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
	  $OutputEncoding = [System.Text.Encoding]::UTF8
	} catch {}

	function Emit-Json($payload, [int]$code = 0) {
	  try {
	    $json = $payload | ConvertTo-Json -Depth 8 -Compress
	    [Console]::Out.WriteLine($json)
	  } catch {
	    [Console]::Out.WriteLine('{"ok":false,"error":"Windows 微信通讯录同步输出 JSON 失败","contacts":[]}')
	    $code = 1
	  }
	  exit $code
	}

	$script:KaypalContactSyncDiagnostics = [ordered]@{
	  stage = 'init'
	  attemptedSources = @()
	  warnings = @()
	  rawPreview = @()
	  ocrPreview = @()
	  pagesScanned = 0
	  uiaContactCount = 0
	  ocrContactCount = 0
	  rawTextCount = 0
	  screenshotPath = ''
	  dbContactCount = 0
	  dbPaths = @()
	  dbError = ''
	  selectedDbPath = ''
	  selectedDbAccountFolder = ''
	  selectedDbBaseWxid = ''
	  selectedDbActiveMtime = ''
	  selectedDbScore = 0
	  dbCandidateResults = @()
	}
	$script:KaypalDecryptedDbSourceMap = @{}

	function Set-Diagnostic($key, $value) {
	  $script:KaypalContactSyncDiagnostics[$key] = $value
	}

	function Add-DiagnosticListItem($key, [string]$value, [int]$max = 30) {
	  if ([string]::IsNullOrWhiteSpace($value)) { return }
	  $items = @($script:KaypalContactSyncDiagnostics[$key])
	  $value = ($value -replace '\s+', ' ').Trim()
	  if (-not $items.Contains($value)) {
	    $items += $value
	  }
	  if ($items.Count -gt $max) {
	    $items = $items[0..($max - 1)]
	  }
	  $script:KaypalContactSyncDiagnostics[$key] = @($items)
	}

	function Add-AttemptedSource([string]$source) {
	  Add-DiagnosticListItem 'attemptedSources' $source 20
	}

	function Add-DiagnosticWarning([string]$warning) {
	  Add-DiagnosticListItem 'warnings' $warning 20
	}

	function Update-MaxDiagnosticNumber($key, [int]$value) {
	  $current = 0
	  try { $current = [int]$script:KaypalContactSyncDiagnostics[$key] } catch {}
	  if ($value -gt $current) {
	    $script:KaypalContactSyncDiagnostics[$key] = $value
	  }
	}

	function Get-Diagnostics() {
	  return $script:KaypalContactSyncDiagnostics
	}

	function Fail($message) {
	  Set-Diagnostic 'failureReason' $message
	  Emit-Json @{ ok = $false; error = $message; contacts = @(); diagnostics = (Get-Diagnostics) } 1
	}

	function Normalize-DbContactText([string]$line) {
	  if ([string]::IsNullOrWhiteSpace($line)) { return '' }
	  $value = ($line -replace '\s+', ' ').Trim()
	  $value = [regex]::Replace($value, '\p{C}+', '').Trim()
	  $compact = ($value -replace '\s+', '')
	  if (-not $compact) { return '' }
	  if ($compact -match '^(微信|WeChat|Weixin|通讯录|联系人|新的朋友|朋友|群聊|标签|公众号|服务号|企业微信联系人|搜索|聊天|收藏|文件传输助手|朋友圈|视频号|订阅号|服务通知|小程序|更多|全部|添加朋友|新的联系人|我的企业|星标朋友|公星标朋友)$') { return '' }
	  if ($compact -match '星标朋友|我的企业') { return '' }
	  if ($value -match '微信小店助手|腾讯新闻|东方甄选|订阅号消息|微信团队|服务通知|公众号|服务号|福利小管|时惠叭|甄选|新闻') { return '' }
	  if ($value -match '抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站') { return '' }
	  if ($compact.Length -lt 2 -or $compact.Length -gt 80) { return '' }
	  if ($compact -notmatch '[\u4e00-\u9fffA-Za-z0-9]') { return '' }
	  return $value
	}

	function Test-WeChatSystemContactId([string]$id) {
	  if ([string]::IsNullOrWhiteSpace($id)) { return $true }
	  $value = $id.Trim()
	  $lower = $value.ToLowerInvariant()
	  $systemIds = @(
	    'fmessage', 'qmessage', 'tmessage', 'weixin', 'filehelper', 'newsapp',
	    'qqmail', 'floatbottle', 'lbsapp', 'medianote', 'qqsync', 'weibo',
	    'masssendapp', 'feedsapp', 'voip', 'weixinreminder', 'officialaccounts',
	    'notification_messages', 'notifymessage', 'mphelper', 'weixin'
	  )
	  if ($systemIds -contains $lower) { return $true }
	  if ($lower.EndsWith('@chatroom')) { return $true }
	  if ($lower.StartsWith('gh_')) { return $true }
	  return $false
	}

	function Add-DbContactItem($items, [string]$wxid, [string]$nickname, [string]$remark, [string]$alias) {
	  if (Test-WeChatSystemContactId $wxid) { return }
	  $cleanRemark = Normalize-DbContactText $remark
	  $cleanNickname = Normalize-DbContactText $nickname
	  $cleanAlias = Normalize-DbContactText $alias
	  $cleanWxid = Normalize-DbContactText $wxid
	  if (-not $cleanRemark -and -not $cleanNickname -and -not $cleanAlias -and -not $cleanWxid) { return }
	  $keyParts = @($wxid, $cleanNickname, $cleanRemark, $cleanAlias) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
	  $key = ($keyParts -join '|').ToLowerInvariant()
	  for ($i = 0; $i -lt $items.Count; $i++) {
	    try {
	      $existing = $items[$i]
	      $existingKey = @($existing.wxid, $existing.nickname, $existing.remark, $existing.alias) |
	        Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
	      if ((($existingKey -join '|').ToLowerInvariant()) -eq $key) { return }
	    } catch {}
	  }
	  $items.Add([ordered]@{
	    wxid = if ([string]::IsNullOrWhiteSpace($wxid)) { $cleanNickname } else { $wxid.Trim() }
	    nickname = $cleanNickname
	    remark = $cleanRemark
	    tags = @()
	    source = 'wechat-db'
	  }) | Out-Null
	}

	function Add-UniquePath($paths, [string]$path, [bool]$diagnostic = $false) {
	  if ([string]::IsNullOrWhiteSpace($path)) { return }
	  try {
	    $full = [System.IO.Path]::GetFullPath($path)
	    if ((Test-Path -LiteralPath $full) -and -not $paths.Contains($full)) {
	      $paths.Add($full) | Out-Null
	      if ($diagnostic) {
	        Add-DiagnosticListItem 'dbPaths' $full 20
	      }
	    }
	  } catch {}
	}

	function Get-WeChatDataRoots {
	  $roots = New-Object System.Collections.Generic.List[string]
	  foreach ($path in @(
	    $env:AI_CONTENT_WECHAT_CONTACT_DB_DIR,
	    $env:AI_CONTENT_WECHAT_FILES_DIR,
	    $env:WECHAT_FILES_DIR
	  )) {
	    Add-UniquePath $roots $path
	  }
	  try {
	    $documents = [Environment]::GetFolderPath('MyDocuments')
	    Add-UniquePath $roots (Join-Path $documents 'WeChat Files')
	    Add-UniquePath $roots (Join-Path $documents 'xwechat_files')
	  } catch {}
	  foreach ($base in @($env:APPDATA, $env:LOCALAPPDATA, $env:USERPROFILE)) {
	    if ([string]::IsNullOrWhiteSpace($base)) { continue }
	    Add-UniquePath $roots (Join-Path $base 'Tencent\WeChat')
	    Add-UniquePath $roots (Join-Path $base 'Tencent\Weixin')
	    Add-UniquePath $roots (Join-Path $base 'Documents\WeChat Files')
	    Add-UniquePath $roots (Join-Path $base 'Documents\xwechat_files')
	  }
	  try {
	    $systemDrive = [string]$env:SystemDrive
	    if ([string]::IsNullOrWhiteSpace($systemDrive)) { $systemDrive = 'C:' }
	    $usersRoot = Join-Path $systemDrive 'Users'
	    if (Test-Path -LiteralPath $usersRoot) {
	      foreach ($userDir in Get-ChildItem -LiteralPath $usersRoot -Directory -Force -ErrorAction SilentlyContinue) {
	        Add-UniquePath $roots (Join-Path $userDir.FullName 'Documents\WeChat Files')
	        Add-UniquePath $roots (Join-Path $userDir.FullName 'Documents\xwechat_files')
	      }
	    }
	  } catch {}
	  try {
	    $props = Get-ItemProperty -Path 'HKCU:\Software\Tencent\WeChat' -ErrorAction SilentlyContinue
	    foreach ($name in @('FileSavePath', 'InstallPath')) {
	      $value = [string]$props.$name
	      Add-UniquePath $roots $value
	      if (-not [string]::IsNullOrWhiteSpace($value)) {
	        Add-UniquePath $roots (Join-Path $value 'WeChat Files')
	        Add-UniquePath $roots (Join-Path $value 'xwechat_files')
	      }
	    }
	  } catch {}
	  return @($roots)
	}

	function Find-FilesLimited($root, [string[]]$names, [int]$maxDepth, [int]$maxCount) {
	  $found = New-Object System.Collections.Generic.List[string]
	  if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root)) { return @($found) }
	  $queue = New-Object System.Collections.Queue
	  $queue.Enqueue(@{ Path = $root; Depth = 0 })
	  while ($queue.Count -gt 0 -and $found.Count -lt $maxCount) {
	    $node = $queue.Dequeue()
	    $path = [string]$node.Path
	    $depth = [int]$node.Depth
	    $children = @()
	    try {
	      $children = @(Get-ChildItem -LiteralPath $path -Force -ErrorAction SilentlyContinue)
	    } catch {
	      continue
	    }
	    foreach ($child in $children) {
	      if ($found.Count -ge $maxCount) { break }
	      if ($child.PSIsContainer) {
	        if ($depth -lt $maxDepth) {
	          $queue.Enqueue(@{ Path = $child.FullName; Depth = $depth + 1 })
	        }
	        continue
	      }
	      foreach ($name in $names) {
	        if ($child.Name -ieq $name -and -not $found.Contains($child.FullName)) {
	          $found.Add($child.FullName) | Out-Null
	          Add-DiagnosticListItem 'dbPaths' $child.FullName 20
	          break
	        }
	      }
	    }
	  }
	  return @($found)
	}

	function Get-WeChatDbCandidateInfo([string]$dbPath) {
	  $normalized = ([string]$dbPath) -replace '\\', '/'
	  $rootKind = ''
	  $accountFolder = ''
	  $baseWxid = ''
	  $accountRoot = ''
	  $match = [regex]::Match($normalized, '(?i)(?:^|/)(xwechat_files|WeChat Files)/([^/]+)(?:/|$)')
	  if ($match.Success) {
	    $rootKind = [string]$match.Groups[1].Value
	    $accountFolder = [string]$match.Groups[2].Value
	    $baseWxid = $accountFolder
	    $baseMatch = [regex]::Match($accountFolder, '(?i)^(wxid_[A-Za-z0-9]+)(?:_|$)')
	    if ($baseMatch.Success) { $baseWxid = [string]$baseMatch.Groups[1].Value }
	    $accountRoot = $normalized.Substring(0, $match.Index + $match.Length).TrimEnd('/')
	  }
	  $activeTicks = [int64]0
	  $probes = New-Object System.Collections.Generic.List[string]
	  foreach ($probe in @($dbPath, (Split-Path -Parent $dbPath), $accountRoot)) {
	    if (-not [string]::IsNullOrWhiteSpace($probe)) { $probes.Add($probe) | Out-Null }
	  }
	  if (-not [string]::IsNullOrWhiteSpace($accountRoot)) {
	    foreach ($child in @('db_storage', 'db_storage/contact', 'db_storage/message', 'config', 'msg', 'resource', 'temp')) {
	      $probes.Add((Join-Path $accountRoot $child)) | Out-Null
	    }
	  }
	  foreach ($probe in $probes) {
	    try {
	      if (Test-Path -LiteralPath $probe) {
	        $item = Get-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
	        if ($null -ne $item) {
	          $activeTicks = [Math]::Max($activeTicks, [int64]$item.LastWriteTimeUtc.Ticks)
	          $activeTicks = [Math]::Max($activeTicks, [int64]$item.CreationTimeUtc.Ticks)
	        }
	      }
	    } catch {}
	  }
	  $score = 0
	  if ($rootKind -ieq 'xwechat_files') { $score += 80 }
	  if ($normalized -match '(?i)/db_storage/contact/contact\.db$|/contact\.db$') { $score += 60 }
	  if ($accountFolder -match '(?i)^wxid_') { $score += 40 }
	  if ($normalized -match '(?i)/(msg|db_storage/message|message)/.*(micromsg|msg)\.db$|/(micromsg|msg)\.db$') { $score -= 20 }
	  if ($normalized -match '(?i)/backup(/|$)|/all_users(/|$)' -or $accountFolder -ieq 'all_users') { $score -= 2000 }
	  return [pscustomobject]@{
	    Path = $dbPath
	    Score = $score
	    ActiveTicks = $activeTicks
	    AccountFolder = $accountFolder
	    BaseWxid = $baseWxid
	  }
	}

	function Sort-WeChatContactDbCandidates([string[]]$paths) {
	  $items = @()
	  foreach ($path in $paths) {
	    if ([string]::IsNullOrWhiteSpace($path)) { continue }
	    $items += Get-WeChatDbCandidateInfo $path
	  }
	  return @(
	    $items |
	      Sort-Object @{ Expression = 'ActiveTicks'; Descending = $true }, @{ Expression = 'Score'; Descending = $true } |
	      ForEach-Object { $_.Path }
	  )
	}

	function Find-WeChatContactDbCandidates {
	  Set-Diagnostic 'stage' 'find-contact-db'
	  $paths = New-Object System.Collections.Generic.List[string]
	  Add-UniquePath $paths $env:AI_CONTENT_WECHAT_CONTACT_DB_PATH $true
	  foreach ($root in Get-WeChatDataRoots) {
	    foreach ($path in Find-FilesLimited $root @('contact.db', 'Contact.db', 'MicroMsg.db') 7 40) {
	      Add-UniquePath $paths $path $true
	    }
	  }
	  return @(Sort-WeChatContactDbCandidates @($paths))
	}

	function Get-SqliteCliPath {
	  foreach ($path in @($env:AI_CONTENT_SQLITE_EXE, $env:SQLITE_EXE)) {
	    if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path)) { return $path }
	  }
	  foreach ($name in @('sqlite3.exe', 'sqlite3')) {
	    try {
	      $cmd = Get-Command $name -ErrorAction SilentlyContinue
	      if ($null -ne $cmd -and -not [string]::IsNullOrWhiteSpace($cmd.Source)) {
	        return $cmd.Source
	      }
	    } catch {}
	  }
	  return ''
	}

	function Invoke-SqliteRows([string]$sqlitePath, [string]$dbPath, [string]$query) {
	  try {
	    $tab = [string][char]9
	    $output = @(& $sqlitePath '-noheader' '-separator' $tab $dbPath $query 2>&1)
	    $code = $LASTEXITCODE
	    return @{ Code = $code; Output = @($output) }
	  } catch {
	    return @{ Code = 1; Output = @($_.Exception.Message) }
	  }
	}

	function Ensure-WeChatDbDecryptor {
	  if ('KaypalWechatDbDecryptor' -as [type]) { return $true }
	  $source = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('dXNpbmcgU3lzdGVtOwp1c2luZyBTeXN0ZW0uQ29sbGVjdGlvbnMuR2VuZXJpYzsKdXNpbmcgU3lzdGVtLkRpYWdub3N0aWNzOwp1c2luZyBTeXN0ZW0uSU87CnVzaW5nIFN5c3RlbS5SdW50aW1lLkludGVyb3BTZXJ2aWNlczsKdXNpbmcgU3lzdGVtLlNlY3VyaXR5LkNyeXB0b2dyYXBoeTsKdXNpbmcgU3lzdGVtLlRleHQ7CgpwdWJsaWMgY2xhc3MgS2F5cGFsV2VjaGF0RGJEZWNyeXB0b3IKewogICAgc3RhdGljIExpc3Q8c3RyaW5nPiBMYXN0U2NhbkRpYWdub3N0aWNzID0gbmV3IExpc3Q8c3RyaW5nPigpOwogICAgc3RhdGljIGxvbmcgU2NhblJlZ2lvbnMgPSAwOwogICAgc3RhdGljIGxvbmcgU2NhbkJ5dGVzID0gMDsKICAgIHN0YXRpYyBsb25nIFNjYW5TYWx0SGl0cyA9IDA7CiAgICBzdGF0aWMgbG9uZyBTY2FuTGl0ZXJhbENhbmRpZGF0ZXMgPSAwOwogICAgc3RhdGljIGxvbmcgU2NhblJhd0FuY2hvcnMgPSAwOwogICAgc3RhdGljIGxvbmcgU2NhblJhd0NhbmRpZGF0ZXMgPSAwOwoKICAgIHB1YmxpYyBzdGF0aWMgc3RyaW5nIEdldExhc3REaWFnbm9zdGljcygpCiAgICB7CiAgICAgICAgcmV0dXJuIFN0cmluZy5Kb2luKCIgfCAiLCBMYXN0U2NhbkRpYWdub3N0aWNzLlRvQXJyYXkoKSk7CiAgICB9CgogICAgc3RhdGljIHZvaWQgUmVzZXRQcm9jZXNzU2NhbkNvdW50ZXJzKCkKICAgIHsKICAgICAgICBTY2FuUmVnaW9ucyA9IDA7CiAgICAgICAgU2NhbkJ5dGVzID0gMDsKICAgICAgICBTY2FuU2FsdEhpdHMgPSAwOwogICAgICAgIFNjYW5MaXRlcmFsQ2FuZGlkYXRlcyA9IDA7CiAgICAgICAgU2NhblJhd0FuY2hvcnMgPSAwOwogICAgICAgIFNjYW5SYXdDYW5kaWRhdGVzID0gMDsKICAgIH0KCiAgICBzdGF0aWMgdm9pZCBBZGRTY2FuRGlhZ25vc3RpYyhzdHJpbmcgdmFsdWUpCiAgICB7CiAgICAgICAgaWYgKCFTdHJpbmcuSXNOdWxsT3JFbXB0eSh2YWx1ZSkgJiYgTGFzdFNjYW5EaWFnbm9zdGljcy5Db3VudCA8IDQwKSBMYXN0U2NhbkRpYWdub3N0aWNzLkFkZCh2YWx1ZSk7CiAgICB9CiAgICBjb25zdCBpbnQgUGFnZVNpemUgPSA0MDk2OwogICAgY29uc3QgaW50IFNhbHRTaXplID0gMTY7CiAgICBjb25zdCBpbnQgUmVzZXJ2ZVNpemUgPSA4MDsKICAgIGNvbnN0IGludCBJdlNpemUgPSAxNjsKICAgIGNvbnN0IGludCBIbWFjU2l6ZSA9IDY0OwogICAgY29uc3QgaW50IE1lbUNvbW1pdCA9IDB4MTAwMDsKICAgIGNvbnN0IGludCBDaHVua1NpemUgPSA0ICogMTAyNCAqIDEwMjQ7CiAgICBjb25zdCB1aW50IFByb2Nlc3NBY2Nlc3MgPSAweDAwMTAgfCAweDA0MDAgfCAweDEwMDA7CgogICAgW1N0cnVjdExheW91dChMYXlvdXRLaW5kLlNlcXVlbnRpYWwpXQogICAgc3RydWN0IE1lbW9yeUJhc2ljSW5mb3JtYXRpb24KICAgIHsKICAgICAgICBwdWJsaWMgSW50UHRyIEJhc2VBZGRyZXNzOwogICAgICAgIHB1YmxpYyBJbnRQdHIgQWxsb2NhdGlvbkJhc2U7CiAgICAgICAgcHVibGljIHVpbnQgQWxsb2NhdGlvblByb3RlY3Q7CiAgICAgICAgcHVibGljIEludFB0ciBSZWdpb25TaXplOwogICAgICAgIHB1YmxpYyB1aW50IFN0YXRlOwogICAgICAgIHB1YmxpYyB1aW50IFByb3RlY3Q7CiAgICAgICAgcHVibGljIHVpbnQgVHlwZTsKICAgIH0KCiAgICBbRGxsSW1wb3J0KCJrZXJuZWwzMi5kbGwiLCBTZXRMYXN0RXJyb3IgPSB0cnVlKV0KICAgIHN0YXRpYyBleHRlcm4gSW50UHRyIE9wZW5Qcm9jZXNzKHVpbnQgZHdEZXNpcmVkQWNjZXNzLCBib29sIGJJbmhlcml0SGFuZGxlLCBpbnQgZHdQcm9jZXNzSWQpOwoKICAgIFtEbGxJbXBvcnQoImtlcm5lbDMyLmRsbCIsIFNldExhc3RFcnJvciA9IHRydWUpXQogICAgc3RhdGljIGV4dGVybiBib29sIENsb3NlSGFuZGxlKEludFB0ciBoT2JqZWN0KTsKCiAgICBbRGxsSW1wb3J0KCJrZXJuZWwzMi5kbGwiLCBTZXRMYXN0RXJyb3IgPSB0cnVlKV0KICAgIHN0YXRpYyBleHRlcm4gSW50UHRyIFZpcnR1YWxRdWVyeUV4KEludFB0ciBoUHJvY2VzcywgSW50UHRyIGxwQWRkcmVzcywgb3V0IE1lbW9yeUJhc2ljSW5mb3JtYXRpb24gbHBCdWZmZXIsIEludFB0ciBkd0xlbmd0aCk7CgogICAgW0RsbEltcG9ydCgia2VybmVsMzIuZGxsIiwgU2V0TGFzdEVycm9yID0gdHJ1ZSldCiAgICBzdGF0aWMgZXh0ZXJuIGJvb2wgUmVhZFByb2Nlc3NNZW1vcnkoSW50UHRyIGhQcm9jZXNzLCBJbnRQdHIgbHBCYXNlQWRkcmVzcywgYnl0ZVtdIGxwQnVmZmVyLCBJbnRQdHIgZHdTaXplLCBvdXQgSW50UHRyIGxwTnVtYmVyT2ZCeXRlc1JlYWQpOwoKICAgIHB1YmxpYyBzdGF0aWMgc3RyaW5nIERlY3J5cHRXaXRoTWVtb3J5S2V5KHN0cmluZyBkYlBhdGgsIHN0cmluZyBvdXRwdXRQYXRoKQogICAgewogICAgICAgIHN0cmluZyBrZXkgPSBGaW5kTWVtb3J5S2V5KGRiUGF0aCk7CiAgICAgICAgaWYgKFN0cmluZy5Jc051bGxPckVtcHR5KGtleSkpIHJldHVybiAiIjsKICAgICAgICBEZWNyeXB0RGF0YWJhc2UoZGJQYXRoLCBvdXRwdXRQYXRoLCBrZXkpOwogICAgICAgIHJldHVybiBrZXk7CiAgICB9CgogICAgcHVibGljIHN0YXRpYyBzdHJpbmcgRmluZE1lbW9yeUtleShzdHJpbmcgZGJQYXRoKQogICAgewogICAgICAgIExhc3RTY2FuRGlhZ25vc3RpY3MuQ2xlYXIoKTsKICAgICAgICBieXRlW10gcGFnZTEgPSBSZWFkRmlyc3RQYWdlKGRiUGF0aCk7CiAgICAgICAgc3RyaW5nIHNhbHRIZXggPSBUb0hleChwYWdlMSwgMCwgU2FsdFNpemUpOwogICAgICAgIExpc3Q8UHJvY2Vzcz4gcHJvY2Vzc2VzID0gbmV3IExpc3Q8UHJvY2Vzcz4oKTsKICAgICAgICBmb3JlYWNoIChzdHJpbmcgbmFtZSBpbiBuZXcgc3RyaW5nW10geyAiV2VpeGluIiwgIldlQ2hhdCIsICJXZUNoYXRBcHBFeCIsICJXZUNoYXRBcHAiLCAiV2VDaGF0QnJvd3NlciIgfSkKICAgICAgICB7CiAgICAgICAgICAgIHRyeSB7IHByb2Nlc3Nlcy5BZGRSYW5nZShQcm9jZXNzLkdldFByb2Nlc3Nlc0J5TmFtZShuYW1lKSk7IH0gY2F0Y2ggeyB9CiAgICAgICAgfQogICAgICAgIEFkZFNjYW5EaWFnbm9zdGljKCJwcm9jZXNzLWNvdW50PSIgKyBwcm9jZXNzZXMuQ291bnQpOwogICAgICAgIHByb2Nlc3Nlcy5Tb3J0KGRlbGVnYXRlKFByb2Nlc3MgYSwgUHJvY2VzcyBiKQogICAgICAgIHsKICAgICAgICAgICAgbG9uZyBidyA9IDA7CiAgICAgICAgICAgIGxvbmcgYXcgPSAwOwogICAgICAgICAgICB0cnkgeyBidyA9IGIuV29ya2luZ1NldDY0OyB9IGNhdGNoIHsgfQogICAgICAgICAgICB0cnkgeyBhdyA9IGEuV29ya2luZ1NldDY0OyB9IGNhdGNoIHsgfQogICAgICAgICAgICByZXR1cm4gYncuQ29tcGFyZVRvKGF3KTsKICAgICAgICB9KTsKCiAgICAgICAgSGFzaFNldDxzdHJpbmc+IHRlc3RlZCA9IG5ldyBIYXNoU2V0PHN0cmluZz4oU3RyaW5nQ29tcGFyZXIuT3JkaW5hbElnbm9yZUNhc2UpOwogICAgICAgIGZvcmVhY2ggKFByb2Nlc3MgcHJvY2VzcyBpbiBwcm9jZXNzZXMpCiAgICAgICAgewogICAgICAgICAgICBJbnRQdHIgaGFuZGxlID0gSW50UHRyLlplcm87CiAgICAgICAgICAgIHRyeQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBSZXNldFByb2Nlc3NTY2FuQ291bnRlcnMoKTsKICAgICAgICAgICAgICAgIGhhbmRsZSA9IE9wZW5Qcm9jZXNzKFByb2Nlc3NBY2Nlc3MsIGZhbHNlLCBwcm9jZXNzLklkKTsKICAgICAgICAgICAgICAgIGlmIChoYW5kbGUgPT0gSW50UHRyLlplcm8pCiAgICAgICAgICAgICAgICB7CiAgICAgICAgICAgICAgICAgICAgQWRkU2NhbkRpYWdub3N0aWMocHJvY2Vzcy5Qcm9jZXNzTmFtZSArICIjIiArIHByb2Nlc3MuSWQgKyAiOm9wZW49ZmFpbGVkIik7CiAgICAgICAgICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBzdHJpbmcga2V5ID0gU2NhblByb2Nlc3NGb3JLZXkoaGFuZGxlLCBwYWdlMSwgc2FsdEhleCwgdGVzdGVkKTsKICAgICAgICAgICAgICAgIHN0cmluZyBzdW1tYXJ5ID0gcHJvY2Vzcy5Qcm9jZXNzTmFtZSArICIjIiArIHByb2Nlc3MuSWQgKyAiOm9wZW49b2s6cmVnaW9ucz0iICsgU2NhblJlZ2lvbnMgKyAiOm1iPSIgKyAoU2NhbkJ5dGVzIC8gMTAyNCAvIDEwMjQpICsgIjpzYWx0PSIgKyBTY2FuU2FsdEhpdHMgKyAiOmxpdGVyYWw9IiArIFNjYW5MaXRlcmFsQ2FuZGlkYXRlcyArICI6cmF3QW5jaG9ycz0iICsgU2NhblJhd0FuY2hvcnMgKyAiOnJhdz0iICsgU2NhblJhd0NhbmRpZGF0ZXMgKyAiOmZvdW5kPSIgKyAoIVN0cmluZy5Jc051bGxPckVtcHR5KGtleSkgPyAieWVzIiA6ICJubyIpOwogICAgICAgICAgICAgICAgQWRkU2NhbkRpYWdub3N0aWMoc3VtbWFyeSk7CiAgICAgICAgICAgICAgICBpZiAoIVN0cmluZy5Jc051bGxPckVtcHR5KGtleSkpIHJldHVybiBrZXk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgY2F0Y2ggKEV4Y2VwdGlvbiBleCkKICAgICAgICAgICAgewogICAgICAgICAgICAgICAgQWRkU2NhbkRpYWdub3N0aWMocHJvY2Vzcy5Qcm9jZXNzTmFtZSArICIjIiArIHByb2Nlc3MuSWQgKyAiOmVycm9yPSIgKyBleC5HZXRUeXBlKCkuTmFtZSk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgZmluYWxseQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBpZiAoaGFuZGxlICE9IEludFB0ci5aZXJvKSBDbG9zZUhhbmRsZShoYW5kbGUpOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICBzdGF0aWMgc3RyaW5nIFNjYW5Qcm9jZXNzRm9yS2V5KEludFB0ciBoYW5kbGUsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgbG9uZyBhZGRyZXNzID0gMDsKICAgICAgICBsb25nIG1heEFkZHJlc3MgPSAweDdGRkZGRkZGRkZGRjsKICAgICAgICBpbnQgbWJpU2l6ZSA9IE1hcnNoYWwuU2l6ZU9mKHR5cGVvZihNZW1vcnlCYXNpY0luZm9ybWF0aW9uKSk7CiAgICAgICAgd2hpbGUgKGFkZHJlc3MgPiAtMSAmJiBhZGRyZXNzIDwgbWF4QWRkcmVzcykKICAgICAgICB7CiAgICAgICAgICAgIE1lbW9yeUJhc2ljSW5mb3JtYXRpb24gbWJpOwogICAgICAgICAgICBJbnRQdHIgcXVlcnkgPSBuZXcgSW50UHRyKGFkZHJlc3MpOwogICAgICAgICAgICBJbnRQdHIgcmVzdWx0ID0gVmlydHVhbFF1ZXJ5RXgoaGFuZGxlLCBxdWVyeSwgb3V0IG1iaSwgbmV3IEludFB0cihtYmlTaXplKSk7CiAgICAgICAgICAgIGlmIChyZXN1bHQgPT0gSW50UHRyLlplcm8pIGJyZWFrOwoKICAgICAgICAgICAgbG9uZyBiYXNlQWRkcmVzcyA9IG1iaS5CYXNlQWRkcmVzcy5Ub0ludDY0KCk7CiAgICAgICAgICAgIGxvbmcgcmVnaW9uU2l6ZSA9IG1iaS5SZWdpb25TaXplLlRvSW50NjQoKTsKICAgICAgICAgICAgaWYgKHJlZ2lvblNpemUgPiAwICYmIHJlZ2lvblNpemUgPCA1MDBMICogMTAyNEwgKiAxMDI0TCAmJiBtYmkuU3RhdGUgPT0gTWVtQ29tbWl0ICYmIElzUmVhZGFibGVQcm90ZWN0KG1iaS5Qcm90ZWN0KSkKICAgICAgICAgICAgewogICAgICAgICAgICAgICAgU2NhblJlZ2lvbnMrKzsKICAgICAgICAgICAgICAgIHN0cmluZyBrZXkgPSBTY2FuTWVtb3J5UmVnaW9uKGhhbmRsZSwgYmFzZUFkZHJlc3MsIHJlZ2lvblNpemUsIHBhZ2UxLCBzYWx0SGV4LCB0ZXN0ZWQpOwogICAgICAgICAgICAgICAgaWYgKCFTdHJpbmcuSXNOdWxsT3JFbXB0eShrZXkpKSByZXR1cm4ga2V5OwogICAgICAgICAgICB9CgogICAgICAgICAgICBsb25nIG5leHQgPSBiYXNlQWRkcmVzcyArIHJlZ2lvblNpemU7CiAgICAgICAgICAgIGlmIChuZXh0IDw9IGFkZHJlc3MpIGJyZWFrOwogICAgICAgICAgICBhZGRyZXNzID0gbmV4dDsKICAgICAgICB9CiAgICAgICAgcmV0dXJuICIiOwogICAgfQoKICAgIHN0YXRpYyBzdHJpbmcgU2Nhbk1lbW9yeVJlZ2lvbihJbnRQdHIgaGFuZGxlLCBsb25nIGJhc2VBZGRyZXNzLCBsb25nIHJlZ2lvblNpemUsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgYnl0ZVtdIHRhaWwgPSBuZXcgYnl0ZVswXTsKICAgICAgICBsb25nIG9mZnNldCA9IDA7CiAgICAgICAgd2hpbGUgKG9mZnNldCA8IHJlZ2lvblNpemUpCiAgICAgICAgewogICAgICAgICAgICBpbnQgcmVhZFNpemUgPSAoaW50KU1hdGguTWluKChsb25nKUNodW5rU2l6ZSwgcmVnaW9uU2l6ZSAtIG9mZnNldCk7CiAgICAgICAgICAgIGJ5dGVbXSBidWZmZXIgPSBuZXcgYnl0ZVtyZWFkU2l6ZV07CiAgICAgICAgICAgIEludFB0ciBieXRlc1JlYWQ7CiAgICAgICAgICAgIGJvb2wgb2sgPSBSZWFkUHJvY2Vzc01lbW9yeShoYW5kbGUsIG5ldyBJbnRQdHIoYmFzZUFkZHJlc3MgKyBvZmZzZXQpLCBidWZmZXIsIG5ldyBJbnRQdHIocmVhZFNpemUpLCBvdXQgYnl0ZXNSZWFkKTsKICAgICAgICAgICAgaWYgKG9rICYmIGJ5dGVzUmVhZC5Ub0ludDY0KCkgPiAwKQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBpbnQgYWN0dWFsID0gKGludClNYXRoLk1pbigobG9uZylyZWFkU2l6ZSwgYnl0ZXNSZWFkLlRvSW50NjQoKSk7CiAgICAgICAgICAgICAgICBpZiAoYWN0dWFsICE9IGJ1ZmZlci5MZW5ndGgpCiAgICAgICAgICAgICAgICB7CiAgICAgICAgICAgICAgICAgICAgYnl0ZVtdIHNtYWxsZXIgPSBuZXcgYnl0ZVthY3R1YWxdOwogICAgICAgICAgICAgICAgICAgIEJ1ZmZlci5CbG9ja0NvcHkoYnVmZmVyLCAwLCBzbWFsbGVyLCAwLCBhY3R1YWwpOwogICAgICAgICAgICAgICAgICAgIGJ1ZmZlciA9IHNtYWxsZXI7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBTY2FuQnl0ZXMgKz0gYnVmZmVyLkxlbmd0aDsKICAgICAgICAgICAgICAgIGJ5dGVbXSBkYXRhID0gQ29tYmluZSh0YWlsLCBidWZmZXIpOwogICAgICAgICAgICAgICAgc3RyaW5nIGtleSA9IFNjYW5DYW5kaWRhdGVzKGRhdGEsIHBhZ2UxLCBzYWx0SGV4LCB0ZXN0ZWQpOwogICAgICAgICAgICAgICAgaWYgKCFTdHJpbmcuSXNOdWxsT3JFbXB0eShrZXkpKSByZXR1cm4ga2V5OwogICAgICAgICAgICAgICAgdGFpbCA9IExhc3RCeXRlcyhkYXRhLCAyNTYpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIG9mZnNldCArPSByZWFkU2l6ZTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuICIiOwogICAgfQoKICAgIHN0YXRpYyBzdHJpbmcgU2NhbkNhbmRpZGF0ZXMoYnl0ZVtdIGRhdGEsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgc3RyaW5nIGtleSA9IFNjYW5TcWxDaXBoZXJMaXRlcmFsQ2FuZGlkYXRlcyhkYXRhLCBwYWdlMSwgc2FsdEhleCwgdGVzdGVkKTsKICAgICAgICBpZiAoIVN0cmluZy5Jc051bGxPckVtcHR5KGtleSkpIHJldHVybiBrZXk7CiAgICAgICAgcmV0dXJuIFNjYW5SYXdDYW5kaWRhdGVzTmVhclNhbHQoZGF0YSwgcGFnZTEsIHRlc3RlZCk7CiAgICB9CgogICAgc3RhdGljIHN0cmluZyBTY2FuU3FsQ2lwaGVyTGl0ZXJhbENhbmRpZGF0ZXMoYnl0ZVtdIGRhdGEsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgZm9yIChpbnQgaSA9IDA7IGkgKyAzIDwgZGF0YS5MZW5ndGg7IGkrKykKICAgICAgICB7CiAgICAgICAgICAgIGlmICgoZGF0YVtpXSAhPSAoYnl0ZSkneCcgJiYgZGF0YVtpXSAhPSAoYnl0ZSknWCcpIHx8IGRhdGFbaSArIDFdICE9IChieXRlKSdcJycpIGNvbnRpbnVlOwogICAgICAgICAgICBpbnQgc3RhcnQgPSBpICsgMjsKICAgICAgICAgICAgaW50IGogPSBzdGFydDsKICAgICAgICAgICAgd2hpbGUgKGogPCBkYXRhLkxlbmd0aCAmJiBJc0hleEJ5dGUoZGF0YVtqXSkgJiYgaiAtIHN0YXJ0IDw9IDE5MikgaisrOwogICAgICAgICAgICBpbnQgbGVuID0gaiAtIHN0YXJ0OwogICAgICAgICAgICBpZiAoaiA+PSBkYXRhLkxlbmd0aCB8fCBkYXRhW2pdICE9IChieXRlKSdcJycgfHwgbGVuIDwgNjQgfHwgbGVuID4gMTkyIHx8IChsZW4gJSAyKSAhPSAwKSBjb250aW51ZTsKICAgICAgICAgICAgc3RyaW5nIGhleCA9IEVuY29kaW5nLkFTQ0lJLkdldFN0cmluZyhkYXRhLCBzdGFydCwgbGVuKTsKICAgICAgICAgICAgc3RyaW5nIG1hcmtlciA9ICJzcWxjaXBoZXItbGl0ZXJhbDoiICsgaGV4OwogICAgICAgICAgICBpZiAodGVzdGVkLkNvbnRhaW5zKG1hcmtlcikpIGNvbnRpbnVlOwogICAgICAgICAgICB0ZXN0ZWQuQWRkKG1hcmtlcik7CiAgICAgICAgICAgIFNjYW5MaXRlcmFsQ2FuZGlkYXRlcysrOwoKICAgICAgICAgICAgc3RyaW5nIGVuY0tleUhleCA9ICIiOwogICAgICAgICAgICBzdHJpbmcgY2FuZGlkYXRlU2FsdCA9ICIiOwogICAgICAgICAgICBpZiAobGVuID09IDY0KQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBlbmNLZXlIZXggPSBoZXg7CiAgICAgICAgICAgICAgICBjYW5kaWRhdGVTYWx0ID0gc2FsdEhleDsKICAgICAgICAgICAgfQogICAgICAgICAgICBlbHNlIGlmIChsZW4gPT0gOTYpCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGVuY0tleUhleCA9IGhleC5TdWJzdHJpbmcoMCwgNjQpOwogICAgICAgICAgICAgICAgY2FuZGlkYXRlU2FsdCA9IGhleC5TdWJzdHJpbmcoNjQsIDMyKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBlbHNlCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICghU3RyaW5nLkVxdWFscyhjYW5kaWRhdGVTYWx0LCBzYWx0SGV4LCBTdHJpbmdDb21wYXJpc29uLk9yZGluYWxJZ25vcmVDYXNlKSkgY29udGludWU7CiAgICAgICAgICAgIGJ5dGVbXSBlbmNLZXkgPSBIZXhUb0J5dGVzKGVuY0tleUhleCk7CiAgICAgICAgICAgIGlmIChWZXJpZnlFbmNLZXkoZW5jS2V5LCBwYWdlMSkpIHJldHVybiBlbmNLZXlIZXg7CiAgICAgICAgfQogICAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICBzdGF0aWMgc3RyaW5nIFNjYW5SYXdDYW5kaWRhdGVzTmVhclNhbHQoYnl0ZVtdIGRhdGEsIGJ5dGVbXSBwYWdlMSwgSGFzaFNldDxzdHJpbmc+IHRlc3RlZCkKICAgIHsKICAgICAgICBieXRlW10gc2FsdCA9IFNsaWNlKHBhZ2UxLCAwLCBTYWx0U2l6ZSk7CiAgICAgICAgaW50IGFuY2hvcnMgPSAwOwogICAgICAgIGZvciAoaW50IGFuY2hvciA9IEluZGV4T2ZCeXRlcyhkYXRhLCBzYWx0LCAwKTsgYW5jaG9yID49IDA7IGFuY2hvciA9IEluZGV4T2ZCeXRlcyhkYXRhLCBzYWx0LCBhbmNob3IgKyAxKSkKICAgICAgICB7CiAgICAgICAgICAgIGFuY2hvcnMrKzsKICAgICAgICAgICAgU2NhblNhbHRIaXRzKys7CiAgICAgICAgICAgIFNjYW5SYXdBbmNob3JzKys7CiAgICAgICAgICAgIGlmIChhbmNob3JzID4gNjQpIGJyZWFrOwogICAgICAgICAgICBpbnQgc3RhcnQgPSBNYXRoLk1heCgwLCBhbmNob3IgLSA0MDk2KTsKICAgICAgICAgICAgaW50IGVuZCA9IE1hdGguTWluKGRhdGEuTGVuZ3RoIC0gMzIsIGFuY2hvciArIDQwOTYpOwogICAgICAgICAgICBpbnQgcHJvYmVzID0gMDsKICAgICAgICAgICAgZm9yIChpbnQgaSA9IHN0YXJ0OyBpIDw9IGVuZDsgaSsrKQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBwcm9iZXMrKzsKICAgICAgICAgICAgICAgIGlmIChwcm9iZXMgPiAxMjAwMCkgYnJlYWs7CiAgICAgICAgICAgICAgICBpZiAoIUxvb2tzTGlrZVJhd0tleShkYXRhLCBpKSkgY29udGludWU7CiAgICAgICAgICAgICAgICBTY2FuUmF3Q2FuZGlkYXRlcysrOwogICAgICAgICAgICAgICAgc3RyaW5nIGhleCA9IFRvSGV4KGRhdGEsIGksIDMyKTsKICAgICAgICAgICAgICAgIHN0cmluZyBtYXJrZXIgPSAicmF3LW5lYXItc2FsdDoiICsgaGV4OwogICAgICAgICAgICAgICAgaWYgKHRlc3RlZC5Db250YWlucyhtYXJrZXIpKSBjb250aW51ZTsKICAgICAgICAgICAgICAgIHRlc3RlZC5BZGQobWFya2VyKTsKICAgICAgICAgICAgICAgIGJ5dGVbXSBlbmNLZXkgPSBTbGljZShkYXRhLCBpLCAzMik7CiAgICAgICAgICAgICAgICBpZiAoVmVyaWZ5RW5jS2V5KGVuY0tleSwgcGFnZTEpKSByZXR1cm4gaGV4OwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICBzdGF0aWMgaW50IEluZGV4T2ZCeXRlcyhieXRlW10gZGF0YSwgYnl0ZVtdIG5lZWRsZSwgaW50IHN0YXJ0KQogICAgewogICAgICAgIGlmIChkYXRhID09IG51bGwgfHwgbmVlZGxlID09IG51bGwgfHwgbmVlZGxlLkxlbmd0aCA9PSAwKSByZXR1cm4gLTE7CiAgICAgICAgZm9yIChpbnQgaSA9IE1hdGguTWF4KDAsIHN0YXJ0KTsgaSArIG5lZWRsZS5MZW5ndGggPD0gZGF0YS5MZW5ndGg7IGkrKykKICAgICAgICB7CiAgICAgICAgICAgIGludCBqID0gMDsKICAgICAgICAgICAgZm9yICg7IGogPCBuZWVkbGUuTGVuZ3RoOyBqKyspCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGlmIChkYXRhW2kgKyBqXSAhPSBuZWVkbGVbal0pIGJyZWFrOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmIChqID09IG5lZWRsZS5MZW5ndGgpIHJldHVybiBpOwogICAgICAgIH0KICAgICAgICByZXR1cm4gLTE7CiAgICB9CgogICAgc3RhdGljIGJvb2wgTG9va3NMaWtlUmF3S2V5KGJ5dGVbXSBkYXRhLCBpbnQgc3RhcnQpCiAgICB7CiAgICAgICAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCArIDMyID4gZGF0YS5MZW5ndGgpIHJldHVybiBmYWxzZTsKICAgICAgICBib29sW10gc2VlbiA9IG5ldyBib29sWzI1Nl07CiAgICAgICAgaW50IHVuaXF1ZSA9IDA7CiAgICAgICAgaW50IHplcm9zID0gMDsKICAgICAgICBpbnQgcHJpbnRhYmxlID0gMDsKICAgICAgICBmb3IgKGludCBpID0gMDsgaSA8IDMyOyBpKyspCiAgICAgICAgewogICAgICAgICAgICBieXRlIHZhbHVlID0gZGF0YVtzdGFydCArIGldOwogICAgICAgICAgICBpZiAodmFsdWUgPT0gMCkgemVyb3MrKzsKICAgICAgICAgICAgaWYgKHZhbHVlID49IDB4MjAgJiYgdmFsdWUgPD0gMHg3ZSkgcHJpbnRhYmxlKys7CiAgICAgICAgICAgIGlmICghc2Vlblt2YWx1ZV0pCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIHNlZW5bdmFsdWVdID0gdHJ1ZTsKICAgICAgICAgICAgICAgIHVuaXF1ZSsrOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIGlmICh6ZXJvcyA+IDQpIHJldHVybiBmYWxzZTsKICAgICAgICBpZiAodW5pcXVlIDwgMTgpIHJldHVybiBmYWxzZTsKICAgICAgICBpZiAocHJpbnRhYmxlID49IDMwKSByZXR1cm4gZmFsc2U7CiAgICAgICAgcmV0dXJuIHRydWU7CiAgICB9CgogICAgc3RhdGljIGJvb2wgSXNSZWFkYWJsZVByb3RlY3QodWludCBwcm90ZWN0KQogICAgewogICAgICAgIGlmICgocHJvdGVjdCAmIDB4MTAwKSAhPSAwKSByZXR1cm4gZmFsc2U7CiAgICAgICAgdWludCBwID0gcHJvdGVjdCAmIDB4ZmY7CiAgICAgICAgcmV0dXJuIHAgPT0gMHgwMiB8fCBwID09IDB4MDQgfHwgcCA9PSAweDA4IHx8IHAgPT0gMHgxMCB8fCBwID09IDB4MjAgfHwgcCA9PSAweDQwIHx8IHAgPT0gMHg4MDsKICAgIH0KCiAgICBzdGF0aWMgYm9vbCBJc0hleEJ5dGUoYnl0ZSB2YWx1ZSkKICAgIHsKICAgICAgICByZXR1cm4gKHZhbHVlID49IChieXRlKScwJyAmJiB2YWx1ZSA8PSAoYnl0ZSknOScpIHx8CiAgICAgICAgICAgICAgICh2YWx1ZSA+PSAoYnl0ZSknYScgJiYgdmFsdWUgPD0gKGJ5dGUpJ2YnKSB8fAogICAgICAgICAgICAgICAodmFsdWUgPj0gKGJ5dGUpJ0EnICYmIHZhbHVlIDw9IChieXRlKSdGJyk7CiAgICB9CgogICAgc3RhdGljIGJ5dGVbXSBSZWFkRmlyc3RQYWdlKHN0cmluZyBkYlBhdGgpCiAgICB7CiAgICAgICAgYnl0ZVtdIHBhZ2UgPSBuZXcgYnl0ZVtQYWdlU2l6ZV07CiAgICAgICAgdXNpbmcgKEZpbGVTdHJlYW0gZnMgPSBGaWxlLk9wZW5SZWFkKGRiUGF0aCkpCiAgICAgICAgewogICAgICAgICAgICBpbnQgcmVhZCA9IGZzLlJlYWQocGFnZSwgMCwgcGFnZS5MZW5ndGgpOwogICAgICAgICAgICBpZiAocmVhZCA8IFBhZ2VTaXplKSB0aHJvdyBuZXcgSW52YWxpZE9wZXJhdGlvbkV4Y2VwdGlvbigiY29udGFjdC5kYiBpcyBzbWFsbGVyIHRoYW4gb25lIFNRTENpcGhlciBwYWdlIik7CiAgICAgICAgfQogICAgICAgIHJldHVybiBwYWdlOwogICAgfQoKICAgIHN0YXRpYyBib29sIFZlcmlmeUVuY0tleShieXRlW10gZW5jS2V5LCBieXRlW10gcGFnZTEpCiAgICB7CiAgICAgICAgYnl0ZVtdIHNhbHQgPSBTbGljZShwYWdlMSwgMCwgU2FsdFNpemUpOwogICAgICAgIGJ5dGVbXSBtYWNTYWx0ID0gbmV3IGJ5dGVbc2FsdC5MZW5ndGhdOwogICAgICAgIGZvciAoaW50IGkgPSAwOyBpIDwgc2FsdC5MZW5ndGg7IGkrKykgbWFjU2FsdFtpXSA9IChieXRlKShzYWx0W2ldIF4gMHgzYSk7CiAgICAgICAgYnl0ZVtdIG1hY0tleSA9IFBia2RmMlNoYTUxMihlbmNLZXksIG1hY1NhbHQsIDIsIDMyKTsKICAgICAgICBieXRlW10gaG1hY0RhdGEgPSBTbGljZShwYWdlMSwgU2FsdFNpemUsIFBhZ2VTaXplIC0gUmVzZXJ2ZVNpemUgKyBJdlNpemUgLSBTYWx0U2l6ZSk7CiAgICAgICAgYnl0ZVtdIGV4cGVjdGVkID0gU2xpY2UocGFnZTEsIFBhZ2VTaXplIC0gSG1hY1NpemUsIEhtYWNTaXplKTsKICAgICAgICBieXRlW10gcGFnZU5vID0gbmV3IGJ5dGVbXSB7IDEsIDAsIDAsIDAgfTsKICAgICAgICB1c2luZyAoSE1BQ1NIQTUxMiBobWFjID0gbmV3IEhNQUNTSEE1MTIobWFjS2V5KSkKICAgICAgICB7CiAgICAgICAgICAgIGhtYWMuVHJhbnNmb3JtQmxvY2soaG1hY0RhdGEsIDAsIGhtYWNEYXRhLkxlbmd0aCwgbnVsbCwgMCk7CiAgICAgICAgICAgIGhtYWMuVHJhbnNmb3JtRmluYWxCbG9jayhwYWdlTm8sIDAsIHBhZ2VOby5MZW5ndGgpOwogICAgICAgICAgICByZXR1cm4gRml4ZWRUaW1lRXF1YWxzKGhtYWMuSGFzaCwgZXhwZWN0ZWQpOwogICAgICAgIH0KICAgIH0KCiAgICBzdGF0aWMgYnl0ZVtdIFBia2RmMlNoYTUxMihieXRlW10gcGFzc3dvcmQsIGJ5dGVbXSBzYWx0LCBpbnQgaXRlcmF0aW9ucywgaW50IGRrTGVuKQogICAgewogICAgICAgIGludCBoYXNoTGVuID0gNjQ7CiAgICAgICAgaW50IGJsb2NrcyA9IChpbnQpTWF0aC5DZWlsaW5nKChkb3VibGUpZGtMZW4gLyBoYXNoTGVuKTsKICAgICAgICBieXRlW10gb3V0cHV0ID0gbmV3IGJ5dGVbYmxvY2tzICogaGFzaExlbl07CiAgICAgICAgaW50IG9mZnNldCA9IDA7CiAgICAgICAgZm9yIChpbnQgYmxvY2sgPSAxOyBibG9jayA8PSBibG9ja3M7IGJsb2NrKyspCiAgICAgICAgewogICAgICAgICAgICBieXRlW10gaW50QmxvY2sgPSBuZXcgYnl0ZVtdIHsKICAgICAgICAgICAgICAgIChieXRlKSgoYmxvY2sgPj4gMjQpICYgMHhmZiksCiAgICAgICAgICAgICAgICAoYnl0ZSkoKGJsb2NrID4+IDE2KSAmIDB4ZmYpLAogICAgICAgICAgICAgICAgKGJ5dGUpKChibG9jayA+PiA4KSAmIDB4ZmYpLAogICAgICAgICAgICAgICAgKGJ5dGUpKGJsb2NrICYgMHhmZikKICAgICAgICAgICAgfTsKICAgICAgICAgICAgYnl0ZVtdIHU7CiAgICAgICAgICAgIHVzaW5nIChITUFDU0hBNTEyIGhtYWMgPSBuZXcgSE1BQ1NIQTUxMihwYXNzd29yZCkpCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIHUgPSBobWFjLkNvbXB1dGVIYXNoKENvbWJpbmUoc2FsdCwgaW50QmxvY2spKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBieXRlW10gdCA9IChieXRlW10pdS5DbG9uZSgpOwogICAgICAgICAgICBmb3IgKGludCBpID0gMTsgaSA8IGl0ZXJhdGlvbnM7IGkrKykKICAgICAgICAgICAgewogICAgICAgICAgICAgICAgdXNpbmcgKEhNQUNTSEE1MTIgaG1hYyA9IG5ldyBITUFDU0hBNTEyKHBhc3N3b3JkKSkKICAgICAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgICAgICB1ID0gaG1hYy5Db21wdXRlSGFzaCh1KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIGZvciAoaW50IGogPSAwOyBqIDwgaGFzaExlbjsgaisrKSB0W2pdIF49IHVbal07CiAgICAgICAgICAgIH0KICAgICAgICAgICAgQnVmZmVyLkJsb2NrQ29weSh0LCAwLCBvdXRwdXQsIG9mZnNldCwgaGFzaExlbik7CiAgICAgICAgICAgIG9mZnNldCArPSBoYXNoTGVuOwogICAgICAgIH0KICAgICAgICByZXR1cm4gU2xpY2Uob3V0cHV0LCAwLCBka0xlbik7CiAgICB9CgogICAgc3RhdGljIHZvaWQgRGVjcnlwdERhdGFiYXNlKHN0cmluZyBkYlBhdGgsIHN0cmluZyBvdXRwdXRQYXRoLCBzdHJpbmcga2V5SGV4KQogICAgewogICAgICAgIGJ5dGVbXSBlbmNLZXkgPSBIZXhUb0J5dGVzKGtleUhleCk7CiAgICAgICAgYnl0ZVtdIHBhZ2UxID0gUmVhZEZpcnN0UGFnZShkYlBhdGgpOwogICAgICAgIGlmICghVmVyaWZ5RW5jS2V5KGVuY0tleSwgcGFnZTEpKSB0aHJvdyBuZXcgSW52YWxpZE9wZXJhdGlvbkV4Y2VwdGlvbigiSE1BQyB2ZXJpZmljYXRpb24gZmFpbGVkIik7CiAgICAgICAgc3RyaW5nIGRpcmVjdG9yeSA9IFBhdGguR2V0RGlyZWN0b3J5TmFtZShvdXRwdXRQYXRoKTsKICAgICAgICBpZiAoIVN0cmluZy5Jc051bGxPckVtcHR5KGRpcmVjdG9yeSkpIERpcmVjdG9yeS5DcmVhdGVEaXJlY3RvcnkoZGlyZWN0b3J5KTsKICAgICAgICB1c2luZyAoRmlsZVN0cmVhbSBpbnB1dCA9IEZpbGUuT3BlblJlYWQoZGJQYXRoKSkKICAgICAgICB1c2luZyAoRmlsZVN0cmVhbSBvdXRwdXQgPSBGaWxlLkNyZWF0ZShvdXRwdXRQYXRoKSkKICAgICAgICB7CiAgICAgICAgICAgIGludCBwYWdlTm8gPSAxOwogICAgICAgICAgICBieXRlW10gcGFnZSA9IG5ldyBieXRlW1BhZ2VTaXplXTsKICAgICAgICAgICAgd2hpbGUgKHRydWUpCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGludCByZWFkID0gUmVhZEZ1bGxQYWdlKGlucHV0LCBwYWdlKTsKICAgICAgICAgICAgICAgIGlmIChyZWFkID09IDApIGJyZWFrOwogICAgICAgICAgICAgICAgaWYgKHJlYWQgPCBQYWdlU2l6ZSkgYnJlYWs7CiAgICAgICAgICAgICAgICBieXRlW10gcGxhaW4gPSBEZWNyeXB0UGFnZShlbmNLZXksIHBhZ2UsIHBhZ2VObyk7CiAgICAgICAgICAgICAgICBvdXRwdXQuV3JpdGUocGxhaW4sIDAsIHBsYWluLkxlbmd0aCk7CiAgICAgICAgICAgICAgICBwYWdlTm8rKzsKICAgICAgICAgICAgICAgIEFycmF5LkNsZWFyKHBhZ2UsIDAsIHBhZ2UuTGVuZ3RoKTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KCiAgICBzdGF0aWMgaW50IFJlYWRGdWxsUGFnZShGaWxlU3RyZWFtIGlucHV0LCBieXRlW10gcGFnZSkKICAgIHsKICAgICAgICBpbnQgdG90YWwgPSAwOwogICAgICAgIHdoaWxlICh0b3RhbCA8IHBhZ2UuTGVuZ3RoKQogICAgICAgIHsKICAgICAgICAgICAgaW50IHJlYWQgPSBpbnB1dC5SZWFkKHBhZ2UsIHRvdGFsLCBwYWdlLkxlbmd0aCAtIHRvdGFsKTsKICAgICAgICAgICAgaWYgKHJlYWQgPT0gMCkgYnJlYWs7CiAgICAgICAgICAgIHRvdGFsICs9IHJlYWQ7CiAgICAgICAgfQogICAgICAgIHJldHVybiB0b3RhbDsKICAgIH0KCiAgICBzdGF0aWMgYnl0ZVtdIERlY3J5cHRQYWdlKGJ5dGVbXSBrZXksIGJ5dGVbXSBwYWdlLCBpbnQgcGFnZU5vKQogICAgewogICAgICAgIGJ5dGVbXSBpdiA9IFNsaWNlKHBhZ2UsIFBhZ2VTaXplIC0gUmVzZXJ2ZVNpemUsIEl2U2l6ZSk7CiAgICAgICAgaW50IHN0YXJ0ID0gcGFnZU5vID09IDEgPyBTYWx0U2l6ZSA6IDA7CiAgICAgICAgaW50IGxlbmd0aCA9IFBhZ2VTaXplIC0gUmVzZXJ2ZVNpemUgLSBzdGFydDsKICAgICAgICBieXRlW10gY2lwaGVyVGV4dCA9IFNsaWNlKHBhZ2UsIHN0YXJ0LCBsZW5ndGgpOwogICAgICAgIGJ5dGVbXSBkZWNyeXB0ZWQ7CiAgICAgICAgdXNpbmcgKEFlc0NyeXB0b1NlcnZpY2VQcm92aWRlciBhZXMgPSBuZXcgQWVzQ3J5cHRvU2VydmljZVByb3ZpZGVyKCkpCiAgICAgICAgewogICAgICAgICAgICBhZXMuS2V5U2l6ZSA9IDI1NjsKICAgICAgICAgICAgYWVzLkJsb2NrU2l6ZSA9IDEyODsKICAgICAgICAgICAgYWVzLk1vZGUgPSBDaXBoZXJNb2RlLkNCQzsKICAgICAgICAgICAgYWVzLlBhZGRpbmcgPSBQYWRkaW5nTW9kZS5Ob25lOwogICAgICAgICAgICBhZXMuS2V5ID0ga2V5OwogICAgICAgICAgICBhZXMuSVYgPSBpdjsKICAgICAgICAgICAgdXNpbmcgKElDcnlwdG9UcmFuc2Zvcm0gdHJhbnNmb3JtID0gYWVzLkNyZWF0ZURlY3J5cHRvcigpKQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBkZWNyeXB0ZWQgPSB0cmFuc2Zvcm0uVHJhbnNmb3JtRmluYWxCbG9jayhjaXBoZXJUZXh0LCAwLCBjaXBoZXJUZXh0Lkxlbmd0aCk7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgYnl0ZVtdIHBhZ2VPdXQgPSBuZXcgYnl0ZVtQYWdlU2l6ZV07CiAgICAgICAgaWYgKHBhZ2VObyA9PSAxKQogICAgICAgIHsKICAgICAgICAgICAgYnl0ZVtdIGhlYWRlciA9IEVuY29kaW5nLkFTQ0lJLkdldEJ5dGVzKCJTUUxpdGUgZm9ybWF0IDNcMCIpOwogICAgICAgICAgICBCdWZmZXIuQmxvY2tDb3B5KGhlYWRlciwgMCwgcGFnZU91dCwgMCwgaGVhZGVyLkxlbmd0aCk7CiAgICAgICAgICAgIEJ1ZmZlci5CbG9ja0NvcHkoZGVjcnlwdGVkLCAwLCBwYWdlT3V0LCBTYWx0U2l6ZSwgZGVjcnlwdGVkLkxlbmd0aCk7CiAgICAgICAgfQogICAgICAgIGVsc2UKICAgICAgICB7CiAgICAgICAgICAgIEJ1ZmZlci5CbG9ja0NvcHkoZGVjcnlwdGVkLCAwLCBwYWdlT3V0LCAwLCBkZWNyeXB0ZWQuTGVuZ3RoKTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuIHBhZ2VPdXQ7CiAgICB9CgogICAgc3RhdGljIGJ5dGVbXSBDb21iaW5lKGJ5dGVbXSBsZWZ0LCBieXRlW10gcmlnaHQpCiAgICB7CiAgICAgICAgaWYgKGxlZnQgPT0gbnVsbCB8fCBsZWZ0Lkxlbmd0aCA9PSAwKSByZXR1cm4gcmlnaHQ7CiAgICAgICAgaWYgKHJpZ2h0ID09IG51bGwgfHwgcmlnaHQuTGVuZ3RoID09IDApIHJldHVybiBsZWZ0OwogICAgICAgIGJ5dGVbXSBjb21iaW5lZCA9IG5ldyBieXRlW2xlZnQuTGVuZ3RoICsgcmlnaHQuTGVuZ3RoXTsKICAgICAgICBCdWZmZXIuQmxvY2tDb3B5KGxlZnQsIDAsIGNvbWJpbmVkLCAwLCBsZWZ0Lkxlbmd0aCk7CiAgICAgICAgQnVmZmVyLkJsb2NrQ29weShyaWdodCwgMCwgY29tYmluZWQsIGxlZnQuTGVuZ3RoLCByaWdodC5MZW5ndGgpOwogICAgICAgIHJldHVybiBjb21iaW5lZDsKICAgIH0KCiAgICBzdGF0aWMgYnl0ZVtdIExhc3RCeXRlcyhieXRlW10gaW5wdXQsIGludCBjb3VudCkKICAgIHsKICAgICAgICBpZiAoaW5wdXQgPT0gbnVsbCB8fCBpbnB1dC5MZW5ndGggPT0gMCkgcmV0dXJuIG5ldyBieXRlWzBdOwogICAgICAgIGludCBsZW4gPSBNYXRoLk1pbihjb3VudCwgaW5wdXQuTGVuZ3RoKTsKICAgICAgICBieXRlW10gb3V0cHV0ID0gbmV3IGJ5dGVbbGVuXTsKICAgICAgICBCdWZmZXIuQmxvY2tDb3B5KGlucHV0LCBpbnB1dC5MZW5ndGggLSBsZW4sIG91dHB1dCwgMCwgbGVuKTsKICAgICAgICByZXR1cm4gb3V0cHV0OwogICAgfQoKICAgIHN0YXRpYyBieXRlW10gU2xpY2UoYnl0ZVtdIGlucHV0LCBpbnQgc3RhcnQsIGludCBsZW5ndGgpCiAgICB7CiAgICAgICAgYnl0ZVtdIG91dHB1dCA9IG5ldyBieXRlW2xlbmd0aF07CiAgICAgICAgQnVmZmVyLkJsb2NrQ29weShpbnB1dCwgc3RhcnQsIG91dHB1dCwgMCwgbGVuZ3RoKTsKICAgICAgICByZXR1cm4gb3V0cHV0OwogICAgfQoKICAgIHN0YXRpYyBib29sIEZpeGVkVGltZUVxdWFscyhieXRlW10gbGVmdCwgYnl0ZVtdIHJpZ2h0KQogICAgewogICAgICAgIGlmIChsZWZ0ID09IG51bGwgfHwgcmlnaHQgPT0gbnVsbCB8fCBsZWZ0Lkxlbmd0aCAhPSByaWdodC5MZW5ndGgpIHJldHVybiBmYWxzZTsKICAgICAgICBpbnQgZGlmZiA9IDA7CiAgICAgICAgZm9yIChpbnQgaSA9IDA7IGkgPCBsZWZ0Lkxlbmd0aDsgaSsrKSBkaWZmIHw9IGxlZnRbaV0gXiByaWdodFtpXTsKICAgICAgICByZXR1cm4gZGlmZiA9PSAwOwogICAgfQoKICAgIHN0YXRpYyBieXRlW10gSGV4VG9CeXRlcyhzdHJpbmcgaGV4KQogICAgewogICAgICAgIGJ5dGVbXSBieXRlcyA9IG5ldyBieXRlW2hleC5MZW5ndGggLyAyXTsKICAgICAgICBmb3IgKGludCBpID0gMDsgaSA8IGJ5dGVzLkxlbmd0aDsgaSsrKQogICAgICAgIHsKICAgICAgICAgICAgYnl0ZXNbaV0gPSBDb252ZXJ0LlRvQnl0ZShoZXguU3Vic3RyaW5nKGkgKiAyLCAyKSwgMTYpOwogICAgICAgIH0KICAgICAgICByZXR1cm4gYnl0ZXM7CiAgICB9CgogICAgc3RhdGljIHN0cmluZyBUb0hleChieXRlW10gYnl0ZXMsIGludCBzdGFydCwgaW50IGxlbmd0aCkKICAgIHsKICAgICAgICBjaGFyW10gYyA9IG5ldyBjaGFyW2xlbmd0aCAqIDJdOwogICAgICAgIGludCBiID0gMDsKICAgICAgICBmb3IgKGludCBpID0gc3RhcnQ7IGkgPCBzdGFydCArIGxlbmd0aDsgaSsrKQogICAgICAgIHsKICAgICAgICAgICAgYnl0ZSB2ID0gYnl0ZXNbaV07CiAgICAgICAgICAgIGNbYisrXSA9IEdldEhleFZhbHVlKHYgLyAxNik7CiAgICAgICAgICAgIGNbYisrXSA9IEdldEhleFZhbHVlKHYgJSAxNik7CiAgICAgICAgfQogICAgICAgIHJldHVybiBuZXcgc3RyaW5nKGMpOwogICAgfQoKICAgIHN0YXRpYyBjaGFyIEdldEhleFZhbHVlKGludCB2YWx1ZSkKICAgIHsKICAgICAgICByZXR1cm4gKGNoYXIpKHZhbHVlIDwgMTAgPyB2YWx1ZSArICcwJyA6IHZhbHVlIC0gMTAgKyAnYScpOwogICAgfQp9'))
	  try {
	    Add-Type -TypeDefinition $source -Language CSharp
	    return $true
	  } catch {
	    Set-Diagnostic 'dbError' $_.Exception.Message
	    Add-DiagnosticWarning "微信数据库解密器初始化失败：$($_.Exception.Message)"
	    return $false
	  }
	}

	function Test-SqlitePlainDatabase([string]$dbPath) {
	  try {
	    if ([string]::IsNullOrWhiteSpace($dbPath) -or -not (Test-Path -LiteralPath $dbPath)) { return $false }
	    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
	    $stream = [System.IO.File]::Open($dbPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
	    try {
	      $bytes = New-Object byte[] 16
	      $read = $stream.Read($bytes, 0, 16)
	    } finally {
	      $stream.Dispose()
	    }
	    if ($bytes.Length -lt 16) { return $false }
	    if ($read -lt 16) { return $false }
	    $expected = [System.Text.Encoding]::ASCII.GetBytes('SQLite format 3')
	    for ($i = 0; $i -lt $expected.Length; $i++) {
	      if ($bytes[$i] -ne $expected[$i]) { return $false }
	    }
	    return $bytes[15] -eq 0
	  } catch {
	    return $false
	  }
	}

	function Copy-WeChatDbSharedRead([string]$dbPath) {
	  if ([string]::IsNullOrWhiteSpace($dbPath) -or -not (Test-Path -LiteralPath $dbPath)) { return $dbPath }
	  $target = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-content-wechat-contact-shared-" + [guid]::NewGuid().ToString('N') + [System.IO.Path]::GetExtension($dbPath))
	  try {
	    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
	    $input = [System.IO.File]::Open($dbPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
	    try {
	      $output = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
	      try {
	        $input.CopyTo($output)
	      } finally {
	        $output.Dispose()
	      }
	    } finally {
	      $input.Dispose()
	    }
	    Add-DiagnosticListItem 'dbSharedReadSnapshotPaths' $target 20
	    return $target
	  } catch {
	    Add-DiagnosticWarning "微信 contact.db 共享读取快照失败：$($_.Exception.Message)"
	    return $dbPath
	  }
	}

	function Get-StableTempDbPath([string]$dbPath) {
	  $sha1 = [System.Security.Cryptography.SHA1]::Create()
	  try {
	    $raw = [System.Text.Encoding]::UTF8.GetBytes($dbPath)
	    $hash = -join ($sha1.ComputeHash($raw) | ForEach-Object { $_.ToString('x2') })
	    $root = Join-Path ([System.IO.Path]::GetTempPath()) 'ai-content-wechat-contact-db'
	    if (-not (Test-Path -LiteralPath $root)) {
	      New-Item -ItemType Directory -Force -Path $root | Out-Null
	    }
	    return (Join-Path $root ("contact-$hash.db"))
	  } finally {
	    $sha1.Dispose()
	  }
	}

	function Try-DecryptWeChatContactDbs([string[]]$dbPaths) {
	  $paths = New-Object System.Collections.Generic.List[string]
	  foreach ($dbPath in $dbPaths) {
	    if (Test-SqlitePlainDatabase $dbPath) {
	      Add-UniquePath $paths $dbPath $true
	    }
	  }
	  if (-not (Ensure-WeChatDbDecryptor)) { return @($paths) }
	  foreach ($dbPath in $dbPaths) {
	    if (Test-SqlitePlainDatabase $dbPath) { continue }
	    $decryptInputPath = $dbPath
	    try {
	      $decryptInputPath = Copy-WeChatDbSharedRead $dbPath
	      $outPath = Get-StableTempDbPath $dbPath
	      $key = [KaypalWechatDbDecryptor]::DecryptWithMemoryKey($decryptInputPath, $outPath)
	      if (-not [string]::IsNullOrWhiteSpace($key) -and (Test-SqlitePlainDatabase $outPath)) {
	        try {
	          $outFull = [System.IO.Path]::GetFullPath($outPath)
	          $script:KaypalDecryptedDbSourceMap[$outFull] = $dbPath
	        } catch {}
	        Add-UniquePath $paths $outPath $true
	      }
	    } catch {
	      Set-Diagnostic 'dbError' $_.Exception.Message
	      Add-DiagnosticWarning "微信加密 contact.db 解密失败：$($_.Exception.Message)"
	    } finally {
	      if ($decryptInputPath -ne $dbPath -and (Test-Path -LiteralPath $decryptInputPath)) {
	        Remove-Item -LiteralPath $decryptInputPath -Force -ErrorAction SilentlyContinue
	      }
	    }
	  }
	  return @($paths)
	}

	function Resolve-OriginalWeChatDbPath([string]$dbPath) {
	  try {
	    $full = [System.IO.Path]::GetFullPath($dbPath)
	    if ($script:KaypalDecryptedDbSourceMap.ContainsKey($full)) {
	      return [string]$script:KaypalDecryptedDbSourceMap[$full]
	    }
	  } catch {}
	  return $dbPath
	}

	function Convert-ContactListToArray($items) {
	  $result = @()
	  if ($null -eq $items) { return @() }
	  foreach ($item in $items) {
	    if ($null -ne $item) {
	      $result += $item
	    }
	  }
	  return @($result)
	}

	function New-ContactBatch($items, [string]$source = '', [string]$errorText = '') {
	  return @{
	    Items = @(Convert-ContactListToArray $items)
	    Source = $source
	    Error = $errorText
	  }
	}

	function Try-CollectContactsBySqliteCli([string[]]$dbPaths, [string]$syncMode) {
	  $sqlitePath = Get-SqliteCliPath
	  $items = New-Object System.Collections.Generic.List[object]
	  if ([string]::IsNullOrWhiteSpace($sqlitePath)) {
	    Add-DiagnosticWarning '未找到 sqlite3 命令，已跳过明文 contact.db 读取。'
	    return (New-ContactBatch $items '' 'sqlite3 not found')
	  }
	  Set-Diagnostic 'sqlitePath' $sqlitePath
	  $limit = if ($syncMode -eq 'all') { 50000 } else { 300 }
	  $order = if ($syncMode -eq 'all') { '' } else { ' ORDER BY RANDOM()' }
	  $systemContactIds = "'fmessage','qmessage','tmessage','weixin','filehelper','newsapp','qqmail','floatbottle','lbsapp','medianote','qqsync','weibo','masssendapp','feedsapp','voip','officialaccounts','notification_messages','notifymessage','mphelper'"
	  $queries = @(
	    "SELECT replace(replace(replace(COALESCE(user_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nick_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM user_info WHERE user_name IS NOT NULL AND user_name NOT LIKE '%@chatroom' AND user_name NOT LIKE 'gh_%'$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nick_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nick_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nickname, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(UserName, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(NickName, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(Remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(Alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%' AND lower(UserName) NOT IN ($systemContactIds) AND COALESCE(DeleteFlag, 0) = 0 AND (COALESCE(Flag, 0) & 1) != 0 AND COALESCE(VerifyFlag, 0) = 0 AND COALESCE(LocalType, 1) = 1$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nick_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nick_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nickname, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(UserName, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(NickName, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(Remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(Alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%' AND lower(UserName) NOT IN ($systemContactIds) AND COALESCE(DeleteFlag, 0) = 0 AND (COALESCE(Flag, 0) & 1) != 0 AND COALESCE(VerifyFlag, 0) = 0$order LIMIT $limit;"
	  )
	  foreach ($dbPath in $dbPaths) {
	    $originDbPath = Resolve-OriginalWeChatDbPath $dbPath
	    $candidateInfo = Get-WeChatDbCandidateInfo $originDbPath
	    foreach ($query in $queries) {
	      $result = Invoke-SqliteRows $sqlitePath $dbPath $query
	      if ([int]$result.Code -ne 0) {
	        $errorText = (($result.Output | Select-Object -First 2) -join ' ')
	        if (-not [string]::IsNullOrWhiteSpace($errorText)) {
	          Set-Diagnostic 'dbError' $errorText
	        }
	        continue
	      }
	      foreach ($line in $result.Output) {
	        $text = [string]$line
	        if ([string]::IsNullOrWhiteSpace($text)) { continue }
	        $parts = @($text -split ([string][char]9), 4)
	        Add-DbContactItem $items $parts[0] $parts[1] $parts[2] $parts[3]
	      }
	      if ($items.Count -gt 0) {
	        Set-Diagnostic 'dbContactCount' ([int]$items.Count)
	        Set-Diagnostic 'selectedDbPath' $originDbPath
	        Set-Diagnostic 'selectedDbAccountFolder' ([string]$candidateInfo.AccountFolder)
	        Set-Diagnostic 'selectedDbBaseWxid' ([string]$candidateInfo.BaseWxid)
	        Set-Diagnostic 'selectedDbActiveMtime' ([string]$candidateInfo.ActiveTicks)
	        Set-Diagnostic 'selectedDbScore' ([int]$candidateInfo.Score)
	        return (New-ContactBatch $items)
	      }
	    }
	  }
	  return (New-ContactBatch $items '' ([string]$script:KaypalContactSyncDiagnostics['dbError']))
	}

	function Find-JsonPayloadLine([string]$text) {
	  if ([string]::IsNullOrWhiteSpace($text)) { return '' }
	  $lines = @($text -split '\r?\n')
	  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
	    $line = ([string]$lines[$i]).Trim()
	    if ($line.StartsWith('{') -and $line.EndsWith('}')) { return $line }
	  }
	  return ''
	}

	function Find-ContactDbPathsFromHelperOutput([string]$text) {
	  $paths = New-Object System.Collections.Generic.List[string]
	  if ([string]::IsNullOrWhiteSpace($text)) { return @($paths) }
	  $matches = [regex]::Matches($text, '[A-Za-z]:\\[^\r\n"''<>|]+')
	  foreach ($match in $matches) {
	    $candidate = ([string]$match.Value).Trim()
	    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
	    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
	      if ($candidate -match '(?i)(contact|micromsg).*\.db$') {
	        Add-UniquePath $paths $candidate $true
	      }
	      continue
	    }
	    if (Test-Path -LiteralPath $candidate -PathType Container) {
	      foreach ($path in Find-FilesLimited $candidate @('contact.db', 'Contact.db', 'MicroMsg.db') 6 40) {
	        Add-UniquePath $paths $path $true
	      }
	    }
	  }
	  return @($paths)
	}

	function Try-CollectContactsByDbHelper([string]$syncMode) {
	  $helper = [string]$env:AI_CONTENT_WECHAT_DB_HELPER
	  $items = New-Object System.Collections.Generic.List[object]
	  if ([string]::IsNullOrWhiteSpace($helper) -or -not (Test-Path -LiteralPath $helper)) {
	    return (New-ContactBatch $items '' 'helper not configured')
	  }
	  Set-Diagnostic 'dbHelper' $helper
	  try {
	    $helperName = [System.IO.Path]::GetFileName($helper)
	    $helperArgs = @('--mode', $syncMode)
	    if ($helperName -match '(?i)wechat-dump-rs') {
	      $helperArgs = @('-a')
	    }
	    $output = @(& $helper @helperArgs 2>&1) -join [Environment]::NewLine
	    $jsonLine = Find-JsonPayloadLine $output
	      if ($jsonLine) {
	        $parsed = $jsonLine | ConvertFrom-Json
	        try {
          if ($parsed.currentWechatId) { Set-Diagnostic 'selectedDbAccountFolder' ([string]$parsed.currentWechatId) }
          if ($parsed.diagnostics.selectedDbAccountFolder) { Set-Diagnostic 'selectedDbAccountFolder' ([string]$parsed.diagnostics.selectedDbAccountFolder) }
          if ($parsed.diagnostics.selectedDbBaseWxid) { Set-Diagnostic 'selectedDbBaseWxid' ([string]$parsed.diagnostics.selectedDbBaseWxid) }
          if ($parsed.diagnostics.selectedDbPath) { Set-Diagnostic 'selectedDbPath' ([string]$parsed.diagnostics.selectedDbPath) }
          if ($parsed.screenshotPath) { Set-Diagnostic 'screenshotPath' ([string]$parsed.screenshotPath) }
          if ($parsed.diagnostics.screenshotPath) { Set-Diagnostic 'screenshotPath' ([string]$parsed.diagnostics.screenshotPath) }
        } catch {}
	        $rawItems = @()
	      if ($parsed.items) { $rawItems = @($parsed.items) }
	      elseif ($parsed.contacts) { $rawItems = @($parsed.contacts) }
	      foreach ($raw in $rawItems) {
	        if ($raw -is [string]) {
	          Add-DbContactItem $items $raw $raw '' ''
	        } else {
	          Add-DbContactItem $items ([string]$raw.wxid) ([string]$raw.nickname) ([string]$raw.remark) ([string]$raw.alias)
	        }
	      }
	      Set-Diagnostic 'dbContactCount' ([int]$items.Count)
	      return (New-ContactBatch $items)
	    }
	    $helperDbPaths = @(Find-ContactDbPathsFromHelperOutput $output)
	    if ($helperDbPaths.Count -gt 0) {
	      $sqliteBatch = Try-CollectContactsBySqliteCli $helperDbPaths $syncMode
	      if ($sqliteBatch['Items'].Count -gt 0) {
	        return (New-ContactBatch $sqliteBatch['Items'])
	      }
	    }
	    Set-Diagnostic 'dbError' 'DB helper 没有返回联系人 JSON，也没有识别到可读 contact.db 输出目录。'
	    return (New-ContactBatch $items '' 'helper no contacts')
	  } catch {
	    Set-Diagnostic 'dbError' $_.Exception.Message
	    Add-DiagnosticWarning "DB helper 执行失败：$($_.Exception.Message)"
	    return (New-ContactBatch $items '' $_.Exception.Message)
	  }
	}

	function Try-CollectContactsByDatabase([string]$syncMode) {
	  Add-AttemptedSource 'windows-db'
	  Set-Diagnostic 'stage' 'db-sync'
	  $helperBatch = Try-CollectContactsByDbHelper $syncMode
	  if ($helperBatch['Items'].Count -gt 0) {
	    return (New-ContactBatch $helperBatch['Items'] 'windows-wechat-db-helper')
	  }
	  $dbPaths = @(Find-WeChatContactDbCandidates)
	  if ($dbPaths.Count -eq 0) {
	    Set-Diagnostic 'dbError' '未找到微信 contact.db/MicroMsg.db。'
	    Add-DiagnosticWarning '未找到微信 contact.db/MicroMsg.db，已退回 UIA/OCR。'
	    return (New-ContactBatch @() 'windows-wechat-db' 'db not found')
	  }
	  $sqliteBatch = Try-CollectContactsBySqliteCli $dbPaths $syncMode
	  if ($sqliteBatch['Items'].Count -gt 0) {
	    return (New-ContactBatch $sqliteBatch['Items'] 'windows-wechat-db')
	  }
	  $decryptedDbPaths = @(Try-DecryptWeChatContactDbs $dbPaths)
	  if ($decryptedDbPaths.Count -gt 0) {
	    $decryptedBatch = Try-CollectContactsBySqliteCli $decryptedDbPaths $syncMode
	    if ($decryptedBatch['Items'].Count -gt 0) {
	      return (New-ContactBatch $decryptedBatch['Items'] 'windows-wechat-db-decrypted')
	    }
	    if ($decryptedBatch['Error']) {
	      Set-Diagnostic 'dbError' $decryptedBatch['Error']
	    }
	  }
	  if ($sqliteBatch['Error']) {
	    Add-DiagnosticWarning "数据库通道未读到联系人：$($sqliteBatch['Error'])"
	  }
	  return (New-ContactBatch @() 'windows-wechat-db' $sqliteBatch['Error'])
	}

	$syncMode = 'random'
	if ($env:AI_CONTENT_WECHAT_CONTACT_SYNC_MODE -eq 'all') {
	  $syncMode = 'all'
	}
	$dbBatch = Try-CollectContactsByDatabase $syncMode
	if ($dbBatch['Items'].Count -gt 0) {
	  Set-Diagnostic 'stage' 'completed-db'
	  Set-Diagnostic 'source' $dbBatch['Source']
	  Emit-Json @{
	    ok = $true
	    source = $dbBatch['Source']
	    mode = $syncMode
	    items = @($dbBatch['Items'])
	    contacts = @($dbBatch['Items'])
	    count = $dbBatch['Items'].Count
	    diagnostics = (Get-Diagnostics)
	  }
	}

	if ($env:AI_CONTENT_WECHAT_CONTACT_DB_ONLY -match '^(1|true|yes)$') {
	  Set-Diagnostic 'stage' 'db-sync-blocked'
	  Set-Diagnostic 'failureLayer' 'db-helper'
	  $dbOnlyReason = '数据库主链路没有读到联系人，已禁用 UIA/OCR 覆盖通讯录。'
	  if ($dbBatch['Error']) {
	    $dbOnlyReason = "$dbOnlyReason $($dbBatch['Error'])"
	  }
	  Set-Diagnostic 'failureReason' $dbOnlyReason
	  Add-DiagnosticWarning $dbOnlyReason
	  Fail "Windows 微信通讯录数据库同步失败：$dbOnlyReason"
	}

	try {
	  Add-Type -AssemblyName UIAutomationClient
	  Add-Type -AssemblyName UIAutomationTypes
	  Add-Type -AssemblyName System.Windows.Forms
	  Add-Type -AssemblyName System.Drawing
	} catch {
	  Fail "Windows 微信通讯录同步控制器初始化失败：$($_.Exception.Message)"
	}

	$script:KaypalWinRtAvailable = $true
	$script:KaypalWinRtError = ''
	try {
	  Add-Type -AssemblyName System.Runtime.WindowsRuntime
	} catch {
	  $script:KaypalWinRtAvailable = $false
	  $script:KaypalWinRtError = $_.Exception.Message
	}

		try {
		  $kaypalWin32Type = @(
		    'using System;',
		    'using System.Runtime.InteropServices;',
		    'public static class KaypalWin32 {',
		    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
		    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
		    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
		    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);',
		    '  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);',
		    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
		    '}'
		  ) -join [Environment]::NewLine
		  Add-Type -TypeDefinition $kaypalWin32Type
		} catch {
	  Fail "Windows 微信通讯录同步 Win32 控制器初始化失败：$($_.Exception.Message)"
	}

	function Await-WinRt($async, [Type]$resultType) {
	  if (-not $script:KaypalWinRtAvailable) {
	    throw "Windows OCR 运行时不可用：$script:KaypalWinRtError"
	  }
	  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
	    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod
	  })[0]
$asTask = $asTaskGeneric.MakeGenericMethod($resultType)
$task = $asTask.Invoke($null, @($async))
$task.Wait()
if ($task.IsFaulted) {
  throw $task.Exception
	  }
	  return $task.Result
	}

function Click-Point([int]$x, [int]$y) {
[KaypalWin32]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 80
[KaypalWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[KaypalWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 350
}

function Wheel-Down([int]$x, [int]$y) {
[KaypalWin32]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 80
[KaypalWin32]::mouse_event(0x0800, 0, 0, -720, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 500
}

function Test-NonWechatPageText([string]$text) {
if ([string]::IsNullOrWhiteSpace($text)) { return $false }
return $text -match '抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|AI员工TOS|智能运营系统|应用市场|增长获客'
}

function Test-WechatContactPageText([string]$text) {
if ([string]::IsNullOrWhiteSpace($text)) { return $false }
return $text -match '微信|WeChat|Weixin|通讯录|联系人|新的朋友|群聊|标签|公众号|企业微信联系人|搜索'
}

	function Clean-Contact([string]$line) {
	  if ([string]::IsNullOrWhiteSpace($line)) { return '' }
	  $value = ($line -replace '\s+', ' ').Trim()
$value = ($value -replace '^[•·@#\->＞〉›\s]+', '').Trim()
$value = ($value -replace '[《》<>]', '').Trim()
if ($value -match '[\u4e00-\u9fff]') {
  $value = [regex]::Replace($value, '(?<=[\u4e00-\u9fffA-Za-z0-9])\s+(?=[\u4e00-\u9fffA-Za-z0-9])', '')
}
$value = [regex]::Replace($value, '\s*(微信号|wxid|备注|标签)[:：].*$', '', 'IgnoreCase').Trim()
$value = ($value -replace '[.。…⋯]+$', '').Trim()
$compact = ($value -replace '\s+', '')
if (-not $compact) { return '' }
		  if ($compact -match '^(微信|WeChat|Weixin|通讯录|联系人|联 系 人|新的朋友|朋友|群聊|标签|公众号|服务号|企业微信联系人|搜索|聊天|收藏|文件传输助手|朋友圈|视频号|订阅号|服务通知|小程序|更多|全部|添加朋友|新的联系人|我的企业|星标朋友|公星标朋友)$') { return '' }
	  if ($compact -match '星标朋友|我的企业') { return '' }
if ($compact -match '联系人|通讯录|搜索') { return '' }
if ($value -match '^(联系人|通讯录)\s*\d+$') { return '' }
if (Test-NonWechatPageText $value) { return '__CONTAMINATION__' }
	  if ($value -match '微信小店助手|腾讯新闻|东方甄选|订阅号消息|微信团队|服务通知|公众号|服务号|福利小管|时惠叭|甄选|网友|茉莉奶|新闻|A new version of Dock|Upgrade plan|Engine starting') { return '' }
	  if ($compact -match '^[【\[\［].*[】\]\］]') { return '' }
	  if ($value -match '折叠的聊天|@所有人|\[\d+条\]|分钟前|昨天|今天|[0-2]?\d:[0-5]\d|招聘|工作内容|上班时间|微信同步|置顶') { return '' }
if ($value -match '每月|满\d|元|小时|专业|速度|参与|赠|抽|送|工资|电话|地址|直播间|微信安全|[!！。；;]') { return '' }
if ($compact.Length -lt 2 -or $compact.Length -gt 40) { return '' }
if ($compact -match '^[\d:：.。/\\|｜)(（）\[\]{}]+$') { return '' }
	  if ($compact -notmatch '[\u4e00-\u9fffA-Za-z0-9]') { return '' }
	  return $value
	}

	function Add-ContactCandidate($contacts, [string]$candidate) {
	  $clean = Clean-Contact $candidate
	  if ($clean -eq '__CONTAMINATION__') {
		    Fail '当前焦点不是微信通讯录窗口：通讯录读取结果混入抖音/发布中心等非微信页面内容。请把 Windows 微信主窗口切到“通讯录”后重试；本次不会覆盖本地通讯录缓存。'
	  }
	  if ($clean -and -not $contacts.Contains($clean)) {
	    $contacts.Add($clean) | Out-Null
	  }
	}

	function Add-RawCandidate($raw, [string]$candidate) {
	  if (-not [string]::IsNullOrWhiteSpace($candidate)) {
	    $value = ($candidate -replace '\s+', ' ').Trim()
	    if ($value -and -not $raw.Contains($value)) {
	      $raw.Add($value) | Out-Null
	    }
	  }
	}

	function Get-ElementTextCandidates($el) {
	  $values = New-Object System.Collections.Generic.List[string]
	  foreach ($propName in @('Name', 'AutomationId', 'ClassName', 'HelpText', 'ItemStatus', 'ItemType')) {
	    try {
	      $value = [string]$el.Current.$propName
	      if (-not [string]::IsNullOrWhiteSpace($value) -and -not $values.Contains($value)) {
	        $values.Add($value) | Out-Null
	      }
	    } catch {}
	  }
	  try {
	    $legacy = $el.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
	    foreach ($value in @([string]$legacy.Current.Name, [string]$legacy.Current.Value, [string]$legacy.Current.Description)) {
	      if (-not [string]::IsNullOrWhiteSpace($value) -and -not $values.Contains($value)) {
	        $values.Add($value) | Out-Null
	      }
	    }
	  } catch {}
	  try {
	    $valuePattern = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
	    $value = [string]$valuePattern.Current.Value
	    if (-not [string]::IsNullOrWhiteSpace($value) -and -not $values.Contains($value)) {
	      $values.Add($value) | Out-Null
	    }
	  } catch {}
	  try {
	    $textPattern = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
	    $value = [string]$textPattern.DocumentRange.GetText(200)
	    if (-not [string]::IsNullOrWhiteSpace($value) -and -not $values.Contains($value)) {
	      $values.Add($value) | Out-Null
	    }
	  } catch {}
	  return $values
	}

function Get-WeChatWindow {
$candidates = New-Object System.Collections.Generic.List[object]
$processes = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and (
    $_.ProcessName -match 'WeChat|Weixin|WeChatAppEx|微信' -or
    $_.MainWindowTitle -match '微信|WeChat'
  )
}
foreach ($proc in $processes) {
  try {
    $element = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    if ($null -eq $element) { continue }
    $rect = $element.Current.BoundingRectangle
    if (
      ($rect.Width -ge 520 -and $rect.Height -ge 480) -or
      $proc.MainWindowTitle -match '微信|WeChat' -or
      $proc.ProcessName -match 'WeChat|Weixin|微信'
    ) {
      $candidates.Add(@{
        Process = $proc
        Element = $element
        Rect = $rect
        Handle = $proc.MainWindowHandle
        Area = [double]($rect.Width * $rect.Height)
        Title = [string]$proc.MainWindowTitle
      }) | Out-Null
    }
  } catch {
    continue
  }
}
try {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  for ($i = 0; $i -lt $windows.Count; $i++) {
    $element = $windows.Item($i)
    $name = [string]$element.Current.Name
    $pid = [int]$element.Current.ProcessId
    if ($pid -le 0) { continue }
    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if ($null -eq $proc) { continue }
    if ($proc.ProcessName -notmatch 'WeChat|Weixin|WeChatAppEx|微信' -and $name -notmatch '微信|WeChat') { continue }
    $rect = $element.Current.BoundingRectangle
    if (
      ($rect.Width -ge 520 -and $rect.Height -ge 480) -or
      $name -match '微信|WeChat' -or
      $proc.ProcessName -match 'WeChat|Weixin|微信'
    ) {
      $candidates.Add(@{
        Process = $proc
        Element = $element
        Rect = $rect
        Handle = $element.Current.NativeWindowHandle
        Area = [double]($rect.Width * $rect.Height)
        Title = $name
      }) | Out-Null
    }
  }
} catch {}
if ($candidates.Count -eq 0) { return $null }
$best = $candidates |
  Sort-Object @{ Expression = { if ($_.Title -match '微信|WeChat') { 1 } else { 0 } }; Descending = $true },
              @{ Expression = 'Area'; Descending = $true } |
  Select-Object -First 1
$candidatePreview = New-Object System.Collections.Generic.List[string]
foreach ($candidate in $candidates) {
  try {
    $candidateArea = [string]$candidate.Area
    $candidatePreview.Add("$($candidate.Process.ProcessName)/$($candidate.Title)/$candidateArea") | Out-Null
  } catch {}
}
if ($candidatePreview.Count -gt 0) {
  Add-DiagnosticListItem 'rawPreview' ("候选微信窗口：" + ($candidatePreview -join ' | ')) 5
}
return $best
}

function Focus-WeChat($window) {
$handle = [IntPtr]$window.Handle
if ($handle -eq [IntPtr]::Zero -and $window.Process.MainWindowHandle -ne 0) {
  $handle = [IntPtr]$window.Process.MainWindowHandle
}
if ($handle -eq [IntPtr]::Zero) { return }
[KaypalWin32]::ShowWindowAsync($handle, 9) | Out-Null
[KaypalWin32]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 600
try {
  $window['Element'] = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  $window['Rect'] = $window['Element'].Current.BoundingRectangle
  $window['Handle'] = $handle
} catch {}
}

function Get-WindowRectByHandle($window) {
$handle = [IntPtr]$window.Handle
if ($handle -eq [IntPtr]::Zero -and $window.Process.MainWindowHandle -ne 0) {
  $handle = [IntPtr]$window.Process.MainWindowHandle
}
$rect = New-Object KaypalWin32+RECT
if (-not [KaypalWin32]::GetWindowRect($handle, [ref]$rect)) {
  return $null
}
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 300 -or $height -lt 300) {
  return $null
}
return @{
  Left = [int]$rect.Left
  Top = [int]$rect.Top
  Width = [int]$width
  Height = [int]$height
  Right = [int]$rect.Right
  Bottom = [int]$rect.Bottom
}
}

function Capture-EnvironmentDiagnostics($window) {
try {
  Set-Diagnostic 'processName' ([string]$window.Process.ProcessName)
  Set-Diagnostic 'processId' ([int]$window.Process.Id)
  Set-Diagnostic 'windowTitle' ([string]$window.Process.MainWindowTitle)
} catch {}
try {
  $rect = Get-WindowRectByHandle $window
  if ($null -ne $rect) {
    Set-Diagnostic 'windowRect' @{
      left = $rect.Left
      top = $rect.Top
      width = $rect.Width
      height = $rect.Height
    }
  }
} catch {}
try {
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  Set-Diagnostic 'screen' @{ width = [int]$screen.Width; height = [int]$screen.Height }
} catch {}
try {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
  if ($null -ne $os) {
    Set-Diagnostic 'os' "$($os.Caption) $($os.Version)"
  }
} catch {}
try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  Set-Diagnostic 'isCurrentProcessElevated' ([bool]$isAdmin)
  if (-not $isAdmin) {
    Add-DiagnosticWarning '当前同步控制器不是管理员权限；如果微信以管理员权限启动，Windows UIA 可能读不到通讯录。'
  }
} catch {}
}

function Read-OcrLinesFromRegion([int]$x, [int]$y, [int]$width, [int]$height) {
try {
  [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime] | Out-Null
  [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
  [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null

  $safeX = [Math]::Max(0, $x)
  $safeY = [Math]::Max(0, $y)
  $safeWidth = [Math]::Max(120, $width)
  $safeHeight = [Math]::Max(120, $height)
  $bitmap = [System.Drawing.Bitmap]::new($safeWidth, $safeHeight)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($safeX, $safeY, 0, 0, [System.Drawing.Size]::new($safeWidth, $safeHeight))
  $graphics.Dispose()

  $maxOcrDimension = 2200
  try {
    $ocrMax = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
    if ($ocrMax -gt 0) {
      $maxOcrDimension = [Math]::Min($maxOcrDimension, [int]($ocrMax - 20))
    }
  } catch {}
  $scale = 2.0
  $largestSide = [Math]::Max($safeWidth, $safeHeight)
  if (($largestSide * $scale) -gt $maxOcrDimension) {
    $scale = [Math]::Max(1.0, $maxOcrDimension / $largestSide)
  }
  $scaledWidth = [int]([Math]::Max(120, [Math]::Round($safeWidth * $scale)))
  $scaledHeight = [int]([Math]::Max(120, [Math]::Round($safeHeight * $scale)))
  $scaled = [System.Drawing.Bitmap]::new($scaledWidth, $scaledHeight)
  $scaledGraphics = [System.Drawing.Graphics]::FromImage($scaled)
  $scaledGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $scaledGraphics.DrawImage($bitmap, 0, 0, $scaledWidth, $scaledHeight)
  $scaledGraphics.Dispose()
  $bitmap.Dispose()

  $path = Join-Path $env:TEMP ("ai-content-wechat-contacts-" + [Guid]::NewGuid().ToString("N") + ".png")
  $scaled.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $scaled.Dispose()

  $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $softwareBitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  if ($softwareBitmap.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8 -or $softwareBitmap.BitmapAlphaMode -ne [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied) {
    $softwareBitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert(
      $softwareBitmap,
      [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
      [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied
    )
  }
  $language = New-Object Windows.Globalization.Language('zh-Hans')
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
  if ($null -eq $engine) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  if ($null -eq $engine) {
    return @{ Lines = @(); Image = $path; Error = 'Windows OCR 引擎不可用' }
  }
  $ocrResult = Await-WinRt ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in $ocrResult.Lines) {
    $text = [string]$line.Text
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      $lines += $text
    }
  }
  return @{ Lines = $lines; Image = $path; Error = '' }
} catch {
  return @{ Lines = @(); Image = ''; Error = $_.Exception.Message }
}
}

function Collect-ContactsByOcr($window, [int]$pageIndex) {
Add-AttemptedSource 'windows-ocr'
$rect = Get-WindowRectByHandle $window
if ($null -eq $rect) {
  Add-DiagnosticWarning '无法获取微信窗口位置，OCR 截图已跳过。'
  return @{ Contacts = @(); Raw = @(); ScreenshotPath = ''; Error = '无法获取微信窗口位置' }
}
$candidates = @(
  @{ X = $rect.Left + 60; Y = $rect.Top + 72; W = [Math]::Min(300, $rect.Width - 70); H = $rect.Height - 90 },
  @{ X = $rect.Left + 70; Y = $rect.Top + 95; W = [Math]::Min(330, $rect.Width - 90); H = $rect.Height - 125 },
  @{ X = $rect.Left + 95; Y = $rect.Top + 105; W = [Math]::Min(250, $rect.Width - 120); H = $rect.Height - 140 }
)
$best = @{ Contacts = @(); Raw = @(); ScreenshotPath = ''; Error = '' }
foreach ($candidate in $candidates) {
  $candidateX = [int]($candidate['X'])
  $candidateY = [int]($candidate['Y'])
  $candidateW = [int]($candidate['W'])
  $candidateH = [int]($candidate['H'])
  $ocr = Read-OcrLinesFromRegion $candidateX $candidateY $candidateW $candidateH
  if ($ocr.Image) {
    Set-Diagnostic 'screenshotPath' $ocr.Image
  }
  if ($ocr.Error) {
    Add-DiagnosticWarning "OCR 区域 $candidateX,$candidateY,$candidateW,$candidateH 失败：$($ocr.Error)"
  }
  foreach ($line in $ocr.Lines) {
    Add-DiagnosticListItem 'ocrPreview' $line 30
  }
  $ocrText = ($ocr.Lines -join [Environment]::NewLine)
  if (Test-NonWechatPageText $ocrText) {
    Fail '当前焦点不是微信通讯录窗口：OCR 识别到抖音/发布中心/知识库等非微信页面内容。请把 Windows 微信主窗口切到“通讯录”后重试；本次不会覆盖本地通讯录缓存。'
  }
  if ($pageIndex -eq 1 -and $ocr.Lines.Count -gt 0 -and -not (Test-WechatContactPageText $ocrText)) {
    Add-DiagnosticWarning "首页 OCR 区域 $candidateX,$candidateY,$candidateW,$candidateH 未识别到微信通讯录特征，已跳过该区域。"
    continue
  }
  $contacts = New-Object System.Collections.Generic.List[string]
  foreach ($line in $ocr.Lines) {
    foreach ($part in ([string]$line -split '\s{2,}|[|｜]')) {
      $clean = Clean-Contact $part
      if ($clean -eq '__CONTAMINATION__') {
        Fail '当前焦点不是微信通讯录窗口：OCR 识别到非微信页面内容。请把 Windows 微信主窗口切到“通讯录”后重试；本次不会覆盖本地通讯录缓存。'
      }
      if ($clean -and -not $contacts.Contains($clean)) {
        $contacts.Add($clean) | Out-Null
      }
    }
  }
  if ($contacts.Count -gt $best.Contacts.Count) {
    $best = @{ Contacts = @($contacts); Raw = @($ocr.Lines); ScreenshotPath = $ocr.Image; Error = $ocr.Error }
  }
}
Update-MaxDiagnosticNumber 'ocrContactCount' ([int]$best.Contacts.Count)
return $best
}

function Try-ClickContactTabByCoordinate($window) {
$rect = $window.Element.Current.BoundingRectangle
if ($rect.Width -lt 240 -or $rect.Height -lt 320) { return $false }
$x = [int]($rect.Left + 28)
$candidateYs = @(
  [int]($rect.Top + 94),
  [int]($rect.Top + 128),
  [int]($rect.Top + 166),
  [int]($rect.Top + 204)
)
foreach ($y in $candidateYs) {
  Click-Point $x $y
  Start-Sleep -Milliseconds 450
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
  $batch = Collect-Contacts $root
  $rawText = ($batch.Raw -join [Environment]::NewLine)
  if ($batch.Contacts.Count -gt 0 -or $rawText -match '通讯录|联系人|新的朋友|群聊|标签|公众号|企业微信联系人') {
    return $true
  }
}
return $false
}

	function Try-ClickContactTab($root) {
	  $all = $root.FindAll(
	    [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition
)
for ($i = 0; $i -lt $all.Count; $i++) {
  $el = $all.Item($i)
  $name = [string]$el.Current.Name
  if ($name -notmatch '通讯录|联系人') { continue }
  try {
    $invoke = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    Start-Sleep -Milliseconds 700
    return $true
  } catch {}
  try {
    $select = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $select.Select()
    Start-Sleep -Milliseconds 700
    return $true
  } catch {}
}
	  return $false
	}

	function Collect-ContactsFromElements($elements, [int]$maxCount) {
	  Add-AttemptedSource 'windows-uia'
	  $raw = New-Object System.Collections.Generic.List[string]
	  $contacts = New-Object System.Collections.Generic.List[string]
	  $max = [Math]::Min($elements.Count, $maxCount)
	  for ($i = 0; $i -lt $max; $i++) {
	    $el = $elements.Item($i)
	    $texts = Get-ElementTextCandidates $el
	    foreach ($text in $texts) {
	      Add-RawCandidate $raw $text
	      Add-DiagnosticListItem 'rawPreview' $text 30
	      foreach ($part in ([string]$text -split '\r?\n|\s{2,}|[|｜]')) {
	        Add-ContactCandidate $contacts $part
	      }
	    }
	  }
	  Update-MaxDiagnosticNumber 'rawTextCount' ([int]$raw.Count)
	  Update-MaxDiagnosticNumber 'uiaContactCount' ([int]$contacts.Count)
	  return @{ Raw = $raw; Contacts = $contacts }
	}

	function Collect-ContactsByControlView($root) {
	  $all = $root.FindAll(
	    [System.Windows.Automation.TreeScope]::Descendants,
	    [System.Windows.Automation.Condition]::TrueCondition
	  )
	  return Collect-ContactsFromElements $all 2500
	}

	function Collect-ContactsByRawView($root) {
	  $raw = New-Object System.Collections.Generic.List[string]
	  $contacts = New-Object System.Collections.Generic.List[string]
	  try {
	    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
	    $queue = New-Object System.Collections.Queue
	    $queue.Enqueue($root)
	    $visited = 0
	    while ($queue.Count -gt 0 -and $visited -lt 4500) {
	      $el = $queue.Dequeue()
	      $visited += 1
	      $texts = Get-ElementTextCandidates $el
	      foreach ($text in $texts) {
	        Add-RawCandidate $raw $text
	        foreach ($part in ([string]$text -split '\r?\n|\s{2,}|[|｜]')) {
	          Add-ContactCandidate $contacts $part
	        }
	      }
	      try {
	        $child = $walker.GetFirstChild($el)
	        while ($null -ne $child -and $visited + $queue.Count -lt 4500) {
	          $queue.Enqueue($child)
	          $child = $walker.GetNextSibling($child)
	        }
	      } catch {}
	    }
	  } catch {}
	  return @{ Raw = $raw; Contacts = $contacts }
	}

	function Merge-ContactBatches($primary, $secondary) {
	  $raw = New-Object System.Collections.Generic.List[string]
	  $contacts = New-Object System.Collections.Generic.List[string]
	  foreach ($batch in @($primary, $secondary)) {
	    foreach ($item in $batch.Raw) { Add-RawCandidate $raw $item }
	    foreach ($item in $batch.Contacts) {
	      if (-not $contacts.Contains($item)) { $contacts.Add($item) | Out-Null }
	    }
	  }
	  return @{ Raw = $raw; Contacts = $contacts }
	}

	function Collect-Contacts($root) {
	  $control = Collect-ContactsByControlView $root
	  if ($control.Contacts.Count -ge 2) { return $control }
	  $rawView = Collect-ContactsByRawView $root
	  return Merge-ContactBatches $control $rawView
	}

	function Collect-VisibleContacts($root, $window, [int]$pageIndex) {
	  Set-Diagnostic 'stage' "collect-page-$pageIndex-uia"
	  $uia = Collect-Contacts $root
	  $merged = $uia
	  $ocr = @{ Contacts = @(); Raw = @(); ScreenshotPath = ''; Error = '' }
	  $ocrEveryPage = $false
	  if ($env:AI_CONTENT_WECHAT_CONTACT_OCR_EACH_PAGE -match '^(1|true|yes)$') {
	    $ocrEveryPage = $true
	  }
	  $shouldUseOcr = $pageIndex -eq 1 -or $ocrEveryPage
	  if (-not $shouldUseOcr -and $uia.Contacts.Count -lt 2) {
	    Add-DiagnosticWarning "第 $pageIndex 页 UIA 读取不足，已跳过滚动页 OCR，避免误扫非微信页面。需要强制逐页 OCR 时可设置 AI_CONTENT_WECHAT_CONTACT_OCR_EACH_PAGE=1。"
	  }
	  if ($shouldUseOcr) {
	    Set-Diagnostic 'stage' "collect-page-$pageIndex-ocr"
	    $ocr = Collect-ContactsByOcr $window $pageIndex
	    $ocrBatch = @{ Raw = @($ocr.Raw); Contacts = @($ocr.Contacts) }
	    $merged = Merge-ContactBatches $uia $ocrBatch
	  }
	  Update-MaxDiagnosticNumber 'uiaContactCount' ([int]$uia.Contacts.Count)
	  Update-MaxDiagnosticNumber 'ocrContactCount' ([int]$ocr.Contacts.Count)
	  Set-Diagnostic 'pagesScanned' $pageIndex
	  return @{
	    Raw = @($merged.Raw)
	    Contacts = @($merged.Contacts)
	    UiaContacts = @($uia.Contacts)
	    OcrContacts = @($ocr.Contacts)
	    ScreenshotPath = $ocr.ScreenshotPath
	    Error = $ocr.Error
	  }
	}

function Scroll-Contacts($root) {
$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty,
  $true
)
$scrollables = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
for ($i = 0; $i -lt $scrollables.Count; $i++) {
  try {
    $pattern = $scrollables.Item($i).GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
    if ($pattern.Current.VerticallyScrollable) {
      $pattern.Scroll(
        [System.Windows.Automation.ScrollAmount]::NoAmount,
        [System.Windows.Automation.ScrollAmount]::LargeIncrement
      )
      Start-Sleep -Milliseconds 450
      return
    }
  } catch {}
}
try {
  $rect = Get-WindowRectByHandle $window
  if ($null -ne $rect) {
    $x = [int]($rect.Left + [Math]::Min(260, [Math]::Max(120, $rect.Width * 0.22)))
    $y = [int]($rect.Top + [Math]::Max(220, $rect.Height * 0.62))
    Wheel-Down $x $y
    return
  }
} catch {
  Add-DiagnosticWarning "鼠标滚轮翻页失败：$($_.Exception.Message)"
}
[System.Windows.Forms.SendKeys]::SendWait('{PGDN}')
Start-Sleep -Milliseconds 450
}

function Reset-ContactsToTop($root, $window) {
Set-Diagnostic 'stage' 'reset-contact-list-top'
$didReset = $false
try {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty,
    $true
  )
  $scrollables = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  for ($i = 0; $i -lt $scrollables.Count; $i++) {
    try {
      $pattern = $scrollables.Item($i).GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
      if ($pattern.Current.VerticallyScrollable) {
        $pattern.SetScrollPercent(
          [System.Windows.Automation.ScrollPattern]::NoScroll,
          0
        )
        Start-Sleep -Milliseconds 700
        $didReset = $true
        break
      }
    } catch {}
  }
} catch {}
if (-not $didReset) {
  try {
    [System.Windows.Forms.SendKeys]::SendWait('^{HOME}')
    Start-Sleep -Milliseconds 900
    $didReset = $true
  } catch {}
}
if (-not $didReset) {
  Add-DiagnosticWarning '未能确认通讯录列表已回到顶部，将从当前可见位置开始全量扫描。'
}
}

Set-Diagnostic 'stage' 'find-window'
$window = Get-WeChatWindow
if ($null -eq $window) {
Fail '没有找到已登录的 Windows 微信主窗口。请先打开微信桌面版并停留在主窗口。'
}
Set-Diagnostic 'stage' 'focus-window'
Focus-WeChat $window
Capture-EnvironmentDiagnostics $window
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
Set-Diagnostic 'stage' 'open-contact-tab'
Try-ClickContactTab $root | Out-Null
[System.Windows.Forms.SendKeys]::SendWait('^2')
Start-Sleep -Milliseconds 800
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
if ($syncMode -eq 'all') {
Reset-ContactsToTop $root $window
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
}
$first = Collect-VisibleContacts $root $window 1
$rawText = ($first.Raw -join [Environment]::NewLine)
if (Test-NonWechatPageText $rawText) {
	  Fail '当前焦点不是微信通讯录窗口：读取到抖音/发布中心/知识库等非微信页面内容。请把 Windows 微信主窗口切到“通讯录”后重试；本次不会覆盖本地通讯录缓存。'
}
	if ($first.Contacts.Count -eq 0) {
	  Set-Diagnostic 'stage' 'coordinate-contact-tab'
	  Try-ClickContactTabByCoordinate $window | Out-Null
	  [System.Windows.Forms.SendKeys]::SendWait('^2')
	  Start-Sleep -Milliseconds 800
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
if ($syncMode -eq 'all') {
  Reset-ContactsToTop $root $window
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
}
$first = Collect-VisibleContacts $root $window 1
$rawText = ($first.Raw -join [Environment]::NewLine)
}
if ($first.Contacts.Count -eq 0 -and -not (Test-WechatContactPageText $rawText)) {
Fail "没有识别到微信通讯录窗口特征，当前窗口可读文本 $($first.Raw.Count) 条。请确认 Windows 微信桌面版已打开主窗口，再点通讯录同步。"
}

$contacts = New-Object System.Collections.Generic.List[string]
foreach ($item in $first.Contacts) {
if (-not $contacts.Contains($item)) { $contacts.Add($item) | Out-Null }
}
$source = 'windows-wechat-uia'
if ($first.UiaContacts.Count -eq 0 -and $first.OcrContacts.Count -gt 0) {
$source = 'windows-wechat-ocr'
} elseif ($first.OcrContacts.Count -gt 0) {
$source = 'windows-wechat-hybrid'
}
$screenshotPath = ''
if ($first.ScreenshotPath) { $screenshotPath = $first.ScreenshotPath }

$pages = 8
$staleLimit = 2
if ($syncMode -eq 'all') {
$pages = 200
$staleLimit = 5
}
if ($env:AI_CONTENT_WECHAT_CONTACT_SCROLL_PAGES) {
$parsed = 0
if ([int]::TryParse($env:AI_CONTENT_WECHAT_CONTACT_SCROLL_PAGES, [ref]$parsed)) {
  $maxPages = if ($syncMode -eq 'all') { 300 } else { 30 }
  $pages = [Math]::Max(1, [Math]::Min($parsed, $maxPages))
}
}
$stalePages = 0
for ($page = 2; $page -le $pages; $page++) {
Set-Diagnostic 'stage' "scroll-page-$page"
$beforeCount = $contacts.Count
Scroll-Contacts $root
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
$batch = Collect-VisibleContacts $root $window $page
$batchRawText = ($batch.Raw -join [Environment]::NewLine)
if (Test-NonWechatPageText $batchRawText) {
  Fail "滚动到第 $page 页时当前焦点离开微信通讯录窗口，读取到非微信页面内容；已停止并拒绝写入通讯录缓存。请把 Windows 微信主窗口切到“通讯录”后重试。"
}
if ($batch.ScreenshotPath) { $screenshotPath = $batch.ScreenshotPath }
if ($batch.OcrContacts.Count -gt 0 -and $source -eq 'windows-wechat-uia') {
  $source = 'windows-wechat-hybrid'
}
foreach ($item in $batch.Contacts) {
  if (-not $contacts.Contains($item)) { $contacts.Add($item) | Out-Null }
}
if ($contacts.Count -eq $beforeCount) {
  $stalePages += 1
} else {
  $stalePages = 0
}
if ($stalePages -ge $staleLimit) {
  Add-DiagnosticWarning "连续 $staleLimit 页没有新增联系人，已停止滚动采集。"
  break
}
}

if ($contacts.Count -eq 0) {
Fail '没有从 Windows 微信通讯录读取到真实联系人。当前微信版本未向 UIA 暴露通讯录文本，Windows OCR 也未识别到可用联系人；诊断信息已包含窗口、截图和原始识别预览。'
}

Set-Diagnostic 'stage' 'completed'
Set-Diagnostic 'source' $source
Set-Diagnostic 'screenshotPath' $screenshotPath
Emit-Json @{
ok = $true
source = $source
mode = $syncMode
contacts = @($contacts)
count = $contacts.Count
screenshotPath = $screenshotPath
diagnostics = (Get-Diagnostics)
}
`.trim();
}

/** contact 方法簇 */
export const contactMethods = {
  resolveWechatContactAccountId,
  isWechatContactsLegacyAccountlessRuntimeCache,
  isWechatContactCacheAccountMismatch,
  withWechatContactsCacheAccountGuard,
  buildWechatContactsCacheFallbackResult,
  buildWechatContactsBlockedResult,
  normalizeWechatContactsSyncMode,
  upsertWechatContact,
  removeWechatContact,
  clearWechatContacts,
  exportWechatContacts,
  exportWechatContactSyncDiagnostics,
  getWechatChatSessions,
  getWechatChatHistory,
  syncWechatChatHistory,
  getReadiness,
  getRuntimeStatus,
  runRuntimeAction,
  getRuntimeLog,
  getProjectLogRoot,
  getRuntimeStateRoot,
  getMacWechatCommandRoot,
  resolveWechatContactSyncScriptPath,
  resolveWechatChatHistorySyncScriptPath,
  getWechatContactsCachePath,
  getWechatContactsDiagnosticsPath,
  readWechatContactSyncDiagnosticsFile,
  getWechatChatHistoryCachePath,
  readWechatContactsCache,
  writeWechatContactsCache,
  buildWechatContactsResult,
  readWechatChatHistoryCache,
  writeWechatChatHistoryCache,
  buildWindowsWechatChatHistoryFromContacts,
  normalizeWechatChatHistoryCache,
  normalizeWechatChatSession,
  normalizeWechatChatMessage,
  normalizeWechatChatHistorySource,
  normalizeWechatMessageDirection,
  normalizeWechatMessageContentType,
  buildWechatChatSessionsResult,
  buildWechatChatHistoryCacheInfo,
  resolveWechatChatHistoryStatus,
  resolveWechatChatHistoryNextAction,
  withWechatChatHistoryBlocker,
  compareOptionalTime,
  normalizeWechatContactList,
  extractWechatContactCandidateTexts,
  isPollutedWechatContactCandidateBatch,
  isRejectedWechatContact,
  normalizeWechatContact,
  getWechatContactDisplay,
  normalizeWechatContactsSyncDiagnostics,
  isNonWechatContactSyncDiagnostics,
  normalizeJsonRecord,
  normalizeInteractionTaskBillingIdentity,
  buildWechatNativeCommandRunnerReadinessCheck,
  resolveMacWechatCommandRunners,
  buildMacWechatToolReadinessCheck,
  normalizeJsonRecordArray,
  mergeWechatDiagnosticStringArrays,
  mergeWechatContactsSyncDiagnostics,
  isWechatContactVisionFallbackEnabled,
  tryRunWechatContactVisionFallback,
  parseWechatVisionContactsOutput,
  humanizeWechatContactSyncErrorMessage,
  wechatContactSyncLastFailureMessage,
  stringifyWechatDiagnosticMessage,
  optionalDiagnosticText,
  cleanWechatContactSyncUserMessage,
  shouldBlockWechatContactCacheFallback,
  toWechatContactsSyncException,
  runWechatContactSyncScript,
  runWechatWindowsContactSyncScript,
  resolveWechatEnginePath,
  getWechatContactSyncResultCount,
  getWechatContactSyncLowConfidenceReason,
  withWechatContactFallbackDiagnostics,
  tryRunWechatNativeContactSync,
  tryRunWechatEngineContactSync,
  probeWechatNativeContactRuntime,
  runWechatEngineContactSyncScript,
  resolveWechatDbHelperPath,
  resolveWechatSqliteCliPath,
  writeWechatContactSyncDiagnostics,
  buildWechatContactFailureRecord,
  buildWechatContactDiagnosticEvidencePackage,
  validateWechatContactDiagnosticEvidencePackage,
  inferWechatContactFailureNextAction,
  summarizeWechatContactFailureRaw,
  formatWechatContactsDiagnosticsForError,
  getWechatWindowsContactSyncScript,
};
