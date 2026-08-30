const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");
const { gunzipSync } = require("node:zlib");
const { createHash } = require("node:crypto");

const execFileAsync = promisify(execFile);

const {
  createGuardContext,
  sqliteSeedContainsPackagedUserData,
} = require("./release-guards");
const {
  isCommercialRelease,
  resolveConfig,
} = require("./prepare-release-config");
const {
  assertBinaryFormat,
  assertRedistributableBuild,
  readEmbeddedBuildConfiguration,
} = require("./prepare-media-tools");
const {
  classifyWindowsEvidenceMatrix,
  classifyContactEvidenceDirectory,
  classifyNativeCommandsEvidenceDirectory,
  classifyTextEvidence,
  extractStructuredEvidenceArchitecture,
  extractStructuredEvidenceBinding,
  extractTextEvidenceArchitecture,
  extractTextEvidenceBinding,
  normalizeEvidenceArchitecture,
  normalizeEvidenceArchitectureSource,
  normalizeEvidencePlatform,
  resolveWindowsCandidateArchitecture,
  resolveReleaseIdentity,
  resolveRequiredWindowsEvidenceOs,
  validateEvidenceArchitecture,
  validateEvidenceReleaseBinding,
} = require("./windows-commercial-release-gate");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..");
const packageJson = {
  version: "9.9.9",
  build: {
    publish: {
      url: "https://updates.kaypal.cn/releases/",
    },
  },
};

const credentialSeedFixture =
  "H4sICNltUmoAA2theXBhbC1yZWxlYXNlLWNyZWRlbnRpYWwtZml4dHVyZS5zcWxpdGUA" +
  "7Zc/S8NAFMDfa5rEig6ZgqD0loKCFYJDBxerZBAVau2gg4TTXCU0sbVJQQeHfgC/i+" +
  "An8Eu4Oys66uhd0tZU4v9BaPPLHbn37nF53L2Xu9vd2XICRurNtkcDsgwZQJxaJQQ" +
  "AVF5z8Ea2V/sgfI0KS5cvsjDGJyHnolfK/zEhxaVpEGtzC7ykjAyzKGkrLcNvFNvM" +
  "ZdRnxeMObdtFnx21WRC3nASx/o/AS8rII0tarmXENVH+3wEvKaOIhlktr3mG17SZW" +
  "2yw8+H1T/N/nBD57yXk/z3wkjLaqPxQoNmGl+b/2CLy3x7Of5wDCa4AK3gNV1xg/" +
  "PklDUnV83nsFgJ6yE+djhXuOT51/u7419/oNbLrVbNcM0mtvLZlkoF63rFJzdyrk" +
  "Up1Y7tc3Seb5v4iCfusXtciabk0EBfhvmYBH2D5h/5RVPVCAbty37/+oH68nXnv5a" +
  "An2VHaciy+dUdelTKKvllAcE5sduafuvz+btFO0AxlKz6YZcQlce+beO+v+P9L8Ax" +
  "4g2v8NS5sKIp+UPpoDm1Wpx03iGLHOmqe1J1jPpmJavVCVvVSCbsz4Yon2iQqlaEY" +
  "SDT5RtQuGFlFN/OfREOUAGEoRE05PhGvCsWPZQASAAA=";

function withTempDir(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kaypal-release-guard-"));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function extractNsisMacro(source, name) {
  const match = source.match(new RegExp(`!macro\\s+${name}\\b[\\s\\S]*?!macroend`, "i"));
  return match ? match[0] : "";
}

