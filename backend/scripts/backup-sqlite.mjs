#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDir, '..');
const options = parseArgs(process.argv.slice(2));
const sourceValue =
  options.source ||
  process.env.SQLITE_DATABASE_URL?.trim() ||
  'file:./kaypal-ai.sqlite';
const sourceFile = resolveSqliteFile(sourceValue);
const backupRoot = resolveOutputRoot(
  options.output ||
    process.env.SQLITE_BACKUP_ROOT?.trim() ||
    process.env.COMMERCIAL_BACKUP_ROOT?.trim() ||
    join(backendRoot, '.local-backups', 'sqlite'),
);

if (!existsSync(sourceFile) || !statSync(sourceFile).isFile()) {
  fail(`SQLite source file does not exist: ${sourceFile}`);
}

// 2026-09-01 换库适配：备份主库（系统库）+ accounts/ 下全部账号库。
// 账号库 = 每账号独立 SQLite（logout 换库架构），漏备份 = 换机/回滚丢该账号业务数据。
const accountsDir = join(dirname(sourceFile), 'accounts');
const accountFiles = existsSync(accountsDir)
  ? readdirSync(accountsDir)
      .filter((name) => name.endsWith('.sqlite'))
      .map((name) => join(accountsDir, name))
      .filter((file) => existsSync(file) && statSync(file).isFile())
  : [];
const targets = [
  { path: sourceFile, kind: 'sqlite-system' },
  ...accountFiles.map((file) => ({ path: file, kind: 'sqlite-account' })),
];

mkdirSync(backupRoot, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = mkdtempSync(join(backupRoot, `${stamp}-`));
const backupFile = join(backupDir, basename(sourceFile));
const manifestFile = join(backupDir, 'manifest.json');

try {
  const sqliteCommand = resolveSqliteCommand();
  if (!sqliteCommand) {
    throw new Error(
      'sqlite3 is required. Install it or set SQLITE3_PATH/AI_CONTENT_SQLITE_EXE.',
    );
  }
  const files = [];
  for (const target of targets) {
    const fileBackupPath = join(backupDir, basename(target.path));
    const escapedBackupFile = fileBackupPath.replaceAll("'", "''");
    runSqlite(
      sqliteCommand,
      target.path,
      `VACUUM INTO '${escapedBackupFile}';`,
    );

    const verification = inspectDatabase(sqliteCommand, fileBackupPath);
    if (verification.integrityCheck !== 'ok') {
      throw new Error(
        `integrity_check=${verification.integrityCheck} (${target.path})`,
      );
    }

    const sizeBytes = statSync(fileBackupPath).size;
    const sha256 = hashFile(fileBackupPath);
    files.push({
      path: basename(fileBackupPath),
      sizeBytes,
      sha256,
      kind: target.kind,
    });
  }

  const sizeBytes = statSync(backupFile).size;
  const sha256 = hashFile(backupFile);
  const manifest = {
    schemaVersion: 2,
    backupType: 'commercial-readiness-local-sqlite',
    generatedAt: new Date().toISOString(),
    source: {
      databaseFile: sourceFile,
      accountDatabaseCount: accountFiles.length,
      sizeBytes: statSync(sourceFile).size,
    },
    verification: {
      integrityCheck: 'ok',
      databaseCount: files.length,
    },
    restore: {
      dryRunSupported: true,
      destructiveRestoreSupported: false,
      note: 'Use verify-sqlite-backup.mjs for hash, integrity, and isolated restore checks.',
    },
    files,
  };
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `${JSON.stringify({
      status: 'created',
      backupDir,
      databaseFile: backupFile,
      manifestFile,
      databaseCount: files.length,
      accountDatabaseCount: accountFiles.length,
      sizeBytes,
      sha256,
      integrityCheck: 'ok',
    })}\n`,
  );
} catch (error) {
  rmSync(backupDir, { recursive: true, force: true });
  fail(
    `SQLite backup failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--source') {
      parsed.source = args[index + 1];
      index += 1;
    } else if (value === '--output') {
      parsed.output = args[index + 1];
      index += 1;
    } else if (!parsed.source) {
      parsed.source = value;
    } else if (!parsed.output) {
      parsed.output = value;
    }
  }
  return parsed;
}

function resolveSqliteFile(value) {
  const normalized = String(value || '').trim();
  if (!normalized) fail('SQLite source is empty.');
  if (normalized.startsWith('file://')) {
    return fileURLToPath(normalized);
  }
  if (normalized.startsWith('file:')) {
    const rawPath = decodeURIComponent(normalized.slice(5).split('?')[0]);
    return isAbsolute(rawPath)
      ? rawPath
      : resolve(backendRoot, rawPath.replace(/^\.\//, ''));
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    fail('db:backup:sqlite only accepts a SQLite file path or file: URL.');
  }
  return isAbsolute(normalized) ? normalized : resolve(backendRoot, normalized);
}

function resolveOutputRoot(value) {
  return isAbsolute(value) ? value : resolve(backendRoot, value);
}

function inspectDatabase(command, file) {
  const output = runSqlite(
    command,
    file,
    "PRAGMA integrity_check; SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';",
  );
  const lines = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    integrityCheck: lines[0] || 'error: empty sqlite3 output',
    tableCount: Number(lines.at(-1) || 0),
  };
}

function resolveSqliteCommand() {
  const configured =
    process.env.SQLITE3_PATH?.trim() ||
    process.env.AI_CONTENT_SQLITE_EXE?.trim();
  const candidates = configured ? [configured] : ['sqlite3'];
  for (const command of candidates) {
    const result = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (!result.error && result.status === 0) return command;
  }
  return null;
}

function runSqlite(command, file, sql) {
  const result = spawnSync(command, [file, sql], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message || result.stderr || 'sqlite3 exited non-zero',
    );
  }
  return result.stdout || '';
}

function hashFile(file) {
  const hash = createHash('sha256');
  const descriptor = openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
