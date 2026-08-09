import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pagePath = path.join(
  frontendRoot,
  "src",
  "app",
  "(dashboard)",
  "admin",
  "voice-agent",
  "page-legacy.tsx",
);

test("voice page keeps local runtime readiness separate from issued authorization", () => {
  const source = fs.readFileSync(pagePath, "utf8");
  assert.match(source, /serviceRunning:\s*false,\s*ready:\s*false/);
  assert.match(source, /window\.electronAPI\?\.baiLongma/);
  assert.match(source, /本地语音服务未启动，请点击“启动并重试”/);
  assert.match(source, /KAYPAL 已签发账号授权，但本地语音服务尚未确认接收/);
  assert.doesNotMatch(source, /handoffState\s*===\s*["']success["']\s*\|\|\s*pairResult/);
});
