// local-engine 杂项/导出/运行时路径簇（god class 拆解收官簇——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；跨块依赖走 MiscHost 接口：
// configService 字段、getProjectLogRoot（service）、task-evidence 簇方法。
// 本簇为 god class 拆解的最后一簇，拆分后 service 仅剩 constructor 与宿主字段。

import { constants, existsSync, mkdirSync } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { ConfigService } from '@nestjs/config';
import {
  buildBatchSummary,
  formatConfirmationIndexForCsv,
  getProjectRoot,
  normalizeBatchTargetStatus,
} from './local-engine.utils';
import {
  resolveProjectDataPath,
  resolveRuntimeStateRoot,
} from '../../common/project-paths';
import type { TaskEvidenceIndex } from './local-engine.task-evidence.mixin';
import type {
  InteractionSendMode,
  InteractionTask,
  LocalEngineFileAccessItem,
} from './local-engine.types';

/** 杂项/导出/运行时路径簇的 host 接口：簇方法访问的 service 成员 */
export interface MiscHost {
  configService: ConfigService;
  getProjectLogRoot(): string;
  formatEvidenceIndexForCsv(
    items: Array<{
      id: string;
      eventId: string;
      type: string;
      label: string;
      level: string;
      stageKey?: string;
      createdAt: string;
      artifactUrl?: string;
      valuePreview?: string;
    }>,
  ): Array<Record<string, string>>;
  buildTaskEvidenceIndex(task: InteractionTask): TaskEvidenceIndex;
  buildTaskEvidenceIntegrity(
    task: InteractionTask,
    evidenceIndex?: TaskEvidenceIndex,
  ): {
    status: 'OK' | 'FAILED';
    missing: string[];
    required: string[];
    checkedAt: string;
  };
}

export function toRecordExportRows(this: MiscHost, task: InteractionTask) {
  const evidenceIndex = this.buildTaskEvidenceIndex(task);
  const integrity = this.buildTaskEvidenceIntegrity(task, evidenceIndex);
  const evidenceCount = String(
    task.events.filter((event) => Boolean(event.evidence)).length,
  );
  const riskAudit = this.formatEvidenceIndexForCsv(evidenceIndex.riskAudits);
  const confirmations = formatConfirmationIndexForCsv(
    evidenceIndex.confirmations,
  );
  const stageLogs = this.formatEvidenceIndexForCsv(evidenceIndex.stageLogs);
  const browserEvidence = this.formatEvidenceIndexForCsv(evidenceIndex.browser);
  const desktopEvidence = this.formatEvidenceIndexForCsv(evidenceIndex.desktop);
  const textEvidence = this.formatEvidenceIndexForCsv(evidenceIndex.text);
  const failureEvidence = this.formatEvidenceIndexForCsv(
    evidenceIndex.failureReasons,
  );
  const base = [
    task.id,
    task.statusLabel,
    task.typeLabel,
    task.platformName || '',
    task.accountName,
  ];

  if (task.batchTargets?.length) {
    return task.batchTargets.map((target, index) => [
      ...base,
      String(index + 1),
      target.targetName,
      target.status,
      target.failureReason || task.failureReason || '',
      task.diagnostics?.summary || '',
      target.nextAction || task.nextAction || '',
      task.riskLevel || '',
      riskAudit,
      confirmations,
      stageLogs,
      browserEvidence,
      desktopEvidence,
      textEvidence,
      failureEvidence,
      task.resultSummary?.headline || '',
      target.sourceText,
      target.replyText,
      evidenceCount,
      (target.evidenceEventIds || []).join('|'),
      integrity.status === 'OK'
        ? 'OK'
        : `FAILED: ${integrity.missing.join('；')}`,
      task.createdAt,
      target.updatedAt || task.updatedAt,
      task.completedAt || '',
    ]);
  }

  return [
    [
      ...base,
      '',
      task.targetName,
      task.status,
      task.failureReason || '',
      task.diagnostics?.summary || '',
      task.nextAction || '',
      task.riskLevel || '',
      riskAudit,
      confirmations,
      stageLogs,
      browserEvidence,
      desktopEvidence,
      textEvidence,
      failureEvidence,
      task.resultSummary?.headline || '',
      task.sourceText,
      task.replyText,
      evidenceCount,
      task.events
        .filter((event) => Boolean(event.evidence))
        .map((event) => event.id)
        .join('|'),
      integrity.status === 'OK'
        ? 'OK'
        : `FAILED: ${integrity.missing.join('；')}`,
      task.createdAt,
      task.updatedAt,
      task.completedAt || '',
    ],
  ];
}

export function formatEvidenceIndexForCsv(
  this: MiscHost,
  items: Array<{
    eventId?: string;
    id?: string;
    type: string;
    label: string;
    stageKey?: string;
    createdAt?: string;
  }>,
) {
  return items
    .map(
      (item) =>
        `${item.stageKey || item.type}:${item.label}#${item.eventId || item.id || 'n/a'}`,
    )
    .join('；');
}

export function normalizeWindowTitles(
  this: MiscHost,
  desktop: {
    windowTitles?: string[];
    currentWindowTitle?: string | null;
    windowTitle?: string | null;
  },
) {
  const values = [
    ...(Array.isArray(desktop.windowTitles) ? desktop.windowTitles : []),
    desktop.currentWindowTitle,
    desktop.windowTitle,
  ];

  return [
    ...new Set(
      values.map((value) => value?.trim()).filter(Boolean) as string[],
    ),
  ];
}

