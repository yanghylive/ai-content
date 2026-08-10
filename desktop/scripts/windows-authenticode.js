const fs = require('fs');
const { spawnSync } = require('child_process');

const IMAGE_DIRECTORY_ENTRY_SECURITY = 4;
const WIN_CERT_TYPE_PKCS_SIGNED_DATA = 0x0002;

function align(value, boundary) {
  return Math.ceil(value / boundary) * boundary;
}

function readUInt16(buffer, offset) {
  return offset >= 0 && offset + 2 <= buffer.length ? buffer.readUInt16LE(offset) : null;
}

function readUInt32(buffer, offset) {
  return offset >= 0 && offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : null;
}

function unsigned(reason, extra = {}) {
  return {
    isPe: true,
    present: false,
    validStructure: true,
    reason,
    certificates: [],
    ...extra,
  };
}

function malformed(reason, extra = {}) {
  return {
    isPe: true,
    present: false,
    validStructure: false,
    reason,
    certificates: [],
    ...extra,
  };
}

function inspectPeAuthenticodeBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64) {
    return {
      isPe: false,
      present: false,
      validStructure: false,
      reason: 'file is too small to be a PE executable',
      certificates: [],
    };
  }
  if (buffer.toString('ascii', 0, 2) !== 'MZ') {
    return {
      isPe: false,
      present: false,
      validStructure: false,
      reason: 'missing DOS MZ header',
      certificates: [],
    };
  }

  const peOffset = readUInt32(buffer, 0x3c);
  if (peOffset === null || peOffset < 64 || peOffset + 24 > buffer.length) {
    return {
      isPe: false,
      present: false,
      validStructure: false,
      reason: 'invalid PE header offset',
      certificates: [],
    };
  }
  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    return {
      isPe: false,
      present: false,
      validStructure: false,
      reason: 'missing PE signature',
      certificates: [],
    };
  }

  const optionalHeaderSize = readUInt16(buffer, peOffset + 20);
  const optionalHeaderOffset = peOffset + 24;
  if (
    optionalHeaderSize === null ||
    optionalHeaderSize === 0 ||
    optionalHeaderOffset + optionalHeaderSize > buffer.length
  ) {
    return malformed('invalid PE optional header size');
  }

  const magic = readUInt16(buffer, optionalHeaderOffset);
  let numberOfDirectoriesOffset;
  let dataDirectoryOffset;
  if (magic === 0x10b) {
    numberOfDirectoriesOffset = optionalHeaderOffset + 92;
    dataDirectoryOffset = optionalHeaderOffset + 96;
  } else if (magic === 0x20b) {
    numberOfDirectoriesOffset = optionalHeaderOffset + 108;
    dataDirectoryOffset = optionalHeaderOffset + 112;
  } else {
    return malformed(`unsupported PE optional header magic 0x${Number(magic || 0).toString(16)}`);
  }

  const numberOfDirectories = readUInt32(buffer, numberOfDirectoriesOffset);
  const securityEntryOffset = dataDirectoryOffset + IMAGE_DIRECTORY_ENTRY_SECURITY * 8;
  if (
    numberOfDirectories === null ||
    numberOfDirectories <= IMAGE_DIRECTORY_ENTRY_SECURITY ||
    securityEntryOffset + 8 > optionalHeaderOffset + optionalHeaderSize
  ) {
    return unsigned('PE optional header has no Security Data Directory');
  }

  // Unlike other PE data directories, the Security Directory address is a file offset.
  const securityOffset = readUInt32(buffer, securityEntryOffset);
  const securitySize = readUInt32(buffer, securityEntryOffset + 4);
  if (!securityOffset || !securitySize) {
    return unsigned('PE Security Data Directory is empty', {
      securityOffset: securityOffset || 0,
      securitySize: securitySize || 0,
    });
  }
  if (securityOffset % 8 !== 0) {
    return malformed('PE Security Data Directory is not 8-byte aligned', {
      securityOffset,
      securitySize,
    });
  }
  if (securityOffset + securitySize > buffer.length) {
    return malformed('PE Security Data Directory extends beyond the file', {
      securityOffset,
      securitySize,
    });
  }

  const certificates = [];
  const securityEnd = securityOffset + securitySize;
  let cursor = securityOffset;
  while (cursor < securityEnd) {
    const remaining = securityEnd - cursor;
    if (remaining < 8) {
      const padding = buffer.subarray(cursor, securityEnd);
      if (padding.every((byte) => byte === 0)) break;
      return malformed('truncated WIN_CERTIFICATE header', { securityOffset, securitySize });
    }

    const length = readUInt32(buffer, cursor);
    const revision = readUInt16(buffer, cursor + 4);
    const certificateType = readUInt16(buffer, cursor + 6);
    if (!length) {
      const padding = buffer.subarray(cursor, securityEnd);
      if (padding.every((byte) => byte === 0)) break;
      return malformed('WIN_CERTIFICATE has zero length', { securityOffset, securitySize });
    }
    if (length < 8 || cursor + length > securityEnd) {
      return malformed('WIN_CERTIFICATE length is outside the Security Data Directory', {
        securityOffset,
        securitySize,
      });
    }

    certificates.push({
      offset: cursor,
      length,
      revision,
      certificateType,
    });
    cursor += align(length, 8);
  }

  const authenticodeCertificates = certificates.filter(
    (certificate) => certificate.certificateType === WIN_CERT_TYPE_PKCS_SIGNED_DATA,
  );
  if (authenticodeCertificates.length === 0) {
    return unsigned('PE certificate table has no PKCS#7 Authenticode entry', {
      securityOffset,
      securitySize,
      certificates,
    });
  }

  return {
    isPe: true,
    present: true,
    validStructure: true,
    reason: `found ${authenticodeCertificates.length} PKCS#7 Authenticode certificate entr${
      authenticodeCertificates.length === 1 ? 'y' : 'ies'
    }`,
    securityOffset,
    securitySize,
    certificates,
  };
}

