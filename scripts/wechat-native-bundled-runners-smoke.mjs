#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const runtime = join(
  root,
  "desktop",
  "runtime",
  "wechat-native-runtime",
  "kaypal-wechat-native-runtime.js",
);
const runnersDir = join(root, "desktop", "runtime", "wechat-native-runners");
const contractVersion = "2026-06-26.wechat-native-v1";

const runnerFiles = {
  "group-broadcast": "kaypal-wechat-group-broadcast-runner.js",
  "contact-add": "kaypal-wechat-contact-add-runner.js",
  "friend-accept": "kaypal-wechat-friend-accept-runner.js",
  "moments-publish": "kaypal-wechat-moments-publish-runner.js",
  "moments-marketing": "kaypal-wechat-moments-marketing-runner.js",
  "chat-history": "kaypal-wechat-chat-history-runner.js",
};

for (const [command, file] of Object.entries(runnerFiles)) {
  const fullPath = join(runnersDir, file);
  assert(existsSync(fullPath), `missing bundled runner for ${command}: ${fullPath}`);
}

const contract = runRuntime("contract", {}, {});
assert(contract.status === 0, "contract should succeed");
for (const command of Object.keys(runnerFiles)) {
  assert(contract.json.output?.implementedCommands?.includes(command), `contract should mark ${command} implemented`);
  assert(contract.json.output?.inputValidation?.[command], `contract should describe ${command} input validation`);
}
assert(contract.json.output?.dryRun?.status?.includes("skipped"), "contract should describe dry-run status");
assert(contract.json.output?.unsupportedPlatform?.status?.includes("unsupported_platform"), "contract should describe unsupported_platform");
assert(contract.json.output?.realExecutionEvidence?.writeLikeCommands?.length > 0, "contract should describe write evidence");
assert(contract.json.output?.realExecutionEvidence?.chatHistory?.length > 0, "contract should describe chat-history evidence");

const diagnose = runRuntime("diagnose", {}, {});
assert(diagnose.status === 0, "diagnose should succeed");
for (const command of Object.keys(runnerFiles)) {
  const entry = diagnose.json.diagnostics?.externalCommandRunners?.[command];
  assert(entry, `diagnose should include ${command} command runner`);
  if (process.platform === "win32") {
    assert(entry.status === "ready", `${command} should be ready on Windows`);
  } else {
    assert(entry.status === "detected-not-runnable", `${command} should be detected but not runnable on non-Windows`);
    assert(entry.candidates?.some((candidate) => candidate.platformSupported === false), `${command} should expose platformSupported:false`);
  }
}

for (const command of Object.keys(runnerFiles)) {
  const validRequest = requestForCommand(command);
  const invalidRequest = invalidRequestForCommand(command);

  const runtimeInvalid = runRuntime(command, invalidRequest, {});
  assert(runtimeInvalid.status !== 0, `${command} invalid input should fail before platform/runner`);
  assert(runtimeInvalid.json.errorCode === expectedInvalidCode(command), `${command} invalid errorCode should be ${expectedInvalidCode(command)}`);
  assert(runtimeInvalid.json.raw?.realWechatActionAttempted !== true, `${command} invalid input must not attempt real action`);

  const runtimeDryRun = runRuntime(command, withDryRun(validRequest), {});
  assert(runtimeDryRun.status === 0, `${command} runtime dry-run should succeed`);
  assert(runtimeDryRun.json.ok === true, `${command} runtime dry-run ok should be true`);
  assert(runtimeDryRun.json.status === "skipped", `${command} runtime dry-run status should be skipped`);
  assert(runtimeDryRun.json.raw?.dryRun === true, `${command} runtime dry-run raw.dryRun should be true`);
  assert(runtimeDryRun.json.raw?.realWechatActionAttempted === false, `${command} runtime dry-run must not attempt real action`);

  const directDryRun = runBundledRunner(command, withDryRun(validRequest));
  assert(directDryRun.status === 0, `${command} bundled runner dry-run should succeed`);
  assert(directDryRun.json.ok === true, `${command} bundled runner dry-run ok should be true`);
  assert(directDryRun.json.status === "skipped", `${command} bundled runner dry-run status should be skipped`);
  assert(directDryRun.json.contractVersion === contractVersion, `${command} bundled runner should echo contractVersion`);
  assert(directDryRun.json.raw?.realWechatActionAttempted === false, `${command} bundled dry-run must not attempt real action`);

  if (process.platform !== "win32") {
    const runtimeUnsupported = runRuntime(command, validRequest, {});
    assert(runtimeUnsupported.status !== 0, `${command} runtime must not execute on non-Windows`);
    assert(runtimeUnsupported.json.errorCode === "unsupported_platform", `${command} runtime should reject non-Windows`);
    assert(runtimeUnsupported.json.raw?.realWechatActionAttempted === false, `${command} runtime unsupported must not attempt real action`);

    const directUnsupported = runBundledRunner(command, validRequest);
    assert(directUnsupported.status !== 0, `${command} bundled runner must not succeed on non-Windows`);
    assert(directUnsupported.json.errorCode === "unsupported_platform", `${command} bundled runner should reject non-Windows`);
    assert(directUnsupported.json.raw?.realWechatActionAttempted === false, `${command} bundled unsupported must not attempt real action`);

    const runtimeThroughBundled = runRuntime(command, validRequest, {
      AI_CONTENT_WECHAT_ALLOW_NON_WINDOWS_COMMAND_RUNNER: "1",
    });
    assert(runtimeThroughBundled.status !== 0, `${command} bundled Windows runner must not succeed on non-Windows`);
    assert(runtimeThroughBundled.json.errorCode === "unsupported_platform", `${command} bundled runner should reject non-Windows through runtime`);
  }
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      platform: process.platform,
      commands: Object.keys(runnerFiles),
      checks: [
        "bundled runner files exist",
        "runtime contract exposes input validation, dry-run, unsupported_platform, and evidence requirements",
        "runtime diagnose exposes command runner readiness",
        "invalid inputs are blocked before runner execution",
        "dry-run succeeds without real WeChat action",
        process.platform === "win32"
          ? "Windows runner discovery is ready"
          : "runtime and bundled runners reject non-Windows execution",
      ],
    },
    null,
    2,
  ),
);