export function resolveLocalRuntimePaths(this: MiscHost) {
  const root = process.env.KAYPAL_RUNTIME_STATE_ROOT?.trim()
    ? resolveRuntimeStateRoot()
    : getProjectRoot();
  const paths = {
    root,
    materials:
      this.configService.get<string>('AUTO_UPLOAD_MATERIALS_DIR') ||
      join(root, 'data', 'materials'),
    cookies:
      this.configService.get<string>('AUTO_UPLOAD_COOKIES_DIR') ||
      join(root, 'data', 'cookiesFile'),
    browserProfiles:
      this.configService.get<string>('LOCAL_BROWSER_PROFILE_ROOT') ||
      resolveProjectDataPath('browser-profiles'),
    evidence:
      this.configService.get<string>('LOCAL_BROWSER_EVIDENCE_ROOT') ||
      join(this.getProjectLogRoot(), 'browser-evidence'),
    avatars:
      this.configService.get<string>('AUTO_UPLOAD_AVATARS_DIR') ||
      join(root, 'data', 'avatars'),
    logs: this.getProjectLogRoot(),
  };
  for (const path of [
    paths.materials,
    paths.cookies,
    paths.browserProfiles,
    paths.evidence,
    paths.avatars,
    paths.logs,
  ]) {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }
  return paths;
}

export async function inspectPath(
  this: MiscHost,
  target: {
    key: string;
    name: string;
    path: string;
    note?: string;
  },
): Promise<LocalEngineFileAccessItem> {
  let pathStat: Awaited<ReturnType<typeof stat>> | null = null;
  let readable = false;
  let writable = false;

  try {
    pathStat = await stat(target.path);
  } catch {
    return {
      key: target.key,
      name: target.name,
      path: target.path,
      exists: false,
      readable: false,
      writable: false,
      kind: 'missing',
      note: target.note,
      recentFiles: [],
    };
  }

  try {
    await access(target.path, constants.R_OK);
    readable = true;
  } catch {
    readable = false;
  }

  try {
    await access(target.path, constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }

  const kind = pathStat.isDirectory()
    ? 'directory'
    : pathStat.isFile()
      ? 'file'
      : 'unknown';
  const item: LocalEngineFileAccessItem = {
    key: target.key,
    name: target.name,
    path: target.path,
    exists: true,
    readable,
    writable,
    kind,
    sizeBytes: pathStat.isFile() ? pathStat.size : undefined,
    updatedAt: pathStat.mtime.toISOString(),
    note: target.note,
    recentFiles: [],
  };

  if (pathStat.isDirectory() && readable) {
    try {
      const entries = await readdir(target.path, { withFileTypes: true });
      item.fileCount = entries.filter((entry) => entry.isFile()).length;
      item.directoryCount = entries.filter((entry) =>
        entry.isDirectory(),
      ).length;
      const recentEntries = await Promise.all(
        entries
          .filter((entry) => !entry.name.startsWith('.'))
          .slice(0, 80)
          .map(async (entry) => {
            const entryPath = join(target.path, entry.name);
            try {
              const entryStat = await stat(entryPath);
              return {
                name: entry.name,
                path: entryPath,
                kind: entry.isDirectory()
                  ? ('directory' as const)
                  : entry.isFile()
                    ? ('file' as const)
                    : ('unknown' as const),
                sizeBytes: entryStat.isFile() ? entryStat.size : undefined,
                updatedAt: entryStat.mtime.toISOString(),
              };
            } catch {
              return {
                name: entry.name,
                path: entryPath,
                kind: 'unknown' as const,
                updatedAt: null,
              };
            }
          }),
      );
      item.recentFiles = recentEntries
        .sort((left, right) =>
          (right.updatedAt || '').localeCompare(left.updatedAt || ''),
        )
        .slice(0, 5);
    } catch {
      item.recentFiles = [];
    }
  }

  return item;
}

export function collectRecentEvidenceEventIds(
  this: MiscHost,
  task: InteractionTask,
  eventIds: string[] = [],
) {
  return [
    ...new Set([
      ...eventIds.filter(Boolean),
      ...task.events
        .filter((event) => Boolean(event.evidence))
        .slice(-8)
        .map((event) => event.id),
    ]),
  ];
}

export function normalizeStoredBatchTargets(
  this: MiscHost,
  task: InteractionTask,
) {
  if (!task.batchTargets?.length) {
    return;
  }

  task.batchTargets = task.batchTargets.map((target) => ({
    ...target,
    status: normalizeBatchTargetStatus(target.status),
    evidenceEventIds: Array.isArray(target.evidenceEventIds)
      ? target.evidenceEventIds.filter(Boolean)
      : undefined,
  }));
  task.batchSummary = buildBatchSummary(task.batchTargets);
}

export function isSendMode(
  this: MiscHost,
  value: unknown,
): value is InteractionSendMode {
  return (
    value === 'approval-send' || value === 'draft-only' || value === 'auto-send'
  );
}

export const miscMethods = {
  toRecordExportRows,
  formatEvidenceIndexForCsv,
  normalizeWindowTitles,
  resolveLocalRuntimePaths,
  inspectPath,
  collectRecentEvidenceEventIds,
  normalizeStoredBatchTargets,
  isSendMode,
};
