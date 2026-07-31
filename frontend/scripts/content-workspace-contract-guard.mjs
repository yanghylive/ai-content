import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "../..");
const repoRoot = resolvePath(
  process.env.CONTENT_WORKSPACE_REPO_ROOT,
  defaultRepoRoot,
  defaultRepoRoot,
);
const contractPath = resolvePath(
  process.env.CONTENT_WORKSPACE_CONTRACT_PATH,
  path.join(repoRoot, "docs/content-workspace/contract.json"),
  repoRoot,
);
const decisionsPath = resolvePath(
  process.env.CONTENT_WORKSPACE_DECISIONS_PATH,
  path.join(repoRoot, "docs/content-workspace/decisions.json"),
  repoRoot,
);
const activeWorkPath = resolvePath(
  process.env.CONTENT_WORKSPACE_ACTIVE_WORK_PATH,
  path.join(repoRoot, "docs/content-workspace/active-work-item.json"),
  repoRoot,
);
const changedFilesPath = process.env.CONTENT_WORKSPACE_CHANGED_FILES_FILE
  ? path.resolve(process.env.CONTENT_WORKSPACE_CHANGED_FILES_FILE)
  : null;
const baseContractPath = process.env.CONTENT_WORKSPACE_BASE_CONTRACT_PATH
  ? path.resolve(process.env.CONTENT_WORKSPACE_BASE_CONTRACT_PATH)
  : null;
const decisionLogPathOverride = process.env.CONTENT_WORKSPACE_DECISION_LOG_PATH
  ? path.resolve(process.env.CONTENT_WORKSPACE_DECISION_LOG_PATH)
  : null;

const D005_DECISION =
  "再次打开 G1.1 并暂停 G2；同一可见工作区最多保留一个主动作，历史简报缺少字段来源时必须明确显示来源未记录，不得猜测或使用模糊说明。";
const D005_REASON =
  "第一次 G1.1 证据未覆盖规则候选打开、已有版本行以及非空历史简报缺少 fieldSources 的组合状态。";
const D005_REQUIREMENT_IDS = ["UX-05", "UX-08", "UX-13"];
const D005_ALLOWED_PATH_PREFIXES = [
  ".github/workflows/content-workspace-contract.yml",
  "docs/content-workspace/",
  "scripts/content-workspace-contract-gate.mjs",
  "frontend/scripts/content-workspace-",
  "frontend/src/app/(dashboard)/content/workspace/",
  "frontend/src/lib/api/content-workspace.ts",
  "frontend/src/lib/content-workspace-types.ts",
];

const failures = [];
const addFailure = (rule, message) => failures.push({ rule, message });

const contract = readJson(contractPath, "CONTRACT_FILE");
const decisions = readJson(decisionsPath, "DECISIONS_FILE");
const activeWork = readJson(activeWorkPath, "ACTIVE_WORK_FILE");

if (contract) validateContract(contract);
if (contract && decisions) validateDecisions(contract, decisions);
if (contract && activeWork) validateActiveWork(contract, activeWork);
if (contract && decisions && activeWork) {
  validateStatusEvidence(contract, decisions);
}
if (contract && activeWork && changedFilesPath) {
  validateChangedFiles(
    contract,
    decisions,
    activeWork,
    changedFilesPath,
    baseContractPath,
  );
}

const summary = buildSummary(contract, decisions, activeWork);

if (failures.length > 0) {
  console.error(
    `Content workspace contract guard failed (${failures.length} issue(s)):`
  );
  for (const failure of failures) {
    console.error(`- [${failure.rule}] ${failure.message}`);
  }
  printSummary(summary, console.error);
  process.exitCode = 1;
} else {
  console.log("Content workspace contract guard passed.");
  printSummary(summary, console.log);
}

