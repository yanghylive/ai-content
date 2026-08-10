#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isIP } from 'node:net';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const backendRequire = createRequire(join(root, 'backend', 'package.json'));
const args = parseArgs(process.argv.slice(2));
const real = Boolean(args.real || envFlag('COMMERCIAL_EXTERNAL_OPS_REAL'));
const runRestore = Boolean(
  args.restore || envFlag('COMMERCIAL_EXTERNAL_OPS_RUN_RESTORE'),
);
const downloadBackup = Boolean(
  args.downloadBackup || envFlag('COMMERCIAL_EXTERNAL_OPS_DOWNLOAD_BACKUP'),
);
const uploadLatestBackup = Boolean(
  args.uploadLatestBackup ||
    envFlag('COMMERCIAL_EXTERNAL_OPS_UPLOAD_LATEST_BACKUP'),
);
const generatedAt = new Date();
const stamp = generatedAt.toISOString().replace(/[:.]/g, '-');
const evidenceDir =
  args.evidenceDir ||
  process.env.COMMERCIAL_EXTERNAL_OPS_EVIDENCE_DIR ||
  join(
    root,
    'docs',
    `acceptance-evidence-${generatedAt.toISOString().slice(0, 10)}`,
    `commercial-external-ops-smoke-${stamp}`,
  );
const backupRoot = resolvePath(
  process.env.COMMERCIAL_BACKUP_ROOT ||
    join(root, '.local-backups', 'commercial-readiness'),
);
const localMirrorRoot = process.env.COMMERCIAL_BACKUP_OBJECT_STORE_DIR
  ? resolvePath(process.env.COMMERCIAL_BACKUP_OBJECT_STORE_DIR)
  : null;
const objectStoreProvider = normalizeObjectStoreProvider();
const alertProvider = normalizeAlertProvider();
const restoreDatabaseUrl =
  process.env.COMMERCIAL_RESTORE_DATABASE_URL?.trim() || '';
const psqlPath =
  process.env.PSQL_RESTORE_PATH?.trim() || process.env.PSQL_PATH?.trim() || 'psql';
const checks = [];
const artifacts = {};

await main();

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  mkdirSync(evidenceDir, { recursive: true });
  const localBackup = checkLatestLocalBackup();
  await checkObjectStore(localBackup);
  await checkAlertChannel(localBackup);
  await checkRestoreRunbook(localBackup);
  writeEvidence();

  const failed = checks.filter((item) => item.status === 'FAIL').length;
  const blocked = checks.filter((item) => item.status === 'BLOCKED').length;
  const passed = checks.filter((item) => item.status === 'PASS').length;
  const warned = checks.filter((item) => item.status === 'WARN').length;
  console.log(
    `Commercial external ops smoke: PASS=${passed} WARN=${warned} BLOCKED=${blocked} FAIL=${failed}`,
  );
  console.log(`Evidence: ${evidenceDir}`);
  if (args.json) {
    console.log(
      JSON.stringify({ generatedAt: generatedAt.toISOString(), checks, artifacts }, null, 2),
    );
  }
  process.exitCode = failed > 0 || blocked > 0 ? 1 : 0;
}

