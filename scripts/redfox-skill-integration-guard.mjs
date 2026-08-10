#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED = {
  packages: 15,
  corePackages: 5,
  redfoxPoolPackages: 10,
  packageSkillRefs: 64,
  uniqueSkillNames: 57,
  apiPackageSkillRefs: 43,
  skillHubPackageSkillRefs: 21,
  contractOnlyPackageSkillRefs: 0,
  unmappedPackageSkillRefs: 0,
  mappingCatalogSize: 36,
  officialSkillHubRefCandidates: 21,
  localSkillHubInstallDirectories: 21,
};

const solutionCatalogPath = path.join(
  ROOT,
  "backend/src/modules/solutions/solutions.catalog.ts",
);
const mappingCatalogPath = path.join(
  ROOT,
  "backend/src/modules/redfox/redfox-skill-mapping.catalog.ts",
);
const agentSServicePath = path.join(
  ROOT,
  "backend/src/modules/local-engine/agent-s.service.ts",
);
const agentSControllerPath = path.join(
  ROOT,
  "backend/src/modules/local-engine/agent-s.controller.ts",
);
const redfoxSkillRunnerPath = path.join(
  ROOT,
  "backend/src/modules/redfox/redfox-skill-runner.service.ts",
);
const skillHubLocalRoot = path.join(ROOT, "skillhub-skills");
const matrixPath = path.join(ROOT, "docs/redfox-skill-integration-matrix.md");
const solutionsPagePath = path.join(
  ROOT,
  "frontend/src/app/(dashboard)/solutions/page.tsx",
);

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractObjectBlocks(source, marker) {
  const blocks = [];
  let index = source.indexOf(marker);
  if (index < 0) {
    throw new Error(`Missing marker: ${marker}`);
  }

  while ((index = source.indexOf("  {\n    code: '", index)) >= 0) {
    const start = index;
    let depth = 0;
    let end = -1;

    for (let cursor = start; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = cursor + 1;
          break;
        }
      }
    }

    if (end < 0) {
      throw new Error(`Unclosed object block near offset ${start}`);
    }

    blocks.push(source.slice(start, end));
    index = end;
  }

  return blocks;
}

function firstMatch(block, pattern) {
  return block.match(pattern)?.[1] || "";
}

function stringArray(block, property) {
  const arraySource =
    block.match(new RegExp(`${property}:\\s*\\[([\\s\\S]*?)\\]`))?.[1] || "";
  return Array.from(arraySource.matchAll(/'([^']+)'/g)).map(
    (match) => match[1],
  );
}

function nestedObjectBlock(block, property) {
  const propertyIndex = block.indexOf(`${property}:`);
  if (propertyIndex < 0) {
    return "";
  }
  const start = block.indexOf("{", propertyIndex);
  if (start < 0) {
    return "";
  }

  let depth = 0;
  for (let cursor = start; cursor < block.length; cursor += 1) {
    const char = block[cursor];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return block.slice(start + 1, cursor);
      }
    }
  }

  return "";
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function parsePackages(source) {
  return extractObjectBlocks(source, "export const SOLUTION_PACKAGES").map(
    (block) => ({
      code: firstMatch(block, /code: '([^']+)'/),
      name: firstMatch(block, /name: '([^']+)'/),
      category: firstMatch(block, /category: '([^']+)'/),
      implementationState: firstMatch(block, /implementationState: '([^']+)'/),
      entryPath: firstMatch(block, /entryPath: '([^']+)'/),
      redfoxSkills: stringArray(block, "redfoxSkills"),
      workflow: stringArray(block, "workflow"),
      dataObjects: stringArray(block, "dataObjects"),
      acceptance: stringArray(block, "acceptance"),
    }),
  );
}

