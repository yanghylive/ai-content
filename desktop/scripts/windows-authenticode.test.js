const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  inspectPeAuthenticodeBuffer,
  verifyAuthenticodeSignature,
} = require('./windows-authenticode');

function peFixture({ signed = false, malformedCertificate = false } = {}) {
  const peOffset = 0x80;
  const optionalHeaderOffset = peOffset + 24;
  const optionalHeaderSize = 0xe0;
  const securityOffset = 0x400;
  const securitySize = 24;
  const buffer = Buffer.alloc(0x600);
  buffer.write('MZ', 0, 'ascii');
  buffer.writeUInt32LE(peOffset, 0x3c);
  buffer.write('PE\0\0', peOffset, 'ascii');
  buffer.writeUInt16LE(optionalHeaderSize, peOffset + 20);
  buffer.writeUInt16LE(0x10b, optionalHeaderOffset);
  buffer.writeUInt32LE(16, optionalHeaderOffset + 92);

  if (signed) {
    const securityEntryOffset = optionalHeaderOffset + 96 + 4 * 8;
    buffer.writeUInt32LE(securityOffset, securityEntryOffset);
    buffer.writeUInt32LE(securitySize, securityEntryOffset + 4);
    buffer.writeUInt32LE(malformedCertificate ? securitySize + 8 : securitySize, securityOffset);
    buffer.writeUInt16LE(0x0200, securityOffset + 4);
    buffer.writeUInt16LE(0x0002, securityOffset + 6);
    buffer.fill(0x5a, securityOffset + 8, securityOffset + securitySize);
  }

  return buffer;
}

function withFixture(buffer, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaypal-authenticode-'));
  const filePath = path.join(root, 'fixture.exe');
  try {
    fs.writeFileSync(filePath, buffer);
    return run(filePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function missingCommand() {
  const error = new Error('spawn ENOENT');
  error.code = 'ENOENT';
  return { status: null, stdout: '', stderr: '', error };
}

test('PE parser identifies an unsigned installer from an empty Security Directory', () => {
  const result = inspectPeAuthenticodeBuffer(peFixture());
  assert.equal(result.isPe, true);
  assert.equal(result.present, false);
  assert.equal(result.validStructure, true);
  assert.match(result.reason, /Security Data Directory is empty/);
});

test('PE parser identifies a structurally present PKCS#7 Authenticode entry', () => {
  const result = inspectPeAuthenticodeBuffer(peFixture({ signed: true }));
  assert.equal(result.present, true);
  assert.equal(result.validStructure, true);
  assert.equal(result.certificates.length, 1);
  assert.equal(result.certificates[0].certificateType, 0x0002);
});

test('PE parser rejects a certificate entry extending outside its directory', () => {
  const result = inspectPeAuthenticodeBuffer(
    peFixture({ signed: true, malformedCertificate: true }),
  );
  assert.equal(result.present, false);
  assert.equal(result.validStructure, false);
  assert.match(result.reason, /length is outside/);
});

test('unsigned installers fail before invoking an external verifier', () => {
  withFixture(peFixture(), (filePath) => {
    let spawned = false;
    const result = verifyAuthenticodeSignature(filePath, {
      platform: 'darwin',
      spawn() {
        spawned = true;
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'unsigned');
    assert.equal(spawned, false);
  });
});

test('signed installers fail closed when no cryptographic verifier is available', () => {
  withFixture(peFixture({ signed: true }), (filePath) => {
    const result = verifyAuthenticodeSignature(filePath, {
      platform: 'darwin',
      spawn: missingCommand,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'unverified');
    assert.match(result.detail, /cannot be verified/);
  });
});

test('osslsigncode success is required for a signed installer on macOS builders', () => {
  withFixture(peFixture({ signed: true }), (filePath) => {
    const valid = verifyAuthenticodeSignature(filePath, {
      platform: 'darwin',
      spawn() {
        return { status: 0, stdout: 'Signature verification: ok', stderr: '' };
      },
    });
    assert.equal(valid.ok, true);
    assert.equal(valid.status, 'valid');
    assert.equal(valid.verifier, 'osslsigncode');

    const invalid = verifyAuthenticodeSignature(filePath, {
      platform: 'darwin',
      spawn() {
        return { status: 1, stdout: '', stderr: 'Signature verification failed' };
      },
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.status, 'invalid');
  });
});
