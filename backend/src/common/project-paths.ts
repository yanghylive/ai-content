import { basename, join, resolve } from 'path';

export function resolveProjectRoot(cwd = process.cwd()): string {
  return basename(cwd) === 'backend' ? resolve(cwd, '..') : cwd;
}

export function resolveRuntimeStateRoot(cwd = process.cwd()): string {
  const explicit = process.env.KAYPAL_RUNTIME_STATE_ROOT?.trim();
  return explicit ? resolve(explicit) : join(resolveProjectRoot(cwd), 'data');
}

export function resolveProjectLogPath(...segments: string[]): string {
  const explicit = process.env.KAYPAL_RUNTIME_LOG_ROOT?.trim();
  const root = explicit
    ? resolve(explicit)
    : join(resolveProjectRoot(), '.local-logs');
  return join(root, ...segments);
}

export function resolveProjectDataPath(...segments: string[]): string {
  return join(resolveRuntimeStateRoot(), ...segments);
}
