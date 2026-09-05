import { basename, join, resolve } from 'path';
import { statSync } from 'fs';

export function resolveProjectRoot(cwd = process.cwd()): string {
  return basename(cwd) === 'backend' ? resolve(cwd, '..') : cwd;
}

export function resolveRuntimeStateRoot(cwd = process.cwd()): string {
  const explicit = process.env.KAYPAL_RUNTIME_STATE_ROOT?.trim();
  if (explicit) return resolve(explicit);
  // 桌面端优先用用户数据目录（Program Files 等安装目录在 Windows 下受 UAC 写保护，
  // 2026-08-20 真机 EPERM 根因：store 快照写入 D:\Program Files\...\resources\data 被拒）
  const desktopUserData = process.env.KAYPAL_DESKTOP_USER_DATA_DIR?.trim();
  if (desktopUserData) return join(desktopUserData, 'data');
  return join(resolveProjectRoot(cwd), 'data');
}

export function resolveProjectLogPath(...segments: string[]): string {
  const explicit = process.env.KAYPAL_RUNTIME_LOG_ROOT?.trim();
  if (explicit) return join(resolve(explicit), ...segments);
  // 桌面端日志同样落用户数据目录（避免安装目录 UAC 写保护，2026-08-20 真机 EPERM）
  const desktopUserData = process.env.KAYPAL_DESKTOP_USER_DATA_DIR?.trim();
  const root = desktopUserData
    ? join(desktopUserData, 'data', '.local-logs')
    : join(resolveProjectRoot(), '.local-logs');
  return join(root, ...segments);
}

export function resolveProjectDataPath(...segments: string[]): string {
  return join(resolveRuntimeStateRoot(), ...segments);
}

/**
 * 桌面端 Electron userData 目录（面板桥凭据/开关文件所在）。
 *
 * 2026-09-05 重建：该函数此前一直是大壮未提交的工作区改动，被 git-filter-repo
 * 历史重写连带 worktree reset 冲掉（第四处丢失，定义从未进过 Git 历史）。
 * 按三处调用方语义重建（agent-panel-bridge.service.ts:233/899/954）：
 *  1. KAYPAL_DESKTOP_USER_DATA_DIR env 显式指定优先（与其他 resolve* 一致）；
 *  2. 按平台推 Electron 默认 userData 目录（app name = ai-content-desktop，
 *     与 desktop/electron 主进程 app.getPath('userData') 对齐）；
 *  3. 目录不存在 → 返回 null（调用方 fail-closed，面板视为不可用）。
 */
export function resolveDesktopUserDataDir(): string | null {
  const explicit = process.env.KAYPAL_DESKTOP_USER_DATA_DIR?.trim();
  if (explicit) return explicit;
  const platform = process.platform;
  const home = process.env.HOME?.trim() || '';
  if (!home) return null;
  let dir: string;
  if (platform === 'darwin') {
    dir = join(home, 'Library', 'Application Support', 'ai-content-desktop');
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA?.trim();
    if (!appData) return null;
    dir = join(appData, 'ai-content-desktop');
  } else {
    const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(home, '.config');
    dir = join(configHome, 'ai-content-desktop');
  }
  try {
    // 目录由 Electron 主进程创建；尚无桌面端安装/未启动过时推导不出 → fail-closed
    return statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}
