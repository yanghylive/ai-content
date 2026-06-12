import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const frontendRoot = process.cwd();
const repoRoot = path.resolve(frontendRoot, "..");
const sourceMapPath = path.join(
  frontendRoot,
  "src/lib/agent-cockpit-canvas/source-map.json",
);
const sourceMap = JSON.parse(readFileSync(sourceMapPath, "utf8"));
const mappedFiles = new Set(Object.keys(sourceMap.files));
const failures = [];

const requiredDocs = [
  "docs/agent-console-agent-cockpit-project-initiation-2026-06-08.html",
  "docs/agent-console-agent-cockpit-prd-2026-06-08.html",
  "docs/agent-console-agent-cockpit-ui-spec-2026-06-08.html",
  "docs/agent-console-agent-cockpit-technical-design-2026-06-08.html",
  "docs/agent-console-agent-cockpit-api-contract-2026-06-08.html",
  "docs/agent-console-agent-surface-catalog-2026-06-08.html",
  "docs/agent-console-agent-cockpit-safety-policy-2026-06-08.html",
  "docs/agent-console-agent-cockpit-acceptance-checklist-2026-06-08.html",
  "docs/agent-console-agent-cockpit-development-breakdown-2026-06-08.html",
];

for (const doc of requiredDocs) {
  if (!existsSync(path.join(repoRoot, doc))) {
    failures.push(`missing development doc: ${doc}`);
  }
}

const forbiddenPaths = [
  "src/app/agent-cockpit-lab",
  "src/app/(dashboard)/agent-cockpit-lab",
  "src/components/agent-cockpit-canvas/dashboard/current-task-workspace.tsx",
];

for (const relativePath of forbiddenPaths) {
  if (existsSync(path.join(frontendRoot, relativePath))) {
    failures.push(`forbidden path still exists: ${relativePath}`);
  }
}

const dashboardFile = path.join(
  frontendRoot,
  "src/components/agent-cockpit-canvas/dashboard/dashboard.tsx",
);
const dashboardText = readFileSync(dashboardFile, "utf8");
if (!dashboardText.includes("PinnedMetrics") || !dashboardText.includes("Charts")) {
  failures.push("dashboard.tsx must keep the GitHub PinnedMetrics + Charts skeleton");
}
if (dashboardText.includes("CurrentTaskWorkspace")) {
  failures.push("dashboard.tsx imports a handwritten canvas workspace");
}

const forbiddenText = [
  "Cockpit metrics",
  "Cockpit status charts",
  "Agent sessions by status",
  "Evidence by type",
  "本机引擎在线",
  "运行中数量",
  "待确认总数",
  "证据总数",
  "metrics_panel",
  "global_status",
  "engine_dashboard",
];

const forbiddenVisibleEnglish = [
  "Persistent Canvas",
  "PERSISTENT CANVAS",
  "Add Metric",
  "Add Chart",
  "Edit Metric",
  "Edit Chart",
  "New Metric",
  "New Chart",
  "Ask for anything",
  "Press Enter to send",
  "Stop generating",
  "Kaypal Agent Cockpit",
  "Local computer task",
  "Chat task",
  "Evidence review",
  "Chat only",
  "Local task",
  "Untitled",
];

for (const relativeFile of listSourceFiles([
  "src/app/agent-cockpit-canvas",
  "src/components/agent-cockpit-canvas",
  "src/lib/agent-cockpit-canvas",
])) {
  const text = readFileSync(path.join(frontendRoot, relativeFile), "utf8");
  for (const phrase of forbiddenText) {
    if (text.includes(phrase)) {
      failures.push(`forbidden global-dashboard text "${phrase}" in ${relativeFile}`);
    }
  }
  for (const phrase of forbiddenVisibleEnglish) {
    if (text.includes(phrase)) {
      failures.push(`forbidden visible English UI text "${phrase}" in ${relativeFile}`);
    }
  }
  if (!mappedFiles.has(relativeFile) && /\.(tsx?|json)$/.test(relativeFile)) {
    failures.push(`agent cockpit file is missing GitHub source mapping: ${relativeFile}`);
  }
}

const protectedDiff = execFileSync(
  "git",
  [
    "status",
    "--short",
    "--",
    "frontend/src/app/(dashboard)/agent-console",
  ],
  { cwd: repoRoot, encoding: "utf8" },
).trim();
if (protectedDiff) {
  failures.push(`protected original agent console files changed:\n${protectedDiff}`);
}

if (failures.length) {
  console.error("Agent Cockpit route guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Agent Cockpit route guard passed.");

function listSourceFiles(relativeDirs) {
  const result = [];
  for (const relativeDir of relativeDirs) {
    const absoluteDir = path.join(frontendRoot, relativeDir);
    if (!existsSync(absoluteDir)) continue;
    walk(absoluteDir, relativeDir);
  }
  return result;

  function walk(absoluteDir, relativeDir) {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolutePath = path.join(absoluteDir, entry.name);
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
        continue;
      }
      if (/\.(tsx?|json)$/.test(entry.name)) result.push(relativePath);
    }
  }
}
