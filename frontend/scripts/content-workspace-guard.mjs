import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const routeDir = resolveInputPath(
  process.env.CONTENT_WORKSPACE_ROUTE_DIR,
  path.join(frontendRoot, "src/app/(dashboard)/content/workspace"),
);
const sidebarPath = resolveInputPath(
  process.env.CONTENT_WORKSPACE_SIDEBAR_PATH,
  path.join(frontendRoot, "src/app/(dashboard)/content/page.tsx"),
);

const workspaceRoute = "/content/workspace";
const workflowLabels = [
  "选题简报",
  "内容大纲",
  "正文编辑",
  "多平台版本",
  "审核准备",
];
const legacyContentEntries = [
  { href: "/topics", title: "选题" },
  { href: "/content/articles", title: "内容生成" },
  { href: "/materials", title: "素材库" },
  { href: "/distribution/scrape", title: "文章反抓" },
  { href: "/templates", title: "模板与风格" },
  { href: "/video-studio", title: "视频成片" },
  { href: "/video/product-cut", title: "商品视频" },
  { href: "/distribution/publish-video", title: "发布" },
  { href: "/viral-analysis", title: "爆款拆解" },
  { href: "/content/ai-image-gen", title: "AI 生图" },
  { href: "/content/collection-center", title: "全网采集" },
];
const forbiddenPublishingPatterns = [
  {
    pattern: /from\s+["']@\/lib\/api\/(?:publishing|auto-upload)["']/,
    message: "must not import a publishing execution API directly",
  },
  {
    pattern: /\b(?:publishingApi|autoUploadApi)\s*\./,
    message: "must not call publishingApi or autoUploadApi directly",
  },
  {
    pattern:
      /\b(?:publishArticle|publishVideo|executePublish|executePublishing|confirmPublish|startPublish)\s*\(/i,
    message: "must not invoke a direct publishing execution method",
  },
  {
    pattern:
      /\b(?:fetch|api\.(?:post|put|patch))\s*\(\s*["'`](?:\/api)?\/(?:publishing|auto-upload)(?:\/|["'`])/i,
    message: "must not write to a publishing execution endpoint directly",
  },
];

const failures = [];
const addFailure = (rule, message) => failures.push({ rule, message });

validateRouteExists();

const sidebarSource = readRequiredFile(sidebarPath, "SIDEBAR_EXISTS");
const routeFiles = existsSync(routeDir) && statSync(routeDir).isDirectory()
  ? listSourceFiles(routeDir)
  : [];
const routeSource = routeFiles
  .map((filePath) => readFileSync(filePath, "utf8"))
  .join("\n");

validateNavigation(sidebarSource);
validateWorkflow(routeSource);
validateAccessibility(routeSource);
validatePublishingBoundary(routeSource);

const summary = {
  sourceFiles: routeFiles.length,
  preservedRoutes: countNavigationEntries(sidebarSource, legacyContentEntries),
  workflowLabels: workflowLabels.filter((label) => routeSource.includes(label)).length,
  accessibilityChecks: countAccessibilityChecks(routeSource),
};

if (failures.length > 0) {
  console.error(`Content workspace guard failed (${failures.length} issue(s)):`);
  for (const failure of failures) {
    console.error(`- [${failure.rule}] ${failure.message}`);
  }
  printSummary(summary, console.error);
  process.exitCode = 1;
} else {
  console.log("Content workspace guard passed.");
  printSummary(summary, console.log);
}

function validateRouteExists() {
  const pagePath = path.join(routeDir, "page.tsx");
  if (!existsSync(routeDir) || !statSync(routeDir).isDirectory()) {
    addFailure("ROUTE_EXISTS", `workspace route directory is missing: ${routeDir}`);
    return;
  }
  if (!existsSync(pagePath) || !statSync(pagePath).isFile()) {
    addFailure("ROUTE_EXISTS", `workspace route entry is missing: ${pagePath}`);
  }
}

function validateNavigation(source) {
  if (!source) return;
  /* 导航已重构到 content/page.tsx 的 ScenePage cards(2026-08-11):
     不再有 sidebar-items 的 content-ops 分组,改为校验内容页宫格本体存在 */
  const cardsStart = source.indexOf("cards={[");
  if (cardsStart < 0) {
    addFailure("NAVIGATION_ENTRY", "cannot locate the content page cards navigation");
  }

  for (const entry of legacyContentEntries) {
    if (!hasNavigationEntry(source, entry.href, entry.title)) {
      addFailure(
        "LEGACY_ROUTE",
        `legacy content entry is missing: ${entry.title} (${entry.href})`,
      );
    }
  }
}

function validateWorkflow(source) {
  for (const label of workflowLabels) {
    if (!source.includes(label)) {
      addFailure("WORKFLOW_LABEL", `workspace is missing workflow label: ${label}`);
    }
  }
}

function validateAccessibility(source) {
  const checks = [
    {
      pattern: /<main\b|role\s*=\s*["']main["']/,
      message: "workspace needs a main landmark",
    },
    {
      pattern: /aria-label(?:ledby)?\s*=/,
      message: "workspace needs an accessible label",
    },
    {
      pattern: /aria-(?:current|selected|pressed)\s*=/,
      message: "workflow controls need an accessible current/selected state",
    },
  ];
  for (const check of checks) {
    if (!check.pattern.test(source)) addFailure("A11Y", check.message);
  }
}

function validatePublishingBoundary(source) {
  for (const { pattern, message } of forbiddenPublishingPatterns) {
    if (pattern.test(source)) {
      addFailure("PUBLISH_EXECUTION_BOUNDARY", message);
    }
  }
}

function resolveInputPath(value, fallback) {
  return value ? path.resolve(value) : fallback;
}

function readRequiredFile(filePath, rule) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    addFailure(rule, `required file is missing: ${filePath}`);
    return "";
  }
  return readFileSync(filePath, "utf8");
}

function listSourceFiles(rootDir) {
  const result = [];
  walk(rootDir);
  return result.sort();

  function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
        result.push(absolutePath);
      }
    }
  }
}

function hasStaticProperty(source, property, value) {
  const pattern = new RegExp(
    `${escapeRegExp(property)}\\s*:\\s*["']${escapeRegExp(value)}["']`,
  );
  return pattern.test(source);
}

function hasNavigationEntry(source, href, title) {
  // 允许单层嵌套花括号(badge 等模板字符串 ${...} 会引入花括号)
  const objectBlocks = source.match(/\{(?:[^{}]|\{[^{}]*\})*\}/gs) || [];
  return objectBlocks.some(
    (block) =>
      hasStaticProperty(block, "href", href) &&
      hasStaticProperty(block, "title", title),
  );
}

function countNavigationEntries(source, entries) {
  return entries.filter((entry) =>
    hasNavigationEntry(source, entry.href, entry.title),
  ).length;
}

function countAccessibilityChecks(source) {
  return [
    /<main\b|role\s*=\s*["']main["']/,
    /aria-label(?:ledby)?\s*=/,
    /aria-(?:current|selected|pressed)\s*=/,
  ].filter((pattern) => pattern.test(source)).length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printSummary(summary, output) {
  output(`- workspace source files: ${summary.sourceFiles}`);
  output(
    `- preserved legacy content routes: ${summary.preservedRoutes}/${legacyContentEntries.length}`,
  );
  output(
    `- workflow labels: ${summary.workflowLabels}/${workflowLabels.length}`,
  );
  output(`- accessibility checks: ${summary.accessibilityChecks}/3`);
  output("- publishing boundary: preparation or distribution handoff only");
}
