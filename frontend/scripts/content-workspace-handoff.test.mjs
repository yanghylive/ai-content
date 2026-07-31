import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const read = (relativePath) =>
  readFileSync(path.join(frontendRoot, relativePath), "utf8");

const workspaceSource = read(
  "src/app/(dashboard)/content/workspace/content-workspace-client.tsx",
);
const distributionSource = read("src/app/(dashboard)/distribution/page.tsx");
const apiSource = read("src/lib/api/content-optimization.ts");
const workspaceApiSource = read("src/lib/api/content-workspace.ts");

test("workspace hands off a persisted preparation identity", () => {
  assert.match(workspaceSource, /source:\s*"content-workspace"/);
  assert.match(workspaceSource, /preparationId:\s*preparation\.id/);
  assert.match(workspaceSource, /tab:\s*"article"/);
});

test("workspace persists a real compliance check before publish preparation", () => {
  assert.match(workspaceApiSource, /async checkCompliance/);
  assert.match(workspaceApiSource, /["']\/compliance\/check["']/);
  assert.ok(
    workspaceSource.indexOf("contentWorkspaceApi.checkCompliance") <
      workspaceSource.indexOf("contentWorkspaceApi.preparePublish"),
  );
});

test("workspace sends medium and high risk versions to manual review", () => {
  assert.match(workspaceSource, /compliance\.gate\.manualReviewRequired/);
  assert.match(workspaceSource, /\/distribution\/compliance\?/);
  assert.match(workspaceSource, /versionId:\s*officialVersion\.id/);
});

test("content optimization API can read a scoped preparation snapshot", () => {
  assert.match(apiSource, /export function getPublishPreparation/);
  assert.match(
    apiSource,
    /content-optimization\/publish-intents\/\$\{encodeURIComponent\(id\)\}/,
  );
});

test("distribution consumes the preparation snapshot as authoritative content", () => {
  assert.match(distributionSource, /source !== "content-workspace"/);
  assert.match(distributionSource, /getPublishPreparation\(sourceDraft\.preparationId\)/);
  assert.match(distributionSource, /preparation\?\.content/);
  assert.match(distributionSource, /rawHtml:\s*null/);
  assert.match(distributionSource, /finalHtml:\s*null/);
});

test("distribution blocks the publish form when handoff loading fails", () => {
  assert.match(distributionSource, /sourceContentError/);
  assert.match(distributionSource, /返回内容工作室/);
  assert.match(
    distributionSource,
    /selectedTab === "article" && !sourceContentError/,
  );
});
