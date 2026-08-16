import { api } from "./client";

export interface CrmSummary {
  totalCustomers: number;
  activeCustomers: number;
  archivedCustomers: number;
  timelineEvents: number;
  totalCompanies: number;
  activeOpportunities: number;
  wonOpportunities: number;
  openTasks: number;
  overdueTasks: number;
  notes: number;
  pipelineAmountCents: number;
  wonAmountCents: number;
}

export interface CrmSourceAccount {
  id: string | null;
  name: string | null;
  platform: string;
}

export interface CrmCustomer {
  id: string;
  displayName: string;
  companyId: string | null;
  companyName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  wechat: string | null;
  status: string;
  sourcePlatform: string | null;
  sourceAccount: CrmSourceAccount | null;
  sourceKeyword: string | null;
  matchedKeyword: string | null;
  sourceUrl: string | null;
  sourceText: string | null;
  latestReply: string | null;
  score: number;
  tags: string[];
  profileUrl: string | null;
  externalUserId: string | null;
  dedupeKey: string | null;
  assignedUserId: string | null;
  firstInteractionTaskId: string | null;
  latestInteractionTaskId: string | null;
  metadata: Record<string, unknown> | null;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  timelineCount: number;
  taskCount: number;
  noteCount: number;
}

export interface CrmCompany {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  employees: number | null;
  annualRevenueCents: number;
  tags: string[];
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customerCount: number;
  opportunityCount: number;
  taskCount: number;
  noteCount: number;
}

export interface CrmOpportunity {
  id: string;
  name: string;
  stage: string;
  amountCents: number;
  currency: string;
  probability: number;
  companyId: string | null;
  companyName: string | null;
  primaryCustomerId: string | null;
  primaryCustomerName: string | null;
  closeDate: string | null;
  nextStep: string | null;
  competitor: string | null;
  source: string | null;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  noteCount: number;
  timelineCount: number;
}

