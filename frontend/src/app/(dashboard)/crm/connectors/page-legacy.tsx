"use client";

import React from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Spinner,
} from "@heroui/react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  DatabaseZap,
  Eye,
  FileCheck2,
  FileText,
  KeyRound,
  LockKeyhole,
  PlayCircle,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import toast from "@/lib/toast";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { getCrmAppState } from "@/lib/api/app-market";
import { api } from "@/lib/api/client";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";

type ChipColor = "default" | "primary" | "success" | "warning" | "danger";

interface FieldMapping {
  source: string;
  target: string;
  note?: string;
}

interface ConnectorSummary {
  key: string;
  name: string;
  vendor: string;
  readiness: string;
  contractOnly: boolean;
  dryRun: boolean;
  noWrite: boolean;
  noNetwork: boolean;
  noToken: boolean;
  writeTables: string[];
  requiredFutureGate: string;
  fieldMappings: FieldMapping[];
  boundaries: string[];
  nextGate: string;
  latestProof?: ConnectorProof | null;
  updatedAt?: string | null;
}

interface ConnectorProof {
  id?: string;
  connectorKey: string;
  connectorName: string;
  status: string;
  generatedAt?: string | null;
  contractVersion?: string;
  mode: string;
  dryRun: boolean;
  noWrite: boolean;
  writeTables: string[];
  requiredFutureGate: string;
  checksum?: string;
  auditId?: string;
  evidenceUrl?: string;
  summary?: string;
  fieldMappings: FieldMapping[];
  raw?: unknown;
}

interface HubSpotVaultStatus {
  connectorKey?: string;
  tokenState?: string;
  activeHandleCount?: number;
  latest?: {
    label?: string | null;
    status?: string | null;
    keyFingerprint?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  } | null;
  plaintextReturned?: boolean;
  encryptedSecretReturned?: boolean;
  warnings?: string[];
}

interface HubSpotReadOnlyObjectResult {
  object?: string;
  displayName?: string;
  returnedCount?: number;
  hasMore?: boolean;
  rows?: Array<{
    id?: string | null;
    properties?: Record<string, string | null>;
  }>;
}

interface HubSpotReadOnlyRunResult {
  status?: string;
  mode?: string;
  maxRowsPerObject?: number;
  objectResults?: HubSpotReadOnlyObjectResult[];
  rawPayloadReturned?: boolean;
  rawPayloadPersisted?: boolean;
  audit?: { id?: string; proofHash?: string };
}

const defaultConnectors: ConnectorSummary[] = [
  {
    key: "twenty",
    name: "Twenty",
    vendor: "开源客户管理",
    readiness: "contract-ready",
    contractOnly: true,
    dryRun: true,
    noWrite: true,
    noNetwork: true,
    noToken: true,
    writeTables: [],
    requiredFutureGate: "11G",
    nextGate: "第三方授权、客户数据隔离、人工确认",
    boundaries: ["no-network", "no-token", "no-write", "contract-only"],
    fieldMappings: [
      { source: "person.name", target: "crm.customers.displayName" },
      { source: "person.email", target: "crm.customers.email" },
      { source: "company.name", target: "crm.companies.name" },
      { source: "opportunity.stage", target: "crm.opportunities.stage" },
    ],
  },
  {
    key: "hubspot",
    name: "HubSpot",
    vendor: "客户管理服务",
    readiness: "contract-ready",
    contractOnly: true,
    dryRun: true,
    noWrite: true,
    noNetwork: true,
    noToken: true,
    writeTables: [],
    requiredFutureGate: "11G",
    nextGate: "只读授权、小范围读取、可撤销授权",
    boundaries: ["no-network", "no-token", "no-write", "contract-only"],
    fieldMappings: [
      {
        source: "contacts.firstname + lastname",
        target: "crm.customers.displayName",
      },
      { source: "contacts.email", target: "crm.customers.email" },
      { source: "companies.domain", target: "crm.companies.domain" },
      { source: "deals.pipeline", target: "crm.opportunities.stage" },
    ],
  },
  {
    key: "salesforce",
    name: "Salesforce",
    vendor: "企业客户管理",
    readiness: "contract-ready",
    contractOnly: true,
    dryRun: true,
    noWrite: true,
    noNetwork: true,
    noToken: true,
    writeTables: [],
    requiredFutureGate: "11G",
    nextGate: "授权应用、字段白名单、记录回放",
    boundaries: ["no-network", "no-token", "no-write", "contract-only"],
    fieldMappings: [
      { source: "Lead.Name", target: "crm.customers.displayName" },
      { source: "Lead.Company", target: "crm.companies.name" },
      { source: "Opportunity.Amount", target: "crm.opportunities.amountCents" },
      { source: "Task.Subject", target: "crm.tasks.title" },
    ],
  },
  {
    key: "feishu",
    name: "飞书",
    vendor: "多维表格",
    readiness: "contract-ready",
    contractOnly: true,
    dryRun: true,
    noWrite: true,
    noNetwork: true,
    noToken: true,
    writeTables: [],
    requiredFutureGate: "11G",
    nextGate: "应用权限、表格字段锁定、人工确认",
    boundaries: ["no-network", "no-token", "no-write", "contract-only"],
    fieldMappings: [
      { source: "record.fields.客户名", target: "crm.customers.displayName" },
      { source: "record.fields.公司", target: "crm.companies.name" },
      { source: "record.fields.跟进状态", target: "crm.customers.status" },
      { source: "record.fields.备注", target: "crm.notes.body" },
    ],
  },
  {
    key: "csv-excel",
    name: "CSV/Excel",
    vendor: "表格导入",
    readiness: "dry-run-ready",
    contractOnly: false,
    dryRun: true,
    noWrite: true,
    noNetwork: true,
    noToken: true,
    writeTables: [],
    requiredFutureGate: "11G",
    nextGate: "导入预览、字段确认、回退计划",
    boundaries: ["local-file", "dry-run", "no-write", "pii-preview", "quality-report"],
    fieldMappings: [
      { source: "name", target: "crm.customers.displayName" },
      { source: "phone", target: "crm.customers.phone" },
      { source: "company", target: "crm.companies.name" },
      { source: "note", target: "crm.notes.body" },
      { source: "客户名称", target: "crm.customers.displayName" },
      { source: "联系电话", target: "crm.customers.phone" },
      { source: "所属公司", target: "crm.companies.name" },
      { source: "最近跟进", target: "crm.timeline.content" },
    ],
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  source: Record<string, unknown>,
  keys: string[],
  fallback = "",
) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

function readBoolean(
  source: Record<string, unknown>,
  keys: string[],
  fallback = false,
) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") return value;
  }
  return fallback;
}