function validateContract(value) {
  if (value.schemaVersion !== 1) {
    addFailure("CONTRACT_SCHEMA", "schemaVersion must be 1");
  }
  if (value.contractId !== "kaypal-content-workspace") {
    addFailure(
      "CONTRACT_ID",
      "contractId must remain kaypal-content-workspace",
    );
  }

  validateBaselineDocuments(value.baselineDocuments);

  const allowedStatuses = value.statusPolicy?.allowed;
  if (!isNonEmptyStringArray(allowedStatuses)) {
    addFailure("STATUS_POLICY", "statusPolicy.allowed must be a non-empty array");
  }

  const requirements = Array.isArray(value.requirements)
    ? value.requirements
    : [];
  const expectedIds = Array.from(
    { length: 15 },
    (_, index) => `UX-${String(index + 1).padStart(2, "0")}`,
  );
  const actualIds = requirements.map((item) => item?.id);
  validateExactIdSet("REQUIREMENT_IDS", actualIds, expectedIds);

  const seenIds = new Set();
  for (const requirement of requirements) {
    if (!requirement || typeof requirement !== "object") {
      addFailure("REQUIREMENT_SHAPE", "every requirement must be an object");
      continue;
    }
    if (seenIds.has(requirement.id)) {
      addFailure("REQUIREMENT_IDS", `duplicate requirement ID: ${requirement.id}`);
    }
    seenIds.add(requirement.id);
    validateRequirement(requirement, allowedStatuses || []);
  }

  validateStatusSummary(value.statusSummary, requirements, allowedStatuses || []);
  validateDeliveryGates(value.deliveryGates, value.activeGate, expectedIds);
  validateCorrectiveGate(value.deliveryGates, value.activeGate, requirements);
}

function validateBaselineDocuments(documents) {
  const expectedRoles = [
    "product-experience",
    "feature-prototype",
    "implementation-contract",
  ];
  if (!Array.isArray(documents)) {
    addFailure("BASELINE_DOCUMENTS", "baselineDocuments must be an array");
    return;
  }
  validateExactIdSet(
    "BASELINE_DOCUMENTS",
    documents.map((item) => item?.role),
    expectedRoles,
  );
  for (const document of documents) {
    if (!isNonEmptyString(document?.file)) {
      addFailure("BASELINE_DOCUMENTS", "each baseline needs a file name");
    }
    if (!/^[a-f0-9]{64}$/.test(document?.sha256 || "")) {
      addFailure(
        "BASELINE_DOCUMENTS",
        `baseline ${document?.role || "unknown"} needs a SHA-256 digest`,
      );
    }
  }
}

function validateRequirement(requirement, allowedStatuses) {
  if (!/^UX-\d{2}$/.test(requirement.id || "")) {
    addFailure("REQUIREMENT_SHAPE", `invalid requirement ID: ${requirement.id}`);
  }
  if (!isNonEmptyString(requirement.title)) {
    addFailure("REQUIREMENT_SHAPE", `${requirement.id} needs a title`);
  }
  if (!isNonEmptyStringArray(requirement.phase)) {
    addFailure("REQUIREMENT_SHAPE", `${requirement.id} needs at least one phase`);
  }
  if (!Array.isArray(requirement.sourceRefs) || requirement.sourceRefs.length === 0) {
    addFailure("SOURCE_TRACE", `${requirement.id} needs sourceRefs`);
  } else {
    for (const reference of requirement.sourceRefs) {
      if (
        !isNonEmptyString(reference?.document) ||
        !Number.isInteger(reference?.line) ||
        reference.line < 1
      ) {
        addFailure(
          "SOURCE_TRACE",
          `${requirement.id} has an invalid document/line source reference`,
        );
      }
    }
  }
  if (!isNonEmptyStringArray(requirement.acceptance)) {
    addFailure("ACCEPTANCE", `${requirement.id} needs acceptance criteria`);
  }
  if (!allowedStatuses.includes(requirement.currentStatus)) {
    addFailure(
      "STATUS_VALUE",
      `${requirement.id} has unsupported status ${requirement.currentStatus}`,
    );
  }
  for (const field of ["implementationRefs", "testRefs", "evidenceRefs"]) {
    if (!Array.isArray(requirement[field])) {
      addFailure("EVIDENCE_SHAPE", `${requirement.id}.${field} must be an array`);
      continue;
    }
    for (const reference of requirement[field]) {
      if (!isNonEmptyString(reference)) {
        addFailure("EVIDENCE_SHAPE", `${requirement.id}.${field} has an empty path`);
      } else {
        validateRepoReference(requirement.id, field, reference);
      }
    }
  }

  if (
    requirement.currentStatus !== "accepted" &&
    !isNonEmptyString(requirement.nextAction)
  ) {
    addFailure("NEXT_ACTION", `${requirement.id} needs a nextAction`);
  }

  if (requirement.currentStatus === "accepted") {
    for (const field of ["implementationRefs", "testRefs", "evidenceRefs"]) {
      if (!isNonEmptyStringArray(requirement[field])) {
        addFailure(
          "ACCEPTED_WITHOUT_EVIDENCE",
          `${requirement.id} is accepted without ${field}`,
        );
      }
    }
  }

  if (["in_progress", "partial", "conflict"].includes(requirement.currentStatus)) {
    if (!isNonEmptyStringArray(requirement.implementationRefs)) {
      addFailure(
        "STATUS_WITHOUT_IMPLEMENTATION",
        `${requirement.id} is ${requirement.currentStatus} without implementationRefs`,
      );
    }
  }
}