export interface CrmTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  completedAt: string | null;
  assigneeId: string | null;
  companyId: string | null;
  companyName: string | null;
  customerId: string | null;
  customerName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmNote {
  id: string;
  body: string;
  createdBy: string | null;
  companyId: string | null;
  companyName: string | null;
  customerId: string | null;
  customerName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmTimelineEvent {
  id: string;
  customerId: string | null;
  companyId: string | null;
  opportunityId: string | null;
  taskId: string | null;
  noteId: string | null;
  eventType: string;
  channel: string | null;
  content: string | null;
  replyContent: string | null;
  status: string | null;
  failureReason: string | null;
  evidence: unknown;
  metadata: unknown;
  relatedInteractionTaskId: string | null;
  relatedRuntimeExecutionId: string | null;
  createdAt: string;
}

export interface CreateCrmCustomerInput {
  displayName: string;
  companyId?: string | null;
  companyName?: string;
  title?: string;
  email?: string;
  phone?: string;
  wechat?: string;
  status?: string;
  sourcePlatform?: string;
  sourceAccountId?: string;
  sourceAccountName?: string;
  sourceKeyword?: string;
  matchedKeyword?: string;
  sourceUrl?: string;
  sourceText?: string;
  latestReply?: string;
  score?: number;
  tags?: string[];
  profileUrl?: string;
  externalUserId?: string;
}

export type UpdateCrmCustomerInput = Partial<CreateCrmCustomerInput>;

export interface CrmCustomerContinuity {
  customer: CrmCustomer;
  tasks: CrmTask[];
  notes: CrmNote[];
  timeline: CrmTimelineEvent[];
}

export type CrmWelcomeMessageChannel = "douyin" | "wechat" | "wechat-channel";

export interface CrmWelcomeMessageTemplate {
  id: string;
  name: string;
  body: string;
  channel: CrmWelcomeMessageChannel;
  metadata: Record<string, unknown>;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmWelcomeMessageTemplateInput {
  name: string;
  body: string;
  channel?: CrmWelcomeMessageChannel;
}

export interface CrmWelcomeMessagePreparation {
  id: string;
  customerId: string;
  customerName: string;
  targetName: string;
  templateId: string | null;
  templateName: string | null;
  channel: CrmWelcomeMessageChannel;
  accountId: string | null;
  accountName: string | null;
  message: string;
  sourceText: string | null;
  sourceUrl: string | null;
  profileUrl: string | null;
  sendMode: "auto-send";
  status: "prepared" | (string & {});
  deliveryStatus: "not_sent";
  externalSendRequested: false;
  deliveryConfirmed: false;
  requiresExternalReadback: true;
  createdAt: string;
}

export interface PrepareCrmWelcomeMessageInput {
  templateId?: string;
  message?: string;
  channel?: CrmWelcomeMessageChannel;
  accountId?: string;
  accountName?: string;
}

export interface CrmCustomerConversationLink {
  customerId: string;
  preparationId: string;
  interactionTaskId: string;
  status: string;
  deliveryConfirmed: false;
  requiresExternalReadback: true;
}

export type CrmImportIssue =
  | string
  | {
      rowNumber?: number;
      field?: string;
      code?: string;
      message: string;
      severity?: "info" | "warning" | "error" | (string & {});
    };

export interface CrmImportPreviewRow {
  rowNumber: number;
  raw: unknown;
  normalized?: Record<string, unknown>;
  status: "preview" | "valid" | "invalid" | "duplicate" | (string & {});
  warnings: CrmImportIssue[];
  errors?: CrmImportIssue[];
  piiFlags?: string[];
}

export interface CrmImportPreviewRequest {
  filename?: string;
  sourceType?: string;
  rows?: unknown[];
  mapping?: Record<string, string>;
  hasHeader?: boolean;
  delimiter?: string;
}

export interface CrmImportDryRunRequest extends CrmImportPreviewRequest {
  proofLabel?: string;
  confirmationGate?: string;
  commit?: false;
}

export interface CrmImportCommitRequest extends CrmImportPreviewRequest {
  proofHash?: string;
  dryRunId?: string;
  confirmationGate: "MIGO_LOCAL_CRM_IMPORT_APPROVED" | (string & {});
  commit: true;
}

export interface CrmImportRollbackRequest {
  importCommitId: string;
  rollbackToken: string;
  customerIds: string[];
  reason?: string;
}

export interface CrmImportPreviewResponse {
  id: string;
  proofId?: string;
  ownerId?: string;
  filename: string;
  sourceType: string;
  status: "preview" | "dry-run" | "ready" | "blocked" | (string & {});
  rowCount: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  mapping: Record<string, string>;
  previewRows: CrmImportPreviewRow[];
  errors: CrmImportIssue[];
  warnings: CrmImportIssue[];
  piiFlags: string[];
  hash?: string;
  writeTables?: string[];
  requiredFutureGate?: string;
  createdAt: string;
}

export interface CrmImportDryRunResponse extends CrmImportPreviewResponse {
  status: "dry-run" | "preview" | "ready" | "blocked" | (string & {});
  proofId?: string;
  proof?: Record<string, unknown>;
  auditId?: string;
}

export interface CrmImportCommitResponse {
  id: string;
  ownerId?: string;
  filename: string;
  sourceType: string;
  status: "committed" | "blocked" | (string & {});
  mode: "local-crm-write" | (string & {});
  rowCount: number;
  committedCount: number;
  upsertedCount: number;
  skippedCount: number;
  duplicateCount: number;
  warningCount: number;
  mapping: Record<string, string>;
  results: Array<{
    rowNumber: number;
    status: "upserted" | "skipped" | (string & {});
    customerId?: string;
    displayName?: string;
    dedupeKey?: string;
    warnings: string[];
    message?: string;
  }>;
  externalWrites: unknown[];
  externalNetwork: boolean;
  externalCrmTouched: boolean;
  writeTables: string[];
  proof: {
    id: string;
    hash: string;
    hashAlgorithm: string;
    generatedAt: string;
    dryRunId?: string | null;
    dryRunProofHash?: string | null;
    gate: string;
    localWrite: boolean;
    externalWrite: boolean;
    customerIds: string[];
  };
  rollbackPlan: {
    importCommitId: string;
    rollbackToken: string;
    strategy: string;
    customerIds: string[];
    timelineEventTypes: string[];
  };
  audit: Record<string, unknown>;
  safety: Record<string, unknown>;
  createdAt: string;
}

export interface CrmImportRollbackResponse {
  id: string;
  importCommitId: string;
  status: "rolled_back" | "no_changes" | (string & {});
  strategy: "local-archive" | (string & {});
  archivedCount: number;
  skippedCount: number;
  externalNetwork: boolean;
  externalCrmTouched: boolean;
  writeTables: string[];
  results: Array<{
    customerId: string;
    displayName?: string;
    status:
      "archived" | "already_archived" | "not_found" | "blocked" | (string & {});
    message: string;
  }>;
  proof: {
    id: string;
    hash: string;
    hashAlgorithm: string;
    generatedAt: string;
    rollbackToken: string;
    localWrite: boolean;
    externalWrite: boolean;
  };
  audit: Record<string, unknown>;
}

export interface CrmImportBatch {
  id: string;
  ownerId: string;
  tenantId: string | null;
  sourceType: string;
  filename: string | null;
  status: string;
  mode: string;
  rowCount: number;
  committedCount: number;
  skippedCount: number;
  duplicateCount: number;
  warningCount: number;
  dryRunId: string | null;
  dryRunProofHash: string | null;
  commitProofHash: string;
  rollbackToken: string;
  rollbackProofHash: string | null;
  rollbackReason: string | null;
  mapping: unknown;
  qualityIssues: unknown;
  customerIds: unknown;
  writeTables: unknown;
  externalNetwork: boolean;
  externalCrmTouched: boolean;
  committedAt: string | null;
  rolledBackAt: string | null;
  metadata: unknown;
  auditEvents: Array<{
    id: string;
    eventType: string;
    action: string;
    status: string;
    proofHash: string | null;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface CrmAuditEvent {
  id: string;
  ownerId: string;
  tenantId: string | null;
  importBatchId: string | null;
  eventType: string;
  action: string;
  status: string;
  proofHash: string | null;
  externalNetwork: boolean;
  externalCrmTouched: boolean;
  writeTables: unknown;
  readTables: unknown;
  summary: string | null;
  payload: unknown;
  metadata: unknown;
  createdAt: string;
}

export type CrmCloserPriority = "low" | "medium" | "high" | (string & {});
export type CrmCloserRiskLevel = "low" | "medium" | "high" | (string & {});

export interface CrmCloserEvidenceRef {
  type:
    | "customer"
    | "company"
    | "opportunity"
    | "task"
    | "timeline"
    | "note"
    | (string & {});
  id?: string | null;
  label: string;
  detail?: string;
  href?: string;
  createdAt?: string;
}

export interface CrmCloserAdvice {
  id: string;
  title: string;
  customerId?: string | null;
  customerName?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  opportunityId?: string | null;
  opportunityName?: string | null;
  taskId?: string | null;
  priority: CrmCloserPriority;
  riskLevel: CrmCloserRiskLevel;
  reason: string;
  recommendedAction: string;
  suggestedScript: string;
  nextStep: string;
  riskPoints: string[];
  evidence: CrmCloserEvidenceRef[];
  dueAt?: string | null;
  channel?: string | null;
  status?: string;
  createdAt?: string;
}

export interface CrmCloserDailyReport {
  title: string;
  summary: string;
  newLeadCount: number;
  pendingFollowupCount: number;
  riskOpportunityCount: number;
  suggestedActionCount: number;
  highlights: string[];
  risks: string[];
  nextActions: string[];
}

export interface CrmCloserAdviceRequest {
  limit?: number;
  horizonDays?: number;
  customerIds?: string[];
  opportunityIds?: string[];
  includeDormant?: boolean;
  includeWonOpportunities?: boolean;
  style?: "consultative" | "direct" | "gentle" | (string & {});
}

export interface CrmCloserSummaryRequest {
  horizonDays?: number;
  includeDormant?: boolean;
}

export interface CrmCloserSummaryResponse {
  generatedAt: string;
  totalAdvice: number;
  highPriorityCount: number;
  dormantCustomerCount: number;
  overdueTaskCount: number;
  riskOpportunityCount: number;
  newLeadCount: number;
  pendingFollowupCount: number;
  summary: string;
  dailyReport?: CrmCloserDailyReport;
  nextActions: string[];
  disclaimer?: string;
}

export interface CrmCloserAdviceResponse {
  generatedAt: string;
  summary: CrmCloserSummaryResponse;
  advice: CrmCloserAdvice[];
  auditId?: string;
  warnings?: CrmImportIssue[];
}

export type CrmConnectorKey =
  | "csv"
  | "csv-excel"
  | "excel"
  | "excel_like"
  | "twenty"
  | "hubspot"
  | "salesforce"
  | "feishu"
  | "notion"
  | "airtable"
  | (string & {});
export type CrmConnectorStatus =
  | "contract-ready"
  | "dry-run-ready"
  | "not-configured"
  | "blocked"
  | "future"
  | (string & {});
export type CrmConnectorMode =
  | "contract-only"
  | "dry-run-only"
  | "read-only"
  | "write-gated"
  | (string & {});

export interface CrmConnectorSafetyBoundary {
  noNetwork: boolean;
  noToken: boolean;
  noWrite: boolean;
  writeTables: string[];
  requiredFutureGate: string;
  notes: string[];
}

export interface CrmConnectorReadinessItem {
  connectorKey: CrmConnectorKey;
  connectorName: string;
  status: CrmConnectorStatus;
  mode: CrmConnectorMode;
  summary: string;
  fieldMapping: Record<string, string | string[]>;
  fieldMappings?: Array<{ source: string; target: string; note?: string }>;
  safetyBoundary: CrmConnectorSafetyBoundary;
  warnings: CrmImportIssue[];
  nextActions: string[];
  updatedAt?: string;
}

export interface CrmConnectorReadinessResponse {
  generatedAt: string;
  ready: boolean;
  status: CrmConnectorStatus;
  summary: string;
  contractReady: boolean;
  dryRunReady: boolean;
  writeTables: string[];
  requiredFutureGate: string;
  connectors: CrmConnectorReadinessItem[];
  blockers: CrmImportIssue[];
  warnings: CrmImportIssue[];
  nextActions: string[];
}

export interface CrmConnectorContractRequest {
  connectorKey: CrmConnectorKey;
  sourceType?: string;
  includeProof?: boolean;
  requestedBy?: string;
}

export interface CrmConnectorContractResponse {
  id: string;
  connectorKey: CrmConnectorKey;
  connectorName: string;
  contractVersion: string;
  status: CrmConnectorStatus;
  mode: CrmConnectorMode;
  generatedAt: string;
  fieldMapping: Record<string, string | string[]>;
  fieldMappings?: Array<{ source: string; target: string; note?: string }>;
  readScopes: string[];
  writeTables: string[];
  requiredFutureGate: string;
  safetyBoundary: CrmConnectorSafetyBoundary;
  proof?: Record<string, unknown>;
  auditId?: string;
  warnings: CrmImportIssue[];
  nextActions: string[];
}

type CrmQueryValue = string | number | boolean | undefined | null;

function suffix(params: object) {
  const search = new URLSearchParams();
  Object.entries(params as Record<string, CrmQueryValue>).forEach(
    ([key, value]) => {
      if (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        value !== "all"
      ) {
        search.set(key, String(value));
      }
    },
  );
  return search.toString() ? `?${search.toString()}` : "";
}

export function getCrmSummary() {
  return api.get<CrmSummary>("/crm/summary");
}

export function listCrmCustomers(params: { q?: string; status?: string } = {}) {
  return api.get<CrmCustomer[]>(`/crm/customers${suffix(params)}`);
}

export function createCrmCustomer(input: CreateCrmCustomerInput) {
  return api.post<CrmCustomer>("/crm/customers", input);
}

export function getCrmCustomer(id: string) {
  return api.get<CrmCustomer>(`/crm/customers/${encodeURIComponent(id)}`);
}

export function getCrmCustomerContinuity(id: string) {
  return api.get<CrmCustomerContinuity>(
    `/crm/customers/${encodeURIComponent(id)}/continuity`,
  );
}

export function updateCrmCustomer(id: string, input: UpdateCrmCustomerInput) {
  return api.patch<CrmCustomer>(
    `/crm/customers/${encodeURIComponent(id)}`,
    input,
  );
}

export function archiveCrmCustomer(id: string) {
  return api.post<CrmCustomer>(`/crm/customers/${id}/archive`, {});
}

export function listCrmCompanies(params: { q?: string; status?: string } = {}) {
  return api.get<CrmCompany[]>(`/crm/companies${suffix(params)}`);
}

export function createCrmCompany(
  input: Partial<CrmCompany> & { name: string },
) {
  return api.post<CrmCompany>("/crm/companies", input);
}

export function archiveCrmCompany(id: string) {
  return api.post<CrmCompany>(`/crm/companies/${id}/archive`, {});
}

export function listCrmOpportunities(
  params: { q?: string; stage?: string } = {},
) {
  return api.get<CrmOpportunity[]>(`/crm/opportunities${suffix(params)}`);
}

export function createCrmOpportunity(input: {
  name: string;
  stage?: string;
  amountCents?: number;
  companyId?: string | null;
  companyName?: string;
  primaryCustomerId?: string | null;
  nextStep?: string;
  closeDate?: string;
}) {
  return api.post<CrmOpportunity>("/crm/opportunities", input);
}

export function getCrmOpportunity(id: string) {
  return api.get<CrmOpportunity>(`/crm/opportunities/${encodeURIComponent(id)}`);
}

export function updateCrmOpportunity(
  id: string,
  input: {
    name?: string;
    stage?: string;
    amountCents?: number;
    probability?: number;
    nextStep?: string;
    closeDate?: string;
    competitor?: string;
    winReason?: string;
    loseReason?: string;
  },
) {
  return api.patch<CrmOpportunity>(
    `/crm/opportunities/${encodeURIComponent(id)}`,
    input,
  );
}

export function archiveCrmOpportunity(id: string) {
  return api.post<CrmOpportunity>(`/crm/opportunities/${id}/archive`, {});
}

export function listCrmTasks(
  params: { q?: string; status?: string; customerId?: string } = {},
) {
  return api.get<CrmTask[]>(`/crm/tasks${suffix(params)}`);
}

export function createCrmTask(input: {
  title: string;
  description?: string;
  priority?: string;
  dueAt?: string;
  customerId?: string | null;
  opportunityId?: string | null;
  companyId?: string | null;
}) {
  return api.post<CrmTask>("/crm/tasks", input);
}

export function completeCrmTask(id: string) {
  return api.post<CrmTask>(`/crm/tasks/${id}/complete`, {});
}

export function archiveCrmTask(id: string) {
  return api.post<CrmTask>(`/crm/tasks/${id}/archive`, {});
}

export function listCrmNotes(params: { q?: string; customerId?: string } = {}) {
  return api.get<CrmNote[]>(`/crm/notes${suffix(params)}`);
}

export function createCrmNote(input: {
  body: string;
  companyId?: string | null;
  customerId?: string | null;
  opportunityId?: string | null;
}) {
  return api.post<CrmNote>("/crm/notes", input);
}

export function archiveCrmNote(id: string) {
  return api.post<CrmNote>(`/crm/notes/${id}/archive`, {});
}

export function getCrmTimeline(customerId: string) {
  return api.get<CrmTimelineEvent[]>(`/crm/customers/${customerId}/timeline`);
}

export function listCrmTimeline(
  params: {
    customerId?: string;
    companyId?: string;
    opportunityId?: string;
    taskId?: string;
    noteId?: string;
  } = {},
) {
  return api.get<CrmTimelineEvent[]>(`/crm/timeline${suffix(params)}`);
}

export function listCrmWelcomeMessageTemplates() {
  return api.get<CrmWelcomeMessageTemplate[]>("/crm/welcome-templates");
}

export function createCrmWelcomeMessageTemplate(
  input: CrmWelcomeMessageTemplateInput,
) {
  return api.post<CrmWelcomeMessageTemplate>("/crm/welcome-templates", input);
}

export function updateCrmWelcomeMessageTemplate(
  id: string,
  input: Partial<CrmWelcomeMessageTemplateInput>,
) {
  return api.patch<CrmWelcomeMessageTemplate>(
    `/crm/welcome-templates/${encodeURIComponent(id)}`,
    input,
  );
}

export function archiveCrmWelcomeMessageTemplate(id: string) {
  return api.post<CrmWelcomeMessageTemplate>(
    `/crm/welcome-templates/${encodeURIComponent(id)}/archive`,
    {},
  );
}

export function prepareCrmWelcomeMessage(
  customerId: string,
  input: PrepareCrmWelcomeMessageInput,
) {
  return api.post<CrmWelcomeMessagePreparation>(
    `/crm/customers/${encodeURIComponent(customerId)}/welcome-message/prepare`,
    input,
  );
}

export function getCrmWelcomeMessagePreparation(
  customerId: string,
  preparationId: string,
) {
  return api.get<CrmWelcomeMessagePreparation>(
    `/crm/customers/${encodeURIComponent(customerId)}/welcome-message/preparations/${encodeURIComponent(preparationId)}`,
  );
}

export function linkCrmCustomerConversation(
  customerId: string,
  input: { interactionTaskId: string; preparationId: string },
) {
  return api.post<CrmCustomerConversationLink>(
    `/crm/customers/${encodeURIComponent(customerId)}/conversations/link`,
    input,
  );
}

export function previewCrmImport(input: CrmImportPreviewRequest = {}) {
  return api.post<CrmImportPreviewResponse>("/crm/import/preview", input);
}

export function dryRunCrmImport(input: CrmImportDryRunRequest = {}) {
  return api.post<CrmImportDryRunResponse>("/crm/import/dry-run", input);
}

export function commitCrmImport(input: CrmImportCommitRequest) {
  return api.post<CrmImportCommitResponse>("/crm/import/commit", input);
}

export function rollbackCrmImport(input: CrmImportRollbackRequest) {
  return api.post<CrmImportRollbackResponse>("/crm/import/rollback", input);
}

export function listCrmImportBatches() {
  return api.get<CrmImportBatch[]>("/crm/import/batches");
}

export function listCrmAuditEvents(
  params: {
    importBatchId?: string;
    eventType?: string;
  } = {},
) {
  return api.get<CrmAuditEvent[]>(`/crm/audit/events${suffix(params)}`);
}

export function getCrmCloserSummary(params: CrmCloserSummaryRequest = {}) {
  return api.get<CrmCloserSummaryResponse>(
    `/crm/closer/summary${suffix(params)}`,
  );
}

export function generateCrmCloserAdvice(input: CrmCloserAdviceRequest = {}) {
  return api.post<CrmCloserAdviceResponse>("/crm/closer/advice", input);
}

export function getCrmCloserAdvice(input: CrmCloserAdviceRequest = {}) {
  return generateCrmCloserAdvice(input);
}

export function readCrmCloserAdvice(params: CrmCloserAdviceRequest = {}) {
  return generateCrmCloserAdvice(params);
}

export function getCrmConnectorReadiness() {
  return api.get<CrmConnectorReadinessResponse>("/crm/connectors/readiness");
}

export const getCrmConnectorsReadiness = getCrmConnectorReadiness;

export function createCrmConnectorContract(input: CrmConnectorContractRequest) {
  return api.post<CrmConnectorContractResponse>(
    "/crm/connectors/contract",
    input,
  );
}

export const generateCrmConnectorContract = createCrmConnectorContract;
