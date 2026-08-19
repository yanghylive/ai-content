/**
 * Unified desktop WeChat native command contract.
 *
 * This file intentionally describes the backend/runtime boundary without
 * importing the current script implementations. The runtime can later adapt
 * AppleScript, UIA, DB collectors, or a packaged native binary behind the same
 * request/response shape.
 */

export const WECHAT_NATIVE_COMMAND_CONTRACT_VERSION =
  '2026-06-26.wechat-native-v1';

export const WECHAT_NATIVE_COMMANDS = [
  'contacts',
  'group-broadcast',
  'contact-add',
  'friend-accept',
  'moments-publish',
  'moments-marketing',
  'chat-history',
  'auto-reply',
] as const;

export type WechatNativeCommandKey = (typeof WECHAT_NATIVE_COMMANDS)[number];

export type WechatNativeRuntimePlatform = 'darwin' | 'win32';

export type WechatNativeSendMode =
  'read-only' | 'draft-only' | 'approval' | 'auto-send';

export type WechatNativeRiskLevel = 'low' | 'medium' | 'high';

export type WechatNativeCommandStatus =
  'success' | 'partial' | 'blocked' | 'failed' | 'skipped';

export type WechatNativeErrorCode =
  | 'success'
  | 'runtime_unavailable'
  | 'unsupported_platform'
  | 'wechat_not_running'
  | 'wechat_not_logged_in'
  | 'permission_missing'
  | 'approval_required'
  | 'target_missing'
  | 'target_not_found'
  | 'target_ambiguous'
  | 'content_invalid'
  | 'media_missing'
  | 'captcha_required'
  | 'risk_prompt_detected'
  | 'rate_limited'
  | 'send_failed'
  | 'readback_failed'
  | 'platform_changed'
  | 'timeout'
  | 'cancelled'
  | 'unknown';

export type WechatNativeJsonSchemaType =
  'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export type WechatNativeJsonSchema = {
  type?: WechatNativeJsonSchemaType | readonly WechatNativeJsonSchemaType[];
  description?: string;
  required?: readonly string[];
  properties?: Readonly<Record<string, WechatNativeJsonSchema>>;
  items?: WechatNativeJsonSchema;
  enum?: readonly string[];
  additionalProperties?: boolean | WechatNativeJsonSchema;
  minimum?: number;
  maximum?: number;
};

export interface WechatNativeAccountRef {
  accountId?: string;
  accountName?: string;
  currentWechatId?: string;
  plannedWechatId?: string;
}

export interface WechatNativeRuntimeRef {
  platform?: WechatNativeRuntimePlatform;
  engine?: 'native-runtime' | 'agent-s' | 'script-adapter' | 'manual';
  engineVersion?: string;
  enginePath?: string;
  workingDirectory?: string;
}

export interface WechatNativeSafetyPolicy {
  sendMode: WechatNativeSendMode;
  riskLevel?: WechatNativeRiskLevel;
  dryRun?: boolean;
  requiresApproval?: boolean;
  approvalId?: string;
  operator?: string;
  targetLockRequired?: boolean;
  contentPreviewRequired?: boolean;
  readbackRequired?: boolean;
  stopOnRiskPrompt?: boolean;
}

export interface WechatNativeCommandContext {
  runId?: string;
  relatedId?: string;
  relatedType?: string;
  tenantId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  locale?: string;
  account?: WechatNativeAccountRef;
  runtime?: WechatNativeRuntimeRef;
  safety: WechatNativeSafetyPolicy;
  metadata?: Record<string, unknown>;
}

export interface WechatNativeContactRef {
  id?: string;
  wxid?: string;
  nickname?: string;
  remark?: string;
  displayName?: string;
  phone?: string;
  alias?: string;
  tags?: string[];
  source?: string;
  riskLabels?: string[];
  raw?: Record<string, unknown>;
}

export interface WechatNativeAssetRef {
  path: string;
  mimeType?: string;
  filename?: string;
  sizeBytes?: number;
  checksum?: string;
  role?: 'image' | 'video' | 'cover' | 'attachment';
}

export interface WechatNativeQuietHourWindow {
  start: string;
  end: string;
  timezone?: string;
}

export interface WechatNativeRateLimitPolicy {
  dailyLimit?: number;
  batchSize?: number;
  intervalMs?: number;
  maxFailures?: number;
  quietHours?: WechatNativeQuietHourWindow[];
}

export interface WechatNativeTextContent {
  text: string;
  attachments?: WechatNativeAssetRef[];
  templateId?: string;
  variables?: Record<string, string>;
}

export interface WechatNativeContactsInput {
  action: 'read-cache' | 'sync' | 'export';
  mode?: 'random' | 'all';
  sourcePriority?: Array<
    'native-runtime' | 'wechat-db' | 'uia' | 'ocr' | 'cache'
  >;
  limit?: number;
  includeTags?: boolean;
  includeDiagnostics?: boolean;
}

export interface WechatNativeGroupBroadcastInput {
  targets: WechatNativeContactRef[];
  message: WechatNativeTextContent;
  messages?: Array<{
    targetId?: string;
    targetName: string;
    message: WechatNativeTextContent;
  }>;
  rateLimit?: WechatNativeRateLimitPolicy;
  resumeFromTargetId?: string;
  dedupeKey?: string;
  allowGroupChats?: boolean;
  stopOnFailure?: boolean;
}

export interface WechatNativeContactAddTarget extends WechatNativeContactRef {
  searchText: string;
  verifyMessage?: string;
}