function parseSkillHubRefs(block) {
  return Array.from(block.matchAll(/skillHubRef\(\{([\s\S]*?)\}\)/g)).map(
    (match) => {
      const refBlock = match[1];
      return {
        skillNo: firstMatch(refBlock, /skillNo:\s*'([^']+)'/),
        skillCode: firstMatch(refBlock, /skillCode:\s*'([^']+)'/),
        skillName: firstMatch(refBlock, /skillName:\s*'([^']+)'/),
        repoUrl: firstMatch(refBlock, /repoUrl:\s*'([^']+)'/),
      };
    },
  );
}

function parseMappings(source) {
  return extractObjectBlocks(source, "export const REDFOX_SKILL_MAPPINGS").map(
    (block) => {
      const aliases = stringArray(block, "aliases");
      const outputObjects = stringArray(block, "outputObjects");
      const inputContractBlock = nestedObjectBlock(block, "inputContract");
      return {
        code: firstMatch(block, /code: '([^']+)'/),
        skillCode: firstMatch(block, /skillCode: '([^']+)'/),
        skillName: firstMatch(block, /skillName: '([^']+)'/),
        aliases,
        platform: firstMatch(block, /platform: '([^']+)'/),
        scenario: firstMatch(block, /scenario: '([^']+)'/),
        method: firstMatch(block, /method: '([^']+)'/),
        path: firstMatch(block, /path: '([^']*)'/),
        estimatedCostPoints: Number(
          firstMatch(block, /estimatedCostPoints:\s*(\d+)/),
        ),
        hasInputContract: /inputContract:\s*\{/.test(block),
        inputContract: {
          requiredAny: stringArray(inputContractBlock, "requiredAny"),
          required: stringArray(inputContractBlock, "required"),
          optional: stringArray(inputContractBlock, "optional"),
        },
        outputObjects,
        skillHubRefs: parseSkillHubRefs(block),
      };
    },
  );
}

