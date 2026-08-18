import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Navigation zero-loss guard v2 测试（2026-08-18 适配场景化导航）。
 * fixture 内联生成 app-shell/command-palette/layout 三个文件，
 * 不再依赖真实 sidebar-items.tsx（已随重构删除）。
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const guardPath = path.join(scriptDir, "navigation-zero-loss-guard.mjs");
const snapshotPath = path.join(scriptDir, "navigation-zero-loss.snapshot.json");

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));

function makeShellSource({ scenes = snapshot.scenes, prefixes = true } = {}) {
  const sceneLines = scenes
    .map(
      (scene) =>
        `  { key: "${scene.key}", href: "${scene.href}", label: "${scene.label}", icon: "x" },`,
    )
    .join("\n");
  const prefixBlock = prefixes
    ? `  if (pathname.startsWith("/content") || pathname.startsWith("/materials")) return "content";
  if (pathname.startsWith("/distribution")) return "publish";
  if (pathname.startsWith("/growth")) return "leads";
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/message")) return "interaction";
  if (pathname.startsWith("/effects")) return "review";
  if (pathname.startsWith("/engagement")) return "interaction";`
    : `  return "today";`;
  return `const SCENES = [
${sceneLines}
];
export function sceneOfPath(pathname: string): string {
${prefixBlock}
}
// "mine" scene is hardcoded in the rail
const mineHref = "/mine";
router.push(mineHref);`;
}

function makeCommandSource({ hrefs = snapshot.commandHrefs } = {}) {
  const lines = hrefs
    .map((href, index) => `  { cat: "c", name: "c${index}", href: "${href}" },`)
    .join("\n");
  return `const COMMANDS = [
${lines}
];`;
}

function makeLayoutSource() {
  const aliasLines = snapshot.routeAliases
    .map((alias) => `  "${alias.from}": "${alias.to}",`)
    .join("\n");
  return `const routeAliases = {
${aliasLines}
};`;
}

function runGuard({ scenes, hrefs, prefixes } = {}) {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "nav-zero-loss-v2-"));
  try {
    const shellPath = path.join(fixtureDir, "app-shell.tsx");
    const commandPath = path.join(fixtureDir, "command-palette.tsx");
    const layoutPath = path.join(fixtureDir, "layout.tsx");
    writeFileSync(shellPath, makeShellSource({ scenes, prefixes }), "utf8");
    writeFileSync(commandPath, makeCommandSource({ hrefs }), "utf8");
    writeFileSync(layoutPath, makeLayoutSource(), "utf8");
    return spawnSync(process.execPath, [guardPath], {
      cwd: frontendRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        NAV_ZERO_LOSS_SHELL_PATH: shellPath,
        NAV_ZERO_LOSS_COMMAND_PATH: commandPath,
        NAV_ZERO_LOSS_LAYOUT_PATH: layoutPath,
        NAV_ZERO_LOSS_SNAPSHOT_PATH: snapshotPath,
      },
    });
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

test("current navigation satisfies the zero-loss contract", () => {
  const result = runGuard();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scenes: \d+\/\d+/);
  assert.match(result.stdout, /critical command entries: 15\/15/);
});

test("removing a required scene fails the guard", () => {
  const scenes = snapshot.scenes.filter((scene) => scene.key !== "content");
  const result = runGuard({ scenes });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[SCENE_MISSING\].*content/);
});

test("removing a critical command entry fails the guard", () => {
  const hrefs = snapshot.commandHrefs.filter((href) => href !== "/crm");
  const result = runGuard({ hrefs });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /critical command entry is missing: \/crm/);
});

test("sceneOfPath losing a critical prefix fails the guard", () => {
  const result = runGuard({ prefixes: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[SCENE_PREFIX_LOST\]/);
});

test("a scene href changed to a non-root path fails the guard", () => {
  const scenes = snapshot.scenes.map((scene) =>
    scene.key === "content" ? { ...scene, href: "content" } : scene,
  );
  const result = runGuard({ scenes });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[SCENE_HREF_FORMAT\]/);
});
