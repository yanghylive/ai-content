import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function resolveFrontendRoot() {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "src/app/globals.css"))) return cwd;
  if (existsSync(path.join(cwd, "frontend/src/app/globals.css"))) {
    return path.join(cwd, "frontend");
  }
  throw new Error("Cannot find the frontend workspace.");
}

const root = resolveFrontendRoot();
const files = {
  account: "src/app/(dashboard)/capabilities/account/page.tsx",
  desktopSettings: "src/app/(dashboard)/settings/desktop-settings.tsx",
  drawer: "src/components/agent-status-drawer.tsx",
  globals: "src/app/globals.css",
  growthShell: "src/app/(dashboard)/growth/growth-page-shell.tsx",
  layout: "src/app/(dashboard)/layout.tsx",
  pagePrimitive: "src/app/(dashboard)/components/dashboard-page.tsx",
  settings: "src/app/(dashboard)/settings/page.tsx",
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, relativePath]) => [
    key,
    readFileSync(path.join(root, relativePath), "utf8"),
  ]),
);
const failures = [];

function requireSnippet(fileKey, snippet, reason) {
  if (!source[fileKey].includes(snippet)) failures.push(reason);
}

function forbidSnippet(fileKey, snippet, reason) {
  if (source[fileKey].includes(snippet)) failures.push(reason);
}

requireSnippet(
  "pagePrimitive",
  "data-dashboard-page-header",
  "shared page header marker is missing",
);
requireSnippet(
  "settings",
  "<DashboardPageHeader",
  "settings must use the shared page header",
);
requireSnippet(
  "account",
  "<DashboardPageHeader",
  "account and devices must use the shared page header",
);
forbidSnippet(
  "account",
  "SimpleFeaturePage",
  "account and devices must not stack the capability page header",
);

requireSnippet(
  "desktopSettings",
  '.get("autoStartService")',
  "desktop auto-recovery must read the existing desktop preference",
);
requireSnippet(
  "desktopSettings",
  '.set("autoStartService", nextValue)',
  "desktop auto-recovery must persist through the existing desktop preference",
);

const persistedDesktopKeys = [
  ...source.desktopSettings.matchAll(/\.set\("([^"]+)"/g),
].map((match) => match[1]);
if (
  persistedDesktopKeys.length !== 1 ||
  persistedDesktopKeys[0] !== "autoStartService"
) {
  failures.push(
    "desktop settings must not invent persistence for unsupported controls",
  );
}

for (const copy of [
  "当前版本暂不支持在这里手动修改位置",
  "尚未提供自定义选项",
  "资料发送功能尚未提供",
]) {
  requireSnippet(
    "desktopSettings",
    copy,
    `desktop settings must disclose unavailable behavior: ${copy}`,
  );
}

for (const snippet of [
  "--kaypal-v3-nav-bg",
  '[data-toast="true"]',
  ".dashboard-overlay__panel",
  ".dashboard-page-shell",
  "2xl:grid-cols-[minmax(0,1fr)_390px]",
  "@media (max-width: 640px)",
  ".dashboard-shell__viewport",
]) {
  requireSnippet("globals", snippet, `global UI contract is missing: ${snippet}`);
}

requireSnippet(
  "layout",
  "dashboard-shell__viewport",
  "dashboard layout must expose the overflow-safe viewport",
);
requireSnippet(
  "layout",
  "min-w-0 overflow-hidden",
  "dashboard shell must constrain horizontal overflow",
);
requireSnippet(
  "growthShell",
  "growth-page-shell",
  "growth pages must opt into the 1280px configuration layout",
);
requireSnippet(
  "drawer",
  "dashboard-overlay__panel",
  "agent status drawer must use the shared elevated surface",
);

forbidSnippet(
  "settings",
  "系统配置中心",
  "settings page still exposes the old stacked configuration heading",
);
forbidSnippet(
  "drawer",
  ">AI专家状态<",
  "agent drawer title must use customer-facing spacing and wording",
);
forbidSnippet(
  "drawer",
  "暂无时间线记录",
  "agent drawer must call the event list processing records",
);

if (failures.length) {
  console.error("Dashboard UI audit guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dashboard UI audit guard passed.");