function validateRepoReference(requirementId, field, reference) {
  const normalized = normalizeRepoPath(reference);
  if (!normalized) {
    addFailure(
      "EVIDENCE_PATH",
      `${requirementId}.${field} contains an unsafe path: ${reference}`,
    );
    return;
  }
  const absolutePath = path.join(repoRoot, normalized);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    addFailure(
      "EVIDENCE_PATH",
      `${requirementId}.${field} does not exist: ${normalized}`,
    );
  }
}

function validateStatusSummary(summary, requirements, allowedStatuses) {
  if (!summary || typeof summary !== "object") {
    addFailure("STATUS_SUMMARY", "statusSummary is required");
    return;
  }
  const actual = Object.fromEntries(allowedStatuses.map((status) => [status, 0]));
  for (const requirement of requirements) {
    if (Object.hasOwn(actual, requirement?.currentStatus)) {
      actual[requirement.currentStatus] += 1;
    }
  }
  for (const status of allowedStatuses) {
    if (summary[status] !== actual[status]) {
      addFailure(
        "STATUS_SUMMARY",
        `${status} summary is ${summary[status]}, expected ${actual[status]}`,
      );
    }
  }
}

function validateDeliveryGates(gates, activeGateId, expectedRequirementIds) {
  if (!Array.isArray(gates) || gates.length === 0) {
    addFailure("DELIVERY_GATES", "deliveryGates must be a non-empty array");
    return;
  }
  const gateIds = gates.map((gate) => gate?.id);
  if (new Set(gateIds).size !== gateIds.length) {
    addFailure("DELIVERY_GATES", "delivery gate IDs must be unique");
  }
  const activeGates = gates.filter((gate) => gate?.status === "active");
  if (activeGates.length !== 1 || activeGates[0]?.id !== activeGateId) {
    addFailure(
      "ACTIVE_GATE",
      `exactly one active gate must match activeGate ${activeGateId}`,
    );
  }
  const assignedIds = gates.flatMap((gate) => gate?.requirementIds || []);
  validateExactIdSet("GATE_REQUIREMENTS", assignedIds, expectedRequirementIds);
}