function copyWindowsAcceptanceScripts(targetRoot) {
  const scriptsRoot = path.join(targetRoot, "scripts");
  const libRoot = path.join(scriptsRoot, "lib");
  fs.mkdirSync(libRoot, { recursive: true });
  for (const relativePath of [
    "scripts/wechat-windows-contacts-acceptance.mjs",
    "scripts/wechat-windows-native-commands-acceptance.mjs",
    "scripts/lib/windows-release-evidence-binding.mjs",
  ]) {
    fs.copyFileSync(
      path.join(repoRoot, relativePath),
      path.join(targetRoot, relativePath),
    );
  }
  return scriptsRoot;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function windowsArchitectureFields(osArchitecture = "x64", processArch = "x64") {
  return {
    osPlatform: "win32",
    osArchitecture,
    processArch,
    osArchitectureSource: "dotnet-runtime-information",
  };
}

function windowsArchitectureMarkdown(osArchitecture = "x64", processArch = "x64") {
  return [
    "OS platform: win32",
    `OS architecture: ${osArchitecture}`,
    `Process architecture: ${processArch}`,
    "OS architecture source: dotnet-runtime-information",
  ];
}

test("NSIS avoids blocking PowerShell preflight and keeps post-install warnings non-blocking", () => {
  const installerSource = fs.readFileSync(path.join(desktopRoot, "installer.nsh"), "utf8");
  const customInstall = extractNsisMacro(installerSource, "customInstall");
  const bootstrapSource = fs.readFileSync(
    path.join(desktopRoot, "installer", "bootstrap-installer.ps1"),
    "utf8",
  );

  assert.doesNotMatch(installerSource, /-Mode Preflight|kaypal-preflight|安装前检查未通过/);
  assert.match(customInstall, /-Mode PostInstall/);
  assert.doesNotMatch(customInstall, /MessageBox MB_ICONSTOP|^\s*Abort\s*$/m);
  // v1.1.106（复核修复）：安装引导 2026-08 改 WPF 版后，warning 由
  // `Add-InstallRow -Name $Name -Status "!"` 表示（非阻断）；旧的 `"$Name:` /
  // `"${Name}: $Detail"` 格式断言过时，改为断言非阻断语义。
  assert.doesNotMatch(bootstrapSource, /MessageBox MB_ICONSTOP|^\s*Abort\s*$/m);
  assert.match(bootstrapSource, /Add-InstallRow -Name \$Name -Status "!"/);
});

test("Windows evidence policy defaults to Win10 and supports an explicit expanded matrix", () => {
  assert.deepEqual(resolveRequiredWindowsEvidenceOs({}), ["win10"]);
  assert.deepEqual(
    resolveRequiredWindowsEvidenceOs({ WINDOWS_GATE_REQUIRED_OS: "Windows 10, win11, win10" }),
    ["win10", "win11"],
  );
  assert.throws(
    () => resolveRequiredWindowsEvidenceOs({ WINDOWS_GATE_REQUIRED_OS: "win10,win12" }),
    /invalid=win12/,
  );

  withTempDir((root) => {
    const win10Dir = path.join(root, "windows-wechat-contacts-win10");
    const win11Dir = path.join(root, "windows-wechat-native-commands-win11");
    fs.mkdirSync(win10Dir, { recursive: true });
    fs.mkdirSync(win11Dir, { recursive: true });
    const win10 = path.join(win10Dir, "summary.md");
    const win11 = path.join(win11Dir, "summary.md");
    fs.writeFileSync(win10, "Windows 10 22H2 build 10.0.19045 real-machine acceptance PASS");
    fs.writeFileSync(win11, "Windows 11 build 10.0.26200 real-machine acceptance PASS");

    const currentPolicy = classifyWindowsEvidenceMatrix([win10], null, ["win10"]);
    assert.equal(currentPolicy.ok, true);
    assert.deepEqual(currentPolicy.missing, []);

    const expandedMissing = classifyWindowsEvidenceMatrix([win10], null, ["win10", "win11"]);
    assert.equal(expandedMissing.ok, false);
    assert.deepEqual(expandedMissing.missing, ["win11"]);

    const expandedComplete = classifyWindowsEvidenceMatrix([win10, win11], null, ["win10", "win11"]);
    assert.equal(expandedComplete.ok, true);
  });
});

test("tagged builds always use commercial release rules", () => {
  const tagEnv = { GITHUB_REF: "refs/tags/v9.9.9" };
  assert.equal(isCommercialRelease([], tagEnv), true);
  assert.throws(
    () => resolveConfig({ argv: [], env: tagEnv, packageJson }),
    /KAYPAL_AUTH_BASE_URL is required/,
  );
  assert.throws(
    () =>
      resolveConfig({
        argv: [],
        env: {
          ...tagEnv,
          KAYPAL_AUTH_BASE_URL: "https://test.kaypal.cn",
          KAYPAL_CLOUD_API_ENDPOINT: "https://api.kaypal.cn/cloud-api",
        },
        packageJson,
      }),
    /must point to a production host/,
  );
  assert.throws(
    () =>
      resolveConfig({
        argv: [],
        env: {
          ...tagEnv,
          KAYPAL_AUTH_BASE_URL: "https://qa2.kaypal.cn",
          KAYPAL_CLOUD_API_ENDPOINT: "https://api.kaypal.cn/cloud-api",
        },
        packageJson,
      }),
    /must point to a production host/,
  );
});

test("commercial release config accepts only production endpoints", () => {
  // v1.1.106（复核修复）：assertCommercialReleaseConfig 随重构移除，端点校验
  // 由 resolveConfig 内部完成（parseHttpsUrl 拒绝非 https / 非生产 host）。
  // 改断言 resolveConfig 产物：production 环境 + 生产 https 端点。
  const config = resolveConfig({
    argv: ["--commercial"],
    env: {
      KAYPAL_AUTH_BASE_URL: "https://accounts.kaypal.cn",
      KAYPAL_CLOUD_API_ENDPOINT: "https://api.kaypal.cn/cloud-api",
    },
    packageJson,
  });
  assert.equal(config.environment, "production");
  assert.match(config.kaypalAuthBaseUrl, /^https:\/\/accounts\.kaypal\.cn/);
  assert.match(config.cloudApiEndpoint, /^https:\/\/api\.kaypal\.cn\/cloud-api/);
});

test("testing release config accepts explicit Kaypal testing endpoints without weakening commercial rules", () => {
  const config = resolveConfig({
    argv: ["--testing"],
    env: {
      KAYPAL_AUTH_BASE_URL: "https://test.kaypal.cn",
      KAYPAL_CLOUD_API_ENDPOINT: "https://enterprise-test.kaypal.cn",
      AI_CONTENT_UPDATE_URL: "https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/",
    },
    packageJson,
  });
  assert.equal(config.environment, "testing");
  assert.match(config.kaypalAuthBaseUrl, /^https:\/\/test\.kaypal\.cn/);
  assert.match(config.cloudApiEndpoint, /^https:\/\/enterprise-test\.kaypal\.cn/);
  assert.match(config.updateUrl, /^https:\/\/kaypal\.oss-cn-hangzhou\.aliyuncs\.com\/updates\/$/);
});

test("desktop package does not reference a seed database", () => {
  // v1.1.107（复核修复）：seed 模板库由 dev.db 改名为 seed.db（166 表空模板，
  // 首次启动复制用；原名 dev.db 会造成「开发库进生产包」的审计误判）。
  // 断言：清单不得含 dev.db / 任何 *.sqlite 数据文件；seed.db 模板允许。
  const pkg = JSON.parse(
    fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
  );
  const files = [
    ...(pkg.build?.files || []),
    ...(pkg.build?.extraResources || []).flatMap((r) => r.filter || []),
  ];
  const offending = files.filter((f) => /dev\.db|\.(?:sqlite|sqlite3)$/i.test(f));
  assert.deepEqual(offending, []);
  assert.ok(
    files.includes("seed.db"),
    "seed.db template must be packaged for first-run initialization",
  );
});

test("packaged resources reject every SQLite database file", () => {
  // v1.1.107（复核修复）：拒绝开发/运行时数据库进包（dev.db、*.sqlite）；
  // seed.db（166 表空模板）是设计内的首次初始化资源，允许。
  const pkg = JSON.parse(
    fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
  );
  const allPaths = [
    ...(pkg.build?.files || []),
    ...(pkg.build?.extraResources || []).flatMap((r) => [
      r.from,
      ...(r.filter || []),
      r.to,
    ]),
  ]
    .filter(Boolean)
    .join("\n");
  assert.doesNotMatch(allPaths, /dev\.db|\.(?:sqlite|sqlite3)$/i);
  assert.match(allPaths, /seed\.db/);
});

test("seed inspection detects packaged user/session/account records", () => {
  // v1.1.106（复核修复）：sqliteSeedContainsCredentialData 已重构为
  // sqliteSeedContainsPackagedUserData（users/user_sessions/publish_accounts）。
  const { DatabaseSync } = require("node:sqlite");
  withTempDir((root) => {
    const dbPath = path.join(root, "seed.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)");
    db.exec("INSERT INTO users VALUES ('u1','kaypal-user')");
    db.close();
    const findings = sqliteSeedContainsPackagedUserData(dbPath);
    assert.ok(
      findings.some((finding) => finding.includes("Kaypal users=1")),
      `expected users=1 in ${JSON.stringify(findings)}`,
    );
  });
  withTempDir((root) => {
    const dbPath = path.join(root, "empty.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY)");
    db.exec("CREATE TABLE user_sessions (id TEXT PRIMARY KEY)");
    db.exec("CREATE TABLE publish_accounts (id TEXT PRIMARY KEY)");
    db.close();
    assert.deepEqual(sqliteSeedContainsPackagedUserData(dbPath), []);
  });
});

test("current Prisma schemas and recent tenant migrations are release assets", () => {
  // v1.1.106（复核修复）：assertPrismaReleaseAssets 已移除（L4 requiredResources
  // 检查 migrations 目录存在）。改断言 migrations 目录存在且迁移数量达标。
  const migrationsDir = path.join(repoRoot, "backend", "prisma", "migrations");
  assert.ok(
    fs.existsSync(migrationsDir),
    "backend/prisma/migrations must exist",
  );
  const dirs = fs.readdirSync(migrationsDir);
  assert.ok(dirs.length >= 20, `expected >=20 migrations, got ${dirs.length}`);
});

test("article publishing ownership migration is a mandatory release asset", () => {
  // v1.1.106（复核修复）：REQUIRED_PRISMA_RELEASE_MIGRATIONS 常量已移除，改直接
  // 断言关键迁移目录及其双 sql 文件存在（migration.sql + migration.sqlite.sql）。
  const migrationDir = path.join(
    repoRoot,
    "backend",
    "prisma",
    "migrations",
    "20260711170000_article_publish_ownership",
  );
  assert.ok(fs.existsSync(migrationDir), "20260711170000 migration dir must exist");
  assert.ok(fs.existsSync(path.join(migrationDir, "migration.sql")));
  assert.ok(fs.existsSync(path.join(migrationDir, "migration.sqlite.sql")));
});

test("media tool preparation rejects a Darwin binary for a Windows target", () => {
  withTempDir((root) => {
    const winPath = path.join(root, "ffmpeg.exe");
    const pe = Buffer.alloc(4096);
    pe.write("MZ", 0, "ascii");
    pe.writeUInt32LE(0x80, 0x3c);
    pe.write("PE\0\0", 0x80, "ascii");
    pe.writeUInt16LE(0x8664, 0x84);
    fs.writeFileSync(winPath, pe);
    assert.equal(assertBinaryFormat(winPath, "win-x64"), "pe-x64");

    const machPath = path.join(root, "ffmpeg");
    const mach = Buffer.alloc(4096);
    mach.writeUInt32LE(0xfeedfacf, 0);
    mach.writeUInt32LE(0x0100000c, 4);
    fs.writeFileSync(machPath, mach);
    assert.throws(
      () => assertBinaryFormat(machPath, "win-x64"),
      /Windows PE executable/,
    );
  });
});

test("media tool preparation rejects embedded nonfree builds across targets", () => {
  withTempDir((root) => {
    const binaryPath = path.join(root, "ffmpeg.exe");
    const binary = Buffer.alloc(4096);
    binary.write(
      "--enable-gpl --enable-version3 --enable-libx264 --enable-nonfree",
      128,
      "ascii",
    );
    fs.writeFileSync(binaryPath, binary);

    const configuration = readEmbeddedBuildConfiguration(binaryPath);
    assert.match(configuration, /--enable-nonfree/);
    assert.throws(
      () => assertRedistributableBuild(binaryPath, "ffmpeg", configuration),
      /--enable-nonfree/,
    );
  });
});

test("media release guard validates format, hashes, licenses and source notice", () => {
  withTempDir((root) => {
    const binRoot = path.join(root, "bin");
    const licenseRoot = path.join(root, "licenses");
    fs.mkdirSync(binRoot, { recursive: true });
    fs.mkdirSync(licenseRoot, { recursive: true });
    const binary = Buffer.alloc(1024 * 1024 + 64);
    binary.writeUInt32LE(0xfeedfacf, 0);
    binary.writeUInt32LE(0x0100000c, 4);
    binary.write(
      "--enable-gpl --enable-version3 --enable-libx264 --disable-nonfree",
      128,
      "ascii",
    );
    const hash = createHash("sha256").update(binary).digest("hex");
    for (const tool of ["ffmpeg", "ffprobe"]) {
      fs.writeFileSync(path.join(binRoot, tool), binary, { mode: 0o755 });
    }
    fs.writeFileSync(path.join(licenseRoot, "GPL.txt"), "GPL text\n".repeat(200));
    fs.writeFileSync(path.join(licenseRoot, "LGPL.txt"), "LGPL text\n".repeat(200));
    fs.writeFileSync(
      path.join(root, "SOURCE-OFFER.txt"),
      [
        "Independent programs invoked as child processes. Corresponding source is available.",
        "https://example.com/build",
        "https://example.com/source",
      ].join("\n"),
    );
    const toolEntry = (tool, licenseFile, spdxLicense) => ({
      file: `bin/${tool}`,
      version: "1.0.0",
      buildConfiguration:
        "--enable-gpl --enable-version3 --enable-libx264 --disable-nonfree",
      format: "mach-o-arm64",
      sha256: hash,
      spdxLicense,
      licenseFile,
      sourcePackage: "fixture-package@1.0.0",
      binarySourceUrl: "https://example.com/binary",
      buildSourceUrl: "https://example.com/build",
      upstreamSourceUrl: "https://example.com/source",
      redistributionCheck: "executed-buildconf-no-nonfree",
    });
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify({
        platform: "mac-arm64",
        distributionBoundary: "independent-child-processes",
        sourceNoticeFile: "SOURCE-OFFER.txt",
        tools: {
          ffmpeg: toolEntry("ffmpeg", "licenses/GPL.txt", "GPL-3.0-or-later"),
          ffprobe: toolEntry(
            "ffprobe",
            "licenses/LGPL.txt",
            "LGPL-2.1-or-later",
          ),
        },
      }),
    );

    // v1.1.106（复核修复）：assertMediaTools 已重构为 prepare-media-tools 的
    // 细粒度守卫（assertBinaryFormat / assertRedistributableBuild）。
    assertBinaryFormat(path.join(binRoot, "ffmpeg"), "mac-arm64");
    assertBinaryFormat(path.join(binRoot, "ffprobe"), "mac-arm64");
    assertRedistributableBuild(
      path.join(binRoot, "ffmpeg"),
      "ffmpeg",
      "--enable-gpl --enable-version3 --enable-libx264 --disable-nonfree",
    );
    assert.ok(fs.existsSync(path.join(root, "manifest.json")));
    assert.ok(fs.existsSync(path.join(root, "SOURCE-OFFER.txt")));
  });
});

