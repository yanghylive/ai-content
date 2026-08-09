#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDir, '..');
const requested =
  process.argv.find((value, index) => index > 1 && value !== '--backup') ||
  process.env.SQLITE_BACKUP_DIR?.trim() ||
  latestBackupDir(resolveBackupRoot());

if (!requested) {
  fail('No SQLite backup was found. Pass --backup <directory-or-manifest>.');
}

const requestedPath = isAbsolute(requested)
  ? requested
  : resolve(backendRoot, requested);
const manifestFile =
  existsSync(requestedPath) && statSync(requestedPath).isDirectory()
    ? join(requestedPath, 'manifest.json')
    : requestedPath;
const backupDir = dirname(manifestFile);

if (!existsSync(manifestFile)) {
  fail(`Backup manifest does not exist: ${manifestFile}`);
}

const manifest = readManifest(manifestFile);
if (manifest.backupType !== 'commercial-readiness-local-sqlite') {
  fail(`Unsupported backup type: ${String(manifest.backupType || 'unknown')}`);
}

const files = Array.isArray(manifest.files) ? manifest.files : [];
const entry = files.find(
  (item) => item && typeof item === 'object' && item.kind === 'sqlite-database',
);
if (!entry || typeof entry.path !== 'string') {
  fail('Manifest does not contain a sqlite-database entry.');
}

const databaseFile = resolve(backupDir, entry.path);
const relativePath = relative(resolve(backupDir), databaseFile);
if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
  fail('Manifest database path escapes the backup directory.');
}
if (!existsSync(databaseFile) || !statSync(databaseFile).isFile()) {
  fail(`Backup database does not exist: ${databaseFile}`);
}

const sizeBytes = statSync(databaseFile).size;
if (Number(entry.sizeBytes) !== sizeBytes) {
  fail(
    `Backup size mismatch: manifest=${entry.sizeBytes}, actual=${sizeBytes}`,
  );
}
if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
  fail('Manifest is missing a valid SHA-256 digest.');
}
const sha256 = hashFile(databaseFile);
if (sha256 !== entry.sha256.toLowerCase()) {
  fail(`Backup SHA-256 mismatch: expected=${entry.sha256}, actual=${sha256}`);
}

const sqliteCommand = resolveSqliteCommand();
if (!sqliteCommand) {
  fail(
    'sqlite3 is required. Install it or set SQLITE3_PATH/AI_CONTENT_SQLITE_EXE.',
  );
}
let sourceVerification;
try {
  sourceVerification = inspectDatabase(sqliteCommand, databaseFile);
} catch (error) {
  fail(
    `Backup integrity check failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}
if (sourceVerification.integrityCheck !== 'ok') {
  fail(`Backup integrity check failed: ${sourceVerification.integrityCheck}`);
}

const restoreDir = mkdtempSync(join(tmpdir(), 'kaypal-sqlite-restore-'));
const restoredFile = join(restoreDir, basename(databaseFile));
let restoreVerification;
let restoreError;
try {
  copyFileSync(databaseFile, restoredFile);
  restoreVerification = inspectDatabase(sqliteCommand, restoredFile);
  if (restoreVerification.integrityCheck !== 'ok') {
    throw new Error(`integrity_check=${restoreVerification.integrityCheck}`);
  }
  if (restoreVerification.tableCount !== sourceVerification.tableCount) {
    throw new Error(
      `table count mismatch: source=${sourceVerification.tableCount}, restored=${restoreVerification.tableCount}`,
    );
  }
} catch (error) {
  restoreError = error;
} finally {
  rmSync(restoreDir, { recursive: true, force: true });
}
if (restoreError) {
  fail(
    `Isolated restore failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
  );
}

process.stdout.write(
  `${JSON.stringify({
    status: 'pass',
    backupDir,
    manifestFile,
    databaseFile,
    sizeBytes,
    sha256,
    integrityCheck: sourceVerification.integrityCheck,
    tableCount: sourceVerification.tableCount,
    isolatedRestore: 'pass',
  })}\n`,
);

function resolveBackupRoot() {
  const configured =
    process.env.SQLITE_BACKUP_ROOT?.trim() ||
    process.env.COMMERCIAL_BACKUP_ROOT?.trim() ||
    join(backendRoot, '.local-backups', 'sqlite');
  return isAbsolute(configured) ? configured : resolve(backendRoot, configured);
}

function latestBackupDir(root) {
  if (!existsSync(root)) return '';
  return (
    readdirSync(root)
      .map((name) => join(root, name))
      .filter((path) => {
        try {
          return (
            statSync(path).isDirectory() &&
            existsSync(join(path, 'manifest.json'))
          );
        } catch {
          return false;
        }
      })
      .sort()
      .at(-1) || ''
  );
}

function readManifest(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail('Backup manifest must be a JSON object.');
    }
    return parsed;
  } catch (error) {
    fail(
      `Backup manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
