import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const pageSource = readFileSync(
  path.join(frontendRoot, "src/app/(dashboard)/workbench/page.tsx"),
  "utf8",
);

function functionSource(name, nextName) {
  const start = pageSource.indexOf(`const ${name} =`);
  const end = pageSource.indexOf(`const ${nextName} =`, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return pageSource.slice(start, end);
}

test("starting or cancelling the customer-service wizard never writes a bot", () => {
  const startDraft = functionSource("startBotDraft", "cancelBotDraft");
  const cancelDraft = functionSource("cancelBotDraft", "selectBot");

  assert.match(startDraft, /setIsCreatingBot\(true\)/);
  assert.doesNotMatch(startDraft, /api\.(?:post|put|patch|delete)/);
  assert.match(cancelDraft, /setIsCreatingBot\(false\)/);
  assert.doesNotMatch(cancelDraft, /api\.(?:post|put|patch|delete)/);
  assert.match(pageSource, /onPress=\{startBotDraft\}/);
  assert.match(pageSource, /onPress=\{cancelBotDraft\}/);
});

test("only explicit save creates a persisted customer-service bot", () => {
  const saveConfig = functionSource("saveConfig", "startBotDraft");

  assert.match(saveConfig, /const creatingBot = isCreatingBot/);
  assert.match(saveConfig, /if \(saveConfigLockRef\.current\) return/);
  assert.match(saveConfig, /saveConfigLockRef\.current = true/);
  assert.match(saveConfig, /saveConfigLockRef\.current = false/);
  assert.match(
    saveConfig,
    /creatingBot\s*\? await api\.post<CustomerServiceBot>\(\s*"\/local-engine\/reply-bots"/,
  );
  assert.match(
    saveConfig,
    /`\/local-engine\/reply-bots\/\$\{encodeURIComponent\(selectedBotId\)\}`/,
  );

  const createCalls =
    pageSource.match(
      /api\.post<CustomerServiceBot>\(\s*"\/local-engine\/reply-bots"/g,
    ) || [];
  assert.equal(createCalls.length, 1);
  assert.match(pageSource, /onPress=\{saveConfig\}/);
});