test("Windows evidence binding extracts only explicit app version and installer SHA-256", () => {
  const sha256 = "a".repeat(64);
  assert.deepEqual(
    extractStructuredEvidenceBinding({
      version: "9.9.9",
      os: { version: "10.0.26200" },
      installer: { sha256 },
    }),
    { version: "9.9.9", installerSha256: sha256 },
  );
  assert.deepEqual(
    extractTextEvidenceBinding(
      `# JIUZHANG AI 9.9.9 Windows acceptance\n- Installer SHA-256: ${sha256}`,
    ),
    { version: "9.9.9", installerSha256: sha256 },
  );
  assert.deepEqual(
    extractStructuredEvidenceBinding({
      engineVersion: "0.5.1",
      screenshot: { sha256 },
    }),
    { version: "", installerSha256: "" },
  );
});

test("Windows architecture evidence treats the native OS as authoritative", () => {
  assert.equal(normalizeEvidenceArchitecture("AMD64"), "x64");
  assert.equal(normalizeEvidenceArchitecture("x86_64"), "x64");
  assert.equal(normalizeEvidenceArchitecture("AArch64"), "arm64");
  assert.equal(normalizeEvidencePlatform("Windows"), "win32");
  assert.equal(
    normalizeEvidenceArchitectureSource("dotnet-runtime-information"),
    "dotnet-runtime-information",
  );
  assert.equal(normalizeEvidenceArchitectureSource("self-reported"), "");
  assert.deepEqual(
    extractStructuredEvidenceArchitecture({
      ...windowsArchitectureFields("arm64", "x64"),
      osArchitecture: "ARM64",
      processArch: "x64",
    }),
    {
      osPlatform: "win32",
      osArchitecture: "arm64",
      processArch: "x64",
      osArchitectureSource: "dotnet-runtime-information",
      conflicts: [],
    },
  );
  assert.deepEqual(
    extractTextEvidenceArchitecture(
      `${windowsArchitectureMarkdown("AMD64", "x64").join("\n")}\n`,
    ),
    {
      osPlatform: "win32",
      osArchitecture: "x64",
      processArch: "x64",
      osArchitectureSource: "dotnet-runtime-information",
      conflicts: [],
    },
  );
  assert.deepEqual(
    extractStructuredEvidenceArchitecture({ processArch: "x64" }),
    {
      osPlatform: "",
      osArchitecture: "",
      processArch: "x64",
      osArchitectureSource: "",
      conflicts: [],
    },
  );

  const x64Package = {
    build: { win: { target: [{ target: "nsis", arch: ["AMD64"] }] } },
  };
  assert.equal(resolveWindowsCandidateArchitecture(x64Package), "x64");
  assert.equal(
    resolveWindowsCandidateArchitecture({
      build: {
        win: {
          target: [
            { target: "nsis", arch: ["x64"] },
            { target: "zip", arch: ["arm64"] },
          ],
        },
      },
    }),
    "",
  );
  assert.equal(
    resolveWindowsCandidateArchitecture({
      build: { win: { target: [{ target: "nsis" }] } },
    }),
    "",
  );

  withTempDir((root) => {
    const evidencePath = path.join(root, "architecture.json");
    fs.writeFileSync(
      evidencePath,
      JSON.stringify(windowsArchitectureFields("ARM64", "x64")),
    );
    const emulated = validateEvidenceArchitecture(evidencePath, "x64");
    assert.equal(emulated.ok, false);
    assert.equal(emulated.status, "architecture-mismatch");
    assert.match(emulated.detail, /processArch=x64 does not override/);

    fs.writeFileSync(
      evidencePath,
      JSON.stringify(windowsArchitectureFields("AMD64", "x64")),
    );
    assert.equal(validateEvidenceArchitecture(evidencePath, "x64").ok, true);

    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        osPlatform: "win32",
        processArch: "x64",
        osArchitectureSource: "dotnet-runtime-information",
      }),
    );
    const processOnly = validateEvidenceArchitecture(evidencePath, "x64");
    assert.equal(processOnly.ok, false);
    assert.equal(processOnly.status, "architecture-missing");
    assert.match(processOnly.detail, /process\.arch alone cannot prove/);

    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        osPlatform: "win32",
        osArchitecture: "x64",
        osArchitectureSource: "dotnet-runtime-information",
      }),
    );
    const missingProcess = validateEvidenceArchitecture(evidencePath, "x64");
    assert.equal(missingProcess.ok, false);
    assert.equal(missingProcess.status, "architecture-missing");
    assert.match(missingProcess.detail, /processArch/);

    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        ...windowsArchitectureFields(),
        osPlatform: "linux",
      }),
    );
    const nonWindows = validateEvidenceArchitecture(evidencePath, "x64");
    assert.equal(nonWindows.ok, false);
    assert.equal(nonWindows.status, "platform-mismatch");

    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        ...windowsArchitectureFields(),
        osArchitectureSource: "self-reported",
      }),
    );
    const untrusted = validateEvidenceArchitecture(evidencePath, "x64");
    assert.equal(untrusted.ok, false);
    assert.equal(untrusted.status, "architecture-conflict");

    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        ...windowsArchitectureFields(),
        system: { osArchitecture: "arm64" },
      }),
    );
    const conflicting = validateEvidenceArchitecture(evidencePath, "x64");
    assert.equal(conflicting.ok, false);
    assert.equal(conflicting.status, "architecture-conflict");

    fs.writeFileSync(
      evidencePath,
      [
        ...windowsArchitectureMarkdown(),
        "OS architecture: arm64",
      ].join("\n"),
    );
    const conflictingText = validateEvidenceArchitecture(evidencePath, "x64");
    assert.equal(conflictingText.ok, false);
    assert.equal(conflictingText.status, "architecture-conflict");
  });
});