function checkLatestLocalBackup() {
  if (!existsSync(backupRoot)) {
    record(
      'BLOCKED',
      'latest-local-backup',
      `备份根目录不存在：${backupRoot}`,
      '先让后台备份 daemon 或 /commercial-readiness/backup/scheduler/run-once 生成一轮备份。',
    );
    return null;
  }
  const dirs = readdirSync(backupRoot)
    .map((name) => join(backupRoot, name))
    .filter((dir) => safeStat(dir)?.isDirectory())
    .sort();
  const latestDir = dirs.at(-1) || null;
  const manifestFile = latestDir ? join(latestDir, 'manifest.json') : null;
  if (!latestDir || !manifestFile || !existsSync(manifestFile)) {
    record(
      'BLOCKED',
      'latest-local-backup',
      `没有找到 manifest：${manifestFile || '-'}`,
      '先生成一轮本地备份，再跑外部运维 smoke。',
    );
    return null;
  }
  const manifest = readJson(manifestFile);
  const backupFile = resolveBackupFile(manifest, latestDir);
  if (!manifest || !backupFile || !existsSync(backupFile)) {
    record(
      'FAIL',
      'latest-local-backup',
      `manifest 无效或备份文件不存在：${manifestFile}`,
      '检查备份生成逻辑和 manifest.files。',
    );
    return { latestDir, manifestFile, manifest, backupFile };
  }
  record(
    'PASS',
    'latest-local-backup',
    `${manifest.backupType || 'unknown'}; file=${backupFile}; size=${statSync(backupFile).size}`,
    '',
    { latestDir, manifestFile, backupFile },
  );
  artifacts.latestLocalBackup = { latestDir, manifestFile, backupFile };
  return { latestDir, manifestFile, manifest, backupFile };
}

async function checkObjectStore(localBackup) {
  if (objectStoreProvider === 'aliyun-oss') {
    await checkAliyunOss(localBackup);
    return;
  }
  if (objectStoreProvider === 'local-dir') {
    checkLocalMirror(localBackup);
    return;
  }
  record(
    'BLOCKED',
    'object-store-provider',
    '未配置对象存储 provider。',
    '配置 COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER=aliyun-oss 和 OSS 凭据，或配置 COMMERCIAL_BACKUP_OBJECT_STORE_DIR 做本地镜像验收。',
  );
}

function checkLocalMirror(localBackup) {
  const mirror = localBackup?.manifest?.objectStoreMirror || {};
  const mirrorDir =
    typeof mirror.mirrorDir === 'string'
      ? mirror.mirrorDir
      : localMirrorRoot && localBackup?.latestDir
        ? join(localMirrorRoot, basename(localBackup.latestDir))
        : null;
  const manifestFile =
    typeof mirror.manifestFile === 'string'
      ? mirror.manifestFile
      : mirrorDir
        ? join(mirrorDir, 'manifest.json')
        : null;
  if (!mirrorDir || !manifestFile || !existsSync(manifestFile)) {
    record(
      'BLOCKED',
      'object-store-local-mirror',
      `本地镜像 manifest 不存在：${manifestFile || '-'}`,
      '设置 COMMERCIAL_BACKUP_OBJECT_STORE_DIR 并重新跑一轮备份。',
    );
    return;
  }
  const files = readdirSync(mirrorDir)
    .map((name) => join(mirrorDir, name))
    .filter((file) => safeStat(file)?.isFile());
  record(
    files.length > 1 ? 'PASS' : 'FAIL',
    'object-store-local-mirror',
    `mirrorDir=${mirrorDir}; files=${files.length}`,
    files.length > 1 ? '' : '镜像目录至少应包含 manifest 和一个备份文件。',
    { mirrorDir, manifestFile, files },
  );
}

