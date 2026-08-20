import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Navigation zero-loss guard v2（2026-08-18 适配场景化导航重构）
 *
 * 旧版深度绑定 sidebar-items.tsx（baseSectionItems/crmSection/createSectionItems）
 * 的 AST 结构，该文件已随重构删除。新导航结构：
 *   - app-shell.tsx    SCENES（8 个顶层场景）+ sceneOfPath（路径→场景映射）
 *   - command-palette.tsx COMMANDS（子路由命令入口）
 *   - layout.tsx       routeAliases（旧路径归一）
 *
 * 校验：
 *   1. SCENES：必备场景 key 齐全、href 以 / 开头且唯一
 *   2. sceneOfPath：关键路径前缀组仍被覆盖（抽查源码）
 *   3. COMMANDS：关键子路由入口仍在命令面板（防误删）
 *   4. routeAliases：alias 快照保护（沿用旧逻辑）
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");

const appShellPath = resolveInputPath(
  process.env.NAV_ZERO_LOSS_SHELL_PATH,
  path.join(frontendRoot, "src/components/shell/app-shell.tsx"),
);
const commandPalettePath = resolveInputPath(
  process.env.NAV_ZERO_LOSS_COMMAND_PATH,
  path.join(frontendRoot, "src/components/shell/command-palette.tsx"),
);
const layoutPath = resolveInputPath(
  process.env.NAV_ZERO_LOSS_LAYOUT_PATH,
  path.join(frontendRoot, "src/app/(dashboard)/layout.tsx"),
);
const snapshotPath = resolveInputPath(
  process.env.NAV_ZERO_LOSS_SNAPSHOT_PATH,
  path.join(scriptDir, "navigation-zero-loss.snapshot.json"),
);

const contract = Object.freeze({
  schemaVersion: 2,
  // 一级导航 SCENES 数组必须包含的业务场景 key（顺序由 snapshot 保护）
  requiredSceneKeys: [
    "growth-home",
    "growth",
    "customer",
    "content",
    "interaction",
    "execution",
  ],
  // Q2：review 移出一级导航但保留为 hidden deeplink key（命令面板可搜 /effects、/growth/reports）。
  // 这些 key 不进 SCENES 数组，但必须在 app-shell 源码中存在对应可达性（sceneOfPath 分支或 rail 项）。
  hiddenSceneKeys: ["review-hidden"],
  // 固定 rail 底部项（不占业务一级导航），app-shell 源码必须含对应路由跳转。
  pinnedRailHrefs: ["/settings", "/mine", "/agent"],
  // sceneOfPath 必须覆盖的关键路径前缀（抽查源码字面量）
  criticalScenePrefixes: [
    "/today",
    "/growth",
    "/intelligence",
    "/crm",
    "/customer",
    "/content",
    "/materials",
    "/distribution",
    "/message",
    "/engagement",
    "/tasks",
    "/approvals",
    "/effects",
    "/settings",
    "/platforms",
  ],
  // 命令面板必须保留的关键子路由入口（防误删）
  criticalCommandHrefs: [
    "/today",
    "/growth",
    "/growth/leads",
    "/growth/acquisition",
    "/growth/strategies",
    "/growth/workflows",
    "/growth/account-health",
    "/crm",
    "/tasks",
    "/engagement/comment-acquisition",
    "/wecom-crm",
    "/boss-recruit",
    "/commercial-readiness",
    "/content/articles",
    "/content/xiaohongshu",
    "/content/ai-image-gen",
    "/content/collection-center",
    "/materials",
    "/intelligence",
    "/intelligence/reports",
    "/approvals",
    "/task-evidence",
    "/agent-workbench",
    "/settings",
    "/platforms",
    "/local-engine",
  ],
});

try {
  main();
} catch (error) {
  console.error("Navigation zero-loss guard failed before validation completed:");
  console.error(`- [AST_STRUCTURE] ${toErrorMessage(error)}`);
  process.exitCode = 1;
}

