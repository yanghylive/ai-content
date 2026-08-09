import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");

function read(relativePath) {
  return readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

test("intelligence examples never become actionable search results", () => {
  const source = read(
    "src/app/(dashboard)/intelligence/_components/search-intelligence-workbench.tsx",
  );

  assert.match(source, /const exampleCandidates: SearchCandidate\[\] = \[/);
  assert.match(source, /return realCandidates\.filter\(\(candidate\) =>/);
  assert.doesNotMatch(source, /realCandidates\.length\s*\?\s*realCandidates/);
  assert.match(source, /仅作说明，不是本次搜索结果/);
  assert.match(source, /示例不会进入待处理队列/);

  const clearIndex = source.indexOf("setRealCandidates([]);");
  const requestIndex = source.indexOf("await intelligenceApi.runSearch");
  assert.ok(clearIndex >= 0 && clearIndex < requestIndex);
});

test("reportId loads and focuses an exact report", () => {
  const source = read(
    "src/app/(dashboard)/intelligence/_components/intelligence-reports-workbench.tsx",
  );

  assert.match(source, /searchParams\.get\("reportId"\)/);
  assert.match(source, /intelligenceApi\.getReport\(requestedReportId\)/);
  assert.match(source, /setDraft\(reportToDraft\(focusedReport\)\)/);
  assert.match(source, /params\.set\("reportId", reportId\)/);
  assert.match(source, /requestedReportId === item\.id/);
});

test("runId renders an exact solution-run context on dashboard result pages", () => {
  const layout = read("src/app/(dashboard)/layout.tsx");
  const banner = read(
    "src/app/(dashboard)/components/solution-run-context-banner.tsx",
  );

  assert.match(layout, /searchParams\.get\("runId"\)/);
  assert.match(layout, /<SolutionRunContextBanner runId=\{activeRunId\} \/>/);
  assert.match(banner, /getSolutionRun\(normalizedRunId\)/);
  assert.match(banner, /data-testid="solution-run-context"/);
  assert.match(banner, /运行编号 \{run\.id\}/);
});
