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

test("settings and customer detail persist tab state and protect drafts", () => {
  const settings = read("frontend/src/app/(dashboard)/settings/page-legacy.tsx");
  const customer = read(
    "frontend/src/app/(dashboard)/crm/customers/[id]/customer-detail-client.tsx",
  );
  const welcome = read(
    "frontend/src/app/(dashboard)/crm/customers/[id]/welcome-message-panel.tsx",
  );
  const warningHook = read("frontend/src/hooks/use-unsaved-changes-warning.ts");

  assert.match(settings, /writeSettingsTabToUrl/);
  assert.match(settings, /window\.addEventListener\("popstate"/);
  assert.match(settings, /useUnsavedChangesWarning\(configIsDirty\)/);
  assert.match(customer, /writeCustomerTabToUrl/);
  assert.match(customer, /useUnsavedChangesWarning\(hasUnsavedChanges\)/);
  assert.match(welcome, /useUnsavedChangesWarning\(messageIsDirty \|\| templateIsDirty\)/);
  assert.match(warningHook, /beforeunload/);
  assert.match(warningHook, /closest<HTMLAnchorElement>\("a\[href\]"\)/);
});

test("desktop candidate version and Windows release scope stay aligned", () => {
  const desktopPackage = JSON.parse(read("desktop/package.json"));
  const desktopLock = JSON.parse(read("desktop/package-lock.json"));
  const packager = JSON.parse(read("desktop/packager.json"));
  const layout = read("frontend/src/app/(dashboard)/layout.tsx");
  const releasePage = read("frontend/src/app/(dashboard)/release-notes/page.tsx");

  assert.equal(desktopPackage.version, "1.1.59");
  assert.equal(desktopLock.version, desktopPackage.version);
  assert.equal(desktopLock.packages[""].version, desktopPackage.version);
  assert.equal(packager.version, desktopPackage.version);
  assert.match(layout, /DESKTOP_APP_VERSION = "1\.1\.59"/);
  assert.match(releasePage, /currentVersion = "1\.1\.59"/);
  assert.match(releasePage, /Windows runner 或 Windows 真机/);
  assert.match(releasePage, /win-x64/);
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