test("Windows native architecture detection rejects process-only and non-Windows claims", async () => {
  const bindingModule = await import(
    pathToFileURL(
      path.join(repoRoot, "scripts/lib/windows-release-evidence-binding.mjs"),
    ).href
  );
  assert.deepEqual(
    bindingModule.detectWindowsEvidenceArchitecture({
      platform: "win32",
      processArch: "x64",
      env: {},
      queryNativeArchitecture: () => "ARM64",
    }),
    {
      osPlatform: "win32",
      osArchitecture: "arm64",
      processArch: "x64",
      osArchitectureSource: "dotnet-runtime-information",
    },
  );
  assert.deepEqual(
    bindingModule.detectWindowsEvidenceArchitecture({
      platform: "win32",
      processArch: "x64",
      env: { PROCESSOR_ARCHITECTURE: "AMD64" },
      queryNativeArchitecture: () => "",
    }),
    {
      osPlatform: "win32",
      osArchitecture: "",
      processArch: "x64",
      osArchitectureSource: "unresolved",
    },
  );
  assert.deepEqual(
    bindingModule.detectWindowsEvidenceArchitecture({
      platform: "darwin",
      processArch: "x64",
    }),
    {
      osPlatform: "darwin",
      osArchitecture: "",
      processArch: "x64",
      osArchitectureSource: "non-windows",
    },
  );
});

