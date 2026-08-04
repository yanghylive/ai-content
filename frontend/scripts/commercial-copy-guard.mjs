import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

function resolveFrontendRoot() {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "src/app"))) return cwd;
  if (existsSync(path.join(cwd, "frontend/src/app"))) {
    return path.join(cwd, "frontend");
  }
  throw new Error("Cannot find frontend/src/app. Run from repo root or frontend/.");
}

const frontendRoot = resolveFrontendRoot();
const require = createRequire(import.meta.url);
const ts = require(path.join(frontendRoot, "node_modules", "typescript"));

const guardedEntries = [
  "src/app",
  "src/components",
];

const ignoredPathParts = [
  "/__tests__/",
  "/test/",
  "/tests/",
  "/fixtures/",
  "/node_modules/",
  "/.next/",
];

const visibleKeys = new Set([
  "action",
  "aria-label",
  "desc",
  "description",
  "detail",
  "emptyLabel",
  "eyebrow",
  "helperText",
  "items",
  "label",
  "message",
  "nextAction",
  "placeholder",
  "previewTitle",
  "primaryAction",
  "publishLabel",
  "publishModalSubject",
  "reason",
  "secondaryAction",
  "subtitle",
  "summary",
  "title",
  "toast",
  "tooltip",
]);

const forbiddenRules = [
  ["externalVendor", /RedFox/i],
  ["skillSurface", /\bSkill\b|技能编排|插件与技能/iu],
  ["apiSurface", /\bAPI\b|endpoint|接口|\/api\//iu],
  ["backendSurface", /后端/iu],
  ["runtimeSurface", /本地引擎|执行器|native runtime|DB\/RPA|\bRuntime\b|\bHelper\b/iu],
  ["secretSurface", /OAuth|\btoken\b|Token|密钥|Webhook/iu],
  ["internalMode", /dry-run|\bProof\b|\bproof\b|\bConnector\b|\bconnector\b|readiness|remediation|\bLease\b|writeTables|no-token|no-write|no-network/iu],
  ["commercialLeak", /租户|tenant|entitlement|扣费|点数上限|使用上限|预算点数/iu],
  ["devPlaceholder", /\bmock\b|\bdemo\b|沙箱页|模型测试|模型配置|大语言模型/iu],
  ["filePathSurface", /文件路径/iu],
  [
    "engineeringLanguage",
    /调试|元数据|校验码|连接器|闭环|链路|回读|阻断|门禁|验收|一期前台范围|真实(?:执行|发布|任务|后台)/u,
  ],
  [
    "internalProductLanguage",
    /预演|本地数据库(?:记录)?|后端检查|持久化|底层运行器|聚合记录|\bdispatch\b|\bFFmpeg\b|二阶段/iu,
  ],
  [
    "technicalDetailSurface",
    /https?:\/\/(?:localhost|127\.0\.0\.1)|internal:\/\/|\bPID\b|服务编号|(?:日志|记录|数据库|文件|素材)路径|绝对路径|原始\s*(?:JSON|回执)/iu,
  ],
];

const reviewRules = [
  ["runtimeLanguage", /端口|进程|数据库|安装包/u],
];

const rawErrorClassifierFiles = new Set([
  "src/app/login/page.tsx",
  "src/app/(dashboard)/layout.tsx",
  "src/app/(dashboard)/knowledge-base/page.tsx",
  "src/app/(dashboard)/intelligence/_components/search-intelligence-workbench.tsx",
  "src/app/(dashboard)/workbench/wechat/wechat-workbench-client.tsx",
]);

const allowedVisibleMatches = [
  {
    file: "src/app/(dashboard)/intelligence/_components/display-text.ts",
    reason: "central sanitizer keeps forbidden source terms mapped away from users",
  },
  {
    file: "src/app/(dashboard)/sidebar-items.tsx",
    reason: "sidebar uses backend route paths as navigation hrefs; display-text.ts sanitizes every rendered title and label",
    textIncludes: ["intelligence/redfox"],
  },
  {
    file: "src/app/(dashboard)/content/workspace/content-workspace-client.tsx",
    reason: "endpoint_unavailable is a backend failure.code enum value shared with content-workspace-types.ts and content-workspace.ts; the user-facing message that follows it is already sanitized",
    textIncludes: ["endpoint_unavailable"],
  },
  {
    file: "src/components/growth/growth-console.tsx",
    reason: "displayText maps backend terms away from users before rendering",
    textIncludes: [".replace("],
  },
  {
    file: "src/app/(dashboard)/workbench/wechat/wechat-workbench-client.tsx",
    reason: "wechatBusinessText/sourceLabel maps backend terms away from users before rendering",
    textIncludes: [".replace("],
  },
  {
    file: "src/app/(dashboard)/crm/connectors/page.tsx",
    reason: "businessConnectorText maps backend terms away from users before rendering",
    textIncludes: [".replace("],
  },
  {
    file: "src/app/(dashboard)/crm/import/page.tsx",
    reason: "displayImportAuditValue maps backend terms away from users before rendering",
    textIncludes: [".replace("],
  },
  {
    file: "src/app/(dashboard)/agent-workbench/agent-workbench-client.tsx",
    reason: "commercialAgentText maps backend terms away from users before rendering",
    textIncludes: [".replace("],
  },
  {
    file: "src/app/(dashboard)/commercial-readiness/commercial-readiness-center.tsx",
    reason: "nested primary-action objects include internal route hrefs that are not rendered as copy",
    textIncludes: ["/commercial-readiness?filter="],
  },
  {
    file: "src/app/(dashboard)/distribution/publish-flow.tsx",
    reason: "dry-run is a persisted execution-mode enum; rendered labels use public safety-check copy",
    textIncludes: ["dry-run"],
  },
  {
    file: "src/app/(dashboard)/intelligence/_components/trends-radar-center.tsx",
    reason: "nested empty-state actions include an internal route href that is not rendered as copy",
    textIncludes: ["/intelligence/redfox"],
  },
  {
    file: "src/app/(dashboard)/intelligence/_components/redfox-skills-center.tsx",
    reason: "navigation callback contains an internal route href that is not rendered as copy",
    textIncludes: ["/intelligence/redfox"],
  },
  {
    file: "src/app/(dashboard)/platforms/platform-account-form.tsx",
    reason: "the advanced publishing-service form intentionally shows its provider URL example",
    textIncludes: ["https://mp.idouq.com/api/open/article"],
  },
];

const sourceFiles = collectSourceFiles(guardedEntries);
const failures = [];
const warnings = [];

for (const relativeFile of sourceFiles) {
  const absoluteFile = path.join(frontendRoot, relativeFile);
  const text = readFileSync(absoluteFile, "utf8");
  const candidates = extractVisibleCandidates(text, relativeFile);

  if (!rawErrorClassifierFiles.has(relativeFile)) {
    for (const match of text.matchAll(
      /(?:error|e)\s+instanceof\s+Error\s*\?\s*(?:error|e)\.message|String\(\s*(?:error|e)\s*\)/g,
    )) {
      warnings.push({
        file: relativeFile,
        line: text.slice(0, match.index).split(/\r?\n/).length,
        rule: "rawErrorPassthrough",
        text: compact(match[0]),
      });
    }
  }

  for (const candidate of candidates) {
    for (const [ruleName, pattern] of forbiddenRules) {
      if (!pattern.test(candidate.text)) continue;
      if (isAllowed(relativeFile, candidate.text)) continue;
      failures.push({
        file: relativeFile,
        line: candidate.line,
        rule: ruleName,
        text: compact(candidate.text),
      });
    }
    for (const [ruleName, pattern] of reviewRules) {
      if (!pattern.test(candidate.text)) continue;
      if (isAllowed(relativeFile, candidate.text)) continue;
      warnings.push({
        file: relativeFile,
        line: candidate.line,
        rule: ruleName,
        text: compact(candidate.text),
      });
    }
  }
}

if (failures.length) {
  console.error("Commercial copy guard failed:");
  for (const failure of failures.slice(0, 80)) {
    console.error(
      `- ${failure.file}:${failure.line} [${failure.rule}] ${failure.text}`,
    );
  }
  if (failures.length > 80) {
    console.error(`... and ${failures.length - 80} more failures`);
  }
  process.exit(1);
}

console.log(`Commercial copy guard passed (${sourceFiles.length} files).`);
if (warnings.length) {
  console.warn(`Commercial copy review warnings: ${warnings.length}`);
  for (const warning of warnings.slice(0, 40)) {
    console.warn(
      `- ${warning.file}:${warning.line} [${warning.rule}] ${warning.text}`,
    );
  }
  if (warnings.length > 40) {
    console.warn(`... and ${warnings.length - 40} more review warnings`);
  }
}

function collectSourceFiles(entries) {
  const result = new Set();
  for (const entry of entries) {
    const absoluteEntry = path.join(frontendRoot, entry);
    if (!existsSync(absoluteEntry)) continue;
    walk(absoluteEntry, entry);
  }
  return [...result].sort();

  function walk(absolutePath, relativePath) {
    if (ignoredPathParts.some((part) => relativePath.includes(part))) return;
    const statEntries = safeReadDir(absolutePath);
    if (statEntries) {
      for (const child of statEntries) {
        walk(path.join(absolutePath, child.name), path.join(relativePath, child.name));
      }
      return;
    }
    if (/\.(tsx?|jsx?)$/.test(relativePath)) result.add(relativePath);
  }
}

function safeReadDir(absolutePath) {
  try {
    return readdirSync(absolutePath, { withFileTypes: true });
  } catch {
    return null;
  }
}

function extractVisibleCandidates(source, relativeFile = "source.tsx") {
  const candidates = [];
  const sourceFile = ts.createSourceFile(
    relativeFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativeFile.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : relativeFile.endsWith(".jsx")
        ? ts.ScriptKind.JSX
        : relativeFile.endsWith(".js")
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS,
  );

  const lineFor = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const addLiteralNodes = (node) => {
    if (!node) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node)
    ) {
      addCandidate(candidates, lineFor(node), node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
        .join(" ")
        .trim();
      addCandidate(candidates, lineFor(node), text);
      return;
    }
    ts.forEachChild(node, addLiteralNodes);
  };

  const propertyName = (name) => {
    if (!name) return "";
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    return "";
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      addLiteralNodes(node);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.text;
      if (visibleKeys.has(name)) addLiteralNodes(node.initializer);
    } else if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (visibleKeys.has(name)) addLiteralNodes(node.initializer);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return candidates;
}

function addCandidate(candidates, line, text) {
  const normalized = text
    .replace(/\$\{[^}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return;
  candidates.push({ line, text: normalized });
}

function isAllowed(file, text) {
  return allowedVisibleMatches.some((allowance) => {
    if (allowance.file !== file) return false;
    return !allowance.textIncludes || allowance.textIncludes.some((item) => text.includes(item));
  });
}

function compact(value) {
  return value.length > 140 ? `${value.slice(0, 137)}...` : value;
}