function baseRequest(command) {
  return {
    contractVersion,
    command,
    context: {
      runId: "wechat-native-bundled-runners-smoke",
      safety: {
        sendMode: command === "friend-accept" ? "auto-send" : "approval",
        dryRun: false,
        readbackRequired: true,
      },
    },
  };
}

function withDryRun(request) {
  return {
    ...request,
    context: {
      ...(request.context || {}),
      safety: {
        ...((request.context && request.context.safety) || {}),
        dryRun: true,
      },
    },
  };
}

function requestForCommand(command) {
  const base = baseRequest(command);
  if (command === "contact-add") {
    return {
      ...base,
      input: {
        targets: [{ id: "wxid_test", displayName: "测试客户", searchText: "wxid_test" }],
        verifyMessage: "你好，我想了解一下你的需求。",
      },
    };
  }
  if (command === "friend-accept") {
    return {
      ...base,
      input: {
        remark: { strategy: "manual", value: "Kaypal测试" },
        welcomeMessage: "测试欢迎语",
        matchKeywords: ["KAYPAL_TEST_REQUEST"],
        dailyLimit: 1,
      },
    };
  }
  if (command === "moments-publish") {
    return { ...base, input: { content: { text: "测试朋友圈内容", assets: [] } } };
  }
  if (command === "moments-marketing") {
    return {
      ...base,
      input: {
        actions: { browse: true, like: false, comment: false },
        browseLimit: 1,
      },
    };
  }
  if (command === "chat-history") {
    return { ...base, input: { action: "sync", sessionId: "visible", limit: 5 } };
  }
  return {
    ...base,
    input: {
      targets: [{ id: "wxid_test", displayName: "测试客户", searchText: "wxid_test" }],
      message: { text: "测试内容", attachments: [] },
    },
  };
}

function invalidRequestForCommand(command) {
  const base = baseRequest(command);
  if (command === "group-broadcast") {
    return { ...base, input: { targets: [{ displayName: "测试客户" }], message: { text: "", attachments: [] } } };
  }
  if (command === "contact-add") {
    return { ...base, input: { targets: [{ id: "wxid_test", displayName: "测试客户" }], verifyMessage: "" } };
  }
  if (command === "friend-accept") {
    return { ...base, input: { matchKeywords: [], dailyLimit: 1 } };
  }
  if (command === "moments-publish") {
    return { ...base, input: { content: { text: "", assets: [] } } };
  }
  if (command === "moments-marketing") {
    return { ...base, input: { actions: { browse: false, like: false, comment: false }, browseLimit: 1 } };
  }
  return { ...base, input: { action: "messages", limit: 5 } };
}

function expectedInvalidCode(command) {
  if (command === "group-broadcast") return "content_invalid";
  if (command === "contact-add") return "content_invalid";
  if (command === "friend-accept") return "content_invalid";
  if (command === "moments-publish") return "content_invalid";
  if (command === "moments-marketing") return "content_invalid";
  return "target_missing";
}

function runBundledRunner(command, request) {
  const result = spawnSync(process.execPath, [join(runnersDir, runnerFiles[command]), command], {
    cwd: root,
    input: JSON.stringify(request),
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
  });
  const json = parseLastJson(result.stdout);
  if (!json) {
    throw new Error(`${command} runner did not return JSON. status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
  }
  return { status: result.status ?? 0, json, stderr: result.stderr };
}

function runRuntime(command, request, env) {
  const result = spawnSync(process.execPath, [runtime, command], {
    cwd: root,
    input: Object.keys(request || {}).length ? JSON.stringify(request) : "",
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
    windowsHide: true,
  });
  const json = parseLastJson(result.stdout);
  if (!json) {
    throw new Error(`Runtime did not return JSON. status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
  }
  return { status: result.status ?? 0, json, stderr: result.stderr };
}

function parseLastJson(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep looking.
    }
  }
  return null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