function markdown(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function joined(values, fallback = "-") {
  return values.length ? values.join(", ") : fallback;
}

function inputSummary(mapping) {
  if (!mapping) {
    return "-";
  }
  const parts = [];
  if (mapping.inputContract.requiredAny.length) {
    parts.push(`任一：${mapping.inputContract.requiredAny.join("/")}`);
  }
  if (mapping.inputContract.required.length) {
    parts.push(`必填：${mapping.inputContract.required.join("/")}`);
  }
  if (mapping.inputContract.optional.length) {
    parts.push(`可选：${mapping.inputContract.optional.join("/")}`);
  }
  return parts.join("<br>") || "已定义 inputContract";
}

function refType(item) {
  if (item.isApi) {
    return "API";
  }
  if (item.isSkillHub) {
    return "SkillHub";
  }
  if (item.isContractOnly) {
    return "ContractOnly";
  }
  return "Unmapped";
}

function identifierSummary(item) {
  if (!item.mapping) {
    return "-";
  }
  if (item.isSkillHub) {
    return joined(
      item.mapping.skillHubRefs.map((ref) => ref.skillCode),
      item.mapping.skillCode,
    );
  }
  return item.mapping.skillCode || item.mapping.code;
}

function entrySummary(item) {
  if (!item.mapping) {
    return "-";
  }
  if (item.isSkillHub) {
    return "agent-s / redfox.skillhub.run";
  }
  if (item.isApi) {
    return `${item.mapping.method} ${item.mapping.path}`;
  }
  return "无可执行入口";
}

function buildMatrixMarkdown(packageSkillRefs) {
  const lines = [
    "# RedFox Skill 功能位接入总表",
    "",
    "更新日期：2026-07-02",
    "",
    "这份表是 3010 RedFox 技能产品化的逐功能硬约束。表里没有的功能不开发；表里标成 SkillHub 的功能不能走普通 RedFox API runner。",
    "",
    "## 64 个功能位接入明细",
    "",
    "| 编号 | 方案包 | 功能名 | 类型 | skillCode / interfaceNo | 执行入口 | 输入 | 输出对象 | 验收方式 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const item of packageSkillRefs) {
    lines.push(
      [
        item.id,
        markdown(item.packageName),
        markdown(item.skillName),
        refType(item),
        markdown(identifierSummary(item)),
        markdown(entrySummary(item)),
        markdown(inputSummary(item.mapping)),
        markdown(joined(item.mapping?.outputObjects || [])),
        markdown(joined(item.acceptance, "使用方案包验收口径")),
      ]
        .map((value) => ` ${value} `)
        .join("|")
        .replace(/^/, "|")
        .replace(/$/, "|"),
    );
  }

  lines.push(
    "",
    "## 完成口径",
    "",
    "单个功能位必须同时满足 mapping、runner、日志、成本、归一化、业务对象写入、前端只展示业务结果、测试或 smoke 验证，才允许从“部分接入”推进到“已接入”。",
    "",
    "本文件由 `scripts/redfox-skill-integration-guard.mjs --write-matrix` 按当前 catalog 和 mapping 生成，生成后 guard 会校验行数和关键字段。",
  );

  return `${lines.join("\n")}\n`;
}

function findMapping(mappings, skillName) {
  const normalized = normalizeKey(skillName);
  return (
    mappings.find((mapping) =>
      [
        mapping.code,
        mapping.skillCode,
        mapping.skillName,
        mapping.path,
        ...mapping.aliases,
      ]
        .map(normalizeKey)
        .includes(normalized),
    ) || null
  );
}

function assertEqual(failures, label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertTruthy(failures, label, value) {
  if (!value) {
    failures.push(label);
  }
}

function main() {
  const packages = parsePackages(read(solutionCatalogPath));
  const mappings = parseMappings(read(mappingCatalogPath));
  const packageSkillRefs = packages.flatMap((solutionPackage, packageIndex) =>
    solutionPackage.redfoxSkills.map((skillName, skillIndex) => {
      const mapping = findMapping(mappings, skillName);
      const isApi = Boolean(mapping?.path);
      const isSkillHub = Boolean(
        mapping && !mapping.path && mapping.skillHubRefs.length,
      );
      const isContractOnly = Boolean(
        mapping && !mapping.path && !mapping.skillHubRefs.length,
      );
      return {
        id: `P${String(packageIndex + 1).padStart(2, "0")}-${String(
          skillIndex + 1,
        ).padStart(2, "0")}`,
        packageCode: solutionPackage.code,
        packageName: solutionPackage.name,
        acceptance: solutionPackage.acceptance,
        skillName,
        mapping,
        isApi,
        isSkillHub,
        isContractOnly,
      };
    }),
  );

  const uniqueSkillNames = new Set(
    packageSkillRefs.map((item) => item.skillName),
  );
  const apiRefs = packageSkillRefs.filter((item) => item.isApi);
  const skillHubRefs = packageSkillRefs.filter((item) => item.isSkillHub);
  const contractOnlyRefs = packageSkillRefs.filter(
    (item) => item.isContractOnly,
  );
  const unmappedRefs = packageSkillRefs.filter((item) => !item.mapping);
  const officialSkillHubRefCandidates = new Set(
    mappings.flatMap((mapping) =>
      mapping.skillHubRefs.map((skillHubRef) => skillHubRef.skillCode),
    ),
  );
  const localSkillHubInstallDirectories = new Set(
    [...officialSkillHubRefCandidates].filter((skillCode) =>
      fs.existsSync(path.join(skillHubLocalRoot, skillCode, "SKILL.md")),
    ),
  );
  const missingLocalSkillHubDirectories = [
    ...officialSkillHubRefCandidates,
  ].filter(
    (skillCode) =>
      !fs.existsSync(path.join(skillHubLocalRoot, skillCode, "SKILL.md")),
  );

  const failures = [];

  assertEqual(failures, "package count", packages.length, EXPECTED.packages);
  assertEqual(
    failures,
    "core package count",
    packages.filter((item) => item.category === "core").length,
    EXPECTED.corePackages,
  );
  assertEqual(
    failures,
    "redfox pool package count",
    packages.filter((item) => item.category === "redfox_pool").length,
    EXPECTED.redfoxPoolPackages,
  );
  assertEqual(
    failures,
    "package skill ref count",
    packageSkillRefs.length,
    EXPECTED.packageSkillRefs,
  );
  assertEqual(
    failures,
    "unique package skill name count",
    uniqueSkillNames.size,
    EXPECTED.uniqueSkillNames,
  );
  assertEqual(
    failures,
    "API package skill ref count",
    apiRefs.length,
    EXPECTED.apiPackageSkillRefs,
  );
  assertEqual(
    failures,
    "SkillHub package skill ref count",
    skillHubRefs.length,
    EXPECTED.skillHubPackageSkillRefs,
  );
  assertEqual(
    failures,
    "contract-only package skill ref count",
    contractOnlyRefs.length,
    EXPECTED.contractOnlyPackageSkillRefs,
  );
  assertEqual(
    failures,
    "unmapped package skill ref count",
    unmappedRefs.length,
    EXPECTED.unmappedPackageSkillRefs,
  );
  assertEqual(
    failures,
    "mapping catalog size",
    mappings.length,
    EXPECTED.mappingCatalogSize,
  );
  assertEqual(
    failures,
    "official SkillHub ref candidate count",
    officialSkillHubRefCandidates.size,
    EXPECTED.officialSkillHubRefCandidates,
  );
  assertEqual(
    failures,
    "local SkillHub install directory count",
    localSkillHubInstallDirectories.size,
    EXPECTED.localSkillHubInstallDirectories,
  );
  assertEqual(
    failures,
    "missing local SkillHub install directory count",
    missingLocalSkillHubDirectories.length,
    0,
  );
  for (const missingSkillCode of missingLocalSkillHubDirectories) {
    failures.push(
      `SkillHub ${missingSkillCode}: local SKILL.md is required under skillhub-skills/${missingSkillCode}`,
    );
  }

  for (const solutionPackage of packages) {
    assertTruthy(
      failures,
      `${solutionPackage.code}: entryPath must stay under /solutions`,
      solutionPackage.entryPath.startsWith("/solutions/"),
    );
    assertTruthy(
      failures,
      `${solutionPackage.code}: workflow is required`,
      solutionPackage.workflow.length > 0,
    );
    assertTruthy(
      failures,
      `${solutionPackage.code}: dataObjects must include SolutionRun`,
      solutionPackage.dataObjects.includes("SolutionRun"),
    );
    assertTruthy(
      failures,
      `${solutionPackage.code}: acceptance is required`,
      solutionPackage.acceptance.length > 0,
    );
  }

  for (const item of packageSkillRefs) {
    if (!item.mapping) {
      continue;
    }
    assertTruthy(
      failures,
      `${item.packageCode}/${item.skillName}: mapping outputObjects is required`,
      item.mapping.outputObjects.length > 0,
    );
    assertTruthy(
      failures,
      `${item.packageCode}/${item.skillName}: mapping inputContract is required`,
      item.mapping.hasInputContract,
    );
  }

  for (const mapping of mappings) {
    assertTruthy(
      failures,
      `${mapping.code}: skillCode is required`,
      mapping.skillCode,
    );
    assertTruthy(
      failures,
      `${mapping.code}: skillName is required`,
      mapping.skillName,
    );
    assertTruthy(
      failures,
      `${mapping.code}: platform is required`,
      mapping.platform,
    );
    assertTruthy(
      failures,
      `${mapping.code}: scenario is required`,
      mapping.scenario,
    );
    assertTruthy(
      failures,
      `${mapping.code}: outputObjects is required`,
      mapping.outputObjects.length > 0,
    );
    assertTruthy(
      failures,
      `${mapping.code}: inputContract is required`,
      mapping.hasInputContract,
    );
    for (const skillHubRef of mapping.skillHubRefs) {
      assertTruthy(
        failures,
        `${mapping.code}: SkillHub ref skillNo is required`,
        skillHubRef.skillNo,
      );
      assertTruthy(
        failures,
        `${mapping.code}: SkillHub ref skillCode is required`,
        skillHubRef.skillCode,
      );
      assertTruthy(
        failures,
        `${mapping.code}: SkillHub ref repoUrl is required for official install`,
        skillHubRef.repoUrl,
      );
    }
  }

  const matrixMarkdown = buildMatrixMarkdown(packageSkillRefs);
  if (process.argv.includes("--write-matrix")) {
    fs.mkdirSync(path.dirname(matrixPath), { recursive: true });
    fs.writeFileSync(matrixPath, matrixMarkdown);
  }

  if (!fs.existsSync(matrixPath)) {
    failures.push(
      "docs/redfox-skill-integration-matrix.md is required; run `node scripts/redfox-skill-integration-guard.mjs --write-matrix`",
    );
  } else {
    const matrixSource = read(matrixPath);
    const matrixLines = matrixSource
      .split(/\r?\n/)
      .filter((line) => /^\| P\d{2}-\d{2} \|/.test(line));
    const matrixRowsById = new Map(
      matrixLines.map((line) => [line.split("|")[1].trim(), line]),
    );

    assertEqual(
      failures,
      "integration matrix row count",
      matrixLines.length,
      EXPECTED.packageSkillRefs,
    );
    for (const item of packageSkillRefs) {
      const row = matrixRowsById.get(item.id) || "";
      assertTruthy(failures, `${item.id}: matrix row is required`, row);
      assertTruthy(
        failures,
        `${item.id}: matrix row must include package name`,
        row.includes(item.packageName),
      );
      assertTruthy(
        failures,
        `${item.id}: matrix row must include skill name`,
        row.includes(item.skillName),
      );
      assertTruthy(
        failures,
        `${item.id}: matrix row must include execution type`,
        row.includes(refType(item)),
      );
      assertTruthy(
        failures,
        `${item.id}: matrix row must include execution entry`,
        row.includes(entrySummary(item)),
      );
      assertTruthy(
        failures,
        `${item.id}: matrix row must include output objects`,
        (item.mapping?.outputObjects || []).every((outputObject) =>
          row.includes(outputObject),
        ),
      );
    }
  }

  if (fs.existsSync(solutionsPagePath)) {
    const solutionsPageSource = read(solutionsPagePath);
    const blockedFrontendTexts = [
      "AI 业务方案中心",
      "方案市场",
      "这页到底干什么用",
      "像逛模板市场",
    ];
    for (const blockedText of blockedFrontendTexts) {
      assertTruthy(
        failures,
        `/solutions must not contain old direction text: ${blockedText}`,
        !solutionsPageSource.includes(blockedText),
      );
    }
    assertTruthy(
      failures,
      "/solutions must use SkillActionWorkbench as business entry",
      solutionsPageSource.includes("<SkillActionWorkbench"),
    );
    assertTruthy(
      failures,
      "/solutions must default to core actions, not all packages",
      solutionsPageSource.includes('useState<FilterKey>("core")'),
    );
  }

  const agentSServiceSource = read(agentSServicePath);
  const agentSControllerSource = read(agentSControllerPath);
  const redfoxSkillRunnerSource = read(redfoxSkillRunnerPath);
  assertTruthy(
    failures,
    "AgentSService must keep RedFox SkillHub route detector",
    agentSServiceSource.includes("isRedfoxSkillHubRoute"),
  );
  assertTruthy(
    failures,
    "AgentSService must keep local RedFox SkillHub runner",
    agentSServiceSource.includes("runRedfoxSkillHubLocalSkill"),
  );
  assertTruthy(
    failures,
    "AgentSService must emit RedFox SkillHub blocked preflight artifacts",
    agentSServiceSource.includes("redfox_skillhub_preflight_blocked"),
  );
  assertTruthy(
    failures,
    "AgentSService must keep redfox.skillhub.run task type",
    agentSServiceSource.includes("redfox.skillhub.run"),
  );
  assertTruthy(
    failures,
    "AgentSController must route RedFox SkillHub sessions to AgentSService",
    agentSControllerSource.includes("isRedfoxSkillHubInput") &&
      agentSControllerSource.includes("redfox.skillhub.run") &&
      agentSControllerSource.includes("redfox-skillhub"),
  );
  assertTruthy(
    failures,
    "RedfoxSkillRunnerService must build Agent-S SkillHub sessions",
    redfoxSkillRunnerSource.includes("runSkillHubSkill") &&
      redfoxSkillRunnerSource.includes("this.agentS.createSession") &&
      redfoxSkillRunnerSource.includes("this.agentS.runTask") &&
      redfoxSkillRunnerSource.includes("task_type: 'redfox.skillhub.run'"),
  );
  assertTruthy(
    failures,
    "RedfoxSkillRunnerService must not require the removed real execution safety gate",
    !redfoxSkillRunnerSource.includes("EXECUTE_REDFOX_SKILL") &&
      !redfoxSkillRunnerSource.includes(
        "REDFOX_SKILL_RUNNER_REAL_EXECUTION_ENABLED",
      ) &&
      !redfoxSkillRunnerSource.includes("assertRealExecutionAllowed"),
  );

  const rows = packages.map((solutionPackage) => {
    const refs = packageSkillRefs.filter(
      (item) => item.packageCode === solutionPackage.code,
    );
    return {
      code: solutionPackage.code,
      name: solutionPackage.name,
      type: solutionPackage.category,
      state: solutionPackage.implementationState,
      refs: refs.length,
      api: refs.filter((item) => item.isApi).length,
      skillHub: refs.filter((item) => item.isSkillHub).length,
      unmapped: refs
        .filter((item) => !item.mapping)
        .map((item) => item.skillName),
    };
  });

  const result = {
    ok: failures.length === 0,
    expected: EXPECTED,
    actual: {
      packages: packages.length,
      corePackages: packages.filter((item) => item.category === "core").length,
      redfoxPoolPackages: packages.filter(
        (item) => item.category === "redfox_pool",
      ).length,
      packageSkillRefs: packageSkillRefs.length,
      uniqueSkillNames: uniqueSkillNames.size,
      apiPackageSkillRefs: apiRefs.length,
      skillHubPackageSkillRefs: skillHubRefs.length,
      contractOnlyPackageSkillRefs: contractOnlyRefs.length,
      unmappedPackageSkillRefs: unmappedRefs.length,
      mappingCatalogSize: mappings.length,
      officialSkillHubRefCandidates: officialSkillHubRefCandidates.size,
      localSkillHubInstallDirectories: localSkillHubInstallDirectories.size,
      integrationMatrixRows: fs.existsSync(matrixPath)
        ? read(matrixPath)
            .split(/\r?\n/)
            .filter((line) => /^\| P\d{2}-\d{2} \|/.test(line)).length
        : 0,
    },
    rows,
    failures,
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (failures.length) {
    console.error("RedFox skill integration guard failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
  } else {
    console.log(
      [
        "RedFox skill integration guard passed.",
        `packages=${result.actual.packages}`,
        `packageSkillRefs=${result.actual.packageSkillRefs}`,
        `apiRefs=${result.actual.apiPackageSkillRefs}`,
        `skillHubRefs=${result.actual.skillHubPackageSkillRefs}`,
        `officialSkillHubRefCandidates=${result.actual.officialSkillHubRefCandidates}`,
        `localSkillHubDirs=${result.actual.localSkillHubInstallDirectories}`,
      ].join(" "),
    );
  }

  if (failures.length) {
    process.exitCode = 1;
  }
}

main();
