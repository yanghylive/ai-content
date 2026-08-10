import process from 'node:process';

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const INSTALLER_SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;

export class ReleaseEvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseEvidenceError';
  }
}

export function readReleaseEvidence(env = process.env, { required = false } = {}) {
  const appVersion = env.RELEASE_VERSION;
  const installerSha256 = env.RELEASE_INSTALLER_SHA256;
  const hasVersion = typeof appVersion === 'string' && appVersion.length > 0;
  const hasInstallerSha256 = typeof installerSha256 === 'string' && installerSha256.length > 0;

  if (hasVersion !== hasInstallerSha256) {
    throw new ReleaseEvidenceError(
      'RELEASE_VERSION and RELEASE_INSTALLER_SHA256 must be provided together.',
    );
  }
  if (!hasVersion) {
    if (!required) return null;
    throw new ReleaseEvidenceError(
      'RELEASE_VERSION and RELEASE_INSTALLER_SHA256 are required for release evidence.',
    );
  }
  if (!SEMVER_PATTERN.test(appVersion)) {
    throw new ReleaseEvidenceError('RELEASE_VERSION must be a valid semantic version.');
  }
  if (!INSTALLER_SHA256_PATTERN.test(installerSha256)) {
    throw new ReleaseEvidenceError(
      'RELEASE_INSTALLER_SHA256 must contain exactly 64 hexadecimal characters.',
    );
  }

  return Object.freeze({
    appVersion,
    installerSha256: installerSha256.toLowerCase(),
  });
}
