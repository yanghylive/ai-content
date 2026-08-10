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
const contractVersion = "2026-06-26.wechat-native-v1";
const commands = [
  "group-broadcast",
  "contact-add",
  "friend-accept",
  "moments-publish",
  "moments-marketing",
  "chat-history",
];

const tempDir = mkdtempSync(join(tmpdir(), "wechat-native-runner-smoke-"));

try {
  const goodRunner = join(tempDir, "good-runner.js");
  const badRunner = join(tempDir, "bad-runner.js");
  writeFileSync(
    goodRunner,
    `#!/usr/bin/env node
let raw = '';
process.stdin.on('data', (chunk) => { raw += String(chunk); });
process.stdin.on('end', () => {
  const request = JSON.parse(raw || '{}');
  const command = request.command;
  const now = new Date().toISOString();
  if (command === 'chat-history') {
    process.stdout.write(JSON.stringify({
      ok: true,
      command,
      status: 'success',
      errorCode: 'success',
      output: {
        source: 'windows-wechat-uia',
        sessions: [{ id: 'session-1', title: '测试客户', source: 'windows-wechat-uia', updatedAt: now }],
        messages: [{ id: 'message-1', sessionId: 'session-1', content: '测试消息', source: 'windows-wechat-uia', sentAt: now }],
        count: 1,
        syncedAt: now,
        evidence: [{ type: 'text', label: 'wechat-chat-history', value: 'session-1', trusted: true, createdAt: now }]
      },
      diagnostics: { stage: command + '-external-runner-completed', screenshotPath: '/tmp/wechat-chat-history.png' },
      raw: { realWechatActionAttempted: false }
    }) + '\\n');
    return;
  }
  const output = command === 'moments-publish'
    ? {
        status: 'published',
        contentText: '测试朋友圈内容',
        assetPaths: [],
        readback: { matched: true, expectedText: '测试朋友圈内容', actualText: '测试朋友圈内容', capturedAt: now },
        evidence: [{ type: 'text', label: 'wechat-moments-publish', value: '测试朋友圈内容', trusted: true, createdAt: now }]
      }
    : {
        summary: { total: 1, succeeded: 1, failed: 0, blocked: 0, skipped: 0 },
        results: [{
          targetName: '测试客户',
          ok: true,
          status: 'success',
          readback: { matched: true, expectedText: '测试内容', actualText: '已发送测试内容', capturedAt: now },
          evidence: [{ type: 'text', label: command, value: '测试客户', trusted: true, createdAt: now }]
        }]
      };
  process.stdout.write(JSON.stringify({
    ok: true,
    command,
    status: 'success',
    errorCode: 'success',
    output,
    diagnostics: { stage: command + '-external-runner-completed', screenshotPath: '/tmp/' + command + '.png' },
    raw: { realWechatActionAttempted: true }
  }) + '\\n');
});
`,
    "utf8",
  );
  writeFileSync(
    badRunner,
    `#!/usr/bin/env node
let raw = '';
process.stdin.on('data', (chunk) => { raw += String(chunk); });
process.stdin.on('end', () => {
  const request = JSON.parse(raw || '{}');
  const command = request.command;
  process.stdout.write(JSON.stringify({
    ok: true,
    command,
    status: 'success',
    errorCode: 'success',
    output: command === 'chat-history'
      ? { source: 'windows-wechat-uia', sessions: [], messages: [], count: 0 }
      : { summary: { total: 1, succeeded: 1 }, results: [{ targetName: '测试客户', ok: true, status: 'success' }] },
    diagnostics: { stage: command + '-bad-runner-completed' },
    raw: { realWechatActionAttempted: command !== 'chat-history' }
  }) + '\\n');
});
`,
    "utf8",
  );

  for (const command of commands) {
    const request = requestForCommand(command);
    const envName = runnerEnvName(command);

    const good = runRuntime(request, {
      [envName]: goodRunner,
      AI_CONTENT_WECHAT_ALLOW_NON_WINDOWS_COMMAND_RUNNER: "1",
    });
    assert(good.status === 0, `${command} good external runner should succeed`);
    assert(good.json.ok === true, `${command} good external runner ok should be true`);
    assert(good.json.diagnostics?.externalRunner?.status === "completed", `${command} good runner diagnostics should be completed`);
    assert(hasEvidence(good.json), `${command} good runner should expose evidence`);
    if (command !== "chat-history") {
      assert(good.json.raw?.realWechatActionAttempted === true, `${command} write-like good runner should mark real action`);
    }

    const bad = runRuntime(request, {
      [envName]: badRunner,
      AI_CONTENT_WECHAT_ALLOW_NON_WINDOWS_COMMAND_RUNNER: "1",
    });
    assert(bad.status !== 0, `${command} unverified external runner should be blocked`);
    assert(bad.json.errorCode === "readback_failed", `${command} unverified runner should be rejected by readback/evidence guard`);
    assert(bad.json.raw?.externalRunnerRejected === true, `${command} unverified runner should be marked rejected`);
    assert(bad.json.raw?.executionEvidencePresent === false, `${command} bad runner should expose missing evidence flag`);
  }

  const dryRun = runRuntime(withDryRun(requestForCommand("group-broadcast")), {
    AI_CONTENT_WECHAT_COMMAND_RUNNER_GROUP_BROADCAST: goodRunner,
    AI_CONTENT_WECHAT_ALLOW_NON_WINDOWS_COMMAND_RUNNER: "1",
  });
  assert(dryRun.status === 0, "dry-run should not invoke external runner");
  assert(dryRun.json.status === "skipped", "dry-run status should be skipped");
  assert(!dryRun.json.diagnostics?.externalRunner, "dry-run should not include externalRunner diagnostics");
  assert(dryRun.json.raw?.realWechatActionAttempted === false, "dry-run should not attempt real action");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        commands,
        checks: [
          "verified external runners succeed for all six commands",
          "missing readback/evidence is rejected for all six commands",
          "dry-run bypasses external runner execution",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function requestForCommand(command) {
  const base = {
    contractVersion,
    command,
    context: {
      runId: "wechat-native-external-runner-smoke",
      safety: {
        sendMode: command === "friend-accept" ? "auto-send" : "approval",
        dryRun: false,
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
      rateLimit: { dailyLimit: 1 },
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

function runnerEnvName(command) {
  return `AI_CONTENT_WECHAT_COMMAND_RUNNER_${command.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

function hasEvidence(payload) {
  const output = payload.output || {};
  const diagnostics = payload.diagnostics || {};
  if (Array.isArray(payload.evidence) && payload.evidence.length) return true;
  if (Array.isArray(output.evidence) && output.evidence.length) return true;
  if (payload.screenshotPath || output.screenshotPath || diagnostics.screenshotPath) return true;
  const results = Array.isArray(output.results) ? output.results : [];
  return results.some((item) => Array.isArray(item.evidence) && item.evidence.length);
}

function runRuntime(request, env) {
  const result = spawnSync(process.execPath, [runtime, request.command], {
    cwd: root,
    input: JSON.stringify(request),
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
    windowsHide: true,
  });
  const json = parseLastJson(result.stdout);
  if (!json) {
    throw new Error(
      `Runtime did not return JSON. status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`,
    );
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