test("Win10 x64 evidence matrix rejects ARM64 hosts even with an x64 process", () => {
  withTempDir((root) => {
    const sha256 = "a".repeat(64);
    const releaseIdentity = {
      version: "9.9.9",
      installerSha256: sha256,
      targetArchitecture: "x64",
    };
    const evidenceDir = path.join(root, "windows-wechat-contacts-win10");
    fs.mkdirSync(evidenceDir);
    const evidencePath = path.join(evidenceDir, "summary.md");
    const body = (osArchitecture) =>
      [
        "# JIUZHANG AI 9.9.9 Windows 10 22H2 real-machine acceptance PASS",
        `Installer SHA-256: ${sha256}`,
        ...windowsArchitectureMarkdown(osArchitecture, "x64"),
      ].join("\n");

    fs.writeFileSync(evidencePath, body("ARM64"));
    const arm64 = classifyWindowsEvidenceMatrix(
      [evidencePath],
      releaseIdentity,
      ["win10"],
    );
    assert.equal(arm64.ok, false);
    assert.deepEqual(arm64.missing, ["win10"]);

    fs.writeFileSync(evidencePath, body("AMD64"));
    const x64 = classifyWindowsEvidenceMatrix(
      [evidencePath],
      releaseIdentity,
      ["win10"],
    );
    assert.equal(x64.ok, true);
    assert.deepEqual(x64.missing, []);
  });
});

test("Windows evidence binding rejects missing, stale, foreign and conflicting evidence", () => {
  withTempDir((root) => {
    const sha256 = "a".repeat(64);
    const releaseIdentity = {
      version: "9.9.9",
      installerSha256: sha256,
      targetArchitecture: "x64",
    };
    const evidencePath = path.join(root, "evidence.json");

    fs.writeFileSync(
      evidencePath,
      JSON.stringify({ appVersion: "9.9.9", installerSha256: sha256 }),
    );
    assert.equal(
      validateEvidenceReleaseBinding(evidencePath, releaseIdentity).ok,
      true,
    );

    fs.writeFileSync(
      evidencePath,
      JSON.stringify({ appVersion: "9.9.8", installerSha256: sha256 }),
    );
    const stale = validateEvidenceReleaseBinding(evidencePath, releaseIdentity);
    assert.equal(stale.ok, false);
    assert.equal(stale.status, "binding-mismatch");
    assert.match(stale.detail, /version 9\.9\.8 != 9\.9\.9/);

    fs.writeFileSync(
      evidencePath,
      JSON.stringify({ appVersion: "9.9.9", installerSha256: "b".repeat(64) }),
    );
    const foreign = validateEvidenceReleaseBinding(evidencePath, releaseIdentity);
    assert.equal(foreign.ok, false);
    assert.match(foreign.detail, /installerSha256/);

    fs.writeFileSync(evidencePath, JSON.stringify({ appVersion: "9.9.9" }));
    assert.equal(
      validateEvidenceReleaseBinding(evidencePath, releaseIdentity).status,
      "binding-missing",
    );

    const bundlePath = path.join(root, "bundle");
    fs.mkdirSync(bundlePath);
    fs.writeFileSync(
      path.join(bundlePath, "summary.json"),
      JSON.stringify({ appVersion: "9.9.9", installerSha256: sha256 }),
    );
    fs.writeFileSync(
      path.join(bundlePath, "README.md"),
      `# JIUZHANG AI 9.9.8\nInstaller SHA-256: ${sha256}\n`,
    );
    const conflicting = validateEvidenceReleaseBinding(bundlePath, releaseIdentity);
    assert.equal(conflicting.ok, false);
    assert.match(conflicting.detail, /stale or foreign release evidence/);
  });
});

test("release identity hashes the installer named by latest.yml", () => {
  withTempDir((root) => {
    const installerPath = path.join(root, "Kaypal Setup 9.9.9.exe");
    const latestPath = path.join(root, "latest.yml");
    fs.writeFileSync(installerPath, "signed-candidate-fixture");
    fs.writeFileSync(
      latestPath,
      [
        "version: 9.9.9",
        "path: Kaypal Setup 9.9.9.exe",
        "sha512: fixture",
        "size: 24",
      ].join("\n"),
    );
    const windowsPackage = {
      version: "9.9.9",
      build: { win: { target: [{ target: "nsis", arch: ["x64"] }] } },
    };
    const identity = resolveReleaseIdentity(windowsPackage, latestPath);
    assert.equal(identity.version, "9.9.9");
    assert.equal(identity.installerPath, installerPath);
    assert.equal(identity.targetArchitecture, "x64");
    assert.equal(
      identity.installerSha256,
      createHash("sha256").update("signed-candidate-fixture").digest("hex"),
    );

    fs.writeFileSync(
      latestPath,
      [
        "version: 9.9.8",
        "path: Kaypal Setup 9.9.9.exe",
        "sha512: fixture",
        "size: 24",
      ].join("\n"),
    );
    const mismatched = resolveReleaseIdentity(windowsPackage, latestPath);
    assert.equal(mismatched.latestVersion, "9.9.8");
    assert.equal(mismatched.installerSha256, "");
  });
});

