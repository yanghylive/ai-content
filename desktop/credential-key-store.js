'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CREDENTIAL_MASTER_KEY_ENV = 'KAYPAL_CREDENTIAL_MASTER_KEY';
const KEY_RECORD_VERSION = 1;
const KEY_RECORD_PROTECTION = 'electron.safeStorage';
const KEY_RECORD_FILE = 'credential-master-key.v1.json';

function decodeMasterKey(value) {
  const configured = typeof value === 'string' ? value.trim() : '';
  if (!configured) {
    throw new Error(`${CREDENTIAL_MASTER_KEY_ENV} is empty`);
  }

  let key;
  if (configured.startsWith('hex:')) {
    const encoded = configured.slice(4);
    if (!/^[0-9a-fA-F]{64}$/.test(encoded)) {
      throw new Error(`${CREDENTIAL_MASTER_KEY_ENV} must contain a 32-byte key`);
    }
    key = Buffer.from(encoded, 'hex');
  } else if (configured.startsWith('base64:')) {
    const encoded = configured.slice(7);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error(`${CREDENTIAL_MASTER_KEY_ENV} must contain a 32-byte key`);
    }
    key = Buffer.from(encoded, 'base64');
  } else if (/^[0-9a-fA-F]{64}$/.test(configured)) {
    key = Buffer.from(configured, 'hex');
  } else {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(configured)) {
      throw new Error(`${CREDENTIAL_MASTER_KEY_ENV} must contain a 32-byte key`);
    }
    key = Buffer.from(configured, 'base64');
  }

  if (key.length !== 32) {
    throw new Error(`${CREDENTIAL_MASTER_KEY_ENV} must contain a 32-byte key`);
  }

  return `base64:${key.toString('base64')}`;
}

function assertSafeStorageAvailable(safeStorage) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    throw new Error('系统安全存储接口不可用');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储尚未就绪');
  }

  const backend = typeof safeStorage.getSelectedStorageBackend === 'function'
    ? safeStorage.getSelectedStorageBackend()
    : null;
  if (backend === 'basic_text') {
    throw new Error('系统仅提供明文安全存储，已拒绝保存账号凭据密钥');
  }
  return backend || 'platform-default';
}

function keyRecordPath(userDataPath) {
  return path.join(userDataPath, 'security', KEY_RECORD_FILE);
}

function readStoredMasterKey({ safeStorage, recordPath, fsModule = fs }) {
  let record;
  try {
    record = JSON.parse(fsModule.readFileSync(recordPath, 'utf8'));
  } catch (error) {
    throw new Error(`设备凭据密钥记录无法读取：${error.message}`);
  }

  if (
    record?.version !== KEY_RECORD_VERSION ||
    record?.protection !== KEY_RECORD_PROTECTION ||
    typeof record?.ciphertext !== 'string' ||
    !record.ciphertext
  ) {
    throw new Error('设备凭据密钥记录格式无效');
  }

  try {
    const encrypted = Buffer.from(record.ciphertext, 'base64');
    if (!encrypted.length) {
      throw new Error('密文为空');
    }
    return decodeMasterKey(safeStorage.decryptString(encrypted));
  } catch (error) {
    throw new Error(`设备凭据密钥无法解密：${error.message}`);
  }
}

function writeStoredMasterKey({
  safeStorage,
  recordPath,
  masterKey,
  storageBackend,
  fsModule = fs,
}) {
  const directory = path.dirname(recordPath);
  fsModule.mkdirSync(directory, { recursive: true, mode: 0o700 });

  const encrypted = safeStorage.encryptString(masterKey);
  if (!Buffer.isBuffer(encrypted) || !encrypted.length) {
    throw new Error('系统安全存储未返回有效密文');
  }

  const record = {
    version: KEY_RECORD_VERSION,
    protection: KEY_RECORD_PROTECTION,
    storageBackend,
    ciphertext: encrypted.toString('base64'),
  };
  const temporaryPath = `${recordPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    fsModule.writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fsModule.renameSync(temporaryPath, recordPath);
  } catch (error) {
    try {
      if (fsModule.existsSync(temporaryPath)) fsModule.unlinkSync(temporaryPath);
    } catch {}
    throw new Error(`设备凭据密钥无法持久化：${error.message}`);
  }
}

function ensureCredentialMasterKey({
  safeStorage,
  userDataPath,
  configuredKey,
  randomBytes = crypto.randomBytes,
  fsModule = fs,
}) {
  if (configuredKey) {
    return {
      value: decodeMasterKey(configuredKey),
      source: 'environment',
      storageBackend: 'environment',
    };
  }
  if (!userDataPath || !path.isAbsolute(userDataPath)) {
    throw new Error('桌面应用数据目录无效');
  }

  const storageBackend = assertSafeStorageAvailable(safeStorage);
  const recordPath = keyRecordPath(userDataPath);
  if (fsModule.existsSync(recordPath)) {
    return {
      value: readStoredMasterKey({ safeStorage, recordPath, fsModule }),
      source: 'device-store',
      storageBackend,
    };
  }

  const generated = randomBytes(32);
  if (!Buffer.isBuffer(generated) || generated.length !== 32) {
    throw new Error('无法生成 32 字节设备凭据密钥');
  }
  const masterKey = `base64:${generated.toString('base64')}`;
  writeStoredMasterKey({
    safeStorage,
    recordPath,
    masterKey,
    storageBackend,
    fsModule,
  });

  return {
    value: masterKey,
    source: 'generated-device-store',
    storageBackend,
  };
}

module.exports = {
  CREDENTIAL_MASTER_KEY_ENV,
  KEY_RECORD_FILE,
  KEY_RECORD_PROTECTION,
  KEY_RECORD_VERSION,
  decodeMasterKey,
  ensureCredentialMasterKey,
  keyRecordPath,
};
