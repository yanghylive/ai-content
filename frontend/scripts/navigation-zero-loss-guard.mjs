import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");

const sidebarPath = resolveInputPath(
  process.env.NAV_ZERO_LOSS_SIDEBAR_PATH,
  path.join(frontendRoot, "src/app/(dashboard)/sidebar-items.tsx"),
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
  baseLeafCount: 72,
  crmLeafCount: 4,
  installedLeafCount: 76,
  distributionTabs: [
    "/distribution-v2/publish-article",
    "/distribution-v2/publish-video",
    "/materials",
    "/platforms",
    "/compliance-check-v2",
    "/distribution-v2/tasks",
    "/local-engine-v2/logs",
  ],
  distributionLegacyKeys: [
    "/distribution?tab=article",
    "/distribution?tab=video",
    "/distribution?tab=materials",
    "/distribution?tab=accounts",
    "/distribution?tab=compliance",
    "/distribution?tab=tasks",
    "/distribution?tab=logs",
  ],
  growthViews: [
    "/growth-v2/strategies",
    "/growth-v2/leads",
    "/growth-v2/acquisition",
    "/growth-v2/workflows",
    "/growth-v2/account-health",
    "/growth-v2/reports",
  ],
  growthLegacyKeys: [
    "/growth?view=strategies",
    "/growth?view=leads",
    "/growth?view=acquisition",
    "/growth?view=workflows",
    "/growth?view=account-health",
    "/growth?view=reports",
  ],
  crmHrefs: ["/crm", "/crm/import", "/crm/closer", "/crm/connectors"],
  criticalHrefs: [
    "/solutions",
    "/tasks",
    "/tasks/confirmations",
    "/tasks/runs",
    "/tasks/records",
    "/tasks/evidence",
    "/tasks/schedules",
    "/intelligence/search",
    "/intelligence/risks",
    "/distribution-v2/publish-article",
    "/distribution-v2/publish-video",
    "/distribution-v2/tasks",
    "/local-engine-v2/logs",
    "/growth-v2/acquisition",
    "/apps/auto-acquisition",
    "/growth-v2/workflows",
    "/growth-v2/account-health",
    "/engagement/wechat",
    "/engagement/wechat-groups",
    "/engagement/wechat-moments",
    "/engagement/customers",
    "/engagement/wecom-assistant",
    "/engagement/rules",
    "/platforms",
    "/voice-agent",
    "/local-engine",
    "/capabilities/risk",
    "/settings",
    "/crm",
    "/crm/import",
    "/crm/closer",
    "/crm/connectors",
  ],
  hiddenHrefs: ["/content/video", "/content/face-swap"],
});

try {
  main();
} catch (error) {
  console.error("Navigation zero-loss guard failed before validation completed:");
  console.error(`- [AST_STRUCTURE] ${toErrorMessage(error)}`);
  process.exitCode = 1;
}

