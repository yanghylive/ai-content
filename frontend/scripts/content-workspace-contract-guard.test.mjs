import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(scriptDir, "../..");
const guardPath = path.join(scriptDir, "content-workspace-contract-guard.mjs");
const baseContract = readJson(
  path.join(packRoot, "docs/content-workspace/contract.json"),
);
const baseDecisions = readJson(
  path.join(packRoot, "docs/content-workspace/decisions.json"),
);
const baseActiveWork = readJson(
  path.join(packRoot, "docs/content-workspace/active-work-item.json"),
);
const baseDecisionLog = readFileSync(
  path.join(packRoot, baseDecisions.logFile),
  "utf8",
);

test("valid frozen contract passes", () => {
  const result = runGuard();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /requirements: 15/);
  assert.match(
    result.stdout,
    new RegExp(`accepted: ${baseContract.statusSummary.accepted}`),
  );
  assert.match(
    result.stdout,
    new RegExp(`active gate: ${baseContract.activeGate}`),
  );
});

test("the corrective gate and its fixed requirement ownership are required", () => {
  const result = runGuard({
    mutateContract(contract) {
      contract.deliveryGates = contract.deliveryGates.filter(
        (gate) => gate.id !== "G1.1",
      );
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[CORRECTIVE_GATE\]/);
});

test("the accepted correction decision cannot be removed or reopened", () => {
  const result = runGuard({
    mutateDecisions(decisions) {
      decisions.entries.find((entry) => entry.id === "CW-D004").status = "open";
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[CORRECTION_DECISION\]/);
});

test("the latest accepted correction decision cannot be removed or reopened", () => {
  const result = runGuard({
    mutateDecisions(decisions) {
      decisions.entries.find((entry) => entry.id === "CW-D005").status = "open";
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[LATEST_CORRECTION_DECISION\]/);
});

test("the latest correction decision content cannot be silently rewritten", () => {
  const result = runGuard({
    mutateDecisions(decisions) {
      const decision = decisions.entries.find(
        (entry) => entry.id === "CW-D005",
      );
      decision.decision = "x";
      decision.reason = "x";
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[LATEST_CORRECTION_DECISION\]/);
});

test("G1.1 must remain accepted while G2 is active", () => {
  const result = runGuard({
    mutateContract(contract) {
      contract.activeGate = "G2";
      contract.deliveryGates.find((gate) => gate.id === "G1.1").status =
        "locked";
      contract.deliveryGates.find((gate) => gate.id === "G2").status = "active";
      contract.deliveryGates.find((gate) => gate.id === "G5").status = "locked";
    },
    mutateActiveWork(activeWork) {
      activeWork.gate = "G2";
      activeWork.selectedRequirementIds = ["UX-07", "UX-08"];
      activeWork.deferredRequirementIds = [];
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[CORRECTIVE_GATE\]/);
});

test("removing a requirement fails the exact ID set", () => {
  const result = runGuard({
    mutateContract(contract) {
      contract.requirements = contract.requirements.filter(
        (requirement) => requirement.id !== "UX-15",
      );
      recomputeStatusSummary(contract);
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[REQUIREMENT_IDS\]/);
});

test("malformed gate data reports a contract failure instead of crashing", () => {
  const result = runGuard({
    mutateContract(contract) {
      contract.deliveryGates = null;
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[DELIVERY_GATES\]/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

test("accepted status without implementation, tests and evidence fails", () => {
  const result = runGuard({
    mutateContract(contract) {
      const requirement = findRequirement(contract, "UX-01");
      requirement.currentStatus = "accepted";
      requirement.implementationRefs = [];
      requirement.testRefs = [];
      requirement.evidenceRefs = [];
      recomputeStatusSummary(contract);
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[ACCEPTED_WITHOUT_EVIDENCE\]/);
});

test("decision-required status needs an open linked decision", () => {
  const result = runGuard({
    mutateContract(contract) {
      findRequirement(contract, "UX-14").currentStatus = "decision_required";
      recomputeStatusSummary(contract);
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[OPEN_DECISION_REQUIRED\].*UX-14/);
});

test("active work cannot select a locked gate", () => {
  const result = runGuard({
    mutateActiveWork(activeWork) {
      activeWork.gate = "G3";
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[ACTIVE_WORK_GATE\]/);
});

test("changed files outside the active work item fail", () => {
  const result = runGuard({
    changedFiles: ["frontend/src/app/(dashboard)/settings/page.tsx"],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[OUT_OF_SCOPE_CHANGE\]/);
});

test("D005 active work cannot expand its own allowed paths", () => {
  const result = runGuard({
    activeWorkFixture: createD005ActiveWorkFixture(),
    mutateContract(contract) {
      contract.activeGate = "G1.1";
      contract.deliveryGates.find((gate) => gate.id === "G1.1").status =
        "active";
      contract.deliveryGates.find((gate) => gate.id === "G2").status = "locked";
      contract.deliveryGates.find((gate) => gate.id === "G5").status = "locked";
      for (const id of ["UX-05", "UX-13"]) {
        findRequirement(contract, id).currentStatus = "partial";
      }
      findRequirement(contract, "UX-06").currentStatus = "accepted";
      recomputeStatusSummary(contract);
    },
    mutateActiveWork(activeWork) {
      activeWork.allowedPathPrefixes.push("frontend/");
    },
    changedFiles: ["frontend/src/app/(dashboard)/settings/page.tsx"],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[D005_ACTIVE_WORK_PATHS\]/);
});

test("implementation changes require contract and test changes", () => {
  const result = runGuard({
    changedFiles: [
      "frontend/src/app/(dashboard)/content/workspace/content-editor.tsx",
    ],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[IMPLEMENTATION_WITHOUT_CONTRACT\]/);
  assert.match(result.stderr, /\[IMPLEMENTATION_WITHOUT_TEST\]/);
});

test("status and evidence updates do not require a new decision", () => {
  const result = runGuard({
    includeBaseContract: true,
    mutateContract(contract) {
      findRequirement(contract, "UX-03").currentStatus = "in_progress";
      recomputeStatusSummary(contract);
    },
    changedFiles: ["docs/content-workspace/contract.json"],
  });
  assert.equal(result.status, 0, result.stderr);
});

test("acceptance changes require a decision-log change", () => {
  const result = runGuard({
    includeBaseContract: true,
    mutateContract(contract) {
      findRequirement(contract, "UX-03").acceptance.push(
        "新增且未经决策记录的验收条件",
      );
    },
    changedFiles: ["docs/content-workspace/contract.json"],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[CONTRACT_CHANGE_WITHOUT_DECISION\]/);
});

test("acceptance changes with a decision-log change pass", () => {
  const result = runGuard({
    includeBaseContract: true,
    mutateContract(contract) {
      findRequirement(contract, "UX-03").acceptance.push(
        "经决策记录确认的新验收条件",
      );
    },
    changedFiles: [
      "docs/content-workspace/contract.json",
      "docs/content-workspace/decisions.json",
    ],
  });
  assert.equal(result.status, 0, result.stderr);
});

test("gate cannot advance while previous requirements remain incomplete", () => {
  const result = runGuard({
    includeBaseContract: true,
    mutateContract(contract) {
      contract.activeGate = "G3";
      contract.deliveryGates.find((gate) => gate.id === "G2").status = "locked";
      contract.deliveryGates.find((gate) => gate.id === "G3").status = "active";
      contract.deliveryGates.find((gate) => gate.id === "G5").status = "locked";
    },
    mutateActiveWork(activeWork) {
      activeWork.gate = "G3";
      activeWork.selectedRequirementIds = ["UX-02", "UX-09"];
      activeWork.deferredRequirementIds = [];
    },
    changedFiles: [
      "docs/content-workspace/contract.json",
      "docs/content-workspace/decisions.json",
      "docs/content-workspace/active-work-item.json",
    ],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[GATE_ADVANCE_WITHOUT_ACCEPTANCE\]/);
});

test("a recorded correction may roll G2 back to G1.1", () => {
  const result = runGuard({
    activeWorkFixture: createD005ActiveWorkFixture(),
    includeBaseContract: true,
    mutateBaseContract(contract) {
      contract.activeGate = "G2";
      contract.deliveryGates.find((gate) => gate.id === "G1.1").status =
        "accepted";
      contract.deliveryGates.find((gate) => gate.id === "G2").status = "active";
      contract.deliveryGates.find((gate) => gate.id === "G5").status = "locked";
      contract.deliveryGates.find((gate) => gate.id === "G5").status = "locked";
      for (const id of ["UX-05", "UX-06", "UX-13"]) {
        findRequirement(contract, id).currentStatus = "accepted";
      }
      recomputeStatusSummary(contract);
    },
    mutateContract(contract) {
      contract.activeGate = "G1.1";
      contract.deliveryGates.find((gate) => gate.id === "G1.1").status =
        "active";
      contract.deliveryGates.find((gate) => gate.id === "G2").status = "locked";
      contract.deliveryGates.find((gate) => gate.id === "G5").status = "locked";
      for (const id of ["UX-05", "UX-13"]) {
        findRequirement(contract, id).currentStatus = "partial";
      }
      findRequirement(contract, "UX-06").currentStatus = "accepted";
      recomputeStatusSummary(contract);
    },
    changedFiles: [
      "docs/content-workspace/contract.json",
      "docs/content-workspace/decisions.json",
      "docs/content-workspace/active-work-item.json",
    ],
  });
  assert.equal(result.status, 0, result.stderr);
});

test("old G1 evidence cannot satisfy the G1.1 correction gate", () => {
  const result = runGuard({
    mutateContract(contract) {
      contract.activeGate = "G2";
      contract.deliveryGates.find((gate) => gate.id === "G1.1").status =
        "accepted";
      contract.deliveryGates.find((gate) => gate.id === "G2").status = "active";
      contract.deliveryGates.find((gate) => gate.id === "G5").status = "locked";
      for (const id of ["UX-05", "UX-06", "UX-13"]) {
        const requirement = findRequirement(contract, id);
        requirement.currentStatus = "accepted";
        requirement.evidenceRefs = requirement.evidenceRefs.filter(
          (reference) =>
            !reference.startsWith("docs/content-workspace/evidence/g1.1-"),
        );
      }
      recomputeStatusSummary(contract);
    },
    mutateActiveWork(activeWork) {
      activeWork.gate = "G2";
      activeWork.selectedRequirementIds = ["UX-07", "UX-08"];
      activeWork.deferredRequirementIds = [];
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[CORRECTIVE_EVIDENCE\]/);
});

test("old G1.1 evidence cannot satisfy the D005 correction", () => {
  const result = runGuard({
    mutateContract(contract) {
      contract.activeGate = "G2";
      contract.deliveryGates.find((gate) => gate.id === "G1.1").status =
        "accepted";
      contract.deliveryGates.find((gate) => gate.id === "G2").status = "active";
      for (const id of ["UX-05", "UX-06", "UX-13"]) {
        findRequirement(contract, id).currentStatus = "accepted";
      }
      for (const id of ["UX-05", "UX-13"]) {
        const requirement = findRequirement(contract, id);
        requirement.evidenceRefs = requirement.evidenceRefs.filter(
          (reference) =>
            !reference.startsWith("docs/content-workspace/evidence/g1.1-d005-"),
        );
      }
      recomputeStatusSummary(contract);
    },
    mutateActiveWork(activeWork) {
      activeWork.gate = "G2";
      activeWork.selectedRequirementIds = ["UX-07", "UX-08"];
      activeWork.deferredRequirementIds = [];
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[LATEST_CORRECTIVE_EVIDENCE\]/);
});

test("G1.1 cannot accept a corrected requirement before D005 evidence exists", () => {
  const result = runGuard({
    activeWorkFixture: createD005ActiveWorkFixture(),
    mutateContract(contract) {
      contract.activeGate = "G1.1";
      contract.deliveryGates.find((gate) => gate.id === "G1.1").status =
        "active";
      contract.deliveryGates.find((gate) => gate.id === "G2").status = "locked";
      contract.deliveryGates.find((gate) => gate.id === "G5").status = "locked";
      for (const id of ["UX-05", "UX-13"]) {
        findRequirement(contract, id).currentStatus = "partial";
      }
      findRequirement(contract, "UX-06").currentStatus = "accepted";
      const requirement = findRequirement(contract, "UX-05");
      requirement.evidenceRefs = requirement.evidenceRefs.filter(
        (reference) =>
          !reference.startsWith("docs/content-workspace/evidence/g1.1-d005-"),
      );
      requirement.currentStatus = "accepted";
      recomputeStatusSummary(contract);
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[LATEST_CORRECTIVE_ACCEPTANCE\]/);
});

test("G2 cannot resume until every G1.1 requirement is accepted", () => {
  const result = runGuard({
    mutateContract(contract) {
      contract.activeGate = "G2";
      contract.deliveryGates.find((gate) => gate.id === "G1.1").status =
        "accepted";
      contract.deliveryGates.find((gate) => gate.id === "G2").status = "active";
      contract.deliveryGates.find((gate) => gate.id === "G5").status = "locked";
      findRequirement(contract, "UX-05").currentStatus = "partial";
      recomputeStatusSummary(contract);
    },
    mutateActiveWork(activeWork) {
      activeWork.gate = "G2";
      activeWork.selectedRequirementIds = ["UX-07", "UX-08"];
      activeWork.deferredRequirementIds = [];
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[CORRECTIVE_ACCEPTANCE\]/);
});

test("G2 may resume after every G1.1 requirement has evidence and acceptance", () => {
  const result = runGuard({
    includeBaseContract: true,
    mutateBaseContract(contract) {
      contract.activeGate = "G1.1";
      contract.deliveryGates.find((gate) => gate.id === "G1.1").status =
        "active";
      contract.deliveryGates.find((gate) => gate.id === "G2").status = "locked";
      contract.deliveryGates.find((gate) => gate.id === "G5").status = "locked";
      for (const id of ["UX-05", "UX-06", "UX-13"]) {
        findRequirement(contract, id).currentStatus = "accepted";
      }
      recomputeStatusSummary(contract);
    },
    mutateContract(contract) {
      contract.activeGate = "G2";
      contract.deliveryGates.find((gate) => gate.id === "G1.1").status =
        "accepted";
      contract.deliveryGates.find((gate) => gate.id === "G2").status = "active";
      contract.deliveryGates.find((gate) => gate.id === "G5").status = "locked";
      for (const id of ["UX-05", "UX-06", "UX-13"]) {
        findRequirement(contract, id).currentStatus = "accepted";
      }
      for (const id of ["UX-05", "UX-08", "UX-13"]) {
        findRequirement(contract, id).evidenceRefs.push(
          `docs/content-workspace/evidence/g1.1-d005-${id.toLowerCase()}.md`,
        );
      }
      recomputeStatusSummary(contract);
    },
    mutateActiveWork(activeWork) {
      activeWork.gate = "G2";
      activeWork.selectedRequirementIds = ["UX-07", "UX-08"];
      activeWork.deferredRequirementIds = [];
    },
    changedFiles: [
      "docs/content-workspace/contract.json",
      "docs/content-workspace/decisions.json",
      "docs/content-workspace/active-work-item.json",
    ],
  });
  assert.equal(result.status, 0, result.stderr);
});

test("scoped S1 result-entry implementation, contract and test changes pass", () => {
  const result = runGuard({
    activeWorkFixture: createS1ActiveWorkFixture(),
    includeBaseContract: true,
    mutateBaseContract(contract) {
      findRequirement(contract, "UX-01").currentStatus = "in_progress";
      recomputeStatusSummary(contract);
    },
    mutateContract(contract) {
      findRequirement(contract, "UX-01").currentStatus = "in_progress";
      recomputeStatusSummary(contract);
    },
    changedFiles: [
      "frontend/src/app/(dashboard)/page.tsx",
      "frontend/src/app/(dashboard)/content/workspace/workspace-intent.ts",
      "frontend/scripts/content-workspace-entry-contract.test.mjs",
      "docs/content-workspace/contract.json",
    ],
  });
  assert.equal(result.status, 0, result.stderr);
});

test("S1 result-entry work rejects frozen shell changes", () => {
  const result = runGuard({
    includeBaseContract: true,
    changedFiles: [
      "frontend/src/app/(dashboard)/layout.tsx",
      "frontend/src/app/providers.tsx",
      "docs/content-workspace/contract.json",
    ],
  });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /\[OUT_OF_SCOPE_CHANGE\].*frontend\/src\/app\/\(dashboard\)\/layout\.tsx/,
  );
  assert.match(
    result.stderr,
    /\[OUT_OF_SCOPE_CHANGE\].*frontend\/src\/app\/providers\.tsx/,
  );
});

function runGuard({
  activeWorkFixture,
  mutateContract,
  mutateBaseContract,
  mutateDecisions,
  mutateActiveWork,
  changedFiles,
  includeBaseContract = false,
} = {}) {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "content-workspace-contract-"),
  );
  try {
    const contract = structuredClone(baseContract);
    const decisions = structuredClone(baseDecisions);
    const activeWork = structuredClone(activeWorkFixture ?? baseActiveWork);
    mutateContract?.(contract);
    mutateDecisions?.(decisions);
    mutateActiveWork?.(activeWork);

    writeJson(
      path.join(fixtureRoot, "docs/content-workspace/contract.json"),
      contract,
    );
    writeJson(
      path.join(fixtureRoot, "docs/content-workspace/decisions.json"),
      decisions,
    );
    writeJson(
      path.join(fixtureRoot, "docs/content-workspace/active-work-item.json"),
      activeWork,
    );
    writeText(path.join(fixtureRoot, decisions.logFile), baseDecisionLog);
    createReferencedFiles(fixtureRoot, contract);

    let changedFilesPath;
    if (changedFiles) {
      changedFilesPath = path.join(fixtureRoot, "changed-files.txt");
      writeText(changedFilesPath, `${changedFiles.join("\n")}\n`);
    }
    let baseContractPath;
    if (includeBaseContract) {
      baseContractPath = path.join(fixtureRoot, "base-contract.json");
      const previousContract = structuredClone(baseContract);
      mutateBaseContract?.(previousContract);
      writeJson(baseContractPath, previousContract);
    }

    return spawnSync(process.execPath, [guardPath], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CONTENT_WORKSPACE_REPO_ROOT: fixtureRoot,
        ...(changedFilesPath
          ? { CONTENT_WORKSPACE_CHANGED_FILES_FILE: changedFilesPath }
          : {}),
        ...(baseContractPath
          ? { CONTENT_WORKSPACE_BASE_CONTRACT_PATH: baseContractPath }
          : {}),
      },
    });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function createD005ActiveWorkFixture() {
  return {
    schemaVersion: 1,
    id: "CW-G1.1-D005-ACTION-PROVENANCE-CORRECTION",
    gate: "G1.1",
    title: "D005 action and provenance correction",
    goal: "Validate the frozen D005 corrective scope.",
    selectedRequirementIds: ["UX-05", "UX-13"],
    deferredRequirementIds: ["UX-06"],
    allowedPathPrefixes: [
      ".github/workflows/content-workspace-contract.yml",
      "docs/content-workspace/",
      "scripts/content-workspace-contract-gate.mjs",
      "frontend/scripts/content-workspace-",
      "frontend/src/app/(dashboard)/content/workspace/",
      "frontend/src/lib/api/content-workspace.ts",
      "frontend/src/lib/content-workspace-types.ts",
    ],
    mustNotChange: ["Do not expand beyond the frozen D005 correction scope."],
    acceptance: ["The D005 correction meets its frozen acceptance criteria."],
    requiredEvidence: {
      tests: ["D005 fixture tests"],
      screenshots: ["D005 fixture screenshots"],
      runtime: ["D005 fixture runtime"],
      report: ["D005 fixture report"],
    },
  };
}

function createS1ActiveWorkFixture() {
  return {
    schemaVersion: 1,
    id: "CW-G5-RESULT-ENTRY",
    gate: "G5",
    title: "S1 result entry fixture",
    goal: "Validate the frozen S1 result-entry scope.",
    selectedRequirementIds: ["UX-01"],
    deferredRequirementIds: ["UX-14", "UX-15"],
    allowedPathPrefixes: [
      "docs/content-workspace/",
      ".local-backups/content-workspace-s1/",
      "backend/src/modules/articles/dto/article-workspace.dto.ts",
      "backend/src/modules/articles/articles.service.ts",
      "backend/src/modules/articles/articles.controller.spec.ts",
      "backend/src/modules/articles/articles.service.spec.ts",
      "frontend/scripts/content-workspace-entry-",
      "frontend/scripts/content-workspace-contract-guard.test.mjs",
      "frontend/src/app/(dashboard)/page.tsx",
      "frontend/src/app/(dashboard)/solutions/page.tsx",
      "frontend/src/app/(dashboard)/components/content-result-entry.tsx",
      "frontend/src/app/(dashboard)/content/workspace/page.tsx",
      "frontend/src/app/(dashboard)/content/workspace/content-workspace-route.tsx",
      "frontend/src/app/(dashboard)/content/workspace/content-workspace-intent-entry.tsx",
      "frontend/src/app/(dashboard)/content/workspace/workspace-intent.ts",
      "frontend/src/lib/api/articles.ts",
    ],
    mustNotChange: ["Do not expand beyond the frozen S1 result-entry scope."],
    acceptance: ["The S1 result-entry acceptance criteria are met."],
    requiredEvidence: {
      tests: ["S1 fixture tests"],
      screenshots: ["S1 fixture screenshots"],
      runtime: ["S1 fixture runtime"],
      report: ["S1 fixture report"],
    },
  };
}

function createReferencedFiles(root, contract) {
  const references = contract.requirements.flatMap((requirement) => [
    ...(requirement.implementationRefs || []),
    ...(requirement.testRefs || []),
    ...(requirement.evidenceRefs || []),
  ]);
  for (const reference of new Set(references)) {
    const content =
      reference.startsWith("docs/content-workspace/evidence/g1.1-d005-") &&
      reference.endsWith(".md")
        ? [
            "# D005 fixture evidence",
            "Result: accepted",
            "Requirements: UX-05, UX-08, UX-13",
            "primary-action-count: 1",
            "historical-brief-source: source-not-recorded",
            "runtime: 3010/3011",
            "",
          ].join("\n")
        : "fixture\n";
    writeText(path.join(root, reference), content);
  }
}

function findRequirement(contract, id) {
  const requirement = contract.requirements.find((item) => item.id === id);
  assert.ok(requirement, `missing fixture requirement ${id}`);
  return requirement;
}

function recomputeStatusSummary(contract) {
  contract.statusSummary = Object.fromEntries(
    contract.statusPolicy.allowed.map((status) => [status, 0]),
  );
  for (const requirement of contract.requirements) {
    contract.statusSummary[requirement.currentStatus] += 1;
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, "utf8");
}