async function checkAliyunOss(localBackup) {
  const config = aliyunOssConfig();
  const missing = Object.entries({
    COMMERCIAL_BACKUP_OSS_ACCESS_KEY_ID: config.accessKeyId,
    COMMERCIAL_BACKUP_OSS_ACCESS_KEY_SECRET: config.accessKeySecret,
    COMMERCIAL_BACKUP_OSS_BUCKET: config.bucket,
    'COMMERCIAL_BACKUP_OSS_ENDPOINT 或 COMMERCIAL_BACKUP_OSS_REGION':
      config.endpoint || config.region,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    record(
      'BLOCKED',
      'aliyun-oss-config',
      `缺少：${missing.join('、')}`,
      '填入真实 OSS bucket/AK/SK/endpoint 或 region 后再跑。',
    );
    return;
  }
  if (!real) {
    record(
      'BLOCKED',
      'aliyun-oss-real-probe',
      '已检测到 OSS 配置，但未启用 --real。',
      '确认这是测试/生产验收窗口后，用 --real 允许写入和删除一个探针对象。',
    );
    return;
  }

  const client = createAliyunOssClient(config);
  const probeKey = joinOssKey(
    config.prefix,
    '_smoke',
    `${stamp}-${randomBytes(4).toString('hex')}.json`,
  );
  const probeBody = Buffer.from(
    JSON.stringify({
      type: 'commercial-external-ops-smoke',
      generatedAt: generatedAt.toISOString(),
    }),
  );
  try {
    await client.put(probeKey, probeBody);
    const probe = await client.get(probeKey);
    const text = Buffer.isBuffer(probe.content)
      ? probe.content.toString('utf8')
      : String(probe.content || '');
    await client.delete(probeKey);
    record(
      text.includes('commercial-external-ops-smoke') ? 'PASS' : 'FAIL',
      'aliyun-oss-write-read-delete',
      `bucket=${config.bucket}; probe=${probeKey}`,
      text.includes('commercial-external-ops-smoke')
        ? ''
        : 'OSS 探针读回内容不匹配。',
      { bucket: config.bucket, key: probeKey },
    );
  } catch (error) {
    record(
      'FAIL',
      'aliyun-oss-write-read-delete',
      errorMessage(error),
      '检查 bucket 权限、endpoint/region、AK/SK、网络出口。',
    );
    return;
  }

  if (uploadLatestBackup) {
    await uploadLatestBackupToAliyunOss(client, config, localBackup);
  }
  await checkAliyunLatestBackupReadback(client, config, localBackup);
}

async function uploadLatestBackupToAliyunOss(client, config, localBackup) {
  if (!localBackup?.manifest || !localBackup?.backupFile) {
    record(
      'BLOCKED',
      'aliyun-oss-upload-latest-backup',
      '没有可上传的本地备份。',
      '先生成一轮本地备份，再使用 --upload-latest-backup。',
    );
    return;
  }
  try {
    const backupStamp = basename(localBackup.latestDir);
    const manifestKey = joinOssKey(config.prefix, backupStamp, 'manifest.json');
    const backupKey = joinOssKey(
      config.prefix,
      backupStamp,
      basename(localBackup.backupFile),
    );
    const uploadedKeys = [backupKey, manifestKey];
    const backupSizeBytes = statSync(localBackup.backupFile).size;
    const remoteManifest = {
      ...localBackup.manifest,
      objectStoreMirror: {
        enabled: true,
        provider: 'aliyun-oss',
        root: `oss://${config.bucket}`,
        mirrorDir: null,
        manifestFile: `oss://${config.bucket}/${manifestKey}`,
        bucket: config.bucket,
        prefix: config.prefix,
        uploadedKeys,
        fileCount: uploadedKeys.length,
        sizeBytes: backupSizeBytes,
        valid: true,
        message: '备份已通过 external ops smoke 上传到阿里云 OSS。',
      },
    };
    const remoteManifestFile = join(evidenceDir, 'uploaded-oss-manifest.json');
    writeFileSync(
      remoteManifestFile,
      `${JSON.stringify(remoteManifest, null, 2)}\n`,
    );
    await client.put(backupKey, localBackup.backupFile);
    await client.put(manifestKey, remoteManifestFile);
    artifacts.uploadedOssBackup = {
      bucket: config.bucket,
      manifestKey,
      backupKey,
      manifestFile: remoteManifestFile,
    };
    record(
      'PASS',
      'aliyun-oss-upload-latest-backup',
      `bucket=${config.bucket}; manifest=${manifestKey}; backup=${backupKey}`,
      '',
      artifacts.uploadedOssBackup,
    );
  } catch (error) {
    record(
      'FAIL',
      'aliyun-oss-upload-latest-backup',
      errorMessage(error),
      '检查 OSS PutObject 权限、bucket、prefix 和网络出口。',
    );
  }
}

async function checkAliyunLatestBackupReadback(client, config, localBackup) {
  try {
    const list = await client.list({
      prefix: config.prefix ? `${config.prefix}/` : '',
      'max-keys': 1000,
    });
    const manifestKeys = (list.objects || [])
      .map((item) => item.name)
      .filter((name) => name.endsWith('/manifest.json'))
      .sort();
    const manifestKey = manifestKeys.at(-1);
    if (!manifestKey) {
      record(
        'BLOCKED',
        'aliyun-oss-latest-backup-readback',
        `prefix=${config.prefix}; 没有找到远端 manifest`,
        '先用当前后端配置跑一轮 aliyun-oss 备份。',
      );
      return;
    }
    const manifestResult = await client.get(manifestKey);
    const manifestText = Buffer.isBuffer(manifestResult.content)
      ? manifestResult.content.toString('utf8')
      : String(manifestResult.content || '');
    const manifest = JSON.parse(manifestText);
    const uploadedKeys = Array.isArray(manifest.objectStoreMirror?.uploadedKeys)
      ? manifest.objectStoreMirror.uploadedKeys
      : [];
    const backupKey = uploadedKeys.find((key) => !key.endsWith('/manifest.json'));
    if (!backupKey) {
      record(
        'FAIL',
        'aliyun-oss-latest-backup-readback',
        `manifest=${manifestKey}; uploadedKeys 缺少备份文件`,
        '检查后端上传 manifest 的 objectStoreMirror.uploadedKeys。',
      );
      return;
    }
    if (downloadBackup) {
      const downloadDir = join(evidenceDir, 'downloaded-backup');
      mkdirSync(downloadDir, { recursive: true });
      const manifestOut = join(downloadDir, 'manifest.json');
      const backupOut = join(downloadDir, basename(backupKey));
      writeFileSync(manifestOut, manifestText);
      await client.get(backupKey, backupOut);
      artifacts.downloadedBackup = { manifestFile: manifestOut, backupFile: backupOut };
    }
    record(
      'PASS',
      'aliyun-oss-latest-backup-readback',
      `manifest=${manifestKey}; backup=${backupKey}`,
      '',
      { manifestKey, backupKey, localBackupManifest: localBackup?.manifestFile },
    );
  } catch (error) {
    record(
      'FAIL',
      'aliyun-oss-latest-backup-readback',
      errorMessage(error),
      '检查 OSS list/get 权限和备份 prefix。',
    );
  }
}

async function checkAlertChannel(localBackup) {
  const webhookUrl = process.env.COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL?.trim() || '';
  if (!webhookUrl) {
    record(
      'BLOCKED',
      'alert-webhook-config',
      '未配置 COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL。',
      '填入企业微信/飞书/Slack 值班群 webhook 后再跑。',
    );
    return;
  }
  const target = classifyWebhookTarget(webhookUrl);
  if (target.category === 'invalid') {
    record(
      'FAIL',
      'alert-webhook-target',
      `provider=${alertProvider}; ${target.message}`,
      '检查 webhook 地址格式，必须使用 http 或 https。',
      target,
    );
    return;
  }
  if (real && target.category === 'loopback') {
    record(
      'BLOCKED',
      'alert-webhook-production-target',
      `provider=${alertProvider}; target=${target.category}; host=${target.host}`,
      '生产告警不能指向本机地址；请填入真实值班群或外部告警系统 webhook。',
      target,
    );
    return;
  }
  if (!real) {
    record(
      'BLOCKED',
      'alert-webhook-real-probe',
      `provider=${alertProvider}; 未启用 --real`,
      '确认会向真实值班群发测试消息后，用 --real 执行。',
    );
    return;
  }
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(alertPayload(localBackup)),
      signal: AbortSignal.timeout(10000),
    });
    record(
      response.ok ? 'PASS' : 'FAIL',
      'alert-webhook-real-probe',
      `provider=${alertProvider}; HTTP ${response.status}`,
      response.ok ? '' : '检查 webhook 地址、机器人签名/关键词/权限。',
      { status: response.status },
    );
  } catch (error) {
    record(
      'FAIL',
      'alert-webhook-real-probe',
      errorMessage(error),
      '检查 webhook 地址、网络出口和值班群机器人配置。',
    );
  }
}