function readStringArray(
  source: Record<string, unknown>,
  keys: string[],
  fallback: string[] = [],
) {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          typeof item === "string" || typeof item === "number"
            ? String(item)
            : "",
        )
        .filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return fallback;
}

function normalizeMappings(
  value: unknown,
  fallback: FieldMapping[],
): FieldMapping[] {
  if (isRecord(value)) {
    const mappings: FieldMapping[] = [];
    for (const [targetGroup, rawSources] of Object.entries(value)) {
      const sources = Array.isArray(rawSources) ? rawSources : [rawSources];
      for (const source of sources) {
        if (typeof source !== "string" && typeof source !== "number") continue;
        const sourceField = String(source).trim();
        if (!sourceField) continue;
        mappings.push({
          source: sourceField,
          target: `crm.${targetGroup}`,
        });
      }
    }
    if (mappings.length) return mappings;
  }
  if (!Array.isArray(value)) return fallback;
  const mappings: FieldMapping[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const source = readString(item, ["source", "from", "sourceField"]);
    const target = readString(item, ["target", "to", "targetField"]);
    if (!source || !target) continue;
    const note = readString(item, ["note", "description"], "");
    mappings.push({
      source,
      target,
      ...(note ? { note } : {}),
    });
  }
  return mappings.length ? mappings : fallback;
}

function normalizeProof(
  value: unknown,
  connector: ConnectorSummary,
): ConnectorProof {
  const record = isRecord(value) ? value : {};
  const safety = isRecord(record.safetyBoundary)
    ? record.safetyBoundary
    : isRecord(record.safety)
      ? record.safety
      : {};
  return {
    id: readString(record, ["id", "proofId"], undefined),
    connectorKey: readString(record, ["connectorKey", "key"], connector.key),
    connectorName: readString(
      record,
      ["connectorName", "name"],
      connector.name,
    ),
    status: readString(record, ["status", "readiness"], "generated"),
    generatedAt: readString(
      record,
      ["generatedAt", "createdAt", "updatedAt"],
      "",
    ),
    contractVersion: readString(record, ["contractVersion", "version"], ""),
    mode: readString(
      record,
      ["mode", "runMode"],
      connector.contractOnly ? "contract-only" : "dry-run",
    ),
    dryRun: readBoolean(record, ["dryRun", "dry_run"], connector.dryRun),
    noWrite: readBoolean(
      record,
      ["noWrite", "no_write"],
      readBoolean(safety, ["noWrite", "no_write"], connector.noWrite),
    ),
    writeTables: readStringArray(
      record,
      ["writeTables", "write_tables"],
      readStringArray(safety, ["writeTables", "write_tables"], connector.writeTables),
    ),
    requiredFutureGate: readString(
      record,
      ["requiredFutureGate", "futureGate"],
      readString(safety, ["requiredFutureGate", "futureGate"], connector.requiredFutureGate),
    ),
    checksum: readString(record, ["checksum", "sha256"], ""),
    auditId: readString(record, ["auditId", "auditRecordId"], ""),
    evidenceUrl: readString(record, ["evidenceUrl", "proofUrl", "url"], ""),
    summary: readString(record, ["summary", "message"], ""),
    fieldMappings: normalizeMappings(
      record.fieldMappings ?? record.mappings ?? record.fieldMapping,
      connector.fieldMappings,
    ),
    raw: value,
  };
}

