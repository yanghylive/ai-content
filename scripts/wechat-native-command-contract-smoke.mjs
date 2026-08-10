#!/usr/bin/env node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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

const commands = [
  "group-broadcast",
  "contact-add",
  "friend-accept",
  "moments-publish",
  "moments-marketing",
  "chat-history",
];

const tempDir = mkdtempSync(join(tmpdir(), "wechat-native-command-contract-"));

try {
  const evidenceFile = join(tempDir, "evidence.png");
  writeFileSync(evidenceFile, "fake png evidence", "utf8");

  const goodRunner = join(tempDir, "good-runner.js");
  const badRunner = join(tempDir, "bad-runner.js");
  const noReadbackRunner = join(tempDir, "no-readback-runner.js");

  writeFileSync(goodRunner, goodRunnerSource(evidenceFile), "utf8");
  writeFileSync(badRunner, badRunnerSource(), "utf8");
  writeFileSync(noReadbackRunner, noReadbackRunnerSource(), "utf8");

  for (const command of commands) {
    const request = requestForCommand(command, { dryRun: true });
    const direct = runBundledRunner(command, request);
    assert(direct.status === 0, `${command} bundled runner dry-run should succeed`);
    assert(direct.json.contractVersion === contractVersion, `${command} dry-run should include contractVersion`);
    assert(direct.json.runnerVersion, `${command} dry-run should include runnerVersion`);
    assert(direct.json.output, `${command} dry-run should include output`);
    assert(direct.json.raw?.realWechatActionAttempted === false, `${command} dry-run must not mark real action`);
  }

  if (process.platform !== "win32") {
    for (const command of commands) {
      const request = requestForCommand(command);
      const direct = runBundledRunner(command, request);
      assert(direct.status !== 0, `${command} bundled runner must reject non-Windows`);
      assert(direct.json.errorCode === "unsupported_platform", `${command} non-Windows rejection should be unsupported_platform`);
      assert(direct.json.raw?.realWechatActionAttempted === false, `${command} non-Windows rejection must not mark attempted`);
    }
  }

  for (const command of commands) {
    const request = requestForCommand(command);
    const env = envForCommand(command, goodRunner);
    const good = runRuntime(command, request, env);
    assert(good.status === 0, `${command} verified external runner should succeed`);
    assert(good.json.ok === true, `${command} verified external runner ok should be true`);
    assert(good.json.contractVersion === contractVersion, `${command} verified result should include contractVersion`);
    assert(good.json.diagnostics?.externalRunner?.status === "completed", `${command} external runner diagnostics should be completed`);
    assert(hasEvidence(good.json), `${command} verified result should include evidence`);
    if (command !== "chat-history") {
      assert(good.json.raw?.realWechatActionAttempted === true, `${command} write command should mark real action`);
      assert(hasMatchedReadback(good.json), `${command} write command should include matched readback`);
    } else {
      assert(hasChatHistory(good.json), "chat-history should include sessions/messages/source");
    }

    const noReadback = runRuntime(command, request, envForCommand(command, noReadbackRunner));
    assert(noReadback.status !== 0, `${command} runner without readback should be rejected`);
    assert(noReadback.json.errorCode === "readback_failed", `${command} runner without readback should fail readback guard`);

    const bad = runRuntime(command, request, envForCommand(command, badRunner));
    assert(bad.status !== 0, `${command} malformed-success runner should be rejected`);
    assert(bad.json.raw?.externalRunnerRejected === true, `${command} rejected runner should be marked`);
  }

  console.log(
    JSON.stringify(
      {
        status: "passed",
        platform: process.platform,
        commands,
        checks: [
          "bundled runners satisfy dry-run contract",
          process.platform === "win32"
            ? "bundled runners are discoverable on Windows and dry-run safe"
            : "bundled runners reject non-Windows real execution",
          "external runner success requires readback/evidence",
          "fake success is rejected for all WeChat command types",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function envForCommand(command, runnerPath) {
  return {
    AI_CONTENT_WECHAT_ALLOW_NON_WINDOWS_COMMAND_RUNNER: "1",
    [`AI_CONTENT_WECHAT_COMMAND_RUNNER_${command.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`]: runnerPath,
  };
}

function requestForCommand(command, options = {}) {
  const base = {
    contractVersion,
    command,
    context: {
      runId: `wechat-native-command-contract-smoke-${command}`,
      safety: {
        sendMode: command === "friend-accept" ? "auto-send" : "approval",
        dryRun: options.dryRun === true,
        readbackRequired: true,
      },
    },
  };
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
    return {
      ...base,
      input: { content: { text: "测试朋友圈内容", assets: [] } },
    };
  }
  if (command === "moments-marketing") {
    return {
      ...base,
      input: {
        mode: "random",
        actions: { browse: true, like: true, comment: true },
        browseLimit: 1,
        comment: { mode: "fixed", fixedText: "这条内容很有启发" },
        targets: [{ id: "1", contact: { displayName: "测试客户", searchText: "测试客户" } }],
      },
    };
  }
  if (command === "chat-history") {
    return {
      ...base,
      input: { action: "visible", sessionId: "测试会话", limit: 5 },
    };
  }
  return {
    ...base,
    input: {
      targets: [{ id: "wxid_test", displayName: "测试客户", searchText: "测试客户" }],
      message: { text: "测试群发内容", attachments: [] },
      rateLimit: { dailyLimit: 1 },
    },
  };
}

function goodRunnerSource(evidenceFile) {
  return `#!/usr/bin/env node
let raw = '';
process.stdin.on('data', (chunk) => { raw += String(chunk); });
process.stdin.on('end', () => {
  const request = JSON.parse(raw || '{}');
  const command = request.command;
  const now = new Date().toISOString();
  const evidence = [{ type: 'screenshot', label: 'verified-readback', value: ${JSON.stringify(evidenceFile)}, path: ${JSON.stringify(evidenceFile)}, trusted: true, createdAt: now }];
  const readback = { expectedText: '测试', actualText: '测试内容已在微信窗口读回', matched: true, capturedAt: now };
  const base = {
    ok: true,
    contractVersion: request.contractVersion,
    command,
    runner: 'contract-smoke-good-runner',
    runnerVersion: '0.0.1',
    status: 'success',
    errorCode: 'success',
    message: command + ' verified',
    diagnostics: { stage: command + '-contract-smoke-completed', evidence },
    raw: { realWechatActionAttempted: command !== 'chat-history' },
    completedAt: now
  };
  if (command === 'chat-history') {
    base.output = {
      source: 'windows-wechat-uia',
      sessions: [{ id: 's1', title: '测试会话', source: 'windows-wechat-uia', updatedAt: now }],
      messages: [{ id: 'm1', sessionId: 's1', content: '测试消息', contentType: 'text', source: 'windows-wechat-uia', sentAt: now }],
      count: 1,
      evidence
    };
  } else if (command === 'moments-publish') {
    base.output = { status: 'draft_filled', contentText: '测试朋友圈内容', assetPaths: [], readback, evidence };
  } else {
    base.output = {
      summary: { total: 1, succeeded: 1, failed: 0, blocked: 0, skipped: 0 },
      results: [{ targetName: '测试客户', ok: true, status: 'success', readback, evidence }],
      readback
    };
  }
  process.stdout.write(JSON.stringify(base) + '\\n');
});
`;
}

function badRunnerSource() {
  return `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ ok: true, status: 'success', errorCode: 'success', output: { summary: { total: 1, succeeded: 1 } } }) + '\\n');
});
`;
}

function noReadbackRunnerSource() {
  return `#!/usr/bin/env node
let raw = '';
process.stdin.on('data', (chunk) => { raw += String(chunk); });
process.stdin.on('end', () => {
  const request = JSON.parse(raw || '{}');
  process.stdout.write(JSON.stringify({
    ok: true,
    contractVersion: request.contractVersion,
    command: request.command,
    status: 'success',
    errorCode: 'success',
    output: request.command === 'chat-history' ? { source: 'empty', sessions: [], messages: [], count: 0 } : { summary: { total: 1, succeeded: 1 }, results: [] },
    raw: { realWechatActionAttempted: request.command !== 'chat-history' }
  }) + '\\n');
});
`;
}

function runBundledRunner(command, request) {
  const result = spawnSync(process.execPath, [join(runnersDir, `kaypal-wechat-${command}-runner.js`), command], {
    cwd: root,
    input: JSON.stringify(request),
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
  });
  return parseResult(command, result);
}

function runRuntime(command, request, env) {
  const result = spawnSync(process.execPath, [runtime, command], {
    cwd: root,
    input: JSON.stringify(request),
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true,
  });
  return parseResult(command, result);
}

function parseResult(command, result) {
  const json = parseLastJson(result.stdout);
  if (!json) {
    throw new Error(`${command} returned no JSON. status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
  }
  return { status: result.status ?? 0, json, stderr: result.stderr };
}

function parseLastJson(value) {
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // keep scanning
    }
  }
  return null;
}

function hasMatchedReadback(payload) {
  const output = payload.output || {};
  if (output.readback?.matched === true) return true;
  return Array.isArray(output.results) && output.results.some((item) => item?.readback?.matched === true);
}

function hasEvidence(payload) {
  const output = payload.output || {};
  const diagnostics = payload.diagnostics || {};
  if (Array.isArray(output.evidence) && output.evidence.length > 0) return true;
  if (Array.isArray(diagnostics.evidence) && diagnostics.evidence.length > 0) return true;
  if (Array.isArray(output.results) && output.results.some((item) => Array.isArray(item.evidence) && item.evidence.length > 0)) return true;
  return false;
}

function hasChatHistory(payload) {
  const output = payload.output || {};
  return output.source && Array.isArray(output.sessions) && output.sessions.length > 0 && Array.isArray(output.messages) && output.messages.length > 0;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