function validateCorrectiveGate(gates, activeGateId, requirements) {
  const gateById = new Map(asArray(gates).map((gate) => [gate?.id, gate]));
  const expectedAssignments = new Map([
    ["G1", ["UX-03", "UX-04"]],
    ["G1.1", ["UX-05", "UX-06", "UX-13"]],
    ["G2", ["UX-07", "UX-08"]],
  ]);

  for (const [gateId, requirementIds] of expectedAssignments) {
    const gate = gateById.get(gateId);
    if (!gate) {
      addFailure("CORRECTIVE_GATE", `required delivery gate ${gateId} is missing`);
      continue;
    }
    validateExactIdSet(
      "CORRECTIVE_GATE",
      asArray(gate.requirementIds),
      requirementIds,
    );
  }

  const correctiveGate = gateById.get("G1.1");
  const reliableEditingGate = gateById.get("G2");
  const requirementById = new Map(
    asArray(requirements).map((requirement) => [requirement?.id, requirement]),
  );
  for (const id of ["UX-05", "UX-13"]) {
    const requirement = requirementById.get(id);
    if (
      requirement?.currentStatus === "accepted" &&
      !asArray(requirement.evidenceRefs).some((reference) =>
        normalizeRepoPath(reference)?.startsWith(
          "docs/content-workspace/evidence/g1.1-d005-",
        ),
      )
    ) {
      addFailure(
        "LATEST_CORRECTIVE_ACCEPTANCE",
        `${id} cannot be accepted without D005 evidence`,
      );
    }
  }
  if (
    activeGateId === "G1.1" &&
    (correctiveGate?.status !== "active" ||
      reliableEditingGate?.status !== "locked")
  ) {
    addFailure(
      "CORRECTIVE_GATE",
      "while G1.1 is active, G1.1 must be active and G2 must remain locked",
    );
  }
  if (
    activeGateId === "G2" &&
    (correctiveGate?.status !== "accepted" ||
      reliableEditingGate?.status !== "active")
  ) {
    addFailure(
      "CORRECTIVE_GATE",
      "G2 can be active only after G1.1 is accepted",
    );
  }
  if (activeGateId === "G2") {
    const correctiveRequirementIds = ["UX-05", "UX-06", "UX-13"];
    const incompleteIds = correctiveRequirementIds.filter(
      (id) => requirementById.get(id)?.currentStatus !== "accepted",
    );
    if (incompleteIds.length > 0) {
      addFailure(
        "CORRECTIVE_ACCEPTANCE",
        `G2 cannot resume before G1.1 acceptance: ${incompleteIds.join(", ")}`,
      );
    }
    const missingEvidenceIds = correctiveRequirementIds.filter(
      (id) =>
        !asArray(requirementById.get(id)?.evidenceRefs).some((reference) =>
          normalizeRepoPath(reference)?.startsWith(
            "docs/content-workspace/evidence/g1.1-",
          ),
        ),
    );
    if (missingEvidenceIds.length > 0) {
      addFailure(
        "CORRECTIVE_EVIDENCE",
        `G2 cannot resume without new G1.1 evidence: ${missingEvidenceIds.join(", ")}`,
      );
    }
    const latestCorrectionRequirementIds = D005_REQUIREMENT_IDS;
    const missingLatestEvidenceIds = latestCorrectionRequirementIds.filter(
      (id) =>
        !asArray(requirementById.get(id)?.evidenceRefs).some((reference) =>
          normalizeRepoPath(reference)?.startsWith(
            "docs/content-workspace/evidence/g1.1-d005-",
          ),
        ),
    );
    if (missingLatestEvidenceIds.length > 0) {
      addFailure(
        "LATEST_CORRECTIVE_EVIDENCE",
        `G2 cannot resume without D005 evidence: ${missingLatestEvidenceIds.join(", ")}`,
      );
    }
    for (const id of latestCorrectionRequirementIds) {
      const reportReference = asArray(
        requirementById.get(id)?.evidenceRefs,
      ).find((reference) => {
        const normalized = normalizeRepoPath(reference);
        return (
          normalized?.startsWith(
            "docs/content-workspace/evidence/g1.1-d005-",
          ) && normalized.endsWith(".md")
        );
      });
      if (!reportReference) {
        addFailure(
          "LATEST_CORRECTIVE_REPORT",
          `${id} needs a D005 markdown evidence report`,
        );
      } else {
        validateD005EvidenceReport(id, reportReference);
      }
    }
  }
}

function validateD005EvidenceReport(requirementId, reference) {
  const normalized = normalizeRepoPath(reference);
  if (!normalized) return;
  const absolutePath = path.join(repoRoot, normalized);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) return;
  const content = readFileSync(absolutePath, "utf8");
  const requiredMarkers = [
    "Result: accepted",
    "UX-05, UX-08, UX-13",
    "primary-action-count: 1",
    "historical-brief-source: source-not-recorded",
    "runtime: 3010/3011",
  ];
  const missingMarkers = requiredMarkers.filter(
    (marker) => !content.includes(marker),
  );
  if (missingMarkers.length > 0) {
    addFailure(
      "LATEST_CORRECTIVE_REPORT",
      `${requirementId} D005 report is incomplete: ${missingMarkers.join(", ")}`,
    );
  }
}