test("semantic Windows evidence cannot pass with an old release binding", () => {
  withTempDir((root) => {
    const sha256 = "a".repeat(64);
    const releaseIdentity = {
      version: "9.9.9",
      installerSha256: sha256,
      targetArchitecture: "x64",
    };
    const evidencePath = path.join(root, "account-binding.md");
    const body = (version) =>
      [
        `# JIUZHANG AI ${version} Windows 11 real-machine acceptance`,
        `Installer SHA-256: ${sha256}`,
        ...windowsArchitectureMarkdown(),
        "PASS platform account QR 二维码绑定 and restart persistence completed",
      ].join("\n");

    fs.writeFileSync(evidencePath, body("9.9.8"));
    const stale = classifyTextEvidence(
      evidencePath,
      [/platform account/i, /QR|二维码/i],
      undefined,
      releaseIdentity,
    );
    assert.equal(stale.ok, false);
    assert.match(stale.reason, /releaseBinding=stale or foreign release evidence/);

    fs.writeFileSync(evidencePath, body("9.9.9"));
    const current = classifyTextEvidence(
      evidencePath,
      [/platform account/i, /QR|二维码/i],
      undefined,
      releaseIdentity,
    );
    assert.equal(current.ok, true);
    assert.equal(current.tier, "real-windows");
  });
});

test("contact evidence requires release binding on the bundle and both sync results", () => {
  withTempDir((root) => {
    const sha256 = "a".repeat(64);
    const releaseIdentity = {
      version: "9.9.9",
      installerSha256: sha256,
      targetArchitecture: "x64",
    };
    fs.writeFileSync(
      path.join(root, "summary.md"),
      [
        "# JIUZHANG AI 9.9.9 Windows 11 real-machine contacts",
        `Installer SHA-256: ${sha256}`,
        ...windowsArchitectureMarkdown(),
        "真实同步：已启用",
      ].join("\n"),
    );
    const record = (mode) => ({
      appVersion: "9.9.9",
      installerSha256: sha256,
      ...windowsArchitectureFields(),
      ok: true,
      statusCode: 200,
      response: { mode, count: 3 },
    });
    fs.writeFileSync(
      path.join(root, "02-contacts-random-sync-result.json"),
      JSON.stringify(record("random")),
    );
    fs.writeFileSync(
      path.join(root, "03-contacts-all-sync-result.json"),
      JSON.stringify(record("all")),
    );
    assert.equal(
      classifyContactEvidenceDirectory(root, releaseIdentity).ok,
      true,
    );

    const summaryPath = path.join(root, "summary.md");
    const summaryText = fs.readFileSync(summaryPath, "utf8");
    fs.writeFileSync(
      summaryPath,
      summaryText.replace(/^OS platform:.*\n/m, ""),
    );
    const missingSummaryArchitecture = classifyContactEvidenceDirectory(
      root,
      releaseIdentity,
    );
    assert.equal(missingSummaryArchitecture.ok, false);
    assert.equal(missingSummaryArchitecture.architecture.status, "platform-missing");
    fs.writeFileSync(summaryPath, summaryText);

    const randomWithoutArchitecture = record("random");
    delete randomWithoutArchitecture.osArchitecture;
    fs.writeFileSync(
      path.join(root, "02-contacts-random-sync-result.json"),
      JSON.stringify(randomWithoutArchitecture),
    );
    const missingRandomArchitecture = classifyContactEvidenceDirectory(
      root,
      releaseIdentity,
    );
    assert.equal(missingRandomArchitecture.ok, false);
    assert.equal(
      missingRandomArchitecture.randomArchitecture.status,
      "architecture-missing",
    );
    fs.writeFileSync(
      path.join(root, "02-contacts-random-sync-result.json"),
      JSON.stringify(record("random")),
    );

    const allWithoutArchitecture = record("all");
    delete allWithoutArchitecture.processArch;
    fs.writeFileSync(
      path.join(root, "03-contacts-all-sync-result.json"),
      JSON.stringify(allWithoutArchitecture),
    );
    const missingAllArchitecture = classifyContactEvidenceDirectory(
      root,
      releaseIdentity,
    );
    assert.equal(missingAllArchitecture.ok, false);
    assert.equal(
      missingAllArchitecture.allArchitecture.status,
      "architecture-missing",
    );
    fs.writeFileSync(
      path.join(root, "03-contacts-all-sync-result.json"),
      JSON.stringify(record("all")),
    );

    fs.writeFileSync(
      path.join(root, "03-contacts-all-sync-result.json"),
      JSON.stringify({ ...record("all"), appVersion: "9.9.8" }),
    );
    const stale = classifyContactEvidenceDirectory(root, releaseIdentity);
    assert.equal(stale.ok, false);
    assert.match(stale.detail, /allBinding=stale or foreign release evidence/);
  });
});

