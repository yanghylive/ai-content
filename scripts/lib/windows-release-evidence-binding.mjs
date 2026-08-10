import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TRUSTED_ARCHITECTURE_SOURCES = new Set([
  "dotnet-runtime-information",
  "PROCESSOR_ARCHITEW6432",
]);

export function normalizeWindowsArchitecture(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["amd64", "x64", "x86_64", "x86-64"].includes(normalized)) return "x64";
  if (["arm64", "aarch64", "arm64ec"].includes(normalized)) return "arm64";
  if (["x86", "i386", "i686", "ia32"].includes(normalized)) return "x86";
  return "";
}

export function resolveWindowsCandidateArchitecture(packageJson) {
  const targets = Array.isArray(packageJson?.build?.win?.target)
    ? packageJson.build.win.target
    : [];
  if (targets.length === 0) return "";
  const architectures = new Set();
  for (const target of targets) {
    const values = Array.isArray(target?.arch) ? target.arch : [];
    if (values.length === 0) return "";
    for (const value of values) {
      const architecture = normalizeWindowsArchitecture(value);
      if (!architecture) return "";
      architectures.add(architecture);
    }
  }
  return architectures.size === 1 ? [...architectures][0] : "";
}

export function detectWindowsEvidenceArchitecture({
  platform = process.platform,
  processArch = process.arch,
  env = process.env,
  queryNativeArchitecture,
} = {}) {
  const normalizedProcessArch = normalizeWindowsArchitecture(processArch);
  if (platform !== "win32") {
    return {
      osPlatform: platform,
      osArchitecture: "",
      processArch: normalizedProcessArch,
      osArchitectureSource: "non-windows",
    };
  }

  let runtimeArchitecture = "";
  try {
    runtimeArchitecture = normalizeWindowsArchitecture(
      queryNativeArchitecture
        ? queryNativeArchitecture()
        : execFileSync(
            "powershell.exe",
            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()",
            ],
            { encoding: "utf8", windowsHide: true },
          ),
    );
  } catch {
    runtimeArchitecture = "";
  }
  if (runtimeArchitecture) {
    return {
      osPlatform: "win32",
      osArchitecture: runtimeArchitecture,
      processArch: normalizedProcessArch,
      osArchitectureSource: "dotnet-runtime-information",
    };
  }

  const wowArchitecture = normalizeWindowsArchitecture(env.PROCESSOR_ARCHITEW6432);
  if (wowArchitecture) {
    return {
      osPlatform: "win32",
      osArchitecture: wowArchitecture,
      processArch: normalizedProcessArch,
      osArchitectureSource: "PROCESSOR_ARCHITEW6432",
    };
  }
  return {
    osPlatform: "win32",
    osArchitecture: "",
    processArch: normalizedProcessArch,
    osArchitectureSource: "unresolved",
  };
}

function normalizeVersion(value) {
  const normalized = String(value || "").trim().replace(/^v/i, "");
  return VERSION_PATTERN.test(normalized) ? normalized : "";
}

function normalizeSha256(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SHA256_PATTERN.test(normalized) ? normalized : "";
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`invalid JSON ${filePath}: ${error.message}`);
  }
}