function validateDecisions(contractValue, decisionsValue) {
  if (decisionsValue.schemaVersion !== 1) {
    addFailure("DECISIONS_SCHEMA", "decisions schemaVersion must be 1");
  }
  if (!isNonEmptyString(decisionsValue.logFile)) {
    addFailure("DECISION_LOG", "decisions.logFile is required");
  } else if (decisionLogPathOverride) {
    if (
      !existsSync(decisionLogPathOverride) ||
      !statSync(decisionLogPathOverride).isFile()
    ) {
      addFailure(
        "DECISION_LOG",
        `decision log override does not exist: ${decisionLogPathOverride}`,
      );
    }
  } else {
    validateRepoReference("DECISIONS", "logFile", decisionsValue.logFile);
  }
  const requirementIds = new Set(
    asArray(contractValue.requirements).map((requirement) => requirement?.id),
  );
  const entries = Array.isArray(decisionsValue.entries)
    ? decisionsValue.entries
    : [];
  const seen = new Set();
  for (const entry of entries) {
    if (!/^CW-D\d{3}$/.test(entry?.id || "")) {
      addFailure("DECISION_ID", `invalid decision ID: ${entry?.id}`);
    }
    if (seen.has(entry?.id)) {
      addFailure("DECISION_ID", `duplicate decision ID: ${entry?.id}`);
    }
    seen.add(entry?.id);
    if (!["open", "accepted", "rejected"].includes(entry?.status)) {
      addFailure("DECISION_STATUS", `${entry?.id} has invalid status`);
    }
    if (!isNonEmptyStringArray(entry?.requirementIds)) {
      addFailure("DECISION_TRACE", `${entry?.id} needs requirementIds`);
    } else {
      for (const requirementId of entry.requirementIds) {
        if (!requirementIds.has(requirementId)) {
          addFailure(
            "DECISION_TRACE",
            `${entry.id} references unknown requirement ${requirementId}`,
          );
        }
      }
    }
    if (!isNonEmptyString(entry?.decision) || !isNonEmptyString(entry?.reason)) {
      addFailure("DECISION_SHAPE", `${entry?.id} needs decision and reason`);
    }
  }

  const correctiveDecision = entries.find((entry) => entry?.id === "CW-D004");
  if (
    correctiveDecision?.status !== "accepted" ||
    !sameStringSet(
      correctiveDecision?.requirementIds,
      ["UX-05", "UX-06", "UX-08", "UX-13"],
    )
  ) {
    addFailure(
      "CORRECTION_DECISION",
      "CW-D004 must remain accepted and trace UX-05, UX-06, UX-08 and UX-13",
    );
  }
  const latestCorrectiveDecision = entries.find(
    (entry) => entry?.id === "CW-D005",
  );
  if (
    latestCorrectiveDecision?.status !== "accepted" ||
    !sameStringSet(
      latestCorrectiveDecision?.requirementIds,
      D005_REQUIREMENT_IDS,
    ) ||
    latestCorrectiveDecision?.decision !== D005_DECISION ||
    latestCorrectiveDecision?.reason !== D005_REASON
  ) {
    addFailure(
      "LATEST_CORRECTION_DECISION",
      "CW-D005 must remain accepted and trace UX-05, UX-08 and UX-13",
    );
  }
  const normalizedLogPath = normalizeRepoPath(decisionsValue.logFile);
  const decisionLogPath = decisionLogPathOverride ||
    (normalizedLogPath ? path.join(repoRoot, normalizedLogPath) : null);
  if (
    decisionLogPath &&
    existsSync(decisionLogPath) &&
    statSync(decisionLogPath).isFile()
  ) {
    const decisionLog = readFileSync(decisionLogPath, "utf8");
    const searchableDecisionLog = decisionLog.replace(/\s+/g, " ");
    const requiredLogMarkers = [
      "## CW-D005 -",
      "- Status: Accepted",
      "- Requirements: UX-05, UX-08, UX-13",
      "- Reason:",
      "at most one primary action",
      "source was not recorded",
    ];
    const missingLogMarkers = requiredLogMarkers.filter(
      (marker) => !searchableDecisionLog.includes(marker),
    );
    if (missingLogMarkers.length > 0) {
      addFailure(
        "LATEST_CORRECTION_LOG",
        `CW-D005 decision log is incomplete: ${missingLogMarkers.join(", ")}`,
      );
    }
  }
}

