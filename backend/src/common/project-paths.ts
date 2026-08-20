import { basename, join, resolve } from 'path';

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
