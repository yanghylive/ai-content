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
  // 2026-08-18：platform-accounts.tsx 已随账号绑定 UI 重构删除，dedupe 逻辑
  // 迁移至 app-shell；旧绑定 UI 断言（validate/force、loginEngineAccountIdRef、
  // refreshAccountsAfterLogin、超时提示）对应实现已重构移除，相应断言删除
  const platformPage = read("src/components/shell/app-shell.tsx");
  const publishFlow = read(
    "src/app/(dashboard)/distribution/publish-flow.tsx",
  );
  const shell = read("src/components/shell/app-shell.tsx");

  assert.match(accountState, /account\.platformKey \|\| account\.platform/);
  assert.match(accountState, /Number\.isFinite\(account\.id\)/);
  assert.match(accountState, /return `\$\{platform\}:\$\{accountId\}`/);
  assert.match(accountState, /account\.sessionStatus === "logged_in"/);
  assert.match(platformPage, /dedupeAutoUploadAccounts/);
  assert.match(publishFlow, /autoUploadApi\.accounts\(\)/);
  assert.match(publishFlow, /autoUploadApi\.preflight\(payloads\)/);
  assert.match(publishFlow, /selectedAccountKeys/);
  assert.doesNotMatch(publishFlow, /selectedAccountIds/);
  assert.match(shell, /dedupeAutoUploadAccounts\(accounts\)/);
  assert.match(shell, /window\.setInterval\(\(\) => void load\(\), 30_000\)/);
});