function main() {
  const shellSource = parseSourceFile(appShellPath);
  const commandSource = parseSourceFile(commandPalettePath);
  const layoutSource = parseSourceFile(layoutPath);

  const scenes = parseNavigationArray(
    getVariableInitializer(shellSource, "SCENES"),
    shellSource,
    "SCENES",
  );
  const commandEntries = parseNavigationArray(
    getVariableInitializer(commandSource, "COMMANDS"),
    commandSource,
    "COMMANDS",
  );
  const commandHrefs = commandEntries
    .map((entry) => entry.href)
    .filter(Boolean);
  const routeAliases = parseStringMap(
    getVariableInitializer(layoutSource, "routeAliases"),
    layoutSource,
    "routeAliases",
  );
  const shellText = readFileSync(appShellPath, "utf8");

  if (process.argv.includes("--print-current-snapshot")) {
    const snapshot = {
      schemaVersion: 2,
      scenes: scenes.map((scene) => ({
        key: scene.key,
        href: scene.href,
        label: scene.title,
      })),
      commandHrefs,
      routeAliases: routeAliases.map(({ from, to }) => ({ from, to })),
    };
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  const snapshot = readSnapshot(snapshotPath);
  const failures = [];
  const addFailure = (rule, message) => failures.push({ rule, message });

  validateSnapshotShape(snapshot, addFailure);
  validateScenes(scenes, shellText, addFailure);
  validateScenePrefixCoverage(shellText, addFailure);
  validateCommandEntries(commandEntries, commandHrefs, addFailure);
  validateRequiredCommandHrefs(commandHrefs, addFailure);
  validateAliases(routeAliases, snapshot, addFailure);
  compareProtectedSequence(
    "SCENES_SNAPSHOT",
    "scene snapshot",
    scenes.map((scene) => ({ key: scene.key, href: scene.href, label: scene.title })),
    snapshot.scenes,
    addFailure,
  );
  compareProtectedSequence(
    "COMMAND_SNAPSHOT",
    "command entry snapshot",
    commandHrefs,
    snapshot.commandHrefs,
    addFailure,
  );

  const summary = {
    scenes: `${scenes.length}/${contract.requiredSceneKeys.length}`,
    commandEntries: `${commandHrefs.length}`,
    criticalCommandEntries: `${countPresent(commandHrefs, contract.criticalCommandHrefs)}/${contract.criticalCommandHrefs.length}`,
    protectedAliases: `${routeAliases.length}/${snapshot.routeAliases?.length ?? 0}`,
  };

  if (failures.length > 0) {
    console.error(
      `Navigation zero-loss guard failed (${failures.length} issue(s)):`,
    );
    for (const failure of failures) {
      console.error(`- [${failure.rule}] ${failure.message}`);
    }
    printSummary(summary, console.error);
    process.exitCode = 1;
    return;
  }

  console.log("Navigation zero-loss guard passed.");
  printSummary(summary, console.log);
}

function validateScenes(scenes, shellText, addFailure) {
  for (const key of contract.requiredSceneKeys) {
    if (!scenes.some((scene) => scene.key === key)) {
      addFailure("SCENE_MISSING", `required scene is missing: ${key}`);
    }
  }
  // Q2：hidden deeplink key 不进 SCENES 数组，但 app-shell 必须保留路径可达性
  for (const key of contract.hiddenSceneKeys) {
    if (scenes.some((scene) => scene.key === key)) {
      addFailure(
        "SCENE_HIDDEN",
        `hidden deeplink key ${key} must not appear in the SCENES array`,
      );
    }
  }
  // 固定 rail 底部项（/settings、/mine、/agent）：不占业务 SCENES，但 app-shell 必须保留入口
  for (const href of contract.pinnedRailHrefs) {
    if (!shellText.includes(href)) {
      addFailure(
        "SCENE_MISSING",
        `pinned rail entry missing from app-shell: ${href}`,
      );
    }
  }
  // "我的"场景硬编码在 rail 末尾（不在 SCENES 数组），单独校验入口存在
  if (!shellText.includes("/mine")) {
    addFailure("SCENE_MISSING", `"mine" scene entry (/mine) is missing from app-shell`);
  }
  const hrefs = new Map();
  for (const scene of scenes) {
    if (typeof scene.href !== "string" || !scene.href.startsWith("/")) {
      addFailure(
        "SCENE_HREF_FORMAT",
        `scene ${scene.key} href must start with /: ${scene.href}`,
      );
    }
    const previous = hrefs.get(scene.href);
    if (previous) {
      addFailure(
        "SCENE_HREF_UNIQUE",
        `scene href ${scene.href} is duplicated (${previous} and ${scene.key})`,
      );
    } else {
      hrefs.set(scene.href, scene.key);
    }
    if (typeof scene.key !== "string" || !scene.key.trim()) {
      addFailure("SCENE_KEY_REQUIRED", `scene at ${scene.location} has empty key`);
    }
  }
}

function validateScenePrefixCoverage(shellText, addFailure) {
  for (const prefix of contract.criticalScenePrefixes) {
    if (!shellText.includes(`"${prefix}`) && !shellText.includes(`'${prefix}`)) {
      addFailure(
        "SCENE_PREFIX_LOST",
        `sceneOfPath lost critical path prefix: ${prefix}`,
      );
    }
  }
}

function validateCommandEntries(entries, hrefs, addFailure) {
  // 命令面板允许不同命令指向同一页面（如 /growth/acquisition 出现在
  // 「找客户」与「获客任务」两个入口）——只校验格式，不校验唯一性
  for (const entry of entries) {
    if (typeof entry.href !== "string" || !entry.href.startsWith("/")) {
      addFailure(
        "COMMAND_HREF_FORMAT",
        `command entry at ${entry.location} href must start with /`,
      );
    }
  }
  if (hrefs.length < 10) {
    addFailure(
      "COMMAND_COUNT",
      `command palette has too few entries: expected at least 10, observed ${hrefs.length}`,
    );
  }
}

function validateRequiredCommandHrefs(hrefs, addFailure) {
  const observed = new Set(hrefs);
  for (const href of contract.criticalCommandHrefs) {
    if (!observed.has(href)) {
      addFailure(`critical command entry is missing: ${href}`);
    }
  }
}

// ─── 以下为 AST 工具（沿用旧版） ───────────────────────────────

function resolveInputPath(value, fallback) {
  return value ? path.resolve(value) : fallback;
}

function parseSourceFile(filePath) {
  const sourceText = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const diagnostics = sourceFile.parseDiagnostics || [];
  if (diagnostics.length > 0) {
    const detail = diagnostics
      .slice(0, 5)
      .map((diagnostic) => formatDiagnostic(sourceFile, diagnostic))
      .join("; ");
    throw new Error(`TypeScript parse error in ${filePath}: ${detail}`);
  }
  return sourceFile;
}

function formatDiagnostic(sourceFile, diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  if (typeof diagnostic.start !== "number") return message;
  const location = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
  return `${location.line + 1}:${location.character + 1} ${message}`;
}

function getVariableInitializer(sourceFile, variableName) {
  const matches = [];
  visit(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      matches.push(node);
    }
  });
  if (matches.length !== 1 || !matches[0].initializer) {
    throw new Error(
      `${sourceFile.fileName}: expected exactly one initialized variable named ${variableName}, found ${matches.length}`,
    );
  }
  return unwrapExpression(matches[0].initializer);
}

