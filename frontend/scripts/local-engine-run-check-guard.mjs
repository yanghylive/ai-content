import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function resolveFrontendRoot() {
  const cwd = process.cwd();
  const directClientPath = path.join(
    cwd,
    "src/app/(dashboard)/local-engine/local-engine-client.tsx",
  );
  if (existsSync(directClientPath)) return cwd;

  const nestedClientPath = path.join(
    cwd,
    "frontend/src/app/(dashboard)/local-engine/local-engine-client.tsx",
  );
  if (existsSync(nestedClientPath)) return path.join(cwd, "frontend");

  throw new Error(
    "Cannot find frontend local-engine-client.tsx. Run from repo root or frontend/.",
  );
}

const frontendRoot = resolveFrontendRoot();
const clientPath = path.join(
  frontendRoot,
  "src/app/(dashboard)/local-engine/local-engine-client.tsx",
);
const apiPath = path.join(frontendRoot, "src/lib/api/local-engine.ts");
const clientText = readFileSync(clientPath, "utf8");
const apiText = readFileSync(apiPath, "utf8");
const failures = [];

const requiredClientSnippets = [
  "function getAgentSAssessment",
  "normalizedRunnerMode.includes(\"mock\")",
  "normalizedRunnerMode.includes(\"compatible\")",
  "browserControl === true",
  "!hasBlockers",
  "本机操作能力未接通",
  "本机操作能力当前可用",
  "可继续处理平台任务",
  "需处理",
  "不能显示为可直接处理",
  "agentSAssessment.isRealExecutionReady",
  "当前可用",
  "无需处理",
  "未接通",
];

for (const snippet of requiredClientSnippets) {
  if (!clientText.includes(snippet)) {
    failures.push(`local-engine-client.tsx missing required runtime wording/check: ${snippet}`);
  }
}

const requiredApiSnippets = [
  "export interface AgentSManagerStatus",
  "runner_mode?: string",
  "runnerMode?: string",
  "browserControl?: boolean",
  "blockers?: string[]",
];

for (const snippet of requiredApiSnippets) {
  if (!apiText.includes(snippet)) {
    failures.push(`local-engine.ts missing Agent-S status contract: ${snippet}`);
  }
}

if (!/return api\.get<AgentSManagerStatus>\((['"])\/agent-s\/status\1\)/.test(apiText)) {
  failures.push("local-engine.ts missing Agent-S status contract: return api.get<AgentSManagerStatus>('/agent-s/status')");
}

const forbiddenClientPatterns = [
  {
    pattern: /<StatusItem\s+label="处理模式"\s+value="真实执行"\s*\/>/,
    message: "processing mode must not be hard-coded as real execution",
  },
  {
    pattern: /warning:\s*\{\s*color:\s*"warning" as const,\s*label:\s*"需要配置"/,
    message: "warning chips must not all be labeled as configuration needed",
  },
  {
    pattern: /missing:\s*\{\s*color:\s*"danger" as const,\s*label:\s*"需要配置"/,
    message: "missing chips should be blocker wording, not generic configuration needed",
  },
  {
    pattern: /label="sidecar 状态"/,
    message: "MCP browser card must not use generic sidecar wording",
  },
  {
    pattern: /外部辅助服务是旧实现或可选项|旧实现\/可选|可执行真实动作/,
    message: "local engine must use customer-facing wording instead of implementation terminology",
  },
];

for (const { pattern, message } of forbiddenClientPatterns) {
  if (pattern.test(clientText)) {
    failures.push(message);
  }
}

if (failures.length) {
  console.error("Local engine run-check guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Local engine run-check guard passed.");
