import { readFileSync } from "node:fs";
import path from "node:path";

const frontendRoot = process.cwd();
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
  "Agent-S 未真实化",
  "外部 17777 Python sidecar",
  "旧实现/可选",
  "阻断/未真实化",
  "不能显示为可直接处理",
  "agentSAssessment.isRealExecutionReady ? \"真实执行\" : \"未真实化\"",
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
  "return api.get<AgentSManagerStatus>('/agent-s/status')",
];

for (const snippet of requiredApiSnippets) {
  if (!apiText.includes(snippet)) {
    failures.push(`local-engine.ts missing Agent-S status contract: ${snippet}`);
  }
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