async function checkRestoreRunbook(localBackup) {
  const backupFile = artifacts.downloadedBackup?.backupFile || localBackup?.backupFile;
  if (!backupFile || !existsSync(backupFile)) {
    record(
      'BLOCKED',
      'restore-backup-file',
      '没有可用于恢复演练的本地或下载备份文件。',
      '先生成本地备份，或用 --real --download-backup 从 OSS 下载远端备份。',
    );
    return;
  }
  if (!restoreDatabaseUrl) {
    record(
      'BLOCKED',
      'restore-target-config',
      '未配置 COMMERCIAL_RESTORE_DATABASE_URL。',
      '在干净机器或隔离库上配置一个独立恢复库，不能指向生产库。',
    );
    return;
  }
  if (!runRestore) {
    record(
      'WARN',
      'restore-runbook-dry-check',
      `restore target=${redactDatabaseUrl(restoreDatabaseUrl)}; backup=${backupFile}`,
      '未启用 --restore，本次只确认恢复输入齐备；干净机器验收时加 --restore。',
    );
    return;
  }
  if (!real) {
    record(
      'BLOCKED',
      'restore-runbook-real-execution',
      '启用了 --restore 但未启用 --real。',
      '恢复会写入目标库，确认目标是隔离库后同时加 --real --restore。',
    );
    return;
  }
  try {
    // sqlite 部署：恢复 = 把备份文件复制到隔离库（restoreDatabaseUrl 形如 file:/path）
    const backupType = String(
      localBackup?.manifest?.backupType || '',
    ).toLowerCase();
    const isSqliteBackup =
      backupType.includes('sqlite') ||
      /\.(sqlite|sqlite3|db)$/i.test(backupFile);
    if (isSqliteBackup) {
      const targetPath = restoreDatabaseUrl
        .replace(/^file:\/\//, '')
        .replace(/^file:/, '');
      if (!targetPath) {
        throw new Error(`无法从 restore URL 解析路径: ${restoreDatabaseUrl}`);
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      if (existsSync(targetPath)) rmSync(targetPath, { force: true });
      copyFileSync(backupFile, targetPath);
      record(
        'PASS',
        'restore-runbook-real-execution',
        `sqlite-restore; backup=${backupFile} -> ${targetPath}`,
        '',
      );
      return;
    }
    const output = execFileSync(
      psqlPath,
      ['-v', 'ON_ERROR_STOP=1', '-f', backupFile, restoreDatabaseUrl],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    record(
      'PASS',
      'restore-runbook-real-execution',
      `psql=${psqlPath}; restored=${backupFile}`,
      '',
      { output: output.slice(-2000) },
    );
  } catch (error) {
    record(
      'FAIL',
      'restore-runbook-real-execution',
      errorMessage(error),
      '确认目标库为空且为隔离库；必要时先重建恢复库再执行。',
    );
  }
}

function alertPayload(localBackup) {
  const text = [
    'Commercial external ops smoke',
    `generatedAt: ${generatedAt.toISOString()}`,
    `latestBackup: ${localBackup?.manifest?.backupType || '-'}`,
    `backupFile: ${localBackup?.backupFile || '-'}`,
  ].join('\n');
  if (alertProvider === 'wecom') {
    return { msgtype: 'markdown', markdown: { content: text } };
  }
  if (alertProvider === 'feishu') {
    return { msg_type: 'text', content: { text } };
  }
  if (alertProvider === 'slack') {
    return { text };
  }
  return {
    type: 'commercial_external_ops_smoke',
    generatedAt: generatedAt.toISOString(),
    text,
  };
}

function writeEvidence() {
  const summary = {
    generatedAt: generatedAt.toISOString(),
    real,
    runRestore,
    downloadBackup,
    uploadLatestBackup,
    backupRoot,
    objectStoreProvider: objectStoreProvider || 'unconfigured',
    alertProvider,
    alertWebhook: webhookTargetSummary(),
    restoreDatabaseUrl: restoreDatabaseUrl ? redactDatabaseUrl(restoreDatabaseUrl) : null,
    checks,
    artifacts,
  };
  writeFileSync(
    join(evidenceDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  const rows = checks
    .map(
      (item) =>
        `| ${item.status} | ${item.name} | ${escapeCell(item.message)} | ${escapeCell(item.nextAction)} |`,
    )
    .join('\n');
  writeFileSync(
    join(evidenceDir, 'report.md'),
    [
      '# Commercial External Ops Smoke',
      '',
      `- Generated at: ${generatedAt.toISOString()}`,
      `- Real external writes: ${real ? 'yes' : 'no'}`,
      `- Evidence dir: ${evidenceDir}`,
      '',
      '| Status | Check | Message | Next action |',
      '| --- | --- | --- | --- |',
      rows,
      '',
    ].join('\n'),
  );
}

function record(status, name, message, nextAction = '', evidence = undefined) {
  checks.push({ status, name, message, nextAction, evidence });
}

function normalizeObjectStoreProvider() {
  const configured = process.env.COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER?.trim();
  if (configured === 'aliyun-oss' || configured === 'oss') return 'aliyun-oss';
  if (configured === 'local-dir' || configured === 'local') return 'local-dir';
  if (localMirrorRoot) return 'local-dir';
  if (
    process.env.COMMERCIAL_BACKUP_OSS_BUCKET ||
    process.env.ALIYUN_OSS_BUCKET ||
    process.env.COMMERCIAL_BACKUP_OSS_ACCESS_KEY_ID ||
    process.env.ALIYUN_OSS_ACCESS_KEY_ID
  ) {
    return 'aliyun-oss';
  }
  return null;
}

function normalizeAlertProvider() {
  const provider = process.env.COMMERCIAL_BACKUP_ALERT_PROVIDER?.trim();
  if (provider === 'wecom' || provider === 'feishu' || provider === 'slack') {
    return provider;
  }
  return 'generic';
}

function webhookTargetSummary() {
  const webhookUrl = process.env.COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL?.trim() || '';
  const target = classifyWebhookTarget(webhookUrl);
  return {
    configured: Boolean(webhookUrl),
    provider: alertProvider,
    protocol: target.protocol,
    host: target.host,
    category: target.category,
    productionCandidate: target.productionCandidate,
    message: target.message,
  };
}

function classifyWebhookTarget(webhookUrl) {
  if (!webhookUrl) {
    return {
      protocol: null,
      host: null,
      category: 'missing',
      productionCandidate: false,
      message: '未配置 webhook。',
    };
  }
  try {
    const parsed = new URL(webhookUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        protocol: parsed.protocol,
        host: parsed.hostname || null,
        category: 'invalid',
        productionCandidate: false,
        message: 'webhook URL must use http or https',
      };
    }
    const host = parsed.hostname.toLowerCase();
    const ipVersion = isIP(host);
    const loopback =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('127.');
    const privateHost =
      loopback ||
      host === '::' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host) ||
      (ipVersion === 6 && /^(fc|fd|fe80):/i.test(host));
    const category = loopback ? 'loopback' : privateHost ? 'private' : 'external';
    return {
      protocol: parsed.protocol.replace(':', ''),
      host,
      category,
      productionCandidate: category !== 'loopback',
      message:
        category === 'loopback'
          ? '本机地址只能用于开发自测，不能作为生产值班告警。'
          : category === 'private'
            ? '内网告警地址需确认值班系统可达。'
            : '外部告警地址格式有效。',
    };
  } catch (error) {
    return {
      protocol: null,
      host: null,
      category: 'invalid',
      productionCandidate: false,
      message: errorMessage(error),
    };
  }
}

function aliyunOssConfig() {
  return {
    accessKeyId:
      process.env.COMMERCIAL_BACKUP_OSS_ACCESS_KEY_ID?.trim() ||
      process.env.ALIYUN_OSS_ACCESS_KEY_ID?.trim() ||
      '',
    accessKeySecret:
      process.env.COMMERCIAL_BACKUP_OSS_ACCESS_KEY_SECRET?.trim() ||
      process.env.ALIYUN_OSS_ACCESS_KEY_SECRET?.trim() ||
      '',
    bucket:
      process.env.COMMERCIAL_BACKUP_OSS_BUCKET?.trim() ||
      process.env.ALIYUN_OSS_BUCKET?.trim() ||
      '',
    endpoint:
      process.env.COMMERCIAL_BACKUP_OSS_ENDPOINT?.trim() ||
      process.env.ALIYUN_OSS_ENDPOINT?.trim() ||
      '',
    region:
      process.env.COMMERCIAL_BACKUP_OSS_REGION?.trim() ||
      process.env.ALIYUN_OSS_REGION?.trim() ||
      '',
    prefix: (
      process.env.COMMERCIAL_BACKUP_OSS_PREFIX?.trim() ||
      process.env.ALIYUN_OSS_BACKUP_PREFIX?.trim() ||
      'commercial-readiness-backups'
    ).replace(/^\/+|\/+$/g, ''),
  };
}

function createAliyunOssClient(config) {
  const OSS = backendRequire('ali-oss');
  return new OSS({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    bucket: config.bucket,
    endpoint: config.endpoint || undefined,
    region: config.region || undefined,
    secure: true,
    timeout: 600000,
  });
}

function resolveBackupFile(manifest, backupDir) {
  if (!manifest || !Array.isArray(manifest.files)) return null;
  const file = manifest.files.find(
    (item) =>
      item &&
      (item.kind === 'sqlite-database' || item.kind === 'postgres-plain-sql') &&
      typeof item.path === 'string',
  );
  if (!file) return null;
  return isAbsolute(file.path) ? file.path : resolve(backupDir, file.path);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function safeStat(file) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

function resolvePath(value) {
  return isAbsolute(value) ? value : resolve(root, value);
}

function joinOssKey(...segments) {
  return segments
    .filter(Boolean)
    .map((segment) => String(segment).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--real') parsed.real = true;
    else if (arg === '--restore') parsed.restore = true;
    else if (arg === '--download-backup') parsed.downloadBackup = true;
    else if (arg === '--upload-latest-backup') parsed.uploadLatestBackup = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--evidence-dir') {
      parsed.evidenceDir = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function envFlag(name) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env[name] || '').trim().toLowerCase(),
  );
}

function errorMessage(error) {
  if (!error) return 'unknown error';
  if (error.stderr) return String(error.stderr);
  if (error.message) return error.message;
  return String(error);
}

function redactDatabaseUrl(value) {
  return value.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:***@');
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function printHelp() {
  console.log(`Commercial external ops smoke

Usage:
  node scripts/commercial-external-ops-smoke.mjs
  node scripts/commercial-external-ops-smoke.mjs --real --download-backup
  node scripts/commercial-external-ops-smoke.mjs --real --upload-latest-backup --download-backup
  node scripts/commercial-external-ops-smoke.mjs --real --restore --download-backup

Important env:
  COMMERCIAL_BACKUP_ROOT
  COMMERCIAL_BACKUP_OBJECT_STORE_PROVIDER=aliyun-oss
  COMMERCIAL_BACKUP_OSS_ACCESS_KEY_ID
  COMMERCIAL_BACKUP_OSS_ACCESS_KEY_SECRET
  COMMERCIAL_BACKUP_OSS_BUCKET
  COMMERCIAL_BACKUP_OSS_ENDPOINT
  COMMERCIAL_BACKUP_OSS_REGION
  COMMERCIAL_BACKUP_OSS_PREFIX
  COMMERCIAL_BACKUP_ALERT_PROVIDER=wecom|feishu|slack|generic
  COMMERCIAL_BACKUP_ALERT_WEBHOOK_URL
  COMMERCIAL_RESTORE_DATABASE_URL
  PSQL_RESTORE_PATH
`);
}