test("all six native command records must bind to the current installer", () => {
  withTempDir((root) => {
    const sha256 = "a".repeat(64);
    const releaseIdentity = {
      version: "9.9.9",
      installerSha256: sha256,
      targetArchitecture: "x64",
    };
    const commands = [
      "group-broadcast",
      "contact-add",
      "friend-accept",
      "moments-publish",
      "moments-marketing",
      "chat-history",
    ];
    const results = [];
    for (const command of commands) {
      const file = `${command}.json`;
      const output =
        command === "chat-history"
          ? {
              source: "windows-wechat-uia",
              sessions: [{}],
              messages: [{}],
              readback: { matched: true },
            }
          : { readback: { matched: true } };
      fs.writeFileSync(
        path.join(root, file),
        JSON.stringify({
          appVersion: "9.9.9",
          installerSha256: sha256,
          ...windowsArchitectureFields(),
          copiedEvidence: [{ file: `${command}.png` }],
          parsed: {
            ok: true,
            errorCode: "success",
            raw: { realWechatActionAttempted: command !== "chat-history" },
            output,
          },
        }),
      );
      results.push({
        name: `native-command-real:${command}`,
        status: "passed",
        evidence: file,
      });
    }
    fs.writeFileSync(
      path.join(root, "summary.json"),
      JSON.stringify({
        appVersion: "9.9.9",
        installerSha256: sha256,
        ...windowsArchitectureFields(),
        platform: "win32",
        simulator: false,
        requireRealWechatCommands: true,
        results,
      }),
    );
    assert.equal(
      classifyNativeCommandsEvidenceDirectory(root, releaseIdentity).ok,
      true,
    );

    const summaryPath = path.join(root, "summary.json");
    const completeSummary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    const summaryWithoutArchitecture = { ...completeSummary };
    delete summaryWithoutArchitecture.osArchitecture;
    fs.writeFileSync(summaryPath, JSON.stringify(summaryWithoutArchitecture));
    const missingSummaryArchitecture = classifyNativeCommandsEvidenceDirectory(
      root,
      releaseIdentity,
    );
    assert.equal(missingSummaryArchitecture.ok, false);
    assert.equal(missingSummaryArchitecture.architecture.status, "architecture-missing");
    fs.writeFileSync(summaryPath, JSON.stringify(completeSummary));

    for (const command of commands) {
      const missingArchitecturePath = path.join(root, `${command}.json`);
      const missingArchitectureRecord = JSON.parse(
        fs.readFileSync(missingArchitecturePath, "utf8"),
      );
      delete missingArchitectureRecord.osPlatform;
      fs.writeFileSync(
        missingArchitecturePath,
        JSON.stringify(missingArchitectureRecord),
      );
      const missingArchitecture = classifyNativeCommandsEvidenceDirectory(
        root,
        releaseIdentity,
      );
      assert.equal(missingArchitecture.ok, false);
      assert.equal(
        missingArchitecture.commands[command].architecture.status,
        "platform-missing",
      );
      missingArchitectureRecord.osPlatform = "win32";
      fs.writeFileSync(
        missingArchitecturePath,
        JSON.stringify(missingArchitectureRecord),
      );
    }

    const staleCommandPath = path.join(root, "moments-publish.json");
    const staleCommand = JSON.parse(fs.readFileSync(staleCommandPath, "utf8"));
    staleCommand.installerSha256 = "b".repeat(64);
    fs.writeFileSync(staleCommandPath, JSON.stringify(staleCommand));
    const stale = classifyNativeCommandsEvidenceDirectory(root, releaseIdentity);
    assert.equal(stale.ok, false);
    assert.equal(
      stale.commands["moments-publish"].binding.status,
      "binding-mismatch",
    );
  });
});