export interface WechatNativeContactAddInput {
  targets: WechatNativeContactAddTarget[];
  verifyMessage: string;
  remark?:
    | { strategy: 'none' }
    | { strategy: 'target-display-name' }
    | { strategy: 'fixed'; value: string }
    | { strategy: 'template'; template: string };
  tags?: string[];
  sourceCampaignId?: string;
  blacklistTags?: string[];
  rateLimit?: WechatNativeRateLimitPolicy;
}

export interface WechatNativeFriendAcceptInput {
  remark?: {
    strategy: 'request_name' | 'phone_wechat' | 'manual';
    value?: string;
  };
  welcomeMessage?: string;
  matchKeywords?: string[];
  dailyLimit?: number;
}

export interface WechatNativeMomentsPublishInput {
  content: {
    text: string;
    assets: WechatNativeAssetRef[];
    firstComment?: string;
    visibility?: 'public' | 'private' | 'partial';
    visibleTo?: WechatNativeContactRef[];
    hiddenFrom?: WechatNativeContactRef[];
    location?: string;
    publishAt?: string;
  };
  items?: Array<WechatNativeMomentsPublishInput['content'] & { id?: string }>;
}

export interface WechatNativeMomentTarget {
  id?: string;
  ordinal?: number;
  contact?: WechatNativeContactRef;
  momentText?: string;
  postedAt?: string;
  raw?: Record<string, unknown>;
}

export interface WechatNativeMomentsMarketingInput {
  mode: 'random' | 'targeted';
  actions: {
    browse?: boolean;
    like?: boolean;
    comment?: boolean;
  };
  contacts?: WechatNativeContactRef[];
  targets?: WechatNativeMomentTarget[];
  browseLimit?: number;
  dailyLimit?: number;
  comment?: {
    mode: 'none' | 'fixed' | 'ai' | 'per-target';
    fixedText?: string;
    prompt?: string;
    targetComments?: Array<{
      targetId?: string;
      targetName?: string;
      commentText: string;
    }>;
  };
  rateLimit?: WechatNativeRateLimitPolicy;
}

export interface WechatNativeChatHistoryInput {
  action: 'read-sessions' | 'read-messages' | 'sync';
  sessionId?: string;
  contact?: WechatNativeContactRef;
  limit?: number;
  since?: string;
  until?: string;
  keyword?: string;
  includeMedia?: boolean;
  directions?: Array<'incoming' | 'outgoing' | 'system' | 'unknown'>;
  contentTypes?: Array<'text' | 'image' | 'file' | 'system' | 'unknown'>;
}

export interface WechatNativeAutoReplyInput {
  action: 'read-latest' | 'draft' | 'send';
  target: WechatNativeContactRef;
  replyText?: string;
  sourceText?: string;
  sendMode?: WechatNativeSendMode;
  rateLimit?: WechatNativeRateLimitPolicy;
  dedupeKey?: string;
}

export interface WechatNativeAutoReplyOutput {
  ok: boolean;
  status: WechatNativeCommandStatus;
  errorCode?: WechatNativeErrorCode;
  readText?: string;
  sourceText?: string;
  replyText?: string;
  targetName?: string;
  sent?: boolean;
  drafted?: boolean;
  screenshotPath?: string;
  message?: string;
  readback?: { matched?: boolean; expectedText?: string; actualText?: string };
  evidence?: WechatNativeEvidenceRef[];
  diagnostics?: Record<string, unknown>;
}

export interface WechatNativeContact {
  wxid: string;
  nickname?: string;
  remark?: string;
  displayName: string;
  tags: string[];
  currentWechatId?: string;
  plannedWechatId?: string;
  syncedAt?: string;
  raw?: Record<string, unknown>;
}

export interface WechatNativeEvidenceRef {
  type:
    | 'screenshot'
    | 'text'
    | 'readback'
    | 'diagnostic-bundle'
    | 'action-log'
    | 'trace'
    | 'file';
  label: string;
  value?: string;
  path?: string;
  url?: string;
  createdAt: string;
  trusted?: boolean;
  raw?: Record<string, unknown>;
}

export interface WechatNativeReadback {
  expectedText?: string;
  actualText?: string;
  matched: boolean;
  targetName?: string;
  capturedAt?: string;
}

export interface WechatNativeTargetResult {
  targetId?: string;
  targetName?: string;
  action:
    | 'read'
    | 'draft'
    | 'send'
    | 'add-contact'
    | 'accept-contact'
    | 'publish'
    | 'browse'
    | 'like'
    | 'comment';
  ok: boolean;
  status:
    | 'read'
    | 'draft_filled'
    | 'sent'
    | 'request_submitted'
    | 'published'
    | 'browsed'
    | 'liked'
    | 'commented'
    | 'skipped'
    | 'blocked'
    | 'failed';
  message: string;
  errorCode?: WechatNativeErrorCode;
  evidence?: WechatNativeEvidenceRef[];
  readback?: WechatNativeReadback;
  raw?: Record<string, unknown>;
}

export interface WechatNativeBatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  blocked: number;
  skipped: number;
}

export interface WechatNativeContactsOutput {
  source: 'empty' | 'cache' | 'native-runtime' | 'wechat-db' | 'uia' | 'ocr';
  contacts: WechatNativeContact[];
  count: number;
  currentWechatId?: string;
  plannedWechatId?: string;
  syncedAt?: string;
  exportedContent?: string;
}

export interface WechatNativeBatchOutput {
  summary: WechatNativeBatchSummary;
  results: WechatNativeTargetResult[];
}

export interface WechatNativeMomentsPublishOutput {
  status: 'draft_filled' | 'published' | 'blocked' | 'failed';
  momentId?: string;
  contentText: string;
  assetPaths: string[];
  evidence: WechatNativeEvidenceRef[];
  readback?: WechatNativeReadback;
}