function validateActiveWork(contractValue, activeWorkValue) {
  if (activeWorkValue.schemaVersion !== 1) {
    addFailure("ACTIVE_WORK_SCHEMA", "active work schemaVersion must be 1");
  }
  if (activeWorkValue.gate !== contractValue.activeGate) {
    addFailure(
      "ACTIVE_WORK_GATE",
      `active work gate ${activeWorkValue.gate} must match ${contractValue.activeGate}`,
    );
  }
  const activeGate = asArray(contractValue.deliveryGates).find(
    (gate) => gate.id === contractValue.activeGate,
  );
  const selectedIds = activeWorkValue.selectedRequirementIds;
  const deferredIds = activeWorkValue.deferredRequirementIds;
  if (!isNonEmptyStringArray(selectedIds)) {
    addFailure("ACTIVE_WORK_SCOPE", "selectedRequirementIds must not be empty");
  } else {
    const allowedIds = new Set(activeGate?.requirementIds || []);
    const requirementById = new Map(
      asArray(contractValue.requirements).map((requirement) => [
        requirement?.id,
        requirement,
      ]),
    );
    for (const requirementId of selectedIds) {
      if (!allowedIds.has(requirementId)) {
        addFailure(
          "ACTIVE_WORK_SCOPE",
          `${requirementId} is outside active gate ${contractValue.activeGate}`,
        );
      }
      if (requirementById.get(requirementId)?.currentStatus === "accepted") {
        addFailure(
          "ACTIVE_WORK_SCOPE",
          `${requirementId} is already accepted and must not be reimplemented silently`,
        );
      }
    }
  }
  if (!Array.isArray(deferredIds)) {
    addFailure("ACTIVE_WORK_SCOPE", "deferredRequirementIds must be an array");
  } else {
    validateExactIdSet(
      "ACTIVE_WORK_SCOPE",
      [...(selectedIds || []), ...deferredIds],
      activeGate?.requirementIds || [],
    );
    const selectedSet = new Set(selectedIds || []);
    for (const requirementId of deferredIds) {
      if (selectedSet.has(requirementId)) {
        addFailure(
          "ACTIVE_WORK_SCOPE",
          `${requirementId} cannot be both selected and deferred`,
        );
      }
    }
  }
  if (!isNonEmptyStringArray(activeWorkValue.allowedPathPrefixes)) {
    addFailure("ACTIVE_WORK_PATHS", "allowedPathPrefixes must not be empty");
  }
  if (!isNonEmptyStringArray(activeWorkValue.mustNotChange)) {
    addFailure("ACTIVE_WORK_BOUNDARY", "mustNotChange must not be empty");
  }
  if (!isNonEmptyStringArray(activeWorkValue.acceptance)) {
    addFailure("ACTIVE_WORK_ACCEPTANCE", "active work acceptance must not be empty");
  }
  for (const evidenceType of ["tests", "screenshots", "runtime", "report"]) {
    if (!isNonEmptyStringArray(activeWorkValue.requiredEvidence?.[evidenceType])) {
      addFailure(
        "ACTIVE_WORK_EVIDENCE",
        `requiredEvidence.${evidenceType} must not be empty`,
      );
    }
  }
  if (contractValue.activeGate === "G1.1") {
    if (activeWorkValue.id !== "CW-G1.1-D005-ACTION-PROVENANCE-CORRECTION") {
      addFailure(
        "D005_ACTIVE_WORK_ID",
        "G1.1 must use the frozen D005 active work item",
      );
    }
    validateExactIdSet(
      "D005_ACTIVE_WORK_PATHS",
      asArray(activeWorkValue.allowedPathPrefixes),
      D005_ALLOWED_PATH_PREFIXES,
    );
    validateExactIdSet(
      "D005_ACTIVE_WORK_SCOPE",
      asArray(activeWorkValue.selectedRequirementIds),
      ["UX-05", "UX-13"],
    );
    validateExactIdSet(
      "D005_ACTIVE_WORK_SCOPE",
      asArray(activeWorkValue.deferredRequirementIds),
      ["UX-06"],
    );
  }
}