function parseNavigationArray(expression, sourceFile, context) {
  if (!ts.isArrayLiteralExpression(expression)) {
    throw structureError(sourceFile, expression, `${context} must be an array literal`);
  }
  return expression.elements.map((element, index) => {
    const value = unwrapExpression(element);
    if (!ts.isObjectLiteralExpression(value)) {
      throw structureError(
        sourceFile,
        element,
        `${context}[${index}] must be an object literal; spreads and computed factories are not allowed`,
      );
    }
    return parseNavigationObject(value, sourceFile, `${context}[${index}]`);
  });
}

function parseNavigationObject(expression, sourceFile, context) {
  const value = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(value)) {
    throw structureError(sourceFile, expression, `${context} must be an object literal`);
  }

  const relevant = new Map();
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw structureError(
        sourceFile,
        property,
        `${context} may contain only static property assignments`,
      );
    }
    const name = getStaticPropertyName(property.name);
    if (!name || !["key", "href", "label", "title"].includes(name)) continue;
    if (relevant.has(name)) {
      throw structureError(sourceFile, property, `${context} repeats property ${name}`);
    }
    relevant.set(name, property.initializer);
  }

  return {
    key: readOptionalString(relevant.get("key"), sourceFile, `${context}.key`),
    href: readOptionalString(relevant.get("href"), sourceFile, `${context}.href`),
    title: readOptionalString(
      relevant.get("label") || relevant.get("title"),
      sourceFile,
      `${context}.label`,
    ),
    location: nodeLocation(sourceFile, value),
  };
}

