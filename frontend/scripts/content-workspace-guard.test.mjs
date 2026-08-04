import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const guardPath = path.join(scriptDir, "content-workspace-guard.mjs");
const sidebarText = readFileSync(
  path.join(frontendRoot, "src/app/(dashboard)/sidebar-items.tsx"),
  "utf8",
);
const validRouteSource = `
export default function ContentWorkspacePage() {
  const steps = ["选题简报", "内容大纲", "正文编辑", "多平台版本", "审核准备"];
  return (
    <main aria-label="内容工作室">
      {steps.map((step, index) => (
        <button type="button" aria-current={index === 0 ? "step" : undefined} key={step}>
          {step}
        </button>
      ))}
      <button type="button" onClick={() => router.push("/distribution?tab=article")}>
        前往发布准备
      </button>
    </main>
  );
}
`;

test("valid content workspace contract passes", () => {
  const result = runGuard({ routeSource: validRouteSource });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /preserved legacy content routes: 11\/11/);
  assert.match(result.stdout, /workflow labels: 5\/5/);
  assert.match(result.stdout, /accessibility checks: 3\/3/);
});

test("missing workspace route fails", () => {
  const result = runGuard({ missingRoute: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[ROUTE_EXISTS\]/);
});

test("removing an existing content route fails zero-loss protection", () => {
  const changedSidebar = replaceOnce(
    sidebarText,
    'key: "/content/articles",\n        href: "/content/articles"',
    'key: "/content/articles",\n        href: "/removed-content-articles"',
  );
  const result = runGuard({
    routeSource: validRouteSource,
    sidebarSource: changedSidebar,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[LEGACY_ROUTE\].*内容生成.*\/content\/articles/);
});

test("direct publishing execution calls fail the boundary", () => {
  const unsafeRouteSource = `${validRouteSource}\npublishingApi.publishArticle();\n`;
  const result = runGuard({ routeSource: unsafeRouteSource });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[PUBLISH_EXECUTION_BOUNDARY\]/);
});

test("publish preparation and distribution handoff remain allowed", () => {
  const preparationSource = `${validRouteSource}\ncontentWorkspaceApi.preparePublish("draft-1");\n`;
  const result = runGuard({ routeSource: preparationSource });
  assert.equal(result.status, 0, result.stderr);
});

test("missing workflow wording fails", () => {
  const changedRoute = replaceOnce(validRouteSource, "多平台版本", "平台版本");
  const result = runGuard({ routeSource: changedRoute });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[WORKFLOW_LABEL\].*多平台版本/);
});

test("missing accessibility semantics fails", () => {
  const changedRoute = validRouteSource
    .replace('<main aria-label="内容工作室">', "<section>")
    .replace("</main>", "</section>")
    .replace('aria-current={index === 0 ? "step" : undefined}', "");
  const result = runGuard({ routeSource: changedRoute });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[A11Y\]/);
});

function runGuard({
  routeSource = validRouteSource,
  sidebarSource = sidebarText,
  missingRoute = false,
}) {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "content-workspace-guard-"));
  const fixtureRouteDir = path.join(fixtureDir, "workspace");
  const fixtureSidebar = path.join(fixtureDir, "sidebar-items.tsx");
  try {
    if (!missingRoute) {
      mkdirSync(fixtureRouteDir, { recursive: true });
      writeFileSync(path.join(fixtureRouteDir, "page.tsx"), routeSource, "utf8");
    }
    writeFileSync(fixtureSidebar, sidebarSource, "utf8");
    return spawnSync(process.execPath, [guardPath], {
      cwd: frontendRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CONTENT_WORKSPACE_ROUTE_DIR: fixtureRouteDir,
        CONTENT_WORKSPACE_SIDEBAR_PATH: fixtureSidebar,
      },
    });
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

function replaceOnce(source, before, after) {
  const index = source.indexOf(before);
  assert.notEqual(index, -1, `test fixture marker not found: ${before}`);
  assert.equal(
    source.indexOf(before, index + before.length),
    -1,
    `test fixture marker is not unique: ${before}`,
  );
  return `${source.slice(0, index)}${after}${source.slice(index + before.length)}`;
}