function validateStatusEvidence(contractValue, decisionsValue) {
  const openDecisionRequirements = new Set(
    asArray(decisionsValue.entries)
      .filter((entry) => entry.status === "open")
      .flatMap((entry) => entry.requirementIds),
  );
  for (const requirement of asArray(contractValue.requirements)) {
    if (
      requirement.currentStatus === "decision_required" &&
      !openDecisionRequirements.has(requirement.id)
    ) {
      addFailure(
        "OPEN_DECISION_REQUIRED",
        `${requirement.id} needs an open decision entry`,
      );
    }
  }
}

function validateChangedFiles(
  contractValue,
  decisionsValue,
  activeWorkValue,
  filePath,
  previousContractPath,
) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    addFailure("CHANGED_FILES", `changed-files list does not exist: ${filePath}`);
    return;
  }
  const changedFiles = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((value) => normalizeRepoPath(value))
    .filter(Boolean);
  const allowedPrefixes = activeWorkValue.allowedPathPrefixes;
  for (const changedFile of changedFiles) {
    if (!allowedPrefixes.some((prefix) => matchesAllowedPath(changedFile, prefix))) {
      addFailure(
        "OUT_OF_SCOPE_CHANGE",
        `${changedFile} is outside active work item ${activeWorkValue.id}`,
      );
    }
  }

  const implementationChanged = changedFiles.some((file) =>
    [
      "frontend/src/app/(dashboard)/content/workspace/",
      "frontend/src/lib/api/content-workspace.ts",
      "frontend/src/lib/content-workspace-types.ts",
      "backend/prisma/schema.prisma",
      "backend/prisma/schema.sqlite.prisma",
      "backend/prisma/migrations/",
      "backend/src/modules/articles/",
    ].some((prefix) => matchesAllowedPath(file, prefix)),
  );
  if (implementationChanged) {
    const contractChanged = changedFiles.includes(
      "docs/content-workspace/contract.json",
    );
    const testChanged = changedFiles.some((file) =>
      /(?:\.test\.|\.spec\.|\/tests?\/)/.test(file),
    );
    if (!contractChanged) {
      addFailure(
        "IMPLEMENTATION_WITHOUT_CONTRACT",
        "workspace implementation changed without updating contract.json",
      );
    }
    if (!testChanged) {
      addFailure(
        "IMPLEMENTATION_WITHOUT_TEST",
        "workspace implementation changed without a test change",
      );
    }
  }

  if (changedFiles.includes("docs/content-workspace/contract.json")) {
    validateContractChangeDecision(
      contractValue,
      decisionsValue,
      changedFiles,
      previousContractPath,
    );
  }

  if (contractValue.activeGate !== activeWorkValue.gate) {
    addFailure("ACTIVE_GATE", "contract and active work gate diverged");
  }
}