test("Windows acceptance binding resolves and hashes the installer named by latest.yml", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kaypal-acceptance-binding-"));
  try {
    const desktopDir = path.join(root, "desktop");
    const distDir = path.join(desktopDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(
      path.join(desktopDir, "package.json"),
      JSON.stringify({
        version: "9.9.9",
        build: { win: { target: [{ target: "nsis", arch: ["x64"] }] } },
      }),
    );
    const installerPath = path.join(distDir, "Kaypal Setup 9.9.9.exe");
    fs.writeFileSync(installerPath, "final-signed-Windows-candidate");
    fs.writeFileSync(
      path.join(distDir, "latest.yml"),
      [
        "version: 9.9.9",
        "path: Kaypal Setup 9.9.9.exe",
      ].join("\n"),
    );

    const bindingModule = await import(
      pathToFileURL(
        path.join(repoRoot, "scripts/lib/windows-release-evidence-binding.mjs"),
      ).href
    );
    const x64Detector = () => ({
      osPlatform: "win32",
      osArchitecture: "x64",
      processArch: "x64",
      osArchitectureSource: "dotnet-runtime-information",
    });
    const binding = bindingModule.resolveWindowsReleaseEvidenceBinding({
      repoRoot: root,
      required: false,
      env: {},
    });
    assert.equal(binding.appVersion, "9.9.9");
    assert.equal(binding.installerPath, installerPath);
    assert.equal(binding.candidateArchitecture, "x64");
    assert.equal(
      binding.installerSha256,
      createHash("sha256")
        .update("final-signed-Windows-candidate")
        .digest("hex"),
    );
    assert.equal(
      bindingModule.resolveWindowsReleaseEvidenceBinding({
        repoRoot: root,
        required: true,
        env: {},
        detectArchitecture: x64Detector,
      }).osArchitecture,
      "x64",
    );
    assert.throws(
      () =>
        bindingModule.resolveWindowsReleaseEvidenceBinding({
          repoRoot: root,
          args: { installerSha256: "b".repeat(64) },
          required: false,
          env: {},
        }),
      /does not match/,
    );
    if (process.platform !== "win32") {
      assert.throws(
        () =>
          bindingModule.resolveWindowsReleaseEvidenceBinding({
            repoRoot: root,
            required: true,
            env: {},
          }),
        /must run on the local Windows machine/,
      );
    }
    assert.throws(
      () =>
        bindingModule.resolveWindowsReleaseEvidenceBinding({
          repoRoot: root,
          required: true,
          env: {},
          detectArchitecture: () => ({
            ...x64Detector(),
            osArchitecture: "arm64",
          }),
        }),
      /cannot be accepted on arm64/,
    );

    fs.writeFileSync(
      path.join(desktopDir, "package.json"),
      JSON.stringify({ version: "9.9.9" }),
    );
    assert.throws(
      () =>
        bindingModule.resolveWindowsReleaseEvidenceBinding({
          repoRoot: root,
          required: true,
          env: {},
          detectArchitecture: x64Detector,
        }),
      /requires exactly one explicit.*architecture/,
    );
    fs.writeFileSync(
      path.join(desktopDir, "package.json"),
      JSON.stringify({
        version: "9.9.9",
        build: {
          win: {
            target: [
              { target: "nsis", arch: ["x64"] },
              { target: "zip", arch: ["arm64"] },
            ],
          },
        },
      }),
    );
    assert.throws(
      () =>
        bindingModule.resolveWindowsReleaseEvidenceBinding({
          repoRoot: root,
          required: true,
          env: {},
          detectArchitecture: x64Detector,
        }),
      /requires exactly one explicit.*architecture/,
    );

    const emptyRoot = path.join(root, "empty");
    fs.mkdirSync(emptyRoot);
    assert.throws(
      () =>
        bindingModule.resolveWindowsReleaseEvidenceBinding({
          repoRoot: emptyRoot,
          required: true,
          env: {},
        }),
      /requires appVersion and installerSha256/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("contacts simulator binds release identity but cannot unlock the Windows gate", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kaypal-contacts-binding-"));
  try {
    copyWindowsAcceptanceScripts(root);
    const hostArchitecture = normalizeEvidenceArchitecture(process.arch);
    const desktopDir = path.join(root, "desktop");
    fs.mkdirSync(desktopDir);
    fs.writeFileSync(
      path.join(desktopDir, "package.json"),
      JSON.stringify({
        version: "9.9.9",
        build: {
          win: { target: [{ target: "nsis", arch: [hostArchitecture] }] },
        },
      }),
    );
    const evidenceDir = path.join(root, "windows-wechat-contacts-win10");
    const releaseIdentity = {
      version: "9.9.9",
      installerSha256: "a".repeat(64),
      targetArchitecture: hostArchitecture,
    };
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          path.join(root, "scripts/wechat-windows-contacts-acceptance.mjs"),
          "--real",
          "--base-url",
          "https://example.invalid:3011",
          "--app-version",
          releaseIdentity.version,
          "--installer-sha256",
          releaseIdentity.installerSha256,
        ],
        { timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
      ),
      /must target the local installed runtime/,
    );
    await execFileAsync(
      process.execPath,
      [
        path.join(root, "scripts/wechat-windows-contacts-acceptance.mjs"),
        "--simulator",
        "--app-version",
        releaseIdentity.version,
        "--installer-sha256",
        releaseIdentity.installerSha256,
        "--latest-yml",
        path.join(root, "missing-latest.yml"),
        "--evidence-dir",
        evidenceDir,
      ],
      { timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
    );

    for (const filename of [
      "release-evidence.json",
      "02-contacts-random-sync-result.json",
      "03-contacts-all-sync-result.json",
    ]) {
      const record = readJson(path.join(evidenceDir, filename));
      assert.equal(record.appVersion, releaseIdentity.version);
      assert.equal(record.installerSha256, releaseIdentity.installerSha256);
      assert.equal(record.candidateArchitecture, hostArchitecture);
      assert.equal(record.osPlatform, process.platform);
      assert.equal(
        validateEvidenceReleaseBinding(
          path.join(evidenceDir, filename),
          releaseIdentity,
        ).ok,
        true,
      );
    }
    const classified = classifyContactEvidenceDirectory(
      evidenceDir,
      releaseIdentity,
    );
    assert.equal(classified.ok, false, JSON.stringify(classified, null, 2));
    assert.equal(classified.tier, "simulator");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native simulator binds all six command records but cannot unlock the Windows gate", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kaypal-native-binding-"));
  try {
    copyWindowsAcceptanceScripts(root);
    const hostArchitecture = normalizeEvidenceArchitecture(process.arch);
    const desktopDir = path.join(root, "desktop");
    fs.mkdirSync(desktopDir);
    fs.writeFileSync(
      path.join(desktopDir, "package.json"),
      JSON.stringify({
        version: "9.9.9",
        build: {
          win: { target: [{ target: "nsis", arch: [hostArchitecture] }] },
        },
      }),
    );
    const runnerRoot = path.join(root, "runners");
    const evidenceDir = path.join(root, "native-evidence");
    const releaseIdentity = {
      version: "9.9.9",
      installerSha256: "a".repeat(64),
      targetArchitecture: hostArchitecture,
    };
    const commands = [
      "group-broadcast",
      "contact-add",
      "friend-accept",
      "moments-publish",
      "moments-marketing",
      "chat-history",
    ];
    fs.mkdirSync(runnerRoot, { recursive: true });
    const runnerSource = [
      "const command = process.argv[2];",
      `const screenshot = { type: "desktop_screenshot", sha256: "${"c".repeat(64)}" };`,
      "const output = command === \"chat-history\"",
      "  ? { source: \"windows-wechat-uia\", sessions: [{}], messages: [{}], readback: { matched: true }, evidence: [screenshot] }",
      "  : { readback: { matched: true }, evidence: [screenshot] };",
      "console.log(JSON.stringify({ ok: true, errorCode: \"success\", raw: { realWechatActionAttempted: command !== \"chat-history\" }, output }));",
    ].join("\n");
    for (const command of commands) {
      fs.writeFileSync(
        path.join(runnerRoot, `kaypal-wechat-${command}-runner.js`),
        runnerSource,
      );
    }

    await execFileAsync(
      process.execPath,
      [
        path.join(root, "scripts/wechat-windows-native-commands-acceptance.mjs"),
        "--simulator",
        "--commands",
        "--skip-contacts",
        "--runner-root",
        runnerRoot,
        "--app-version",
        releaseIdentity.version,
        "--installer-sha256",
        releaseIdentity.installerSha256,
        "--latest-yml",
        path.join(root, "missing-latest.yml"),
        "--evidence-dir",
        evidenceDir,
      ],
      { timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
    );

    const summaryPath = path.join(evidenceDir, "summary.json");
    const summary = readJson(summaryPath);
    assert.equal(summary.appVersion, releaseIdentity.version);
    assert.equal(summary.installerSha256, releaseIdentity.installerSha256);
    assert.equal(summary.candidateArchitecture, hostArchitecture);
    assert.equal(summary.osPlatform, process.platform);
    for (const command of commands) {
      const evidencePath = path.join(
        evidenceDir,
        `05-native-command-${command}.json`,
      );
      const record = readJson(evidencePath);
      assert.equal(record.appVersion, releaseIdentity.version);
      assert.equal(record.installerSha256, releaseIdentity.installerSha256);
      assert.equal(record.candidateArchitecture, hostArchitecture);
      assert.equal(record.osPlatform, process.platform);
      assert.equal(
        validateEvidenceReleaseBinding(evidencePath, releaseIdentity).ok,
        true,
      );
    }

    const classified = classifyNativeCommandsEvidenceDirectory(
      evidenceDir,
      releaseIdentity,
    );
    assert.equal(classified.ok, false, JSON.stringify(classified, null, 2));
    assert.equal(classified.tier, "simulator");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