function parseLatestYml(filePath) {
  if (!existsSync(filePath)) return { version: "", path: "" };
  const source = readFileSync(filePath, "utf8");
  const pick = (pattern) => {
    const match = source.match(pattern);
    return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : "";
  };
  return {
    version: normalizeVersion(pick(/^\s*version:\s*([^\r\n#]+)\s*$/m)),
    path: pick(/^\s*path:\s*([^\r\n#]+)\s*$/m),
  };
}

function hashFile(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function resolvePath(value, baseDir) {
  if (!value) return "";
  return isAbsolute(value) ? value : resolve(baseDir, value);
}

export function hasWindowsReleaseEvidenceBinding(binding) {
  return Boolean(
    normalizeVersion(binding?.appVersion) &&
      normalizeSha256(binding?.installerSha256),
  );
}

export function resolveWindowsReleaseEvidenceBinding({
  repoRoot,
  args = {},
  env = process.env,
  required = false,
  detectArchitecture = detectWindowsEvidenceArchitecture,
} = {}) {
  if (!repoRoot) throw new Error("repoRoot is required to resolve Windows release evidence");

  const desktopRoot = join(repoRoot, "desktop");
  const packagePath = join(desktopRoot, "package.json");
  const packageJson = readJson(packagePath);
  const packageVersion = normalizeVersion(packageJson?.version);
  const candidateArchitecture = resolveWindowsCandidateArchitecture(packageJson);
  const architecture = detectArchitecture({ env });
  const latestYmlPath = resolvePath(
    args.latestYml ||
      args.latestYmlPath ||
      env.WINDOWS_ACCEPT_LATEST_YML ||
      join(desktopRoot, "dist", "latest.yml"),
    repoRoot,
  );
  const latest = parseLatestYml(latestYmlPath);

  const requestedVersionRaw =
    args.appVersion || env.WINDOWS_ACCEPT_APP_VERSION || packageVersion || latest.version;
  const appVersion = normalizeVersion(requestedVersionRaw);
  if (requestedVersionRaw && !appVersion) {
    throw new Error(`invalid Windows acceptance app version: ${requestedVersionRaw}`);
  }
  if (packageVersion && appVersion && packageVersion !== appVersion) {
    throw new Error(
      `Windows acceptance app version ${appVersion} does not match desktop/package.json ${packageVersion}`,
    );
  }
  if (latest.version && appVersion && latest.version !== appVersion) {
    throw new Error(
      `Windows acceptance app version ${appVersion} does not match latest.yml ${latest.version}`,
    );
  }

  const explicitInstallerPath = args.installerPath || env.WINDOWS_ACCEPT_INSTALLER_PATH || "";
  const installerPath = explicitInstallerPath
    ? resolvePath(explicitInstallerPath, repoRoot)
    : latest.path
      ? resolve(dirname(latestYmlPath), latest.path)
      : "";
  if (explicitInstallerPath && !existsSync(installerPath)) {
    throw new Error(`Windows acceptance installer does not exist: ${installerPath}`);
  }
  if (installerPath && existsSync(installerPath) && !statSync(installerPath).isFile()) {
    throw new Error(`Windows acceptance installer is not a file: ${installerPath}`);
  }

  const requestedShaRaw =
    args.installerSha256 || env.WINDOWS_ACCEPT_INSTALLER_SHA256 || "";
  const requestedSha256 = normalizeSha256(requestedShaRaw);
  if (requestedShaRaw && !requestedSha256) {
    throw new Error("Windows acceptance installer SHA256 must be 64 hexadecimal characters");
  }
  const computedSha256 =
    installerPath && existsSync(installerPath) ? hashFile(installerPath) : "";
  if (requestedSha256 && computedSha256 && requestedSha256 !== computedSha256) {
    throw new Error(
      `Windows acceptance installer SHA256 ${requestedSha256} does not match ${computedSha256}`,
    );
  }
  const installerSha256 = requestedSha256 || computedSha256;

  const binding = {
    appVersion,
    installerSha256,
    installerPath,
    installerFile: installerPath ? basename(installerPath) : "",
    candidateArchitecture,
    ...architecture,
  };
  if (required && !hasWindowsReleaseEvidenceBinding(binding)) {
    throw new Error(
      "real Windows acceptance requires appVersion and installerSha256; pass --app-version and --installer-sha256, pass --installer-path, or keep a matching desktop/dist/latest.yml and installer",
    );
  }
  if (required && binding.osPlatform !== "win32") {
    throw new Error(
      `real Windows acceptance must run on the local Windows machine; detected platform=${binding.osPlatform || "unknown"}`,
    );
  }
  if (required && !binding.candidateArchitecture) {
    throw new Error(
      "real Windows acceptance requires exactly one explicit desktop build.win.target architecture",
    );
  }
  if (required && !binding.osArchitecture) {
    throw new Error(
      "real Windows acceptance requires a native osArchitecture from RuntimeInformation or Windows architecture environment data",
    );
  }
  if (required && !binding.processArch) {
    throw new Error("real Windows acceptance requires a recognized processArch");
  }
  if (
    required &&
    !TRUSTED_ARCHITECTURE_SOURCES.has(binding.osArchitectureSource)
  ) {
    throw new Error(
      `real Windows acceptance requires a trusted native architecture source; detected source=${binding.osArchitectureSource || "unknown"}`,
    );
  }
  if (
    required &&
    binding.candidateArchitecture &&
    binding.osArchitecture !== binding.candidateArchitecture
  ) {
    throw new Error(
      `Windows ${binding.candidateArchitecture} candidate cannot be accepted on ${binding.osArchitecture}; process.arch=${binding.processArch || "unknown"} does not override the native OS architecture`,
    );
  }
  return binding;
}

export function bindWindowsReleaseEvidence(value, binding) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : { value };
  return {
    ...record,
    ...(hasWindowsReleaseEvidenceBinding(binding)
      ? {
          appVersion: binding.appVersion,
          installerSha256: binding.installerSha256,
        }
      : {}),
    ...(binding?.candidateArchitecture
      ? { candidateArchitecture: binding.candidateArchitecture }
      : {}),
    ...(binding?.osPlatform ? { osPlatform: binding.osPlatform } : {}),
    ...(binding?.osArchitecture
      ? { osArchitecture: binding.osArchitecture }
      : {}),
    ...(binding?.processArch ? { processArch: binding.processArch } : {}),
    ...(binding?.osArchitectureSource
      ? { osArchitectureSource: binding.osArchitectureSource }
      : {}),
  };
}

export function writeWindowsReleaseEvidenceManifest({
  evidenceDir,
  binding,
  evidenceType,
  generatedAt = new Date().toISOString(),
}) {
  if (!hasWindowsReleaseEvidenceBinding(binding)) return "";
  const manifestPath = join(evidenceDir, "release-evidence.json");
  const manifest = bindWindowsReleaseEvidence(
    {
      schemaVersion: "2026-07-20.windows-release-evidence-v2",
      evidenceType,
      generatedAt,
      installer: {
        version: binding.appVersion,
        sha256: binding.installerSha256,
        file: binding.installerFile || "",
      },
      system: {
        osPlatform: binding.osPlatform,
        osArchitecture: binding.osArchitecture,
        processArch: binding.processArch,
        osArchitectureSource: binding.osArchitectureSource,
      },
    },
    binding,
  );
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

export function windowsReleaseEvidenceMarkdown(binding) {
  const lines = [];
  if (hasWindowsReleaseEvidenceBinding(binding)) {
    lines.push(`- App version: ${binding.appVersion}`);
    lines.push(`- Installer SHA-256: ${binding.installerSha256}`);
  }
  if (binding?.candidateArchitecture) {
    lines.push(`- Candidate architecture: ${binding.candidateArchitecture}`);
  }
  if (binding?.osPlatform) {
    lines.push(`- OS platform: ${binding.osPlatform}`);
  }
  if (binding?.osArchitecture) {
    lines.push(`- OS architecture: ${binding.osArchitecture}`);
  }
  if (binding?.processArch) {
    lines.push(`- Process architecture: ${binding.processArch}`);
  }
  if (binding?.osArchitectureSource) {
    lines.push(`- OS architecture source: ${binding.osArchitectureSource}`);
  }
  return lines;
}