function readOptionalString(expression, sourceFile, context) {
  if (!expression) return undefined;
  const value = unwrapExpression(expression);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }
  throw structureError(
    sourceFile,
    expression,
    `${context} must be a static string literal`,
  );
}

function parseStringMap(expression, sourceFile, context) {
  const value = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(value)) {
    throw structureError(sourceFile, expression, `${context} must be an object literal`);
  }
  const entries = [];
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw structureError(
        sourceFile,
        property,
        `${context} may contain only static property assignments`,
      );
    }
    const from = getStaticPropertyName(property.name);
    const target = unwrapExpression(property.initializer);
    if (!from || !(ts.isStringLiteral(target) || ts.isNoSubstitutionTemplateLiteral(target))) {
      throw structureError(sourceFile, property, `${context} entries must be static strings`);
    }
    entries.push({ from, to: target.text, location: nodeLocation(sourceFile, property) });
  }
  return entries;
}

function getStaticPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function readSnapshot(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function validateSnapshotShape(snapshot, addFailure) {
  if (snapshot?.schemaVersion !== 2) {
    addFailure("SNAPSHOT_SCHEMA", "snapshot schemaVersion must be 2");
  }
  for (const field of ["scenes", "commandHrefs", "routeAliases"]) {
    if (!Array.isArray(snapshot?.[field])) {
      addFailure("SNAPSHOT_SCHEMA", `snapshot.${field} must be an array`);
    }
  }
}

function compareProtectedSequence(rule, label, actual, expected, addFailure) {
  if (!Array.isArray(expected)) return;
  let actualIndex = 0;
  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
    const expectedValue = JSON.stringify(expected[expectedIndex]);
    while (
      actualIndex < actual.length &&
      JSON.stringify(actual[actualIndex]) !== expectedValue
    ) {
      actualIndex += 1;
    }
    if (actualIndex >= actual.length) {
      addFailure(
        rule,
        `${label} lost or reordered protected item ${expectedIndex}: ${expectedValue}`,
      );
      return;
    }
    actualIndex += 1;
  }
}

function validateAliases(routeAliases, snapshot, addFailure) {
  const seen = new Map();
  for (const alias of routeAliases) {
    if (!alias.from.trim() || !alias.to.trim()) {
      addFailure("ALIAS_FORMAT", `empty route alias at ${alias.location}`);
      continue;
    }
    if (!alias.from.startsWith("/") || !alias.to.startsWith("/")) {
      addFailure("ALIAS_FORMAT", `${alias.from} -> ${alias.to} must use absolute app paths`);
    }
    if (alias.from.includes("?") || alias.to.includes("?") || alias.from.includes("#") || alias.to.includes("#")) {
      addFailure("ALIAS_FORMAT", `${alias.from} -> ${alias.to} must not contain query or hash state`);
    }
    if (alias.from === alias.to) {
      addFailure("ALIAS_FORMAT", `${alias.from} must not alias to itself`);
    }
    if (seen.has(alias.from)) {
      addFailure(
        "ALIAS_UNIQUE",
        `alias source ${alias.from} is duplicated at ${seen.get(alias.from)} and ${alias.location}`,
      );
    } else {
      seen.set(alias.from, alias.location);
    }
  }

  compareProtectedSequence(
    "ALIAS_SNAPSHOT",
    "route alias snapshot",
    routeAliases.map(({ from, to }) => ({ from, to })),
    snapshot.routeAliases,
    addFailure,
  );
}

function countPresent(observedHrefs, requiredHrefs) {
  const observed = new Set(observedHrefs);
  return requiredHrefs.filter((href) => observed.has(href)).length;
}

function nodeLocation(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(frontendRoot, sourceFile.fileName)}:${position.line + 1}:${position.character + 1}`;
}

function structureError(sourceFile, node, message) {
  return new Error(`${message} at ${nodeLocation(sourceFile, node)}`);
}

function printSummary(summary, output) {
  output("Observed summary:");
  output(`- scenes: ${summary.scenes}`);
  output(`- command entries: ${summary.commandEntries}`);
  output(`- critical command entries: ${summary.criticalCommandEntries}`);
  output(`- protected route aliases: ${summary.protectedAliases}`);
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function visit(root, callback) {
  const walk = (node) => {
    callback(node);
    ts.forEachChild(node, walk);
  };
  walk(root);
}