export interface WechatNativeChatSession {
  id: string;
  title: string;
  contactName?: string;
  unreadCount: number;
  lastMessage?: string;
  lastMessageAt?: string;
  source: 'cache' | 'native-runtime' | 'wechat-db' | 'ocr' | 'manual';
  raw?: Record<string, unknown>;
}

export interface WechatNativeChatMessage {
  id: string;
  sessionId: string;
  senderName?: string;
  direction: 'incoming' | 'outgoing' | 'system' | 'unknown';
  content: string;
  contentType: 'text' | 'image' | 'file' | 'system' | 'unknown';
  sentAt?: string;
  source: 'cache' | 'native-runtime' | 'wechat-db' | 'ocr' | 'manual';
  raw?: Record<string, unknown>;
}

export interface WechatNativeChatHistoryOutput {
  source: 'empty' | 'cache' | 'native-runtime' | 'wechat-db' | 'ocr' | 'manual';
  sessions: WechatNativeChatSession[];
  messages: WechatNativeChatMessage[];
  sessionId?: string;
  count: number;
  syncedAt?: string;
}

export type WechatNativeCommandInputByKey = {
  contacts: WechatNativeContactsInput;
  'group-broadcast': WechatNativeGroupBroadcastInput;
  'contact-add': WechatNativeContactAddInput;
  'friend-accept': WechatNativeFriendAcceptInput;
  'moments-publish': WechatNativeMomentsPublishInput;
  'moments-marketing': WechatNativeMomentsMarketingInput;
  'chat-history': WechatNativeChatHistoryInput;
  'auto-reply': WechatNativeAutoReplyInput;
};

export type WechatNativeCommandOutputByKey = {
  contacts: WechatNativeContactsOutput;
  'group-broadcast': WechatNativeBatchOutput;
  'contact-add': WechatNativeBatchOutput;
  'friend-accept': WechatNativeBatchOutput;
  'moments-publish': WechatNativeMomentsPublishOutput;
  'moments-marketing': WechatNativeBatchOutput;
  'chat-history': WechatNativeChatHistoryOutput;
  'auto-reply': WechatNativeAutoReplyOutput;
};

export interface WechatNativeCommandError {
  code: WechatNativeErrorCode;
  category:
    | 'runtime'
    | 'permission'
    | 'login'
    | 'target'
    | 'content'
    | 'risk'
    | 'readback'
    | 'unknown';
  message: string;
  technicalMessage?: string;
  stage?: string;
  target?: string;
  retryable: boolean;
  manualActionRequired?: boolean;
  nextAction?: string;
  raw?: Record<string, unknown>;
}

export interface WechatNativeRuntimeDiagnostics {
  engine?: string;
  engineVersion?: string;
  enginePath?: string;
  nativeRuntimeVersion?: string;
  platform?: WechatNativeRuntimePlatform;
  processName?: string;
  processId?: number;
  appVersion?: string;
  attemptedSources?: string[];
}

export interface WechatNativeWindowDiagnostics {
  title?: string;
  bundleId?: string;
  processName?: string;
  rect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  frontmost?: boolean;
}

