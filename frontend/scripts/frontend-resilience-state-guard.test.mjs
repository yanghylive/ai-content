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
  const settings = read("frontend/src/app/(dashboard)/settings/page.tsx");
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

test("desktop candidate version and Win10 release scope stay aligned", () => {
  const desktopPackage = JSON.parse(read("desktop/package.json"));
  const desktopLock = JSON.parse(read("desktop/package-lock.json"));
  const packager = JSON.parse(read("desktop/packager.json"));
  const layout = read("frontend/src/app/(dashboard)/layout.tsx");
  const releasePage = read("frontend/src/app/(dashboard)/release-notes/page.tsx");
  const updaterNotes = read("desktop/release-notes.md");

  assert.equal(desktopPackage.version, "1.1.56");
  assert.equal(desktopLock.version, desktopPackage.version);
  assert.equal(desktopLock.packages[""].version, desktopPackage.version);
  assert.equal(packager.version, desktopPackage.version);
  assert.match(layout, /DESKTOP_APP_VERSION = "1\.1\.56"/);
  assert.match(releasePage, /currentVersion = "1\.1\.56"/);
  assert.match(releasePage, /Win10 真机账号验收/);
  assert.doesNotMatch(releasePage, /Win10、Win11/);
  assert.match(updaterNotes, /Win10 真机账号验收/);
});

test("desktop login reports the native device platform and always starts its local API", () => {
  const login = read("frontend/src/app/login/page.tsx");
  const desktopMain = read("desktop/main.js");
  const authClient = read("backend/src/modules/auth/kaypal-auth.client.ts");

  assert.match(login, /electronAPI\?\.app\?\.getPlatform/);
  assert.match(login, /deviceName: "Kaypal AI \(Windows\)"/);
  assert.match(login, /platform: "windows"/);
  assert.match(desktopMain, /autoStartService 只控制崩溃后的自动恢复/);
  assert.doesNotMatch(
    desktopMain,
    /if \(store\.get\("autoStartService"\)\) \{\s*await startBackendService/,
  );
  assert.match(authClient, /!payload\.user_code/);
});
