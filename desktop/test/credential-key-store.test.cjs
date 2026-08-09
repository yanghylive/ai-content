'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CREDENTIAL_MASTER_KEY_ENV,
  KEY_RECORD_FILE,
  ensureCredentialMasterKey,
} = require('../credential-key-store');

function makeSafeStorage({ available = true, backend = 'dpapi' } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^protected:/, ''),
  };
}

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jiuzhang-key-store-'));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('首次启动生成 32 字节密钥，后续启动和版本升级复用同一密钥', () => {
  withTempDirectory((userDataPath) => {
    const safeStorage = makeSafeStorage();
    const first = ensureCredentialMasterKey({
      safeStorage,
      userDataPath,
      randomBytes: () => Buffer.alloc(32, 9),
    });
    const second = ensureCredentialMasterKey({
      safeStorage,
      userDataPath,
      randomBytes: () => Buffer.alloc(32, 3),
    });

    assert.equal(first.source, 'generated-device-store');
    assert.equal(second.source, 'device-store');
    assert.equal(second.value, first.value);
    assert.match(first.value, /^base64:/);
    assert.equal(
      fs.existsSync(path.join(userDataPath, 'security', KEY_RECORD_FILE)),
      true,
    );
  });
});

test('持久化记录不包含明文主密钥', () => {
  withTempDirectory((userDataPath) => {
    const result = ensureCredentialMasterKey({
      safeStorage: makeSafeStorage(),
      userDataPath,
      randomBytes: () => Buffer.alloc(32, 5),
    });
    const record = fs.readFileSync(
      path.join(userDataPath, 'security', KEY_RECORD_FILE),
      'utf8',
    );

    assert.equal(record.includes(result.value), false);
    assert.match(record, /electron\.safeStorage/);
  });
});

test('拒绝系统明文安全存储和不可用的安全存储', () => {
  withTempDirectory((userDataPath) => {
    assert.throws(
      () => ensureCredentialMasterKey({
        safeStorage: makeSafeStorage({ backend: 'basic_text' }),
        userDataPath,
      }),
      /明文安全存储/,
    );
    assert.throws(
      () => ensureCredentialMasterKey({
        safeStorage: makeSafeStorage({ available: false }),
        userDataPath,
      }),
      /尚未就绪/,
    );
  });
});

test('损坏或无法解密的记录必须失败，禁止静默轮换密钥', () => {
  withTempDirectory((userDataPath) => {
    const securityDir = path.join(userDataPath, 'security');
    fs.mkdirSync(securityDir, { recursive: true });
    fs.writeFileSync(
      path.join(securityDir, KEY_RECORD_FILE),
      JSON.stringify({
        version: 1,
        protection: 'electron.safeStorage',
        ciphertext: Buffer.from('not-protected').toString('base64'),
      }),
    );

    const safeStorage = makeSafeStorage();
    safeStorage.decryptString = () => {
      throw new Error('DPAPI decrypt failed');
    };
    assert.throws(
      () => ensureCredentialMasterKey({ safeStorage, userDataPath }),
      /无法解密/,
    );
  });
});

test('已有加密数据但密钥记录缺失时禁止生成新密钥', () => {
  withTempDirectory((userDataPath) => {
    assert.throws(
      () => ensureCredentialMasterKey({
        safeStorage: makeSafeStorage(),
        userDataPath,
        allowCreate: false,
      }),
      /已加密账号数据.*密钥记录缺失/,
    );
    assert.equal(
      fs.existsSync(path.join(userDataPath, 'security', KEY_RECORD_FILE)),
      false,
    );
  });
});

test('开发环境显式密钥经过长度校验和规范化', () => {
  const key = Buffer.alloc(32, 1).toString('base64');
  const result = ensureCredentialMasterKey({
    configuredKey: key,
    safeStorage: null,
    userDataPath: '',
  });
  assert.equal(result.value, `base64:${key}`);
  assert.equal(result.source, 'environment');
  assert.throws(
    () => ensureCredentialMasterKey({
      configuredKey: 'too-short',
      safeStorage: null,
      userDataPath: '',
    }),
    new RegExp(CREDENTIAL_MASTER_KEY_ENV),
  );
});