export interface WechatNativeCommandDiagnostics {
  command: WechatNativeCommandKey;
  stage: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  runtime?: WechatNativeRuntimeDiagnostics;
  window?: WechatNativeWindowDiagnostics;
  permissions?: Array<{
    key: string;
    status: 'ready' | 'warning' | 'blocked';
    message: string;
  }>;
  evidence?: WechatNativeEvidenceRef[];
  readback?: WechatNativeReadback;
  warnings?: string[];
  legacyMetadata?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface WechatNativeContactsDiagnostics extends WechatNativeCommandDiagnostics {
  command: 'contacts';
  contacts?: {
    pagesScanned?: number;
    uiaContactCount?: number;
    ocrContactCount?: number;
    dbContactCount?: number;
    rawTextCount?: number;
    dbKeyStatus?: string;
    dbPaths?: string[];
    pollutionRejected?: boolean;
  };
}

export interface WechatNativeBatchDiagnostics extends WechatNativeCommandDiagnostics {
  command:
    'group-broadcast' | 'contact-add' | 'friend-accept' | 'moments-marketing';
  batch?: {
    requestedTargets: number;
    attemptedTargets: number;
    succeededTargets: number;
    failedTargets: number;
    blockedTargets: number;
    lastTarget?: string;
    rateLimited?: boolean;
  };
}

export interface WechatNativeMomentsPublishDiagnostics extends WechatNativeCommandDiagnostics {
  command: 'moments-publish';
  momentsPublish?: {
    assetCount: number;
    assetPaths: string[];
    publishButtonDetected?: boolean;
    publishResultDetected?: boolean;
  };
}

export interface WechatNativeChatHistoryDiagnostics extends WechatNativeCommandDiagnostics {
  command: 'chat-history';
  chatHistory?: {
    sessionsScanned?: number;
    messagesScanned?: number;
    sessionId?: string;
    source?: string;
    cachePath?: string;
  };
}

export interface WechatNativeAutoReplyDiagnostics extends WechatNativeCommandDiagnostics {
  command: 'auto-reply';
  autoReply?: {
    action?: string;
    targetName?: string;
    sourceText?: string;
    replyText?: string;
    sent?: boolean;
    screenshotPath?: string;
  };
}

export type WechatNativeDiagnosticsByKey = {
  contacts: WechatNativeContactsDiagnostics;
  'group-broadcast': WechatNativeBatchDiagnostics;
  'contact-add': WechatNativeBatchDiagnostics;
  'friend-accept': WechatNativeBatchDiagnostics;
  'moments-publish': WechatNativeMomentsPublishDiagnostics;
  'moments-marketing': WechatNativeBatchDiagnostics;
  'chat-history': WechatNativeChatHistoryDiagnostics;
  'auto-reply': WechatNativeAutoReplyDiagnostics;
};

export interface WechatNativeCommandRequest<
  K extends WechatNativeCommandKey = WechatNativeCommandKey,
> {
  contractVersion: string;
  command: K;
  input: WechatNativeCommandInputByKey[K];
  context: WechatNativeCommandContext;
}

export interface WechatNativeCommandResponse<
  K extends WechatNativeCommandKey = WechatNativeCommandKey,
> {
  contractVersion: string;
  command: K;
  ok: boolean;
  status: WechatNativeCommandStatus;
  output?: WechatNativeCommandOutputByKey[K];
  diagnostics: WechatNativeDiagnosticsByKey[K];
  error?: WechatNativeCommandError;
}

export interface WechatNativeRunnerCapability {
  command: WechatNativeCommandKey;
  available: boolean;
  mode: 'native-runtime' | 'agent-s-adapter' | 'script-adapter' | 'manual';
  supportsAutoSend: boolean;
  supportsReadback: boolean;
  supportedPlatforms: WechatNativeRuntimePlatform[];
  message: string;
  blockers?: string[];
  warnings?: string[];
}

export interface WechatNativeCommandRunner {
  readonly runnerId: string;
  readonly contractVersion: string;
  readonly supportedCommands: readonly WechatNativeCommandKey[];
  getCapabilities?(): Promise<WechatNativeRunnerCapability[]>;
  canRun?(
    command: WechatNativeCommandKey,
    context?: WechatNativeCommandContext,
  ): Promise<WechatNativeRunnerCapability>;
  run<K extends WechatNativeCommandKey>(
    request: WechatNativeCommandRequest<K>,
  ): Promise<WechatNativeCommandResponse<K>>;
}

export interface WechatNativeCommandDefinition<
  K extends WechatNativeCommandKey = WechatNativeCommandKey,
> {
  key: K;
  title: string;
  taskTypes: readonly string[];
  legacySkillIds: readonly string[];
  legacyMetadataKeys: readonly string[];
  defaultSendMode: WechatNativeSendMode;
  supportsAutoSend: boolean;
  requiresTargetReadback: boolean;
  schema: {
    input: WechatNativeJsonSchema;
    output: WechatNativeJsonSchema;
    diagnostics: WechatNativeJsonSchema;
    error: WechatNativeJsonSchema;
  };
}

const stringSchema: WechatNativeJsonSchema = { type: 'string' };
const numberSchema: WechatNativeJsonSchema = { type: 'number' };
const integerSchema: WechatNativeJsonSchema = { type: 'integer' };
const booleanSchema: WechatNativeJsonSchema = { type: 'boolean' };
const stringArraySchema: WechatNativeJsonSchema = {
  type: 'array',
  items: stringSchema,
};

function objectSchema(
  properties: Record<string, WechatNativeJsonSchema>,
  required: readonly string[] = [],
  additionalProperties: boolean | WechatNativeJsonSchema = false,
): WechatNativeJsonSchema {
  return {
    type: 'object',
    required,
    properties,
    additionalProperties,
  };
}

function arraySchema(items: WechatNativeJsonSchema): WechatNativeJsonSchema {
  return {
    type: 'array',
    items,
  };
}

function enumSchema(values: readonly string[]): WechatNativeJsonSchema {
  return {
    type: 'string',
    enum: values,
  };
}

const contactRefSchema = objectSchema(
  {
    id: stringSchema,
    wxid: stringSchema,
    nickname: stringSchema,
    remark: stringSchema,
    displayName: stringSchema,
    phone: stringSchema,
    alias: stringSchema,
    tags: stringArraySchema,
    source: stringSchema,
    riskLabels: stringArraySchema,
    raw: objectSchema({}, [], true),
  },
  [],
  true,
);

const assetRefSchema = objectSchema(
  {
    path: stringSchema,
    mimeType: stringSchema,
    filename: stringSchema,
    sizeBytes: integerSchema,
    checksum: stringSchema,
    role: enumSchema(['image', 'video', 'cover', 'attachment']),
  },
  ['path'],
);

const rateLimitSchema = objectSchema({
  dailyLimit: integerSchema,
  batchSize: integerSchema,
  intervalMs: integerSchema,
  maxFailures: integerSchema,
  quietHours: arraySchema(
    objectSchema(
      {
        start: stringSchema,
        end: stringSchema,
        timezone: stringSchema,
      },
      ['start', 'end'],
    ),
  ),
});

const textContentSchema = objectSchema(
  {
    text: stringSchema,
    attachments: arraySchema(assetRefSchema),
    templateId: stringSchema,
    variables: objectSchema({}, [], { type: 'string' }),
  },
  ['text'],
);

const evidenceSchema = objectSchema(
  {
    type: enumSchema([
      'screenshot',
      'text',
      'readback',
      'diagnostic-bundle',
      'action-log',
      'trace',
      'file',
    ]),
    label: stringSchema,
    value: stringSchema,
    path: stringSchema,
    url: stringSchema,
    createdAt: stringSchema,
    trusted: booleanSchema,
    raw: objectSchema({}, [], true),
  },
  ['type', 'label', 'createdAt'],
);

const readbackSchema = objectSchema(
  {
    expectedText: stringSchema,
    actualText: stringSchema,
    matched: booleanSchema,
    targetName: stringSchema,
    capturedAt: stringSchema,
  },
  ['matched'],
);

const commandErrorSchema = objectSchema(
  {
    code: enumSchema([
      'success',
      'runtime_unavailable',
      'unsupported_platform',
      'wechat_not_running',
      'wechat_not_logged_in',
      'permission_missing',
      'approval_required',
      'target_missing',
      'target_not_found',
      'target_ambiguous',
      'content_invalid',
      'media_missing',
      'captcha_required',
      'risk_prompt_detected',
      'rate_limited',
      'send_failed',
      'readback_failed',
      'platform_changed',
      'timeout',
      'cancelled',
      'unknown',
    ]),
    category: enumSchema([
      'runtime',
      'permission',
      'login',
      'target',
      'content',
      'risk',
      'readback',
      'unknown',
    ]),
    message: stringSchema,
    technicalMessage: stringSchema,
    stage: stringSchema,
    target: stringSchema,
    retryable: booleanSchema,
    manualActionRequired: booleanSchema,
    nextAction: stringSchema,
    raw: objectSchema({}, [], true),
  },
  ['code', 'category', 'message', 'retryable'],
);

const diagnosticsSchema = objectSchema(
  {
    command: enumSchema(WECHAT_NATIVE_COMMANDS),
    stage: stringSchema,
    startedAt: stringSchema,
    completedAt: stringSchema,
    durationMs: numberSchema,
    runtime: objectSchema({}, [], true),
    window: objectSchema({}, [], true),
    permissions: arraySchema(
      objectSchema(
        {
          key: stringSchema,
          status: enumSchema(['ready', 'warning', 'blocked']),
          message: stringSchema,
        },
        ['key', 'status', 'message'],
      ),
    ),
    evidence: arraySchema(evidenceSchema),
    readback: readbackSchema,
    warnings: stringArraySchema,
    legacyMetadata: objectSchema({}, [], true),
    raw: objectSchema({}, [], true),
  },
  ['command', 'stage'],
  true,
);

const targetResultSchema = objectSchema(
  {
    targetId: stringSchema,
    targetName: stringSchema,
    action: enumSchema([
      'read',
      'draft',
      'send',
      'add-contact',
      'publish',
      'browse',
      'like',
      'comment',
    ]),
    ok: booleanSchema,
    status: enumSchema([
      'read',
      'draft_filled',
      'sent',
      'request_submitted',
      'published',
      'browsed',
      'liked',
      'commented',
      'skipped',
      'blocked',
      'failed',
    ]),
    message: stringSchema,
    errorCode: commandErrorSchema.properties?.code || stringSchema,
    evidence: arraySchema(evidenceSchema),
    readback: readbackSchema,
    raw: objectSchema({}, [], true),
  },
  ['action', 'ok', 'status', 'message'],
);

const batchOutputSchema = objectSchema(
  {
    summary: objectSchema(
      {
        total: integerSchema,
        succeeded: integerSchema,
        failed: integerSchema,
        blocked: integerSchema,
        skipped: integerSchema,
      },
      ['total', 'succeeded', 'failed', 'blocked', 'skipped'],
    ),
    results: arraySchema(targetResultSchema),
  },
  ['summary', 'results'],
);

export const WECHAT_NATIVE_COMMAND_DEFINITIONS = {
  contacts: {
    key: 'contacts',
    title: 'WeChat contacts sync/read/export',
    taskTypes: ['wechat-contacts-sync'],
    legacySkillIds: ['wechat-contact-sync'],
    legacyMetadataKeys: [
      'wechat_contacts_sync_mode',
      'wechat_contacts_source_priority',
    ],
    defaultSendMode: 'read-only',
    supportsAutoSend: false,
    requiresTargetReadback: false,
    schema: {
      input: objectSchema(
        {
          action: enumSchema(['read-cache', 'sync', 'export']),
          mode: enumSchema(['random', 'all']),
          sourcePriority: arraySchema(
            enumSchema(['native-runtime', 'wechat-db', 'uia', 'ocr', 'cache']),
          ),
          limit: integerSchema,
          includeTags: booleanSchema,
          includeDiagnostics: booleanSchema,
        },
        ['action'],
      ),
      output: objectSchema(
        {
          source: enumSchema([
            'empty',
            'cache',
            'native-runtime',
            'wechat-db',
            'uia',
            'ocr',
          ]),
          contacts: arraySchema(
            objectSchema(
              {
                wxid: stringSchema,
                nickname: stringSchema,
                remark: stringSchema,
                displayName: stringSchema,
                tags: stringArraySchema,
                currentWechatId: stringSchema,
                plannedWechatId: stringSchema,
                syncedAt: stringSchema,
                raw: objectSchema({}, [], true),
              },
              ['wxid', 'displayName', 'tags'],
            ),
          ),
          count: integerSchema,
          currentWechatId: stringSchema,
          plannedWechatId: stringSchema,
          syncedAt: stringSchema,
          exportedContent: stringSchema,
        },
        ['source', 'contacts', 'count'],
      ),
      diagnostics: objectSchema(
        {
          ...diagnosticsSchema.properties,
          contacts: objectSchema({
            pagesScanned: integerSchema,
            uiaContactCount: integerSchema,
            ocrContactCount: integerSchema,
            dbContactCount: integerSchema,
            rawTextCount: integerSchema,
            dbKeyStatus: stringSchema,
            dbPaths: stringArraySchema,
            pollutionRejected: booleanSchema,
          }),
        },
        ['command', 'stage'],
        true,
      ),
      error: commandErrorSchema,
    },
  },
  'group-broadcast': {
    key: 'group-broadcast',
    title: 'WeChat group/contact broadcast',
    taskTypes: ['wechat-group-broadcast'],
    legacySkillIds: ['wechat.group.broadcast', 'wechat-group-broadcast'],
    legacyMetadataKeys: [
      'wechat_group_targets',
      'wechat_reply_draft',
      'wechat_reply_mode',
    ],
    defaultSendMode: 'approval',
    supportsAutoSend: true,
    requiresTargetReadback: true,
    schema: {
      input: objectSchema(
        {
          targets: arraySchema(contactRefSchema),
          message: textContentSchema,
          messages: arraySchema(
            objectSchema(
              {
                targetId: stringSchema,
                targetName: stringSchema,
                message: textContentSchema,
              },
              ['targetName', 'message'],
            ),
          ),
          rateLimit: rateLimitSchema,
          resumeFromTargetId: stringSchema,
          dedupeKey: stringSchema,
          allowGroupChats: booleanSchema,
          stopOnFailure: booleanSchema,
        },
        ['targets', 'message'],
      ),
      output: batchOutputSchema,
      diagnostics: objectSchema(
        {
          ...diagnosticsSchema.properties,
          batch: objectSchema({
            requestedTargets: integerSchema,
            attemptedTargets: integerSchema,
            succeededTargets: integerSchema,
            failedTargets: integerSchema,
            blockedTargets: integerSchema,
            lastTarget: stringSchema,
            rateLimited: booleanSchema,
          }),
        },
        ['command', 'stage'],
        true,
      ),
      error: commandErrorSchema,
    },
  },
  'contact-add': {
    key: 'contact-add',
    title: 'WeChat contact add',
    taskTypes: ['wechat-contact-add'],
    legacySkillIds: ['wechat.contact.add', 'wechat-contact-add'],
    legacyMetadataKeys: [
      'wechat_contact_add_targets',
      'wechat_contact_add_verify_message',
      'wechat_reply_mode',
    ],
    defaultSendMode: 'approval',
    supportsAutoSend: true,
    requiresTargetReadback: true,
    schema: {
      input: objectSchema(
        {
          targets: arraySchema(
            objectSchema(
              {
                ...contactRefSchema.properties,
                searchText: stringSchema,
                verifyMessage: stringSchema,
              },
              ['searchText'],
              true,
            ),
          ),
          verifyMessage: stringSchema,
          remark: objectSchema({}, [], true),
          tags: stringArraySchema,
          sourceCampaignId: stringSchema,
          blacklistTags: stringArraySchema,
          rateLimit: rateLimitSchema,
        },
        ['targets', 'verifyMessage'],
      ),
      output: batchOutputSchema,
      diagnostics: objectSchema(
        {
          ...diagnosticsSchema.properties,
          batch: objectSchema({
            requestedTargets: integerSchema,
            attemptedTargets: integerSchema,
            succeededTargets: integerSchema,
            failedTargets: integerSchema,
            blockedTargets: integerSchema,
            lastTarget: stringSchema,
            rateLimited: booleanSchema,
          }),
        },
        ['command', 'stage'],
        true,
      ),
      error: commandErrorSchema,
    },
  },
  'friend-accept': {
    key: 'friend-accept',
    title: 'WeChat friend request controlled acceptance',
    taskTypes: ['wechat-friend-accept'],
    legacySkillIds: ['wechat.friend.accept', 'wechat-friend-accept'],
    legacyMetadataKeys: [
      'wechat_friend_accept_remark_strategy',
      'wechat_friend_accept_remark_content',
      'wechat_friend_accept_welcome_message',
      'wechat_friend_accept_match_keywords',
      'wechat_friend_accept_daily_limit',
    ],
    defaultSendMode: 'approval',
    supportsAutoSend: true,
    requiresTargetReadback: true,
    schema: {
      input: objectSchema({
        remark: objectSchema(
          {
            strategy: enumSchema(['request_name', 'phone_wechat', 'manual']),
            value: stringSchema,
          },
          ['strategy'],
        ),
        welcomeMessage: stringSchema,
        matchKeywords: stringArraySchema,
        dailyLimit: integerSchema,
      }),
      output: batchOutputSchema,
      diagnostics: objectSchema(
        {
          ...diagnosticsSchema.properties,
          batch: objectSchema({
            requestedTargets: integerSchema,
            attemptedTargets: integerSchema,
            succeededTargets: integerSchema,
            failedTargets: integerSchema,
            blockedTargets: integerSchema,
            lastTarget: stringSchema,
            rateLimited: booleanSchema,
          }),
        },
        ['command', 'stage'],
        true,
      ),
      error: commandErrorSchema,
    },
  },
  'moments-publish': {
    key: 'moments-publish',
    title: 'WeChat Moments publish',
    taskTypes: ['wechat-moments-publish'],
    legacySkillIds: ['wechat.moments.publish', 'wechat-moments-publish'],
    legacyMetadataKeys: [
      'wechat_moments_content',
      'wechat_moments_asset_path',
      'wechat_reply_mode',
    ],
    defaultSendMode: 'approval',
    supportsAutoSend: true,
    requiresTargetReadback: true,
    schema: {
      input: objectSchema(
        {
          content: objectSchema(
            {
              text: stringSchema,
              assets: arraySchema(assetRefSchema),
              firstComment: stringSchema,
              visibility: enumSchema(['public', 'private', 'partial']),
              visibleTo: arraySchema(contactRefSchema),
              hiddenFrom: arraySchema(contactRefSchema),
              location: stringSchema,
              publishAt: stringSchema,
            },
            ['text', 'assets'],
          ),
          items: arraySchema(
            objectSchema(
              {
                id: stringSchema,
                text: stringSchema,
                assets: arraySchema(assetRefSchema),
                firstComment: stringSchema,
                visibility: enumSchema(['public', 'private', 'partial']),
                visibleTo: arraySchema(contactRefSchema),
                hiddenFrom: arraySchema(contactRefSchema),
                location: stringSchema,
                publishAt: stringSchema,
              },
              ['text', 'assets'],
            ),
          ),
        },
        ['content'],
      ),
      output: objectSchema(
        {
          status: enumSchema([
            'draft_filled',
            'published',
            'blocked',
            'failed',
          ]),
          momentId: stringSchema,
          contentText: stringSchema,
          assetPaths: stringArraySchema,
          evidence: arraySchema(evidenceSchema),
          readback: readbackSchema,
        },
        ['status', 'contentText', 'assetPaths', 'evidence'],
      ),
      diagnostics: objectSchema(
        {
          ...diagnosticsSchema.properties,
          momentsPublish: objectSchema({
            assetCount: integerSchema,
            assetPaths: stringArraySchema,
            publishButtonDetected: booleanSchema,
            publishResultDetected: booleanSchema,
          }),
        },
        ['command', 'stage'],
        true,
      ),
      error: commandErrorSchema,
    },
  },
  'moments-marketing': {
    key: 'moments-marketing',
    title: 'WeChat Moments browse/like/comment marketing',
    taskTypes: ['wechat-moments-marketing'],
    legacySkillIds: ['wechat.moments.marketing', 'wechat-moments-marketing'],
    legacyMetadataKeys: [
      'wechat_moments_marketing_mode',
      'wechat_moments_marketing_contacts',
      'wechat_moments_marketing_actions',
      'wechat_moments_marketing_comment_mode',
      'wechat_moments_marketing_target_comments',
      'wechat_moments_marketing_daily_limit',
      'wechat_reply_mode',
    ],
    defaultSendMode: 'approval',
    supportsAutoSend: true,
    requiresTargetReadback: true,
    schema: {
      input: objectSchema(
        {
          mode: enumSchema(['random', 'targeted']),
          actions: objectSchema({
            browse: booleanSchema,
            like: booleanSchema,
            comment: booleanSchema,
          }),
          contacts: arraySchema(contactRefSchema),
          targets: arraySchema(
            objectSchema({
              id: stringSchema,
              ordinal: integerSchema,
              contact: contactRefSchema,
              momentText: stringSchema,
              postedAt: stringSchema,
              raw: objectSchema({}, [], true),
            }),
          ),
          browseLimit: integerSchema,
          dailyLimit: integerSchema,
          comment: objectSchema({
            mode: enumSchema(['none', 'fixed', 'ai', 'per-target']),
            fixedText: stringSchema,
            prompt: stringSchema,
            targetComments: arraySchema(
              objectSchema(
                {
                  targetId: stringSchema,
                  targetName: stringSchema,
                  commentText: stringSchema,
                },
                ['commentText'],
              ),
            ),
          }),
          rateLimit: rateLimitSchema,
        },
        ['mode', 'actions'],
      ),
      output: batchOutputSchema,
      diagnostics: objectSchema(
        {
          ...diagnosticsSchema.properties,
          batch: objectSchema({
            requestedTargets: integerSchema,
            attemptedTargets: integerSchema,
            succeededTargets: integerSchema,
            failedTargets: integerSchema,
            blockedTargets: integerSchema,
            lastTarget: stringSchema,
            rateLimited: booleanSchema,
          }),
        },
        ['command', 'stage'],
        true,
      ),
      error: commandErrorSchema,
    },
  },
  'chat-history': {
    key: 'chat-history',
    title: 'WeChat chat history sessions/messages',
    taskTypes: ['wechat-chat-history-sync'],
    legacySkillIds: ['wechat-chat-sync'],
    legacyMetadataKeys: [
      'wechat_chat_history_session_id',
      'wechat_chat_history_limit',
      'wechat_chat_history_since',
      'wechat_chat_history_until',
    ],
    defaultSendMode: 'read-only',
    supportsAutoSend: false,
    requiresTargetReadback: false,
    schema: {
      input: objectSchema(
        {
          action: enumSchema(['read-sessions', 'read-messages', 'sync']),
          sessionId: stringSchema,
          contact: contactRefSchema,
          limit: integerSchema,
          since: stringSchema,
          until: stringSchema,
          keyword: stringSchema,
          includeMedia: booleanSchema,
          directions: arraySchema(
            enumSchema(['incoming', 'outgoing', 'system', 'unknown']),
          ),
          contentTypes: arraySchema(
            enumSchema(['text', 'image', 'file', 'system', 'unknown']),
          ),
        },
        ['action'],
      ),
      output: objectSchema(
        {
          source: enumSchema([
            'empty',
            'cache',
            'native-runtime',
            'wechat-db',
            'ocr',
            'manual',
          ]),
          sessions: arraySchema(
            objectSchema(
              {
                id: stringSchema,
                title: stringSchema,
                contactName: stringSchema,
                unreadCount: integerSchema,
                lastMessage: stringSchema,
                lastMessageAt: stringSchema,
                source: stringSchema,
                raw: objectSchema({}, [], true),
              },
              ['id', 'title', 'unreadCount', 'source'],
            ),
          ),
          messages: arraySchema(
            objectSchema(
              {
                id: stringSchema,
                sessionId: stringSchema,
                senderName: stringSchema,
                direction: enumSchema([
                  'incoming',
                  'outgoing',
                  'system',
                  'unknown',
                ]),
                content: stringSchema,
                contentType: enumSchema([
                  'text',
                  'image',
                  'file',
                  'system',
                  'unknown',
                ]),
                sentAt: stringSchema,
                source: stringSchema,
                raw: objectSchema({}, [], true),
              },
              [
                'id',
                'sessionId',
                'direction',
                'content',
                'contentType',
                'source',
              ],
            ),
          ),
          sessionId: stringSchema,
          count: integerSchema,
          syncedAt: stringSchema,
        },
        ['source', 'sessions', 'messages', 'count'],
      ),
      diagnostics: objectSchema(
        {
          ...diagnosticsSchema.properties,
          chatHistory: objectSchema({
            sessionsScanned: integerSchema,
            messagesScanned: integerSchema,
            sessionId: stringSchema,
            source: stringSchema,
            cachePath: stringSchema,
          }),
        },
        ['command', 'stage'],
        true,
      ),
      error: commandErrorSchema,
    },
  },
  'auto-reply': {
    key: 'auto-reply',
    title: 'WeChat session auto reply (read latest / draft / send)',
    taskTypes: ['wechat-reply-draft'],
    legacySkillIds: ['wechat-auto-reply', 'wechat-live-auto-reply'],
    legacyMetadataKeys: [
      'wechat_reply_draft',
      'replyText',
      'sourceText',
      'wechat_reply_mode',
    ],
    defaultSendMode: 'read-only',
    supportsAutoSend: true,
    requiresTargetReadback: true,
    schema: {
      input: objectSchema(
        {
          action: enumSchema(['read-latest', 'draft', 'send']),
          target: contactRefSchema,
          replyText: stringSchema,
          sourceText: stringSchema,
          sendMode: enumSchema([
            'read-only',
            'draft-only',
            'approval',
            'auto-send',
          ]),
          rateLimit: rateLimitSchema,
          dedupeKey: stringSchema,
        },
        ['action'],
      ),
      output: objectSchema(
        {
          ok: booleanSchema,
          status: enumSchema([
            'success',
            'partial',
            'blocked',
            'failed',
            'skipped',
          ]),
          errorCode: commandErrorSchema.properties?.code || stringSchema,
          readText: stringSchema,
          sourceText: stringSchema,
          replyText: stringSchema,
          targetName: stringSchema,
          sent: booleanSchema,
          drafted: booleanSchema,
          screenshotPath: stringSchema,
          message: stringSchema,
          readback: readbackSchema,
          evidence: arraySchema(evidenceSchema),
        },
        ['ok', 'status', 'action'],
        true,
      ),
      diagnostics: objectSchema(
        {
          ...diagnosticsSchema.properties,
          autoReply: objectSchema({
            action: stringSchema,
            targetName: stringSchema,
            sourceText: stringSchema,
            replyText: stringSchema,
            sent: booleanSchema,
            screenshotPath: stringSchema,
          }),
        },
        ['command', 'stage'],
        true,
      ),
      error: commandErrorSchema,
    },
  },
} as const satisfies {
  readonly [K in WechatNativeCommandKey]: WechatNativeCommandDefinition<K>;
};

export const WECHAT_NATIVE_LEGACY_TASK_TYPE_TO_COMMAND = {
  'wechat-contacts-sync': 'contacts',
  'wechat-group-broadcast': 'group-broadcast',
  'wechat-contact-add': 'contact-add',
  'wechat-friend-accept': 'friend-accept',
  'wechat-moments-publish': 'moments-publish',
  'wechat-moments-marketing': 'moments-marketing',
  'wechat-chat-history-sync': 'chat-history',
  'wechat-reply-draft': 'auto-reply',
} as const satisfies Readonly<Record<string, WechatNativeCommandKey>>;

export function isWechatNativeCommandKey(
  value: string,
): value is WechatNativeCommandKey {
  return Boolean(
    Object.prototype.hasOwnProperty.call(
      WECHAT_NATIVE_COMMAND_DEFINITIONS,
      value,
    ),
  );
}

export function resolveWechatNativeCommandKey(
  value: string,
): WechatNativeCommandKey | undefined {
  const normalized = String(value || '').trim();
  if (isWechatNativeCommandKey(normalized)) return normalized;
  return (
    WECHAT_NATIVE_LEGACY_TASK_TYPE_TO_COMMAND as Readonly<
      Record<string, WechatNativeCommandKey | undefined>
    >
  )[normalized];
}

export function getWechatNativeCommandDefinition<
  K extends WechatNativeCommandKey,
>(command: K): WechatNativeCommandDefinition<K> {
  return WECHAT_NATIVE_COMMAND_DEFINITIONS[
    command
  ] as unknown as WechatNativeCommandDefinition<K>;
}

export function createWechatNativeCommandRequest<
  K extends WechatNativeCommandKey,
>(
  request: Omit<WechatNativeCommandRequest<K>, 'contractVersion'> & {
    contractVersion?: string;
  },
): WechatNativeCommandRequest<K> {
  return {
    ...request,
    contractVersion:
      request.contractVersion || WECHAT_NATIVE_COMMAND_CONTRACT_VERSION,
  };
}

export function buildWechatNativeCommandFailure<
  K extends WechatNativeCommandKey,
>(
  request: WechatNativeCommandRequest<K>,
  error: WechatNativeCommandError,
  diagnostics: WechatNativeDiagnosticsByKey[K],
): WechatNativeCommandResponse<K> {
  return {
    contractVersion: request.contractVersion,
    command: request.command,
    ok: false,
    status: error.code === 'approval_required' ? 'blocked' : 'failed',
    diagnostics,
    error,
  };
}