function main() {
  const sidebarSource = parseSourceFile(sidebarPath);
  const layoutSource = parseSourceFile(layoutPath);
  const baseRoots = parseNavigationArray(
    getVariableInitializer(sidebarSource, "baseSectionItems"),
    sidebarSource,
    "baseSectionItems",
  );
  const crmRoot = parseNavigationObject(
    getVariableInitializer(sidebarSource, "crmSection"),
    sidebarSource,
    "crmSection",
  );
  const baseLeaves = flattenLeaves(baseRoots);
  const crmLeaves = flattenLeaves([crmRoot]);
  const installedLeaves = [...baseLeaves, ...crmLeaves];
  const routeAliases = parseStringMap(
    getVariableInitializer(layoutSource, "routeAliases"),
    layoutSource,
    "routeAliases",
  );

  if (process.argv.includes("--print-current-snapshot")) {
    const snapshot = {
      schemaVersion: 1,
      baseLeaves: baseLeaves.map(snapshotLeaf),
      crmLeaves: crmLeaves.map(snapshotLeaf),
      routeAliases: routeAliases.map(({ from, to }) => ({ from, to })),
    };
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  const snapshot = readSnapshot(snapshotPath);
  const failures = [];
  const addFailure = (rule, message) => failures.push({ rule, message });

  validateSnapshotShape(snapshot, addFailure);
  validateLeafCollection("base", baseLeaves, addFailure);
  validateLeafCollection("CRM-installed", installedLeaves, addFailure);

  expectAtLeast(
    "NAV_COUNT_BASE",
    "base navigation leaves",
    baseLeaves.length,
    contract.baseLeafCount,
    addFailure,
  );
  expectAtLeast(
    "CRM_COUNT",
    "CRM leaves",
    crmLeaves.length,
    contract.crmLeafCount,
    addFailure,
  );
  expectAtLeast(
    "NAV_COUNT_INSTALLED",
    "CRM-installed navigation leaves",
    installedLeaves.length,
    contract.installedLeafCount,
    addFailure,
  );

  compareProtectedSequence(
    "NAV_SNAPSHOT_BASE",
    "base leaf snapshot",
    baseLeaves.map(snapshotLeaf),
    snapshot.baseLeaves,
    addFailure,
  );
  compareProtectedSequence(
    "CRM_SNAPSHOT",
    "CRM leaf snapshot",
    crmLeaves.map(snapshotLeaf),
    snapshot.crmLeaves,
    addFailure,
  );

  validateRequiredHrefs(
    "DISTRIBUTION_TABS",
    baseLeaves,
    contract.distributionTabs,
    addFailure,
  );
  validateRequiredKeys(
    "DISTRIBUTION_LEGACY_KEYS",
    baseLeaves,
    contract.distributionLegacyKeys,
    addFailure,
  );
  validateRequiredHrefs(
    "GROWTH_VIEWS",
    baseLeaves,
    contract.growthViews,
    addFailure,
  );
  validateRequiredKeys(
    "GROWTH_LEGACY_KEYS",
    baseLeaves,
    contract.growthLegacyKeys,
    addFailure,
  );
  validateCrmContract(sidebarSource, baseLeaves, crmLeaves, addFailure);
  validateRequiredHrefs(
    "CRITICAL_ENTRY",
    installedLeaves,
    contract.criticalHrefs,
    addFailure,
  );
  validateHiddenHrefs(installedLeaves, contract.hiddenHrefs, addFailure);
  validateAliases(routeAliases, baseLeaves, crmLeaves, snapshot, addFailure);

  const summary = {
    baseLeaves: `${baseLeaves.length}/${contract.baseLeafCount}`,
    installedLeaves: `${installedLeaves.length}/${contract.installedLeafCount}`,
    crmConditionalLeaves: `${crmLeaves.length}/${contract.crmLeafCount}`,
    distributionTabs: `${countPresent(baseLeaves, contract.distributionTabs)}/${contract.distributionTabs.length}`,
    growthViews: `${countPresent(baseLeaves, contract.growthViews)}/${contract.growthViews.length}`,
    criticalEntries: `${countPresent(installedLeaves, contract.criticalHrefs)}/${contract.criticalHrefs.length}`,
    protectedAliases: `${routeAliases.length}/${snapshot.routeAliases.length}`,
  };

  if (failures.length > 0) {
    console.error(`Navigation zero-loss guard failed (${failures.length} issue(s)):`);
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

function validateHiddenHrefs(leaves, hiddenHrefs, addFailure) {
  for (const href of hiddenHrefs) {
    if (leaves.some((leaf) => leaf.href === href)) {
      addFailure("HIDDEN_ENTRY", `hidden frontend entry is still visible: ${href}`);
    }
  }
}

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
    if (!name || !["key", "href", "title", "items"].includes(name)) continue;
    if (relevant.has(name)) {
      throw structureError(sourceFile, property, `${context} repeats property ${name}`);
    }
    relevant.set(name, property.initializer);
  }

  const itemsExpression = relevant.get("items");
  const children = itemsExpression
    ? parseNavigationArray(unwrapExpression(itemsExpression), sourceFile, `${context}.items`)
    : null;

  return {
    key: readOptionalString(relevant.get("key"), sourceFile, `${context}.key`),
    href: readOptionalString(relevant.get("href"), sourceFile, `${context}.href`),
    title: readOptionalString(relevant.get("title"), sourceFile, `${context}.title`),
    children,
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

function flattenLeaves(roots) {
  const leaves = [];
  const walk = (node) => {
    if (node.children) {
      for (const child of node.children) walk(child);
      return;
    }
    leaves.push(node);
  };
  for (const root of roots) walk(root);
  return leaves;
}

function snapshotLeaf(leaf) {
  return { key: leaf.key, href: leaf.href, title: leaf.title };
}

function readSnapshot(filePath) {
  const value = JSON.parse(readFileSync(filePath, "utf8"));
  return value;
}

function validateSnapshotShape(snapshot, addFailure) {
  if (snapshot?.schemaVersion !== 1) {
    addFailure("SNAPSHOT_SCHEMA", "snapshot schemaVersion must be 1");
  }
  for (const field of ["baseLeaves", "crmLeaves", "routeAliases"]) {
    if (!Array.isArray(snapshot?.[field])) {
      addFailure("SNAPSHOT_SCHEMA", `snapshot.${field} must be an array`);
    }
  }
}

function validateLeafCollection(label, leaves, addFailure) {
  const fields = ["key", "href", "title"];
  for (const leaf of leaves) {
    for (const field of fields) {
      if (typeof leaf[field] !== "string" || leaf[field].trim() === "") {
        addFailure(
          "NAV_LEAF_REQUIRED",
          `${label} leaf at ${leaf.location} has an empty or missing ${field}`,
        );
      }
    }
    if (typeof leaf.href === "string" && !leaf.href.startsWith("/")) {
      addFailure("NAV_HREF_FORMAT", `${label} leaf ${leaf.href} must start with /`);
    }
  }

  for (const field of fields) {
    const seen = new Map();
    for (const leaf of leaves) {
      if (typeof leaf[field] !== "string" || leaf[field].trim() === "") continue;
      const previous = seen.get(leaf[field]);
      if (previous) {
        addFailure(
          "NAV_LEAF_UNIQUE",
          `${label} ${field} ${JSON.stringify(leaf[field])} is duplicated at ${previous} and ${leaf.location}`,
        );
      } else {
        seen.set(leaf[field], leaf.location);
      }
    }
  }
}

function expectAtLeast(rule, label, actual, expected, addFailure) {
  if (actual < expected) {
    addFailure(rule, `${label}: expected at least ${expected}, observed ${actual}`);
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

function validateRequiredHrefs(rule, leaves, requiredHrefs, addFailure) {
  const hrefs = new Set(leaves.map((leaf) => leaf.href));
  for (const href of requiredHrefs) {
    if (!hrefs.has(href)) addFailure(rule, `required navigation entry is missing: ${href}`);
  }
}

function validateRequiredKeys(rule, leaves, requiredKeys, addFailure) {
  const keys = new Set(leaves.map((leaf) => leaf.key));
  for (const key of requiredKeys) {
    if (!keys.has(key)) addFailure(rule, `required navigation key is missing: ${key}`);
  }
}

function validateQueryFamily(
  rule,
  leaves,
  pathname,
  parameterName,
  expectedHrefs,
  addFailure,
) {
  const leavesByHref = new Map(leaves.map((leaf) => [leaf.href, leaf]));
  for (const expectedHref of expectedHrefs) {
    const leaf = leavesByHref.get(expectedHref);
    if (!leaf) continue;
    const url = new URL(expectedHref, "https://navigation.guard.invalid");
    if (url.pathname !== pathname) {
      addFailure(rule, `${expectedHref} must stay under ${pathname}`);
      continue;
    }
    const parameterNames = [...url.searchParams.keys()];
    if (
      parameterNames.length !== 1 ||
      parameterNames[0] !== parameterName ||
      !url.searchParams.get(parameterName)
    ) {
      addFailure(
        rule,
        `${expectedHref} must contain exactly one non-empty ${parameterName} query parameter`,
      );
    }
  }
}

function validateCrmContract(sourceFile, baseLeaves, crmLeaves, addFailure) {
  const baseCrmLeaves = baseLeaves.filter((leaf) => stripQuery(leaf.href).startsWith("/crm"));
  if (baseCrmLeaves.length > 0) {
    addFailure(
      "CRM_CONDITION",
      `CRM entries leaked into base navigation: ${baseCrmLeaves.map((leaf) => leaf.href).join(", ")}`,
    );
  }
  compareProtectedSequence(
    "CRM_ENTRIES",
    "CRM hrefs",
    crmLeaves.map((leaf) => leaf.href),
    contract.crmHrefs,
    addFailure,
  );

  const createFunction = findFunctionDeclaration(sourceFile, "createSectionItems");
  if (!createFunction) {
    addFailure("CRM_CONDITION", "createSectionItems function is missing");
    return;
  }

  const crmGuards = [];
  visit(createFunction.body, (node) => {
    if (ts.isIfStatement(node) && isCrmInstalledExpression(node.expression)) {
      crmGuards.push(node);
    }
  });
  if (crmGuards.length !== 1) {
    addFailure(
      "CRM_CONDITION",
      `createSectionItems must have exactly one options.crmInstalled guard, observed ${crmGuards.length}`,
    );
    return;
  }

  const guard = crmGuards[0];
  const crmReferences = [];
  let guardedSpliceFound = false;
  const unguardedMutations = [];
  visit(createFunction.body, (node) => {
    if (ts.isIdentifier(node) && node.text === "crmSection") crmReferences.push(node);
    const isSectionsMutation =
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "sections" &&
      ["push", "splice", "unshift"].includes(node.expression.name.text);
    if (isSectionsMutation && !isDescendantOf(node, guard.thenStatement)) {
      unguardedMutations.push(node);
    }
    if (
      isSectionsMutation &&
      node.expression.name.text === "splice" &&
      node.arguments.some(
        (argument) => ts.isIdentifier(unwrapExpression(argument)) && unwrapExpression(argument).text === "crmSection",
      ) &&
      isDescendantOf(node, guard.thenStatement)
    ) {
      guardedSpliceFound = true;
    }
  });
  if (!guardedSpliceFound) {
    addFailure(
      "CRM_CONDITION",
      "crmSection must be inserted into sections inside the options.crmInstalled guard",
    );
  }
  for (const reference of crmReferences) {
    if (!isDescendantOf(reference, guard.thenStatement)) {
      addFailure(
        "CRM_CONDITION",
        `crmSection is referenced outside the installed guard at ${nodeLocation(sourceFile, reference)}`,
      );
    }
  }
  for (const mutation of unguardedMutations) {
    addFailure(
      "CRM_CONDITION",
      `sections is mutated outside the installed guard at ${nodeLocation(sourceFile, mutation)}`,
    );
  }

  const sectionsInitializer = findLocalVariableInitializer(createFunction, "sections");
  const sectionsValue = sectionsInitializer ? unwrapExpression(sectionsInitializer) : null;
  if (
    !sectionsValue ||
    !ts.isCallExpression(sectionsValue) ||
    !ts.isPropertyAccessExpression(sectionsValue.expression) ||
    !ts.isIdentifier(sectionsValue.expression.expression) ||
    sectionsValue.expression.expression.text !== "baseSectionItems" ||
    sectionsValue.expression.name.text !== "map"
  ) {
    addFailure(
      "NAV_BASE_SOURCE",
      "createSectionItems must derive sections from baseSectionItems.map(...) before conditional additions",
    );
  }

  const returns = [];
  visit(createFunction.body, (node) => {
    if (ts.isReturnStatement(node)) returns.push(node.expression || null);
  });
  if (
    returns.length !== 1 ||
    !returns[0] ||
    !ts.isIdentifier(unwrapExpression(returns[0])) ||
    unwrapExpression(returns[0]).text !== "sections"
  ) {
    addFailure("NAV_BASE_SOURCE", "createSectionItems must return the guarded sections array");
  }

  const defaultItems = getOptionalVariableInitializer(sourceFile, "sectionItems");
  const call = defaultItems ? unwrapExpression(defaultItems) : null;
  if (
    !call ||
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== "createSectionItems" ||
    call.arguments.length !== 0
  ) {
    addFailure(
      "CRM_CONDITION",
      "default sectionItems must call createSectionItems() without enabling CRM",
    );
  }
}

function validateAliases(routeAliases, baseLeaves, crmLeaves, snapshot, addFailure) {
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

function findFunctionDeclaration(sourceFile, functionName) {
  let result = null;
  visit(sourceFile, (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === functionName &&
      node.body
    ) {
      if (result) throw new Error(`duplicate function declaration: ${functionName}`);
      result = node;
    }
  });
  return result;
}

function getOptionalVariableInitializer(sourceFile, variableName) {
  let result = null;
  visit(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      if (result) throw new Error(`duplicate variable declaration: ${variableName}`);
      result = node.initializer || null;
    }
  });
  return result;
}

function findLocalVariableInitializer(root, variableName) {
  let result = null;
  visit(root, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      if (result) throw new Error(`duplicate local variable declaration: ${variableName}`);
      result = node.initializer || null;
    }
  });
  return result;
}

function isCrmInstalledExpression(expression) {
  const value = unwrapExpression(expression);
  return (
    ts.isPropertyAccessExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === "options" &&
    value.name.text === "crmInstalled"
  );
}

function isDescendantOf(node, ancestor) {
  let current = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function visit(root, callback) {
  const walk = (node) => {
    callback(node);
    ts.forEachChild(node, walk);
  };
  walk(root);
}

function stripQuery(value) {
  return String(value || "").split("?")[0];
}

function countPresent(leaves, hrefs) {
  const observed = new Set(leaves.map((leaf) => leaf.href));
  return hrefs.filter((href) => observed.has(href)).length;
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
  output(`- base leaves: ${summary.baseLeaves}`);
  output(`- CRM-installed leaves: ${summary.installedLeaves}`);
  output(`- conditional CRM leaves: ${summary.crmConditionalLeaves}`);
  output(`- distribution tab entries: ${summary.distributionTabs}`);
  output(`- growth view entries: ${summary.growthViews}`);
  output(`- critical entries: ${summary.criticalEntries}`);
  output(`- protected route aliases: ${summary.protectedAliases}`);
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