function normalizeConnector(
  value: unknown,
  fallback?: ConnectorSummary,
): ConnectorSummary | null {
  if (!isRecord(value) && !fallback) return null;
  const record = isRecord(value) ? value : {};
  const safety = isRecord(record.safetyBoundary)
    ? record.safetyBoundary
    : isRecord(record.safety)
      ? record.safety
      : {};
  const key = readString(
    record,
    ["key", "connectorKey", "id"],
    fallback?.key || "",
  );
  if (!key) return null;
  const proofConnector =
    fallback ||
    defaultConnectors.find((connector) => connector.key === key) ||
    defaultConnectors[0];
  const latestProof = isRecord(record.latestProof)
    ? normalizeProof(record.latestProof, proofConnector)
    : fallback?.latestProof;
  return {
    key,
    name: readString(
      record,
      ["name", "displayName", "connectorName"],
      fallback?.name || key,
    ),
    vendor: readString(
      record,
      ["vendor", "provider"],
      fallback?.vendor || "CRM connector",
    ),
    readiness: readString(
      record,
      ["readiness", "status"],
      fallback?.readiness || "contract-ready",
    ),
    contractOnly: readBoolean(
      record,
      ["contractOnly", "contract_only"],
      fallback?.contractOnly ?? true,
    ),
    dryRun: readBoolean(
      record,
      ["dryRun", "dry_run"],
      fallback?.dryRun ?? true,
    ),
    noWrite: readBoolean(
      record,
      ["noWrite", "no_write"],
      readBoolean(safety, ["noWrite", "no_write"], fallback?.noWrite ?? true),
    ),
    noNetwork: readBoolean(
      record,
      ["noNetwork", "no_network"],
      readBoolean(safety, ["noNetwork", "no_network"], fallback?.noNetwork ?? true),
    ),
    noToken: readBoolean(
      record,
      ["noToken", "no_token"],
      readBoolean(safety, ["noToken", "no_token"], fallback?.noToken ?? true),
    ),
    writeTables: readStringArray(
      record,
      ["writeTables", "write_tables"],
      readStringArray(safety, ["writeTables", "write_tables"], fallback?.writeTables || []),
    ),
    requiredFutureGate: readString(
      record,
      ["requiredFutureGate", "futureGate"],
      readString(safety, ["requiredFutureGate", "futureGate"], fallback?.requiredFutureGate || "11G"),
    ),
    fieldMappings: normalizeMappings(
      record.fieldMappings ?? record.mappings ?? record.fieldMapping,
      fallback?.fieldMappings || [],
    ),
    boundaries: readStringArray(
      record,
      ["boundaries", "safetyBoundaries"],
      [
        ...readStringArray(safety, ["notes"], []),
        ...(fallback?.boundaries || []),
      ],
    ),
    nextGate: readString(
      record,
      ["nextGate", "futureGateDescription"],
      fallback?.nextGate || "人工确认",
    ),
    latestProof,
    updatedAt: readString(
      record,
      ["updatedAt", "checkedAt"],
      fallback?.updatedAt || "",
    ),
  };
}

function extractConnectorArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    for (const key of ["connectors", "items", "readiness"]) {
      const candidate = value[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [];
}

function mergeConnectors(apiValue: unknown) {
  const byKey = new Map(
    defaultConnectors.map((connector) => [connector.key, connector]),
  );
  for (const item of extractConnectorArray(apiValue)) {
    const rawKey = isRecord(item)
      ? readString(item, ["key", "connectorKey", "id"])
      : "";
    const fallback = byKey.get(rawKey);
    const normalized = normalizeConnector(item, fallback);
    if (normalized) byKey.set(normalized.key, normalized);
  }
  return Array.from(byKey.values());
}

async function getCrmConnectorReadiness() {
  try {
    return await api.get<unknown>("/crm/connectors/readiness");
  } catch (firstError) {
    try {
      return await api.get<unknown>("/crm/connectors");
    } catch {
      throw firstError;
    }
  }
}

async function getCrmConnectorContractProof(connector: ConnectorSummary) {
  const key = encodeURIComponent(connector.key);
  const response = await api.get<unknown>(`/crm/connectors/${key}/contract`);
  return normalizeProof(response, connector);
}

async function createCrmConnectorContractProof(connector: ConnectorSummary) {
  const response = await api.post<unknown>("/crm/connectors/contract", {
    connectorKey: connector.key,
    includeProof: true,
    requestedBy: "crm-connectors-page",
  });
  return normalizeProof(response, connector);
}

async function getHubSpotVaultStatus() {
  return api.get<HubSpotVaultStatus>("/crm/connectors/hubspot/vault-status");
}

async function saveHubSpotVaultToken(input: {
  token: string;
  label?: string;
  portalId?: string;
}) {
  return api.post<HubSpotVaultStatus>("/crm/connectors/hubspot/vault-token", input);
}

async function runHubSpotReadOnlySandbox(input: {
  objects: string[];
  maxRowsPerObject: number;
}) {
  return api.post<HubSpotReadOnlyRunResult>(
    "/crm/connectors/hubspot/read-only-run",
    input,
  );
}

function buildLocalConnectorProof(connector: ConnectorSummary): ConnectorProof {
  return {
    connectorKey: connector.key,
    connectorName: connector.name,
    status: connector.readiness,
    generatedAt: new Date().toISOString(),
    contractVersion: "frontend-fallback",
    mode: connector.contractOnly ? "contract-only" : "dry-run",
    dryRun: connector.dryRun,
    noWrite: connector.noWrite,
    writeTables: connector.writeTables,
    requiredFutureGate: connector.requiredFutureGate,
    summary:
      "CRM 应用未安装，当前展示只读连接方案；不会连接第三方系统，也不会写入 CRM。",
    fieldMappings: connector.fieldMappings,
    raw: {
      source: "frontend-fallback",
      boundaries: connector.boundaries,
      nextGate: connector.nextGate,
    },
  };
}

function statusColor(readiness: string): ChipColor {
  if (readiness.includes("ready")) return "success";
  if (readiness.includes("blocked")) return "danger";
  if (readiness.includes("planned")) return "warning";
  return "primary";
}

function safetyColor(enabled: boolean): ChipColor {
  return enabled ? "success" : "warning";
}

function businessConnectorText(value: string) {
  return commercialDisplayText(
    String(value)
      .replace(/Connected App/gi, "授权应用")
      .replace(/rollback plan/gi, "回退计划")
      .replace(/MIGO preview/gi, "导入预览")
      .replace(/pii-preview/gi, "隐私预览")
      .replace(/quality-report/gi, "质量报告")
      .replace(/local-file/gi, "本机文件")
      .replace(/CRM_CONNECTOR_VAULT_KEY/gi, "专属安全保护")
      .replace(/keyFingerprint/gi, "安全标识")
      .replace(/Open-source/gi, "开源")
      .replace(/\bSaaS\b/gi, "云服务")
      .replace(/密钥/g, "授权信息")
      .replace(/审计/g, "记录")
      .replace(/contract-ready/gi, "连接方案已确认")
      .replace(/dry-run-ready/gi, "可安全检查")
      .replace(/contract-only/gi, "仅查看连接方案")
      .replace(/dry-run/gi, "仅检查")
      .replace(/no-network/gi, "第三方连接关闭")
      .replace(/no-token/gi, "第三方授权关闭")
      .replace(/no-write/gi, "写入关闭")
      .replace(/writeTables=\[\]/gi, "无写入")
      .replace(/writeTables/gi, "写入范围")
      .replace(/requiredFutureGate=11G/gi, "需要管理员确认")
      .replace(/required gate/gi, "后续确认")
      .replace(/Future gate/gi, "后续确认")
      .replace(/connector proof/gi, "连接记录")
      .replace(/connector readiness/gi, "连接状态")
      .replace(/\bproof\b/gi, "记录")
      .replace(/\bconnector\b/gi, "连接"),
  );
}

function displayConnectorStatus(value: string) {
  return businessConnectorText(value);
}

function displayBoundaryList(values: string[]) {
  return values.length ? values.map(businessConnectorText).join(" / ") : "写入关闭";
}

function displayHubSpotWarning(value?: string) {
  const text = String(value || "");
  if (
    /CRM_CONNECTOR_VAULT_KEY|本地派生密钥|生产部署|轮换/.test(text)
  ) {
    return "当前使用临时安全保护。正式使用前请完成专属安全保护配置。";
  }
  return businessConnectorText(text);
}

function displayFieldName(value: string) {
  return businessConnectorText(String(value))
    .replace(/^crm\.customers\./, "客户.")
    .replace(/^crm\.companies\./, "公司.")
    .replace(/^crm\.opportunities\./, "商机.")
    .replace(/^person\./, "联系人.")
    .replace(/^company\./, "公司.")
    .replace(/^opportunity\./, "商机.")
    .replace(/^contacts\./, "联系人.")
    .replace(/^companies\./, "公司.")
    .replace(/^deals\./, "商机.");
}

function formatDate(value?: string | null) {
  if (!value) return "尚未生成";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function ConnectorCard({
  connector,
  busy,
  selected,
  onProof,
}: {
  connector: ConnectorSummary;
  busy: boolean;
  selected: boolean;
  onProof: (connector: ConnectorSummary) => void;
}) {
  return (
    <Card
      className={
        "border bg-content1 shadow-sm " +
        (selected
          ? "border-primary/60 ring-1 ring-primary/30"
          : "border-default-200")
      }
    >
      <CardHeader className="flex flex-col items-start gap-3 p-4">
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
              {connector.contractOnly ? (
                <PlugZap size={20} />
              ) : (
                <FileText size={20} />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-[var(--kaypal-v3-ink)]">
                  {connector.name}
                </h2>
                <Chip
                  size="sm"
                  color={statusColor(connector.readiness)}
                  variant="flat"
                >
                  {displayConnectorStatus(connector.readiness)}
                </Chip>
              </div>
              <p className="mt-1 text-xs text-default-500">
                {connector.vendor}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            color="primary"
            variant={connector.latestProof ? "flat" : "solid"}
            isLoading={busy}
            startContent={
              !busy ? (
                connector.latestProof ? (
                  <Eye size={14} />
                ) : (
                  <FileCheck2 size={14} />
                )
              ) : null
            }
            onPress={() => onProof(connector)}
          >
            {connector.latestProof ? "查看记录" : "生成记录"}
          </Button>
        </div>
      </CardHeader>
      <Divider />
      <CardBody className="gap-4 p-4">
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3 xl:grid-cols-6">
          <Chip
            color={safetyColor(connector.contractOnly)}
            variant="flat"
            size="sm"
          >
            只读方案
          </Chip>
          <Chip color={safetyColor(connector.dryRun)} variant="flat" size="sm">
            仅检查
          </Chip>
          <Chip color={safetyColor(connector.noWrite)} variant="flat" size="sm">
            写入关闭
          </Chip>
          <Chip
            color={safetyColor(connector.noNetwork)}
            variant="flat"
            size="sm"
          >
            外部连接关闭
          </Chip>
          <Chip color={safetyColor(connector.noToken)} variant="flat" size="sm">
            第三方授权关闭
          </Chip>
          <Chip
            color={connector.writeTables.length === 0 ? "success" : "danger"}
            variant="flat"
            size="sm"
          >
            {connector.writeTables.length ? `写入 ${connector.writeTables.length} 项` : "无写入"}
          </Chip>
        </div>
        <div className="grid gap-3 text-xs text-default-600 md:grid-cols-2">
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
            <p className="font-semibold text-[var(--kaypal-v3-ink)]">
              安全边界
            </p>
            <p className="mt-1 leading-5">
              {displayBoundaryList(connector.boundaries)}
            </p>
          </div>
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
            <p className="font-semibold text-[var(--kaypal-v3-ink)]">
              后续确认
            </p>
            <p className="mt-1 leading-5">
              {businessConnectorText(`${connector.requiredFutureGate} · ${connector.nextGate}`)}
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {connector.fieldMappings.slice(0, 4).map((mapping) => (
            <div
              key={`${connector.key}-${mapping.source}-${mapping.target}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-default-200 px-3 py-2 text-xs"
            >
              <span className="font-medium text-default-700">
                {displayFieldName(mapping.source)}
              </span>
              <span className="text-default-400">-&gt;</span>
              <span className="font-medium text-[var(--kaypal-v3-ink)]">
                {displayFieldName(mapping.target)}
              </span>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function ProofPanel({ proof }: { proof: ConnectorProof | null }) {
  if (!proof) {
    return (
      <Card className="border border-dashed border-default-300 bg-content1 shadow-sm">
        <CardBody className="p-4">
          <FunctionalEmptyState
            actions={[
              { href: "/crm/import", label: "CRM 导入" },
              { href: "/crm", label: "CRM 客户" },
            ]}
            description="选择任一连接生成或查看连接记录。这里会展示只读检查、字段匹配、安全边界和留存编号。"
            examples={["只读检查", "字段匹配", "安全边界", "留存编号"]}
            icon={ClipboardCheck}
            surface="plain"
            title="等待连接记录"
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="border border-default-200 bg-content1 shadow-sm">
      <CardHeader className="flex flex-col items-start gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            color="success"
            variant="flat"
            startContent={<CheckCircle2 size={14} />}
          >
            {displayConnectorStatus(proof.status)}
          </Chip>
          <Chip color="primary" variant="flat">
            {businessConnectorText(proof.mode)}
          </Chip>
          <Chip color={proof.noWrite ? "success" : "danger"} variant="flat">
            写入关闭
          </Chip>
        </div>
        <div>
          <h2 className="text-base font-bold text-[var(--kaypal-v3-ink)]">
            {proof.connectorName} 连接记录
          </h2>
          <p className="mt-1 text-xs text-default-500">
            生成时间：{formatDate(proof.generatedAt)}
          </p>
        </div>
      </CardHeader>
      <Divider />
      <CardBody className="gap-4 p-4">
        <div className="grid gap-3 text-xs md:grid-cols-2">
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
            <p className="font-semibold text-[var(--kaypal-v3-ink)]">
              写入范围
            </p>
            <p className="mt-1 text-default-600">
              {proof.writeTables.length
                ? proof.writeTables.map(displayFieldName).join(" / ")
                : "无写入"}
            </p>
          </div>
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
            <p className="font-semibold text-[var(--kaypal-v3-ink)]">
              后续确认
            </p>
            <p className="mt-1 text-default-600">{businessConnectorText(proof.requiredFutureGate)}</p>
          </div>
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
            <p className="font-semibold text-[var(--kaypal-v3-ink)]">版本</p>
            <p className="mt-1 text-default-600">
              {proof.contractVersion || "-"}
            </p>
          </div>
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
            <p className="font-semibold text-[var(--kaypal-v3-ink)]">记录</p>
            <p className="mt-1 text-default-600">
              {proof.auditId || proof.checksum || "-"}
            </p>
          </div>
        </div>
        {proof.summary ? (
          <p className="rounded-[8px] bg-success/10 p-3 text-sm text-success-700">
            {businessConnectorText(proof.summary)}
          </p>
        ) : null}
        {proof.evidenceUrl ? (
          <Button
            as={Link}
            href={proof.evidenceUrl}
            target="_blank"
            rel="noreferrer"
            variant="flat"
            startContent={<FileCheck2 size={14} />}
          >
            打开记录
          </Button>
        ) : null}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-default-500">字段映射</p>
          {proof.fieldMappings.map((mapping) => (
            <div
              key={`${proof.connectorKey}-${mapping.source}-${mapping.target}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-default-200 px-3 py-2 text-xs"
            >
              <span>{displayFieldName(mapping.source)}</span>
              <span className="text-default-400">-&gt;</span>
              <span className="font-medium text-[var(--kaypal-v3-ink)]">
                {displayFieldName(mapping.target)}
              </span>
            </div>
          ))}
        </div>
        <p className="rounded-[8px] bg-default-100 p-3 text-xs leading-5 text-default-600">
          原始检查明细已保留在系统记录中，用户侧仅展示必要结论。
        </p>
      </CardBody>
    </Card>
  );
}

function hubspotObjectLabel(value: string) {
  if (value === "companies") return "公司";
  if (value === "contacts") return "联系人";
  if (value === "deals") return "交易";
  return value;
}

function HubSpotVaultPanel({
  enabled,
  status,
  result,
  token,
  label,
  portalId,
  rows,
  selectedObjects,
  busy,
  onTokenChange,
  onLabelChange,
  onPortalIdChange,
  onRowsChange,
  onToggleObject,
  onSave,
  onRun,
}: {
  enabled: boolean;
  status: HubSpotVaultStatus | null;
  result: HubSpotReadOnlyRunResult | null;
  token: string;
  label: string;
  portalId: string;
  rows: string;
  selectedObjects: string[];
  busy: "save" | "run" | "";
  onTokenChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onPortalIdChange: (value: string) => void;
  onRowsChange: (value: string) => void;
  onToggleObject: (value: string) => void;
  onSave: () => void;
  onRun: () => void;
}) {
  const active = status?.tokenState === "active";
  const objectOptions = ["companies", "contacts", "deals"];
  return (
    <Card className="border border-default-200 bg-content1 shadow-sm">
      <CardHeader className="flex flex-col items-start gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              color={active ? "success" : "warning"}
              variant="flat"
              startContent={<LockKeyhole size={14} />}
            >
              {active ? "HubSpot 安全库已接入" : "HubSpot 安全库未接入"}
            </Chip>
            <Chip color="success" variant="flat">
              只读检查环境
            </Chip>
            <Chip color="success" variant="flat">
              不写 CRM
            </Chip>
          </div>
          <h2 className="mt-3 text-base font-bold text-[var(--kaypal-v3-ink)]">
            HubSpot 只读检查接入
          </h2>
          <p className="mt-1 text-xs leading-5 text-default-500">
            授权信息只进入安全保护区；页面不回显原文。只读检查只拉取脱敏样本，不写入客户管理系统。
          </p>
        </div>
        <Button
          color="primary"
          variant="flat"
          isDisabled={!enabled || !active}
          isLoading={busy === "run"}
          startContent={busy === "run" ? null : <PlayCircle size={16} />}
          onPress={onRun}
        >
          执行只读检查
        </Button>
      </CardHeader>
      <Divider />
      <CardBody className="gap-4 p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
          <Input
            type="password"
            size="sm"
            label="HubSpot 授权信息"
            placeholder="粘贴只读检查授权信息"
            value={token}
            isDisabled={!enabled || busy !== ""}
            onValueChange={onTokenChange}
          />
          <Input
            size="sm"
            label="标签"
            placeholder="HubSpot 安全检查环境"
            value={label}
            isDisabled={!enabled || busy !== ""}
            onValueChange={onLabelChange}
          />
          <Input
            size="sm"
            label="空间编号"
            placeholder="可选"
            value={portalId}
            isDisabled={!enabled || busy !== ""}
            onValueChange={onPortalIdChange}
          />
          <Button
            className="self-end"
            color="primary"
            isDisabled={!enabled || !token.trim()}
            isLoading={busy === "save"}
            startContent={busy === "save" ? null : <KeyRound size={16} />}
            onPress={onSave}
          >
            安全保存
          </Button>
        </div>

        <div className="grid gap-3 text-xs lg:grid-cols-[1fr_auto]">
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
            <p className="font-semibold text-[var(--kaypal-v3-ink)]">
              当前安全库状态
            </p>
            <p className="mt-1 leading-5 text-default-600">
              {active
                ? `${status?.latest?.label || "HubSpot 安全检查环境"} · ${status?.latest?.keyFingerprint || "-"} · ${formatDate(status?.latest?.updatedAt || status?.latest?.createdAt)}`
                    : enabled
                  ? "尚未保存 HubSpot 只读检查授权信息"
                  : "CRM 未安装或连接服务不可用"}
            </p>
            {status?.warnings?.length ? (
              <p className="mt-2 text-warning-700">
                {displayHubSpotWarning(status.warnings[0])}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-[8px] border border-default-200 bg-default-50 p-3">
            <Input
              className="w-28"
              type="number"
              size="sm"
              min={1}
              max={10}
              label="每类条数"
              value={rows}
              isDisabled={!enabled || busy !== ""}
              onValueChange={onRowsChange}
            />
            {objectOptions.map((objectKey) => (
              <Button
                key={objectKey}
                size="sm"
                variant={selectedObjects.includes(objectKey) ? "solid" : "flat"}
                color={selectedObjects.includes(objectKey) ? "primary" : "default"}
                onPress={() => onToggleObject(objectKey)}
              >
                {hubspotObjectLabel(objectKey)}
              </Button>
            ))}
          </div>
        </div>

        {result ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {(result.objectResults || []).length ? (
              (result.objectResults || []).map((item) => (
                <div
                  key={item.object}
                  className="rounded-[8px] border border-default-200 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-[var(--kaypal-v3-ink)]">
                      {item.displayName || hubspotObjectLabel(item.object || "")}
                    </p>
                    <Chip size="sm" color="success" variant="flat">
                      {item.returnedCount || 0} 条
                    </Chip>
                  </div>
                  <div className="mt-2 space-y-2">
                    {(item.rows || []).slice(0, 3).map((row, index) => (
                      <div
                        key={`${item.object}-${row.id || index}`}
                        className="rounded-[8px] bg-default-50 p-2 text-default-600"
                      >
                        {Object.entries(row.properties || {})
                          .slice(0, 4)
                          .map(([key, value]) => (
                            <p key={key}>
                              {displayFieldName(`${item.object}.${key}`)}：{value || "-"}
                            </p>
                          ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="lg:col-span-3">
                <FunctionalEmptyState
                  description="只读检查已完成，但本次没有返回可展示的脱敏样本。可以减少筛选对象或检查 HubSpot 授权范围。"
                  examples={["脱敏样本", "授权范围", "只读检查", "不写入 CRM"]}
                  icon={Eye}
                  surface="plain"
                  title="本次没有只读检查结果"
                />
              </div>
            )}
          </div>
        ) : (
          <FunctionalEmptyState
            description="保存 HubSpot 只读检查授权后，可以执行一次安全检查。检查只读取脱敏样本，不写入客户管理系统。"
            examples={["安全保护区", "脱敏样本", "只读检查", "不写入 CRM"]}
            icon={Eye}
            surface="plain"
            title="尚未执行只读检查"
          />
        )}
      </CardBody>
    </Card>
  );
}

export default function CrmConnectorsPage() {
  const [connectors, setConnectors] =
    React.useState<ConnectorSummary[]>(defaultConnectors);
  const [selectedProof, setSelectedProof] =
    React.useState<ConnectorProof | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [apiMessage, setApiMessage] = React.useState("");
  const [busyKey, setBusyKey] = React.useState("");
  const [connectorApiEnabled, setConnectorApiEnabled] = React.useState(false);
  const [hubspotVaultStatus, setHubspotVaultStatus] =
    React.useState<HubSpotVaultStatus | null>(null);
  const [hubspotReadOnlyResult, setHubspotReadOnlyResult] =
    React.useState<HubSpotReadOnlyRunResult | null>(null);
  const [hubspotToken, setHubspotToken] = React.useState("");
  const [hubspotLabel, setHubspotLabel] = React.useState(
    "HubSpot 安全检查环境",
  );
  const [hubspotPortalId, setHubspotPortalId] = React.useState("");
  const [hubspotRows, setHubspotRows] = React.useState("3");
  const [hubspotObjects, setHubspotObjects] = React.useState<string[]>([
    "companies",
    "contacts",
    "deals",
  ]);
  const [hubspotBusy, setHubspotBusy] = React.useState<"save" | "run" | "">("");

  const refreshHubSpotVaultStatus = React.useCallback(async () => {
    try {
      const status = await getHubSpotVaultStatus();
      setHubspotVaultStatus(status);
    } catch {
      setHubspotVaultStatus(null);
    }
  }, []);

  const loadReadiness = React.useCallback(async () => {
    setLoading(true);
    setApiMessage("");
    try {
      const appState = await getCrmAppState();
      if (!appState.installed) {
        setConnectorApiEnabled(false);
        setConnectors(defaultConnectors);
        setApiMessage("CRM 客户管理未安装，当前展示只读连接方案。");
        return;
      }
      setConnectorApiEnabled(true);
      const response = await getCrmConnectorReadiness();
      setConnectors(mergeConnectors(response));
      await refreshHubSpotVaultStatus();
    } catch (error) {
      setConnectorApiEnabled(false);
      setConnectors(defaultConnectors);
      setHubspotVaultStatus(null);
      setApiMessage(
        toPublicError(
          error,
          "CRM 连接状态暂时无法检查，请稍后重试。",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [refreshHubSpotVaultStatus]);

  React.useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  const handleProof = async (connector: ConnectorSummary) => {
    if (!connectorApiEnabled) {
      const proof = buildLocalConnectorProof(connector);
      setSelectedProof(proof);
      setConnectors((current) =>
        current.map((item) =>
          item.key === connector.key
            ? { ...item, latestProof: proof, updatedAt: proof.generatedAt }
            : item,
        ),
      );
      setApiMessage(
        "CRM 客户管理未启用，当前仅生成只读连接方案，不访问受限客户数据。",
      );
      return;
    }

    setBusyKey(connector.key);
    try {
      const proof = connector.latestProof
        ? await getCrmConnectorContractProof(connector)
        : await createCrmConnectorContractProof(connector);
      setSelectedProof(proof);
      setConnectors((current) =>
        current.map((item) =>
          item.key === connector.key
            ? { ...item, latestProof: proof, updatedAt: proof.generatedAt }
            : item,
        ),
      );
      toast.success(`${connector.name} 连接记录已就绪`);
    } catch (error) {
      const message = toPublicError(
        error,
        "连接记录未能生成，请稍后重试。",
      );
      toast.error(message);
      setApiMessage(message);
    } finally {
      setBusyKey("");
    }
  };

  const handleToggleHubSpotObject = (objectKey: string) => {
    setHubspotObjects((current) => {
      if (current.includes(objectKey)) {
        const next = current.filter((item) => item !== objectKey);
        return next.length ? next : current;
      }
      return [...current, objectKey];
    });
  };

  const handleSaveHubSpotToken = async () => {
    if (!connectorApiEnabled) {
      toast.error("CRM 客户管理未启用，不能保存第三方授权");
      return;
    }
    if (!hubspotToken.trim()) {
      toast.error("先填写 HubSpot 只读检查授权信息");
      return;
    }
    setHubspotBusy("save");
    try {
      await saveHubSpotVaultToken({
        token: hubspotToken.trim(),
        label: hubspotLabel.trim() || "HubSpot 只读检查环境",
        portalId: hubspotPortalId.trim() || undefined,
      });
      setHubspotToken("");
      await refreshHubSpotVaultStatus();
      toast.success("HubSpot 授权信息已安全保存");
    } catch (error) {
      toast.error(
        toPublicError(
          error,
          "HubSpot 授权信息未能保存，请稍后重试。",
        ),
      );
    } finally {
      setHubspotBusy("");
    }
  };

  const handleRunHubSpotReadOnly = async () => {
    if (!connectorApiEnabled) {
      toast.error("CRM 客户管理未启用，不能执行只读检查");
      return;
    }
    setHubspotBusy("run");
    try {
      const result = await runHubSpotReadOnlySandbox({
        objects: hubspotObjects,
        maxRowsPerObject: Number(hubspotRows) || 3,
      });
      setHubspotReadOnlyResult(result);
      toast.success("HubSpot 只读检查完成");
    } catch (error) {
      toast.error(
        toPublicError(
          error,
          "HubSpot 连接检查未完成，请稍后重试。",
        ),
      );
    } finally {
      setHubspotBusy("");
    }
  };

  const contractReady = connectors.filter((connector) =>
    connector.readiness.includes("contract"),
  ).length;
  const dryRunReady = connectors.filter((connector) => connector.dryRun).length;
  const noWriteReady = connectors.filter(
    (connector) => connector.noWrite && connector.writeTables.length === 0,
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 pb-10">
      <header className="kaypal-v3-page-header flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Chip
              color="primary"
              variant="flat"
              startContent={<PlugZap size={14} />}
            >
              连接中心
            </Chip>
            <Chip
              color="success"
              variant="flat"
              startContent={<ShieldCheck size={14} />}
            >
              写入关闭
            </Chip>
            <Chip
              color="warning"
              variant="flat"
              startContent={<AlertTriangle size={14} />}
            >
              管理员确认
            </Chip>
          </div>
          <h1>CRM 连接</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-default-500">
            管理 Twenty、HubSpot、Salesforce、飞书、CSV 和表格导入的连接状态、字段匹配与安全边界。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="flat"
            startContent={loading ? null : <RefreshCw size={16} />}
            isLoading={loading}
            onPress={() => void loadReadiness()}
          >
            刷新
          </Button>
          <Button
            as={Link}
            href="/crm/import"
            variant="flat"
            startContent={<DatabaseZap size={16} />}
          >
            CRM 导入
          </Button>
          <Button
            as={Link}
            href="/crm"
            color="primary"
            variant="solid"
            startContent={<ClipboardCheck size={16} />}
          >
            CRM 客户
          </Button>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-[8px] border border-default-200 bg-content1 p-4 shadow-sm">
          <p className="text-xs text-default-500">连接方案已确认</p>
          <p className="mt-1 text-2xl font-bold text-[var(--kaypal-v3-ink)]">
            {contractReady}
          </p>
        </div>
        <div className="rounded-[8px] border border-default-200 bg-content1 p-4 shadow-sm">
          <p className="text-xs text-default-500">可安全检查</p>
          <p className="mt-1 text-2xl font-bold text-[var(--kaypal-v3-ink)]">
            {dryRunReady}
          </p>
        </div>
        <div className="rounded-[8px] border border-default-200 bg-content1 p-4 shadow-sm">
          <p className="text-xs text-default-500">写入关闭</p>
          <p className="mt-1 text-2xl font-bold text-[var(--kaypal-v3-ink)]">
            {noWriteReady}
          </p>
        </div>
        <div className="rounded-[8px] border border-default-200 bg-content1 p-4 shadow-sm">
          <p className="text-xs text-default-500">后续确认</p>
          <p className="mt-1 text-2xl font-bold text-[var(--kaypal-v3-ink)]">
            11G
          </p>
        </div>
      </section>

      {apiMessage ? (
        <div className="flex items-start gap-3 rounded-[8px] border border-warning/30 bg-warning/10 p-4 text-sm text-warning-700">
          <AlertTriangle className="mt-0.5 shrink-0" size={18} />
          <span>{apiMessage}</span>
        </div>
      ) : null}

      <HubSpotVaultPanel
        enabled={connectorApiEnabled}
        status={hubspotVaultStatus}
        result={hubspotReadOnlyResult}
        token={hubspotToken}
        label={hubspotLabel}
        portalId={hubspotPortalId}
        rows={hubspotRows}
        selectedObjects={hubspotObjects}
        busy={hubspotBusy}
        onTokenChange={setHubspotToken}
        onLabelChange={setHubspotLabel}
        onPortalIdChange={setHubspotPortalId}
        onRowsChange={setHubspotRows}
        onToggleObject={handleToggleHubSpotObject}
        onSave={() => void handleSaveHubSpotToken()}
        onRun={() => void handleRunHubSpotReadOnly()}
      />

      {loading ? (
        <div className="flex items-center justify-center rounded-[8px] border border-default-200 bg-content1 py-10">
          <Spinner label="正在加载连接状态..." />
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="grid gap-4">
            {connectors.map((connector) => (
              <ConnectorCard
                key={connector.key}
                connector={connector}
                busy={busyKey === connector.key}
                selected={selectedProof?.connectorKey === connector.key}
                onProof={(item) => void handleProof(item)}
              />
            ))}
          </div>
          <div className="xl:sticky xl:top-4 xl:self-start">
            <ProofPanel proof={selectedProof} />
          </div>
        </div>
      )}
    </div>
  );
}
