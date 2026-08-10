import assert from 'node:assert/strict';
import test from 'node:test';

import { ReleaseEvidenceError, readReleaseEvidence } from './release-evidence.mjs';

const installerSha256 = '7798c59c89c24c29fe18638196673e677512a0401ad60d9fa3c7ee0e901f3843';

test('returns validated release evidence with report field names', () => {
  const result = readReleaseEvidence({
    RELEASE_VERSION: '1.1.48',
    RELEASE_INSTALLER_SHA256: installerSha256.toUpperCase(),
  });

  assert.deepEqual(result, {
    appVersion: '1.1.48',
    installerSha256,
  });
  assert.equal(Object.isFrozen(result), true);
});

test('accepts SemVer prerelease and build metadata', () => {
  assert.equal(
    readReleaseEvidence({
      RELEASE_VERSION: '2.0.0-rc.1+win.20260717',
      RELEASE_INSTALLER_SHA256: installerSha256,
    }).appVersion,
    '2.0.0-rc.1+win.20260717',
  );
});

test('allows an ordinary non-release check when both values are absent', () => {
  assert.equal(readReleaseEvidence({}), null);
});

test('fails closed when release evidence is required and both values are absent', () => {
  assert.throws(
    () => readReleaseEvidence({}, { required: true }),
    (error) => error instanceof ReleaseEvidenceError && /are required/.test(error.message),
  );
});

test('fails closed when only one release evidence value is provided', () => {
  assert.throws(
    () => readReleaseEvidence({ RELEASE_VERSION: '1.1.48' }),
    (error) => error instanceof ReleaseEvidenceError && /provided together/.test(error.message),
  );
  assert.throws(
    () => readReleaseEvidence({ RELEASE_INSTALLER_SHA256: installerSha256 }),
    (error) => error instanceof ReleaseEvidenceError && /provided together/.test(error.message),
  );
});

test('rejects non-SemVer and padded versions', () => {
  for (const version of ['1.1', 'v1.1.48', '01.1.48', '1.1.48 ', '1.1.48-01']) {
    assert.throws(
      () =>
        readReleaseEvidence({
          RELEASE_VERSION: version,
          RELEASE_INSTALLER_SHA256: installerSha256,
        }),
      /valid semantic version/,
      version,
    );
  }
});

test('rejects SHA-256 values that are not exactly 64 hexadecimal characters', () => {
  for (const sha256 of [installerSha256.slice(1), `${installerSha256}0`, `${installerSha256.slice(0, -1)}g`, ` ${installerSha256}`]) {
    assert.throws(
      () =>
        readReleaseEvidence({
          RELEASE_VERSION: '1.1.48',
          RELEASE_INSTALLER_SHA256: sha256,
        }),
      /64 hexadecimal characters/,
      sha256,
    );
  }
});
