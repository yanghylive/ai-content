import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  agentSessionRequiresEvidence,
  getAgentSessionVerificationState,
} from "../src/lib/agent-session-verification.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");

function read(relativePath) {
  return readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

function session(overrides = {}) {
  return {
    id: "session-1",
    title: "内部分析",
    instruction: "整理本地资料",
    status: "completed",
    statusLabel: "已完成",
    executionScope: "local-files",
    source: "system",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    completedAt: "2026-07-19T00:00:00.000Z",
    riskLevel: "low",
    confirmations: [],
    events: [],
    ...overrides,
  };
}

test("real growth execution has one API path behind preflight confirmation", () => {
  const source = read("src/components/growth/growth-console.tsx");
  const executeCalls = source.match(/growthApi\.executeConfig\(/g) || [];

  assert.equal(executeCalls.length, 1);
  assert.match(
    source,
    /const executeConfig = async[\s\S]*?await openPreflight\(config\);/,
  );
  assert.match(
    source,
    /const confirmPreflightExecution = async[\s\S]*?if \(!preflight\.allowed \|\| preflight\.blockers\.length > 0\)[\s\S]*?growthApi\.executeConfig\([\s\S]*?preflight\.config\.id/,
  );
  assert.match(source, /onExecute=\{confirmPreflightExecution\}/);
  assert.match(source, /onPress=\{\(\) => onConfirm\(config\)\}/);
  assert.match(source, /确认并执行/);
  assert.doesNotMatch(source, /executeConfigNow|acknowledgePreflight/);
});

test("growth preview remains a dry-run without real external actions", () => {
  const source = read("src/components/growth/growth-console.tsx");

  assert.match(source, /aiEmployeeApi\.createDryRunTask\(/);
  assert.match(
    source,
    /只生成任务事件、待确认和结果留存，不执行真实采集、评论、私信或批量触达/,
  );
});

test("internal analysis can complete without external-action evidence", () => {
  const state = getAgentSessionVerificationState(session());

  assert.equal(state.requiresEvidence, false);
  assert.equal(state.evidenceCount, 0);
  assert.equal(state.pendingVerification, false);
});

test("high-risk and platform actions stay pending until evidence exists", () => {
  const cases = [
    session({ riskLevel: "high" }),
    session({ source: "publishing" }),
    session({ source: "interaction" }),
    session({
      executionScope: "browser",
      targetApp: "内容平台",
    }),
    session({ metadata: { actionKind: "platform_action" } }),
  ];

  for (const item of cases) {
    assert.equal(agentSessionRequiresEvidence(item), true);
    assert.equal(
      getAgentSessionVerificationState(item).pendingVerification,
      true,
    );
  }

  const verified = getAgentSessionVerificationState(
    session({
      riskLevel: "high",
      events: [
        {
          id: "event-1",
          sessionId: "session-1",
          level: "success",
          title: "平台回执",
          message: "已留存",
          createdAt: "2026-07-19T00:00:00.000Z",
          evidence: {
            type: "result_summary",
            label: "结果",
            value: "执行成功",
          },
        },
      ],
    }),
  );
  assert.equal(verified.evidenceCount, 1);
  assert.equal(verified.pendingVerification, false);
});

test("explicit low-risk read-only metadata avoids false pending states", () => {
  const item = session({
    executionScope: "browser",
    targetApp: "研究页面",
    metadata: { requiresEvidence: false, executionKind: "read_only" },
  });
  const state = getAgentSessionVerificationState(item);

  assert.equal(state.requiresEvidence, false);
  assert.equal(state.pendingVerification, false);
  assert.equal(
    agentSessionRequiresEvidence(
      session({ riskLevel: "high", metadata: { requiresEvidence: false } }),
    ),
    true,
  );
});

test("drawer and lifecycle use the same pending-verification state", () => {
  const drawer = read("src/components/agent-status-drawer.tsx");
  const lifecycle = read(
    "src/components/agent-session-lifecycle-stepper.tsx",
  );

  for (const source of [drawer, lifecycle]) {
    assert.match(source, /getAgentSessionVerificationState/);
    assert.match(source, /verification\.pendingVerification/);
    assert.match(source, /待核验/);
  }
  assert.match(lifecycle, /证据缺失/);
  assert.match(lifecycle, /内部分析任务无需外部动作证据/);
});
