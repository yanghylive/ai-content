import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(frontendRoot, "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("dashboard routes expose loading, error recovery, and not-found states", () => {
  assert.match(read("frontend/src/app/(dashboard)/loading.tsx"), /aria-busy="true"/);
  assert.match(read("frontend/src/app/(dashboard)/error.tsx"), /reset: \(\) => void/);
  assert.match(read("frontend/src/app/(dashboard)/error.tsx"), /重新加载/);
  assert.match(read("frontend/src/app/(dashboard)/not-found.tsx"), /返回工作台/);
});

test("customer detail persist tab state and protect drafts", () => {
  // 2026-08-18：移除 settings page-legacy（已删除）与 use-unsaved-changes-warning
  // （已重构）的断言，保留仍有效的 customer/welcome 断言
  const customer = read(
    "frontend/src/app/(dashboard)/crm/customers/[id]/customer-detail-client.tsx",
  );
  const welcome = read(
    "frontend/src/app/(dashboard)/crm/customers/[id]/welcome-message-panel.tsx",
  );

  assert.match(customer, /writeCustomerTabToUrl/);
  assert.match(customer, /useUnsavedChangesWarning\(hasUnsavedChanges\)/);
  assert.match(welcome, /useUnsavedChangesWarning\(messageIsDirty \|\| templateIsDirty\)/);
});

test("desktop candidate version and Windows release scope stay aligned", () => {
  const desktopPackage = JSON.parse(read("desktop/package.json"));
  const desktopLock = JSON.parse(read("desktop/package-lock.json"));
  const packager = JSON.parse(read("desktop/packager.json"));
  const layout = read("frontend/src/app/(dashboard)/layout.tsx");
  const releasePage = read("frontend/src/app/(dashboard)/release-notes/page.tsx");
  const currentVersion = desktopPackage.version;

  /* 2026-08-11：不再硬编码具体版本号（曾卡在 1.1.60 导致门禁失效），
     统一以 desktop/package.json 为唯一版本源，校验各处一致。 */
  assert.equal(desktopLock.version, currentVersion);
  assert.equal(desktopLock.packages[""].version, currentVersion);
  assert.equal(packager.version, currentVersion);
  assert.match(layout, new RegExp(`DESKTOP_APP_VERSION = "${currentVersion.replace(/\./g, "\\.")}"`));
  assert.match(releasePage, new RegExp(`currentVersion = "${currentVersion.replace(/\./g, "\\.")}"`));
  assert.match(releasePage, /Windows 真机|Windows 构建环境/);
  assert.match(releasePage, /Windows 安装包/);
});

test("desktop login reports the native device platform and always starts its local API", () => {
  const login = read("frontend/src/app/login/page.tsx");
  const desktopMain = read("desktop/main.js");
  const authClient = read("backend/src/modules/auth/kaypal-auth.client.ts");

  assert.match(login, /electronAPI\?\.app\?\.getPlatform/);
  assert.match(login, /deviceName: "JIUZHANG AI \(Windows\)"/);
  assert.match(login, /platform: "windows"/);
  assert.match(desktopMain, /autoStartService 只控制崩溃后的自动恢复/);
  assert.match(desktopMain, /createWindowsPackagedBaseEnv/);
  assert.match(desktopMain, /SystemRoot/);
  assert.match(desktopMain, /LOCALAPPDATA/);
  assert.match(desktopMain, /USERPROFILE/);
  assert.doesNotMatch(
    desktopMain,
    /if \(store\.get\("autoStartService"\)\) \{\s*await startBackendService/,
  );
  assert.match(authClient, /!payload\.user_code/);
});

test("local engine health check cannot hang forever or report a false green state", () => {
  const healthCenter = read(
    "frontend/src/app/(dashboard)/local-engine/engine-health-center.tsx",
  );
  const localEngineApi = read("frontend/src/lib/api/local-engine.ts");

  assert.match(healthCenter, /STATUS_REQUEST_TIMEOUT_MS = 12_000/);
  assert.match(healthCenter, /localEngineApi\.health\(STATUS_REQUEST_OPTIONS\)/);
  assert.match(healthCenter, /localEngineApi\.tasks\(50, STATUS_REQUEST_OPTIONS\)/);
  assert.match(healthCenter, /setCheckFailed\(partialFailure\)/);
  assert.match(
    healthCenter,
    /!checkFailed\s*&&\s*assistantConnected === true\s*&&/,
  );
  assert.match(healthCenter, /部分状态检查超时或失败/);
  assert.match(localEngineApi, /health\(options\?: ApiRequestOptions\)/);
  assert.match(localEngineApi, /tasks\(limit = 50, options\?: ApiRequestOptions\)/);
});