function validateContractChangeDecision(
  contractValue,
  decisionsValue,
  changedFiles,
  previousContractPath,
) {
  if (!previousContractPath) return;
  const previousContract = readJson(previousContractPath, "BASE_CONTRACT_FILE");
  if (!previousContract) return;

  const baselineChanged =
    JSON.stringify(contractBaseline(previousContract)) !==
    JSON.stringify(contractBaseline(contractValue));
  if (
    baselineChanged &&
    !changedFiles.includes("docs/content-workspace/decisions.json")
  ) {
    addFailure(
      "CONTRACT_CHANGE_WITHOUT_DECISION",
      "requirements, acceptance criteria, source references, or gate assignments changed without decisions.json",
    );
  }

  if (previousContract.activeGate !== contractValue.activeGate) {
    const acceptedCorrectionRollback =
      previousContract.activeGate === "G2" &&
      contractValue.activeGate === "G1.1" &&
      changedFiles.includes("docs/content-workspace/decisions.json") &&
      hasAcceptedCorrectionDecision(decisionsValue);
    const previousGate = asArray(previousContract.deliveryGates).find(
      (gate) => gate.id === previousContract.activeGate,
    );
    const requirementById = new Map(
      asArray(contractValue.requirements).map((requirement) => [
        requirement?.id,
        requirement,
      ]),
    );
    const incompleteIds = (previousGate?.requirementIds || []).filter(
      (requirementId) =>
        requirementById.get(requirementId)?.currentStatus !== "accepted",
    );
    if (incompleteIds.length > 0 && !acceptedCorrectionRollback) {
      addFailure(
        "GATE_ADVANCE_WITHOUT_ACCEPTANCE",
        `cannot leave ${previousContract.activeGate}; requirements are not accepted: ${incompleteIds.join(", ")}`,
      );
    }
  }
}

function hasAcceptedCorrectionDecision(decisionsValue) {
  const entry = asArray(decisionsValue?.entries).find(
    (decision) => decision?.id === "CW-D005",
  );
  return (
    entry?.status === "accepted" &&
    sameStringSet(entry.requirementIds, D005_REQUIREMENT_IDS) &&
    entry?.decision === D005_DECISION &&
    entry?.reason === D005_REASON
  );
}

function contractBaseline(contractValue) {
  return {
    schemaVersion: contractValue.schemaVersion,
    contractId: contractValue.contractId,
    baselineDocuments: contractValue.baselineDocuments,
    statusPolicy: contractValue.statusPolicy,
    deliveryGates: asArray(contractValue.deliveryGates).map((gate) => ({
      id: gate.id,
      title: gate.title,
      requirementIds: gate.requirementIds,
    })),
    requirements: asArray(contractValue.requirements).map((requirement) => ({
      id: requirement.id,
      phase: requirement.phase,
      title: requirement.title,
      sourceRefs: requirement.sourceRefs,
      acceptance: requirement.acceptance,
    })),
  };
}

function readJson(filePath, rule) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    addFailure(rule, `required JSON file is missing: ${filePath}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    addFailure(rule, `cannot parse ${filePath}: ${error.message}`);
    return null;
  }
}

function validateExactIdSet(rule, actualValues, expectedValues) {
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    addFailure(
      rule,
      `expected [${expected.join(", ")}], received [${actual.join(", ")}]`,
    );
  }
}

function normalizeRepoPath(value) {
  if (!isNonEmptyString(value)) return null;
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return null;
  }
  return normalized;
}

function matchesAllowedPath(filePath, allowedPrefix) {
  const normalizedPrefix = normalizeRepoPath(allowedPrefix);
  if (!normalizedPrefix) return false;
  if (normalizedPrefix.endsWith("/") || normalizedPrefix.endsWith("-")) {
    return filePath.startsWith(normalizedPrefix);
  }
  return filePath === normalizedPrefix;
}

function resolvePath(value, fallback, baseDir) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function sameStringSet(actualValues, expectedValues) {
  if (!Array.isArray(actualValues) || !Array.isArray(expectedValues)) return false;
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildSummary(contractValue, decisionsValue, activeWorkValue) {
  const requirements = asArray(contractValue?.requirements);
  return {
    contractId: contractValue?.contractId || "unavailable",
    requirements: requirements.length,
    accepted: requirements.filter((item) => item.currentStatus === "accepted").length,
    activeGate: contractValue?.activeGate || "unavailable",
    activeWork: activeWorkValue?.id || "unavailable",
    openDecisions: asArray(decisionsValue?.entries).filter(
      (entry) => entry.status === "open",
    ).length,
  };
}

function printSummary(summary, output) {
  output(`- contract: ${summary.contractId}`);
  output(`- requirements: ${summary.requirements}`);
  output(`- accepted: ${summary.accepted}`);
  output(`- active gate: ${summary.activeGate}`);
  output(`- active work item: ${summary.activeWork}`);
  output(`- open decisions: ${summary.openDecisions}`);
}
