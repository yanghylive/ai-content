import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const guardPath = path.join(scriptDir, "navigation-zero-loss-guard.mjs");
const snapshotPath = path.join(scriptDir, "navigation-zero-loss.snapshot.json");
const sidebarText = readFileSync(
  path.join(frontendRoot, "src/app/(dashboard)/sidebar-items.tsx"),
  "utf8",
);
const layoutText = readFileSync(
  path.join(frontendRoot, "src/app/(dashboard)/layout.tsx"),
  "utf8",
);

test("current navigation satisfies the zero-loss contract", () => {
  const result = runGuard(sidebarText, layoutText);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /base leaves: 71\/68/);
  assert.match(result.stdout, /CRM-installed leaves: 75\/72/);
});

test("new navigation capabilities and aliases are allowed", () => {
  const extendedSidebar = replaceOnce(
    sidebarText,
    "\n];\n\nconst crmSection",
    `
  {
    key: "future-capabilities",
    href: "/future-capabilities",
    title: "新增能力",
    icon: Settings,
    items: [
      {
        key: "/future-capabilities",
        href: "/future-capabilities",
        icon: Settings,
        title: "新增能力",
      },
    ],
  },
];

const crmSection`,
  );
  const extendedLayout = replaceOnce(
    layoutText,
    '  "/interaction/records": "/engagement/records",\n};',
    '  "/interaction/records": "/engagement/records",\n  "/future": "/future-capabilities",\n};',
  );
  const result = runGuard(extendedSidebar, extendedLayout);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /base leaves: 72\/68/);
  assert.match(result.stdout, /protected route aliases: 55\/54/);
});

test("an emptied existing navigation href fails the guard", () => {
  const changedSidebar = replaceOnce(
    sidebarText,
    'href: "/content/face-swap"',
    'href: ""',
  );
  const result = runGuard(changedSidebar, layoutText);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[NAV_LEAF_REQUIRED\]/);
});

test("an alias redirected to the wrong module fails the guard", () => {
  const changedLayout = replaceOnce(
    layoutText,
    '"/workbench/wechat": "/engagement/wechat"',
    '"/workbench/wechat": "/content/articles"',
  );
  const result = runGuard(sidebarText, changedLayout);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[ALIAS_SNAPSHOT\]/);
});

test("a publishing tab query entry cannot be renamed or dropped", () => {
  const changedSidebar = replaceOnce(
    sidebarText,
    'href: "/distribution?tab=logs"',
    'href: "/distribution?panel=logs"',
  );
  const result = runGuard(changedSidebar, layoutText);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[DISTRIBUTION_TABS\]/);
});

test("CRM entries cannot escape the installed guard", () => {
  const changedSidebar = replaceOnce(
    sidebarText,
    "if (options.crmInstalled) {",
    "if (true) {",
  );
  const result = runGuard(changedSidebar, layoutText);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[CRM_CONDITION\]/);
});

function runGuard(sidebarSource, layoutSource) {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "navigation-zero-loss-"));
  const fixtureSidebar = path.join(fixtureDir, "sidebar-items.tsx");
  const fixtureLayout = path.join(fixtureDir, "layout.tsx");
  try {
    writeFileSync(fixtureSidebar, sidebarSource, "utf8");
    writeFileSync(fixtureLayout, layoutSource, "utf8");
    return spawnSync(process.execPath, [guardPath], {
      cwd: frontendRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        NAV_ZERO_LOSS_SIDEBAR_PATH: fixtureSidebar,
        NAV_ZERO_LOSS_LAYOUT_PATH: fixtureLayout,
        NAV_ZERO_LOSS_SNAPSHOT_PATH: snapshotPath,
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
