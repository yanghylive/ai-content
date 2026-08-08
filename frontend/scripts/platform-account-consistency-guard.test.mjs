import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relativePath) {
  return readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

test("account surfaces share one identity and login-state policy", () => {
  const accountState = read("src/lib/auto-upload-account-state.ts");
  const platformPage = read(
    "src/app/(dashboard)/platforms/platform-accounts.tsx",
  );
  const publishFlow = read(
    "src/app/(dashboard)/distribution/publish-flow.tsx",
  );
  const shell = read("src/components/shell/app-shell.tsx");

  assert.match(accountState, /account\.platformKey \|\| account\.platform/);
  assert.match(accountState, /Number\.isFinite\(account\.id\)/);
  assert.match(accountState, /return `\$\{platform\}:\$\{accountId\}`/);
  assert.match(accountState, /account\.sessionStatus === "logged_in"/);
  assert.match(platformPage, /dedupeAutoUploadAccounts/);
  assert.match(platformPage, /validate: true, force: true, silent: true/);
  assert.match(platformPage, /loginEngineAccountIdRef/);
  assert.match(platformPage, /refreshAccountsAfterLogin/);
  assert.match(platformPage, /平台已经完成绑定，但账号列表同步超时/);
  assert.match(publishFlow, /autoUploadApi\.accounts\(\)/);
  assert.match(publishFlow, /autoUploadApi\.preflight\(payloads\)/);
  assert.match(publishFlow, /selectedAccountKeys/);
  assert.doesNotMatch(publishFlow, /selectedAccountIds/);
  assert.match(shell, /dedupeAutoUploadAccounts\(accounts\)/);
  assert.match(shell, /window\.setInterval\(\(\) => void load\(\), 30_000\)/);
});