function inspectPeAuthenticode(filePath) {
  return inspectPeAuthenticodeBuffer(fs.readFileSync(filePath));
}

function combinedOutput(result) {
  return [result?.stdout, result?.stderr]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join('\n');
}

function conciseOutput(value, maxLength = 1200) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function commandMissing(result) {
  return result?.error?.code === 'ENOENT';
}

function verifyWithOsslSigncode(filePath, options) {
  const spawn = options.spawn || spawnSync;
  const executable = options.osslsigncodePath || process.env.KAYPAL_OSSLSIGNCODE || 'osslsigncode';
  const result = spawn(executable, ['verify', '-in', filePath], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (commandMissing(result)) {
    return {
      available: false,
      ok: false,
      verifier: 'osslsigncode',
      detail: `${executable} is not installed or not on PATH`,
    };
  }
  const output = combinedOutput(result);
  return {
    available: true,
    ok: result.status === 0,
    verifier: 'osslsigncode',
    detail: result.status === 0
      ? conciseOutput(output) || 'osslsigncode verified the Authenticode signature'
      : conciseOutput(output) || `osslsigncode exited with status ${result.status}`,
  };
}

function verifyWithPowerShell(filePath, options) {
  const spawn = options.spawn || spawnSync;
  const script = [
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:KAYPAL_AUTHENTICODE_FILE',
    '[pscustomobject]@{',
    '  Status = [string]$signature.Status',
    '  StatusMessage = [string]$signature.StatusMessage',
    '  Subject = [string]$signature.SignerCertificate.Subject',
    '  Thumbprint = [string]$signature.SignerCertificate.Thumbprint',
    '} | ConvertTo-Json -Compress',
  ].join('\n');
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  const candidates = options.powerShellPath
    ? [options.powerShellPath]
    : ['powershell.exe', 'pwsh.exe', 'pwsh'];

  for (const executable of candidates) {
    const result = spawn(
      executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...process.env,
          KAYPAL_AUTHENTICODE_FILE: filePath,
        },
      },
    );
    if (commandMissing(result)) continue;
    const output = combinedOutput(result);
    if (result.status !== 0) {
      return {
        available: true,
        ok: false,
        verifier: 'Get-AuthenticodeSignature',
        detail: conciseOutput(output) || `${executable} exited with status ${result.status}`,
      };
    }
    try {
      const parsed = JSON.parse(String(result.stdout || '').trim());
      return {
        available: true,
        ok: parsed.Status === 'Valid',
        verifier: 'Get-AuthenticodeSignature',
        detail: parsed.Status === 'Valid'
          ? `Status=Valid; signer=${parsed.Subject || '<unknown>'}; thumbprint=${parsed.Thumbprint || '<unknown>'}`
          : `Status=${parsed.Status || '<missing>'}; ${parsed.StatusMessage || 'signature is not valid'}`,
        signer: parsed.Subject || '',
        thumbprint: parsed.Thumbprint || '',
      };
    } catch (error) {
      return {
        available: true,
        ok: false,
        verifier: 'Get-AuthenticodeSignature',
        detail: `could not parse PowerShell verification output: ${error.message}; ${conciseOutput(output)}`,
      };
    }
  }

  return {
    available: false,
    ok: false,
    verifier: 'Get-AuthenticodeSignature',
    detail: 'PowerShell is not available',
  };
}

function verifyAuthenticodeSignature(filePath, options = {}) {
  let inspection;
  try {
    inspection = inspectPeAuthenticode(filePath);
  } catch (error) {
    return {
      ok: false,
      status: 'unreadable',
      verifier: '',
      detail: `cannot read installer: ${error.message}`,
      inspection: null,
    };
  }

  if (!inspection.isPe || !inspection.validStructure) {
    return {
      ok: false,
      status: 'malformed',
      verifier: '',
      detail: `installer is not a valid signed PE file: ${inspection.reason}`,
      inspection,
    };
  }
  if (!inspection.present) {
    return {
      ok: false,
      status: 'unsigned',
      verifier: '',
      detail: `installer is unsigned: ${inspection.reason}`,
      inspection,
    };
  }

  const platform = options.platform || process.platform;
  let verification;
  if (platform === 'win32') {
    verification = verifyWithPowerShell(filePath, options);
    if (!verification.available) {
      verification = verifyWithOsslSigncode(filePath, options);
    }
  } else {
    verification = verifyWithOsslSigncode(filePath, options);
  }

  if (!verification.available) {
    return {
      ok: false,
      status: 'unverified',
      verifier: verification.verifier,
      detail: `embedded Authenticode signature is present but cannot be verified: ${verification.detail}`,
      inspection,
    };
  }
  if (!verification.ok) {
    return {
      ok: false,
      status: 'invalid',
      verifier: verification.verifier,
      detail: `embedded Authenticode signature failed verification with ${verification.verifier}: ${verification.detail}`,
      inspection,
    };
  }
  return {
    ok: true,
    status: 'valid',
    verifier: verification.verifier,
    detail: `embedded Authenticode signature verified with ${verification.verifier}: ${verification.detail}`,
    signer: verification.signer || '',
    thumbprint: verification.thumbprint || '',
    inspection,
  };
}

module.exports = {
  IMAGE_DIRECTORY_ENTRY_SECURITY,
  WIN_CERT_TYPE_PKCS_SIGNED_DATA,
  inspectPeAuthenticode,
  inspectPeAuthenticodeBuffer,
  verifyAuthenticodeSignature,
};
