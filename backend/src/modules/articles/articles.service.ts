import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { ImageSelectorService } from './image-selector.service';
import { MaterialsService } from '../materials/materials.service';
import { StorageService } from '../storage/storage.service';
import {
  renderXiaohongshuCardSvg,
  XiaohongshuSlideRole,
  XiaohongshuSlideTemplate,
} from './xiaohongshu-card-renderer';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { ArticleWorkspaceIntentDto } from './dto/article-workspace.dto';

export async function withAbortTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  ms: number,
  msg: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new Error(msg);
  timeoutError.name = 'TimeoutError';
  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };
  const onParentAbort = () => abort(parentSignal?.reason);

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const timer = setTimeout(() => abort(timeoutError), ms);
  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason || timeoutError;
    }
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  if (reason instanceof Error) throw reason;
  const error = new Error(
    typeof reason === 'string' ? reason : '文章生成已取消',
  );
  error.name = 'AbortError';
  throw error;
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true;
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'APIUserAbortError';
}

function rethrowAbort(error: unknown, signal?: AbortSignal): void {
  if (!isAbortError(error, signal)) return;
  if (signal?.aborted) {
    throwIfAborted(signal);
  }
  throw error;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

type ArticleContentFormat = 'markdown' | 'html';
type ArticleContentType = 'article' | 'xiaohongshu';
export type ArticleWorkspaceStep =
  | 'brief'
  | 'outline'
  | 'draft'
  | 'versions'
  | 'review';

export type ArticleWorkspaceBrief = {
  goal: string;
  audience: string;
  platforms: string[];
  deadline: string | null;
  action: string;
  constraints: string;
  fieldSources?: Partial<
    Record<
      ArticleWorkspaceBriefField,
      { source: string; label: string; edited: boolean }
    >
  >;
};

const ARTICLE_WORKSPACE_BRIEF_FIELDS = [
  'goal',
  'audience',
  'platforms',
  'deadline',
  'action',
  'constraints',
] as const;
type ArticleWorkspaceBriefField =
  (typeof ARTICLE_WORKSPACE_BRIEF_FIELDS)[number];

export type ArticleWorkspaceOutlineItem = {
  id: string;
  title: string;
  summary: string;
};

export type ArticleWorkspaceOutline = {
  items: ArticleWorkspaceOutlineItem[];
  confirmedAt: string | null;
  confirmedItemsHash: string | null;
  legacyBodyWithoutOutline?: true;
};

const ARTICLE_WORKSPACE_STEPS = new Set<ArticleWorkspaceStep>([
  'brief',
  'outline',
  'draft',
  'versions',
  'review',
]);

function createEmptyWorkspaceBrief(): ArticleWorkspaceBrief {
  return {
    goal: '',
    audience: '',
    platforms: [],
    deadline: null,
    action: '',
    constraints: '',
  };
}

function createPrefilledWorkspaceBrief(
  input: CreateArticleDraftInput,
): ArticleWorkspaceBrief {
  const title = input.title?.trim();
  const meaningfulTitle = title && title !== '未命名内容' ? title : '';
  const isXiaohongshu = input.contentType === 'xiaohongshu';
  const intentGoal = input.workspaceIntent?.goal?.trim();
  const intentPlatforms = input.workspaceIntent?.platforms;
  const taskGoal = input.workspaceIntent
    ? {
        create: '形成一篇可审核、可交接的内容主稿',
        rewrite: '在保留核心事实的前提下完成内容改写',
        multiplatform: '形成一份可继续适配多平台的内容主稿',
        prepare: '形成一份可进入审核与发布准备的内容主稿',
      }[input.workspaceIntent.task]
    : '';
  const goal =
    intentGoal ||
    taskGoal ||
    (meaningfulTitle
      ? `围绕「${meaningfulTitle.slice(0, 80)}」形成可审核主稿`
      : '形成一篇可审核、可交接的内容主稿');
  const platforms =
    intentPlatforms === undefined
      ? isXiaohongshu
        ? ['xiaohongshu']
        : []
      : Array.from(new Set(intentPlatforms));
  return {
    goal,
    audience: '当前品牌的目标读者',
    platforms,
    deadline: null,
    action: '阅读后完成与内容目标一致的下一步行动',
    constraints: '仅使用可验证事实；避免绝对化承诺',
    fieldSources: {
      goal: {
        source: input.workspaceIntent
          ? 'task_intent'
          : meaningfulTitle
            ? 'article_title'
            : 'workflow_default',
        label: input.workspaceIntent
          ? '根据任务意图预填'
          : meaningfulTitle
            ? '根据草稿标题预填'
            : '工作流默认，可修改',
        edited: false,
      },
      audience: {
        source: 'workflow_default',
        label: '工作流默认，可修改',
        edited: false,
      },
      platforms: {
        source:
          intentPlatforms !== undefined
            ? 'task_intent'
            : isXiaohongshu
              ? 'content_type'
              : 'unavailable',
        label:
          intentPlatforms !== undefined
            ? '根据任务意图预填'
            : isXiaohongshu
              ? '根据内容类型预填'
              : '未指定发布平台',
        edited: false,
      },
      deadline: {
        source: 'unavailable',
        label: '未关联营销任务，可选填',
        edited: false,
      },
      action: {
        source: 'workflow_default',
        label: '工作流默认，可修改',
        edited: false,
      },
      constraints: {
        source: 'compliance_default',
        label: '内容合规默认约束',
        edited: false,
      },
    },
  };
}

function createEmptyWorkspaceOutline(): ArticleWorkspaceOutline {
  return { items: [], confirmedAt: null, confirmedItemsHash: null };
}

function workspaceOutlineItemsHash(items: ArticleWorkspaceOutlineItem[]) {
  return createHash('sha256').update(JSON.stringify(items)).digest('hex');
}

function hasValidWorkspaceOutlineConfirmation(
  outline: ArticleWorkspaceOutline,
) {
  return Boolean(
    outline.items.length > 0 &&
    outline.items.every((item) => item.title.trim()) &&
    outline.confirmedAt &&
    outline.confirmedItemsHash === workspaceOutlineItemsHash(outline.items),
  );
}

function invalidWorkspaceValue(message: string): never {
  throw new HttpException(message, HttpStatus.BAD_REQUEST);
}

function workspaceRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidWorkspaceValue(`${label}必须是对象`);
  }
  return value as Record<string, unknown>;
}

function workspaceField(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return invalidWorkspaceValue(`${label}缺少字段 ${key}`);
  }
  return record[key];
}

function workspaceText(
  value: unknown,
  maxLength: number,
  label: string,
  allowEmpty = true,
) {
  if (typeof value !== 'string') {
    return invalidWorkspaceValue(`${label}必须是字符串`);
  }
  if (value.length > maxLength) {
    return invalidWorkspaceValue(`${label}不能超过 ${maxLength} 个字符`);
  }
  const normalized = value.trim();
  if (!allowEmpty && !normalized) {
    return invalidWorkspaceValue(`${label}不能为空`);
  }
  return normalized;
}

function normalizeWorkspaceBriefFieldSources(
  value: unknown,
): ArticleWorkspaceBrief['fieldSources'] {
  const record = workspaceRecord(value, '简报字段来源');
  const allowedFields = new Set<string>(ARTICLE_WORKSPACE_BRIEF_FIELDS);
  const fieldSources: NonNullable<ArticleWorkspaceBrief['fieldSources']> = {};
  for (const [field, rawSource] of Object.entries(record)) {
    if (!allowedFields.has(field)) {
      return invalidWorkspaceValue(`简报字段来源包含未知字段 ${field}`);
    }
    const sourceRecord = workspaceRecord(rawSource, `${field} 字段来源`);
    if (typeof sourceRecord.edited !== 'boolean') {
      return invalidWorkspaceValue(`${field} 字段来源的 edited 必须是布尔值`);
    }
    fieldSources[field as ArticleWorkspaceBriefField] = {
      source: workspaceText(
        workspaceField(sourceRecord, 'source', `${field} 字段来源`),
        80,
        `${field} 字段来源标识`,
        false,
      ),
      label: workspaceText(
        workspaceField(sourceRecord, 'label', `${field} 字段来源`),
        120,
        `${field} 字段来源说明`,
        false,
      ),
      edited: sourceRecord.edited,
    };
  }
  return fieldSources;
}

function normalizeWorkspaceBrief(
  value: unknown,
  fallbackFieldSources?: ArticleWorkspaceBrief['fieldSources'],
): ArticleWorkspaceBrief {
  const record = workspaceRecord(value, '内容工作区简报');
  const rawPlatforms = workspaceField(record, 'platforms', '内容工作区简报');
  if (!Array.isArray(rawPlatforms)) {
    return invalidWorkspaceValue('目标平台必须是数组');
  }
  if (rawPlatforms.length > 8) {
    return invalidWorkspaceValue('目标平台不能超过 8 个');
  }
  const platforms = Array.from(
    new Set(
      rawPlatforms.map((platform, index) =>
        workspaceText(platform, 40, `第 ${index + 1} 个目标平台`, false),
      ),
    ),
  );
  const rawDeadline = workspaceField(record, 'deadline', '内容工作区简报');
  if (rawDeadline !== null && typeof rawDeadline !== 'string') {
    return invalidWorkspaceValue('截止日期必须是字符串或 null');
  }
  const deadline =
    rawDeadline === null
      ? null
      : workspaceText(rawDeadline, 40, '截止日期', false);
  if (deadline && Number.isNaN(Date.parse(deadline))) {
    return invalidWorkspaceValue('截止日期格式无效');
  }
  const suppliedFieldSources = Object.prototype.hasOwnProperty.call(
    record,
    'fieldSources',
  )
    ? normalizeWorkspaceBriefFieldSources(record.fieldSources)
    : undefined;
  const fieldSources = suppliedFieldSources
    ? { ...(fallbackFieldSources || {}), ...suppliedFieldSources }
    : fallbackFieldSources
      ? { ...fallbackFieldSources }
      : undefined;
  return {
    goal: workspaceText(
      workspaceField(record, 'goal', '内容工作区简报'),
      2000,
      '内容目标',
    ),
    audience: workspaceText(
      workspaceField(record, 'audience', '内容工作区简报'),
      2000,
      '目标受众',
    ),
    platforms,
    deadline,
    action: workspaceText(
      workspaceField(record, 'action', '内容工作区简报'),
      1000,
      '期望行动',
    ),
    constraints: workspaceText(
      workspaceField(record, 'constraints', '内容工作区简报'),
      3000,
      '表达约束',
    ),
    ...(fieldSources ? { fieldSources } : {}),
  };
}

function markChangedWorkspaceBriefFields(
  current: ArticleWorkspaceBrief,
  next: ArticleWorkspaceBrief,
): ArticleWorkspaceBrief {
  const fieldSources = { ...(next.fieldSources || {}) };
  for (const field of ARTICLE_WORKSPACE_BRIEF_FIELDS) {
    const changed =
      field === 'platforms'
        ? JSON.stringify(current.platforms) !== JSON.stringify(next.platforms)
        : current[field] !== next[field];
    if (changed) {
      fieldSources[field] = {
        source: 'user',
        label: '已由你修改',
        edited: true,
      };
    }
  }
  if (Object.keys(fieldSources).length > 0) {
    return { ...next, fieldSources };
  }
  const withoutSources = { ...next };
  delete withoutSources.fieldSources;
  return withoutSources;
}

function normalizeStoredWorkspaceBrief(value: unknown) {
  if (value === null || value === undefined) return createEmptyWorkspaceBrief();
  try {
    return normalizeWorkspaceBrief(value);
  } catch {
    return createEmptyWorkspaceBrief();
  }
}

function normalizeWorkspaceOutline(value: unknown): ArticleWorkspaceOutline {
  const record = workspaceRecord(value, '内容工作区大纲');
  const rawItems = workspaceField(record, 'items', '内容工作区大纲');
  if (!Array.isArray(rawItems)) {
    return invalidWorkspaceValue('大纲节点必须是数组');
  }
  if (rawItems.length > 50) {
    return invalidWorkspaceValue('大纲节点不能超过 50 个');
  }
  const seenIds = new Set<string>();
  const items = rawItems.map((rawItem, index) => {
    const item = workspaceRecord(rawItem, `第 ${index + 1} 个大纲节点`);
    const id = workspaceText(
      workspaceField(item, 'id', `第 ${index + 1} 个大纲节点`),
      120,
      `第 ${index + 1} 个大纲节点 ID`,
      false,
    );
    if (seenIds.has(id)) {
      return invalidWorkspaceValue(`大纲节点 ID 重复：${id}`);
    }
    seenIds.add(id);
    return {
      id,
      title: workspaceText(
        workspaceField(item, 'title', `第 ${index + 1} 个大纲节点`),
        160,
        `第 ${index + 1} 个大纲节点标题`,
      ),
      summary: workspaceText(
        workspaceField(item, 'summary', `第 ${index + 1} 个大纲节点`),
        2000,
        `第 ${index + 1} 个大纲节点要点`,
      ),
    };
  });
  const rawConfirmedAt = workspaceField(
    record,
    'confirmedAt',
    '内容工作区大纲',
  );
  if (rawConfirmedAt !== null && typeof rawConfirmedAt !== 'string') {
    return invalidWorkspaceValue('大纲确认时间必须是字符串或 null');
  }
  const confirmedAt =
    rawConfirmedAt === null
      ? null
      : workspaceText(rawConfirmedAt, 40, '大纲确认时间', false);
  if (confirmedAt && Number.isNaN(Date.parse(confirmedAt))) {
    return invalidWorkspaceValue('大纲确认时间格式无效');
  }
  const rawConfirmedItemsHash = Object.prototype.hasOwnProperty.call(
    record,
    'confirmedItemsHash',
  )
    ? record.confirmedItemsHash
    : null;
  if (
    rawConfirmedItemsHash !== null &&
    (typeof rawConfirmedItemsHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(rawConfirmedItemsHash))
  ) {
    return invalidWorkspaceValue('大纲确认摘要格式无效');
  }
  const legacyBodyWithoutOutline = record.legacyBodyWithoutOutline;
  if (
    legacyBodyWithoutOutline !== undefined &&
    legacyBodyWithoutOutline !== true
  ) {
    return invalidWorkspaceValue('旧正文兼容标记格式无效');
  }
  return {
    items,
    confirmedAt: confirmedAt ? new Date(confirmedAt).toISOString() : null,
    confirmedItemsHash: rawConfirmedItemsHash,
    ...(legacyBodyWithoutOutline === true
      ? { legacyBodyWithoutOutline: true as const }
      : {}),
  };
}

function normalizeStoredWorkspaceOutline(value: unknown) {
  if (value === null || value === undefined)
    return createEmptyWorkspaceOutline();
  try {
    const normalized = normalizeWorkspaceOutline(value);
    const record = value as Record<string, unknown>;
    if (
      normalized.confirmedAt &&
      normalized.items.length > 0 &&
      normalized.items.every((item) => item.title.trim()) &&
      !Object.prototype.hasOwnProperty.call(record, 'confirmedItemsHash')
    ) {
      return {
        ...normalized,
        confirmedItemsHash: workspaceOutlineItemsHash(normalized.items),
      };
    }
    return normalized;
  } catch {
    return createEmptyWorkspaceOutline();
  }
}

function normalizedWorkspaceValueEquals<T>(
  current: unknown,
  next: T,
  normalize: (value: unknown) => T,
  emptyValue: T,
) {
  if (current === null || current === undefined) {
    return JSON.stringify(emptyValue) === JSON.stringify(next);
  }
  try {
    return JSON.stringify(normalize(current)) === JSON.stringify(next);
  } catch {
    return false;
  }
}

function normalizeWorkspaceStep(value: unknown): ArticleWorkspaceStep {
  if (
    typeof value === 'string' &&
    ARTICLE_WORKSPACE_STEPS.has(value as ArticleWorkspaceStep)
  ) {
    return value as ArticleWorkspaceStep;
  }
  throw new HttpException('无效的内容工作区步骤', HttpStatus.BAD_REQUEST);
}

type GeneratedArticlePayload = {
  title: string;
  content: string;
  contentFormat: ArticleContentFormat;
};

type XiaohongshuSlidePlan = {
  role: XiaohongshuSlideRole;
  template: XiaohongshuSlideTemplate;
  title: string;
  body: string;
  bullets: string[];
  highlight: string;
  imagePrompt: string;
  imageType: 'real' | 'ai' | 'none';
};

export type GeneratedXiaohongshuPayload = {
  title: string;
  caption: string;
  hashtags: string[];
  slides: XiaohongshuSlidePlan[];
};

export type AgentWakerXiaohongshuDraftInput = GeneratedXiaohongshuPayload & {
  modelId?: string | null;
  generateCards?: boolean;
  generateBackgrounds?: boolean;
};

export type AgentWakerWechatDraftInput = {
  title: string;
  markdown: string;
  html: string;
  digest: string;
  author: string;
  coverPrompt: string;
  sourceUrl?: string;
  sourceLedger: Array<{
    title: string;
    url: string;
    evidence: string;
  }>;
  modelId?: string | null;
};

type XiaohongshuSlide = XiaohongshuSlidePlan & {
  coverText: string;
  bodyText: string;
  imageUrl: string | null;
  backgroundImageUrl: string | null;
  cardImageUrl: string;
};

type XiaohongshuNoteData = {
  title: string;
  caption: string;
  hashtags: string[];
  slides: XiaohongshuSlide[];
};

type MaterialInfo = {
  id: string;
  imageUrl: string | null;
  originalImageUrl: string | null;
  hasImage: boolean;
  title: string;
  content: string | null;
};

type ImageTaskResult = {
  placeholder: string;
  url: string | null;
  success: boolean;
  errorDetail?: string;
};

const ARTICLE_GENERATION_TIMEOUT_MS = 20 * 60 * 1000;
const ARTICLE_MAX_GENERATION_ATTEMPTS = 3;
const ARTICLE_MARKDOWN_MAX_TOKENS = 4000;
const ARTICLE_HTML_MAX_TOKENS = 12000;
const ARTICLE_HTML_CONTINUATION_MAX_TOKENS = 6000;

type HtmlValidationResult = {
  isComplete: boolean;
  reason: string;
};

type ArticleOwnerScope = { tenantId: string; userId: string };

export type CreateArticleDraftInput = {
  title?: string;
  content?: string;
  contentType?: ArticleContentType;
  contentFormat?: ArticleContentFormat;
  workspaceIntent?: ArticleWorkspaceIntentDto;
};

export type UpdateArticleInput = {
  title?: string;
  content?: string;
  rawHtml?: string;
  finalHtml?: string;
  contentFormat?: ArticleContentFormat;
  workspaceBrief?: unknown;
  workspaceOutline?: unknown;
  workspaceStep?: unknown;
  confirmWorkspaceOutline?: boolean;
};

@Injectable()
export class ArticlesService {
  private readonly logger = new Logger(ArticlesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClientService,
    private readonly defaultModels: DefaultModelsService,
    private readonly systemLogsService: SystemLogsService,
    private readonly imageSelector: ImageSelectorService,
    private readonly materialsService: MaterialsService,
    private readonly storageService: StorageService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  async createDraft(input: CreateArticleDraftInput = {}) {
    const ownerScope = await this.resolveArticleOwnerScope();
    const title = input.title?.trim().slice(0, 120) || '未命名内容';
    const content = typeof input.content === 'string' ? input.content : '';
    const contentType: ArticleContentType =
      input.contentType === 'xiaohongshu' ? 'xiaohongshu' : 'article';
    const contentFormat: ArticleContentFormat =
      input.contentFormat === 'html' ? 'html' : 'markdown';

    const article = await this.prisma.article.create({
      data: {
        title,
        content,
        contentType,
        contentFormat,
        workspaceBrief: createPrefilledWorkspaceBrief(
          input,
        ) as Prisma.InputJsonValue,
        workspaceOutline:
          createEmptyWorkspaceOutline() as Prisma.InputJsonValue,
        workspaceStep: 'brief',
        workspaceRevision: 1,
        rawHtml: contentFormat === 'html' && content ? content : null,
        finalHtml: contentFormat === 'html' && content ? content : null,
        status: 'draft',
        ...ownerScope,
      },
      include: {
        topic: { select: { title: true, keywords: true } },
        template: { select: { id: true, name: true } },
      },
    });

    await this.systemLogsService.record(
      `空白内容草稿「${title}」已创建`,
      'success',
    );
    return article;
  }

  // ================= 核心：一键图文文生成引擎 =================
  async generateFromTopic(
    topicId: string,
    force = false,
    contentType: ArticleContentType = 'article',
    allowScheduledLegacyOwner = false,
    signal?: AbortSignal,
  ) {
    throwIfAborted(signal);
    const ownerScope = await this.resolveArticleOwnerScope(
      allowScheduledLegacyOwner,
    );
    let topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      include: { materials: { include: { material: true } } },
    });

    if (!topic) {
      throw new HttpException('选题不存在', HttpStatus.NOT_FOUND);
    }
    if (topic.isPublished && !force) {
      throw new HttpException(
        `该选题已完成过${this.getContentLabel(contentType)}创作`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (topic.materials.length > 0) {
      await this.materialsService.ensureImagesForMaterials(
        topic.materials.map((m) => m.material.id),
      );
      throwIfAborted(signal);
      topic = await this.prisma.topic.findUnique({
        where: { id: topicId },
        include: { materials: { include: { material: true } } },
      });
      if (!topic) {
        throw new HttpException('选题不存在', HttpStatus.NOT_FOUND);
      }
    }

    const claimed = await this.prisma.topic.updateMany({
      where: {
        id: topicId,
        status: { not: 'generating' },
        ...(force ? {} : { isPublished: false }),
      },
      data: { status: 'generating' },
    });
    if (claimed.count !== 1) {
      throw new HttpException(
        '该选题正在生成或已经完成，请刷新状态后再操作。',
        HttpStatus.CONFLICT,
      );
    }

    try {
      return await withAbortTimeout(
        async (generationSignal) => {
          const [articleStyle, imageStyle, articleTemplate] = await Promise.all(
            [
              this.prisma.style.findFirst({
                where: {
                  isDefault: true,
                  type:
                    contentType === 'xiaohongshu' ? 'xiaohongshu' : 'article',
                },
              }),
              this.prisma.style.findFirst({
                where: { isDefault: true, type: 'image' },
              }),
              contentType === 'article'
                ? this.prisma.style.findFirst({
                    where: { isDefault: true, type: 'template' },
                  })
                : Promise.resolve(null),
            ],
          );

          const stylePrompt =
            articleStyle?.promptTemplate ||
            this.getDefaultStylePrompt(contentType);
          const templateHtml = articleTemplate?.promptTemplate?.trim() || '';
          const templateNotes = this.readTemplateNotes(
            articleTemplate?.parameters,
          );
          const contentFormat: ArticleContentFormat =
            contentType === 'article' && templateHtml ? 'html' : 'markdown';

          // 内容父子关系（报告 16.3 第 9 项）：同一选题下先到的是主版本，
          // 后续生成的其他平台变体 parentId 指向主版本，建立父子关联。
          const parentArticle = await this.prisma.article.findFirst({
            where: { topicId: topic.id },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          const parentId = parentArticle?.id ?? null;

          const config = await this.defaultModels.getDefaults();
          if (!config.articleCreation) {
            throw new HttpException(
              '未配置文章创作默认 AI 模型',
              HttpStatus.BAD_REQUEST,
            );
          }
          if (!config.imageCreation) {
            this.logger.warn('未配置图片创作模型，可能无法生成插图');
          }

          const materialContents = topic.materials
            .map(
              (m, i) =>
                `【参考素材 ${i + 1}】标题：${m.material.title}\n真实配图：${m.material.hasImage && m.material.imageUrl ? '有可复用原图' : '暂无可用原图'}\n内容详情：${m.material.content?.substring(0, 800) || m.material.summary || ''}`,
            )
            .join('\n\n');

          const startMsg = `开始为选题「${topic.title}」生成${contentType === 'xiaohongshu' ? '小红书笔记' : contentFormat === 'html' ? 'HTML 模板文章' : 'Markdown 文章'}... (模型: ${config.articleCreation})`;
          this.logger.log(startMsg);
          await this.systemLogsService.record(startMsg, 'info');

          const materialInfos: MaterialInfo[] = topic.materials.map((m) => ({
            id: m.material.id,
            imageUrl: m.material.imageUrl,
            originalImageUrl: m.material.originalImageUrl,
            hasImage: m.material.hasImage,
            title: m.material.title,
            content: m.material.content,
          }));

          const imageStylePrompt = imageStyle?.promptTemplate;
          const imageStyleParams =
            (imageStyle?.parameters as {
              ratio?: string;
              resolution?: string;
            } | null) || undefined;
          const topicKeywords = asStringArray(topic.keywords);

          if (contentType === 'xiaohongshu') {
            const xiaohongshuData = await this.generateXiaohongshuNote({
              modelId: config.articleCreation,
              stylePrompt,
              topicTitle: topic.title,
              topicSummary: topic.summary || '',
              keywords: topicKeywords,
              materialContents,
              materialInfos,
              imageStylePrompt,
              imageStyleParams,
              imageCreationEnabled: Boolean(config.imageCreation),
              signal: generationSignal,
            });

            const newArticle = await this.prisma.article.create({
              data: {
                title: xiaohongshuData.title,
                content: this.buildXiaohongshuContent(
                  xiaohongshuData.caption,
                  xiaohongshuData.hashtags,
                ),
                contentType,
                contentFormat: 'markdown',
                xiaohongshuData,
                coverImage:
                  xiaohongshuData.slides[0]?.cardImageUrl ||
                  xiaohongshuData.slides[0]?.imageUrl ||
                  null,
                status: 'draft',
                ...ownerScope,
                topicId: topic.id,
                parentId,
                styleId: articleStyle?.id,
                templateId: null,
                modelId: config.articleCreation,
              },
            });

            await this.prisma.topic.update({
              where: { id: topic.id },
              data: {
                status: 'completed',
                isPublished: true,
              },
            });

            const successMsg = `${this.getContentLabel(contentType)}「${xiaohongshuData.title}」生成顺利完成`;
            this.logger.log(
              `${this.getContentLabel(contentType)}生成顺利完成。记录号: ${newArticle.id}`,
            );
            await this.systemLogsService.record(successMsg, 'success');
            return newArticle;
          }

          const articleData = await this.generateArticlePayload({
            modelId: config.articleCreation,
            systemPrompt: this.buildSystemPrompt(
              contentType,
              stylePrompt,
              contentFormat,
              templateHtml,
              templateNotes,
            ),
            userPrompt: this.buildUserPrompt({
              contentType,
              topicTitle: topic.title,
              topicSummary: topic.summary || '',
              keywords: topicKeywords,
              materialContents,
              templateNotes,
            }),
            fallbackTitle: topic.title,
            contentFormat,
            templateHtml,
            signal: generationSignal,
          });

          const renderedResult = await this.renderImages({
            content: articleData.content,
            contentFormat,
            materialInfos,
            imageStylePrompt,
            imageStyleParams,
            imageCreationEnabled: Boolean(config.imageCreation),
            topicTitle: topic.title,
            signal: generationSignal,
          });
          const coverImage = await this.generateCoverImage({
            topicTitle: topic.title,
            topicSummary: topic.summary || '',
            keywords: topicKeywords,
            imageStylePrompt,
            imageStyleParams,
            imageCreationEnabled: Boolean(config.imageCreation),
            signal: generationSignal,
          });

          const newArticle = await this.prisma.article.create({
            data: {
              title: articleData.title,
              content: renderedResult.content,
              contentType,
              contentFormat,
              rawHtml: contentFormat === 'html' ? articleData.content : null,
              finalHtml:
                contentFormat === 'html' ? renderedResult.content : null,
              coverImage,
              status: 'draft',
              ...ownerScope,
              topicId: topic.id,
              parentId,
              styleId: articleStyle?.id,
              templateId: articleTemplate?.id,
              modelId: config.articleCreation,
            },
          });

          await this.prisma.topic.update({
            where: { id: topic.id },
            data: {
              status: 'completed',
              isPublished: true,
            },
          });

          const successMsg = `${this.getContentLabel(contentType)}「${articleData.title}」生成顺利完成`;
          this.logger.log(
            `${this.getContentLabel(contentType)}生成顺利完成。记录号: ${newArticle.id}`,
          );
          await this.systemLogsService.record(successMsg, 'success');
          return newArticle;
        },
        ARTICLE_GENERATION_TIMEOUT_MS,
        `${this.getContentLabel(contentType)}生成超时（超过20分钟），请稍后重试`,
        signal,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '系统内部打分执行中断';
      const errorMsg = `${this.getContentLabel(contentType)}「${topic.title}」一键生成过程出错了: ${message}`;
      this.logger.error(
        `${this.getContentLabel(contentType)}一键生成过程出错了`,
        error,
      );
      await this.systemLogsService.record(errorMsg, 'error');
      await this.prisma.topic.update({
        where: { id: topicId },
        data: { status: 'completed' },
      });
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ================= 批量操作：定时任务按门槛生成草稿 =================
  async batchGenerateDrafts(limit: number = 5, minScore: number = 80) {
    this.logger.log(
      `开始执行批量生成草稿任务，寻找 AI 评分 >= ${minScore} 的待处理选题，最多处理 ${limit} 个...`,
    );

    const topics = await this.prisma.topic.findMany({
      where: {
        status: 'completed',
        isPublished: false,
        aiScore: { gte: minScore },
      },
      orderBy: {
        aiScore: 'desc',
      },
      take: limit,
    });

    if (topics.length === 0) {
      this.logger.log('当前没有符合生成门槛的待处理选题。');
      return { processed: 0, message: '无符合条件选题' };
    }

    let successCount = 0;
    let failCount = 0;
    const generatedArticleIds: string[] = [];

    for (const topic of topics) {
      try {
        this.logger.log(
          `>>> 批量生成进度: 正在处理选题 「${topic.title}」 (分数: ${topic.aiScore})`,
        );
        const article = await this.generateFromTopic(
          topic.id,
          false,
          'article',
          true,
        );
        generatedArticleIds.push(article.id);
        successCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知错误';
        this.logger.error(`批量生成「${topic.title}」失败: ${message}`);
        failCount++;
      }
    }

    const msg = `批量文章生成完毕。成功: ${successCount}，失败: ${failCount}。`;
    this.logger.log(msg);
    if (successCount > 0) {
      await this.systemLogsService.record(msg, 'success');
    }
    return {
      processed: topics.length,
      successCount,
      failCount,
      message: msg,
      generatedArticleIds,
    };
  }

  // ============== 常规 CRUD ===============
  async createXiaohongshuDraftFromAgent(
    input: AgentWakerXiaohongshuDraftInput,
  ) {
    const ownerScope = await this.resolveArticleOwnerScope();
    const payload = this.parseXiaohongshuPayload(
      JSON.stringify({
        title: input.title,
        caption: input.caption,
        hashtags: input.hashtags,
        slides: input.slides,
      }),
      input.title || '小红书笔记',
    );
    const defaults = await this.defaultModels.getDefaults();
    const imageStyle = input.generateBackgrounds
      ? await this.prisma.style.findFirst({
          where: { isDefault: true, type: 'image' },
        })
      : null;
    const imageStyleParams =
      (imageStyle?.parameters as {
        ratio?: string;
        resolution?: string;
      } | null) || undefined;

    const slides = await Promise.all(
      payload.slides.map(async (slide, index) => {
        const backgroundImageUrl =
          input.generateBackgrounds &&
          defaults.imageCreation &&
          slide.imageType === 'ai' &&
          slide.imagePrompt
            ? await this.imageSelector
                .selectImage(
                  'ai',
                  slide.imagePrompt,
                  [],
                  imageStyle?.promptTemplate,
                  { ...imageStyleParams, ratio: '3:4' },
                )
                .catch(() => null)
            : null;
        const cardImageUrl =
          input.generateCards === false
            ? ''
            : await this.renderXiaohongshuCardPng(
                renderXiaohongshuCardSvg({
                  role: slide.role,
                  template: slide.template,
                  title: slide.title,
                  body: slide.body,
                  bullets: slide.bullets,
                  highlight: slide.highlight,
                  imageType: backgroundImageUrl ? slide.imageType : 'none',
                  backgroundImageUrl,
                  pageNumber: index + 1,
                  totalPages: payload.slides.length,
                }),
                index,
              );

        return {
          ...slide,
          coverText: slide.title,
          bodyText: slide.body,
          imageUrl: backgroundImageUrl,
          backgroundImageUrl,
          cardImageUrl,
        };
      }),
    );
    const xiaohongshuData: XiaohongshuNoteData = {
      title: payload.title,
      caption: payload.caption,
      hashtags: payload.hashtags,
      slides,
    };
    const article = await this.prisma.article.create({
      data: {
        title: payload.title,
        content: this.buildXiaohongshuContent(
          payload.caption,
          payload.hashtags,
        ),
        contentType: 'xiaohongshu',
        contentFormat: 'markdown',
        xiaohongshuData,
        coverImage: slides[0]?.cardImageUrl || null,
        status: 'draft',
        modelId: input.modelId || null,
        ...ownerScope,
      },
    });
    await this.systemLogsService.record(
      `AgentWaker 小红书笔记「${payload.title}」已写入内容库`,
      'success',
    );
    return article;
  }

  async createWechatDraftFromAgent(input: AgentWakerWechatDraftInput) {
    const ownerScope = await this.resolveArticleOwnerScope();
    const title = input.title.trim().slice(0, 120);
    const markdown = input.markdown.trim();
    const html = input.html.trim();
    if (!title || !markdown || !html) {
      throw new HttpException(
        '公众号文章缺少标题、Markdown 或微信 HTML。',
        HttpStatus.BAD_REQUEST,
      );
    }

    const article = await this.prisma.article.create({
      data: {
        title,
        content: markdown,
        contentType: 'article',
        contentFormat: 'markdown',
        rawHtml: html,
        finalHtml: html,
        wechatData: {
          channel: 'wechat-official-account',
          digest: input.digest,
          author: input.author,
          coverPrompt: input.coverPrompt,
          sourceUrl: input.sourceUrl || null,
          sourceLedger: input.sourceLedger,
          preview: {
            visibility: 'local-private',
            assetGate: 'pending',
            integratedRenderGate: 'pass',
            remoteRenderGate: 'pending',
          },
        },
        status: 'draft',
        modelId: input.modelId || null,
        ...ownerScope,
      },
    });
    await this.systemLogsService.record(
      `AgentWaker 公众号文章「${title}」已写入文章库`,
      'success',
    );
    return article;
  }

  async findAll(query: Record<string, string | number | undefined>) {
    const { page = 1, limit = 10, keyword, status, contentType } = query;
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10));
    const skip = (safePage - 1) * safeLimit;
    const ownerScope = await this.resolveArticleOwnerScope();

    const whereCondition: Record<string, unknown> = { ...ownerScope };

    if (keyword) {
      whereCondition.OR = [
        { title: { contains: keyword } },
        { content: { contains: keyword } },
        { rawHtml: { contains: keyword } },
        { finalHtml: { contains: keyword } },
      ];
    }

    if (status && status !== 'all') {
      whereCondition.status = status;
    }

    if (contentType && contentType !== 'all') {
      whereCondition.contentType = contentType;
    }

    const [items, total] = await Promise.all([
      this.prisma.article.findMany({
        where: whereCondition,
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          topicId: true,
          title: true,
          // 列表页摘要只需正文开头，不返回全文大字段：
          // content 保留（前端用 normalizedExcerpt 截断做摘要，字段本身为 markdown 文本），
          // rawHtml / finalHtml（HTML 模板）、workspaceBrief / workspaceOutline / xiaohongshuData /
          // wechatData（JSON 结构）都是详情页才需要，全量返回会把列表 payload 撑到 10MB+，
          // 导致移动端 WebView 传输超时（内容工作室「内容服务暂时不可用」）。
          content: true,
          contentType: true,
          contentFormat: true,
          workspaceStep: true,
          workspaceRevision: true,
          status: true,
          coverImage: true,
          templateId: true,
          createdAt: true,
          updatedAt: true,
          topic: { select: { title: true, keywords: true } },
          template: { select: { id: true, name: true } },
        },
      }),
      this.prisma.article.count({ where: whereCondition }),
    ]);

    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async findOne(id: string) {
    const ownerScope = await this.resolveArticleOwnerScope();
    return this.prisma.article.findFirst({
      where: { id, ...ownerScope },
      include: {
        topic: { select: { title: true, keywords: true } },
        template: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: string, data: UpdateArticleInput) {
    const ownerScope = await this.resolveArticleOwnerScope();
    const currentArticle = await this.prisma.article.findFirst({
      where: { id, ...ownerScope },
    });
    if (!currentArticle) {
      throw new HttpException('文章不存在', HttpStatus.NOT_FOUND);
    }

    const nextFormat =
      data.contentFormat ||
      (currentArticle.contentFormat as ArticleContentFormat);
    const nextContent =
      data.content ?? data.finalHtml ?? currentArticle.content;
    const isHtmlArticle = nextFormat === 'html';
    const hasContentWrite =
      data.content !== undefined || data.finalHtml !== undefined;
    const currentWorkspaceBrief = normalizeStoredWorkspaceBrief(
      currentArticle.workspaceBrief,
    );
    const workspaceBrief =
      data.workspaceBrief !== undefined
        ? markChangedWorkspaceBriefFields(
            currentWorkspaceBrief,
            normalizeWorkspaceBrief(
              data.workspaceBrief,
              currentWorkspaceBrief.fieldSources,
            ),
          )
        : undefined;
    const currentWorkspaceOutline = normalizeStoredWorkspaceOutline(
      currentArticle.workspaceOutline,
    );
    const requestedWorkspaceOutline =
      data.workspaceOutline !== undefined
        ? normalizeWorkspaceOutline(data.workspaceOutline)
        : currentWorkspaceOutline;
    const outlineItemsChanged =
      JSON.stringify(requestedWorkspaceOutline.items) !==
      JSON.stringify(currentWorkspaceOutline.items);
    const wasLegacyArticle = Boolean(
      currentArticle.workspaceBrief === null &&
      currentArticle.workspaceOutline === null &&
      currentArticle.content.trim(),
    );
    let nextWorkspaceOutline: ArticleWorkspaceOutline = {
      items: requestedWorkspaceOutline.items,
      confirmedAt: outlineItemsChanged
        ? null
        : currentWorkspaceOutline.confirmedAt,
      confirmedItemsHash: outlineItemsChanged
        ? null
        : currentWorkspaceOutline.confirmedItemsHash,
      ...(currentWorkspaceOutline.legacyBodyWithoutOutline === true &&
      requestedWorkspaceOutline.items.length === 0
        ? { legacyBodyWithoutOutline: true as const }
        : {}),
    };
    if (data.confirmWorkspaceOutline === true) {
      if (
        nextWorkspaceOutline.items.length === 0 ||
        nextWorkspaceOutline.items.some((item) => !item.title.trim())
      ) {
        return invalidWorkspaceValue('请先补全至少一个大纲节点再确认');
      }
      nextWorkspaceOutline = {
        items: nextWorkspaceOutline.items,
        confirmedAt: new Date().toISOString(),
        confirmedItemsHash: workspaceOutlineItemsHash(
          nextWorkspaceOutline.items,
        ),
      };
    }
    const workspaceStep =
      data.workspaceStep !== undefined
        ? normalizeWorkspaceStep(data.workspaceStep)
        : undefined;
    const currentWorkspaceStep = ARTICLE_WORKSPACE_STEPS.has(
      currentArticle.workspaceStep as ArticleWorkspaceStep,
    )
      ? (currentArticle.workspaceStep as ArticleWorkspaceStep)
      : 'brief';
    const effectiveWorkspaceStep = workspaceStep ?? currentWorkspaceStep;
    const legacyDraftAllowed = Boolean(
      effectiveWorkspaceStep === 'draft' &&
      nextWorkspaceOutline.items.length === 0 &&
      (currentWorkspaceOutline.legacyBodyWithoutOutline === true ||
        wasLegacyArticle),
    );
    if (
      ['draft', 'versions', 'review'].includes(effectiveWorkspaceStep) &&
      !hasValidWorkspaceOutlineConfirmation(nextWorkspaceOutline) &&
      !legacyDraftAllowed
    ) {
      return invalidWorkspaceValue('请先确认当前内容大纲再进入后续步骤');
    }
    if (legacyDraftAllowed) {
      nextWorkspaceOutline = {
        ...nextWorkspaceOutline,
        legacyBodyWithoutOutline: true,
      };
    }
    const workspaceOutline =
      data.workspaceOutline !== undefined ||
      data.confirmWorkspaceOutline === true ||
      (legacyDraftAllowed && currentArticle.workspaceOutline === null)
        ? nextWorkspaceOutline
        : undefined;
    const workspaceBriefChanged =
      workspaceBrief !== undefined &&
      !normalizedWorkspaceValueEquals(
        currentArticle.workspaceBrief,
        workspaceBrief,
        normalizeWorkspaceBrief,
        createEmptyWorkspaceBrief(),
      );
    const workspaceOutlineChanged =
      workspaceOutline !== undefined &&
      !normalizedWorkspaceValueEquals(
        currentArticle.workspaceOutline,
        workspaceOutline,
        normalizeStoredWorkspaceOutline,
        createEmptyWorkspaceOutline(),
      );
    const workspaceStepChanged =
      workspaceStep !== undefined && workspaceStep !== currentWorkspaceStep;
    const hasWorkspaceChange =
      workspaceBriefChanged ||
      workspaceOutlineChanged ||
      workspaceStepChanged ||
      (data.title !== undefined && data.title !== currentArticle.title) ||
      (hasContentWrite && nextContent !== currentArticle.content) ||
      (data.contentFormat !== undefined &&
        nextFormat !== currentArticle.contentFormat);

    return this.prisma.article.update({
      where: { id },
      data: {
        title: data.title,
        content: nextContent,
        contentFormat: nextFormat,
        workspaceBrief:
          workspaceBrief === undefined
            ? undefined
            : (workspaceBrief as Prisma.InputJsonValue),
        workspaceOutline:
          workspaceOutline === undefined
            ? undefined
            : (workspaceOutline as Prisma.InputJsonValue),
        workspaceStep,
        workspaceRevision: hasWorkspaceChange ? { increment: 1 } : undefined,
        rawHtml:
          data.rawHtml ??
          (hasContentWrite
            ? isHtmlArticle
              ? nextContent
              : null
            : currentArticle.rawHtml),
        finalHtml: isHtmlArticle
          ? (data.finalHtml ??
            data.content ??
            currentArticle.finalHtml ??
            nextContent)
          : null,
      },
    });
  }

  async remove(id: string) {
    const ownerScope = await this.resolveArticleOwnerScope();
    const article = await this.prisma.article.findFirst({
      where: { id, ...ownerScope },
      select: { id: true },
    });
    if (!article) {
      throw new HttpException('文章不存在', HttpStatus.NOT_FOUND);
    }
    return this.prisma.article.delete({ where: { id } });
  }

  private async resolveArticleOwnerScope(): Promise<
    ArticleOwnerScope | Record<string, never>
  >;
  private async resolveArticleOwnerScope(
    allowScheduledLegacyOwner: boolean,
  ): Promise<ArticleOwnerScope | Record<string, never>>;
  private async resolveArticleOwnerScope(
    allowScheduledLegacyOwner = false,
  ): Promise<ArticleOwnerScope | Record<string, never>> {
    if (!this.authRequestContext) {
      return {};
    }
    if (!this.authRequestContext.hasContext()) {
      if (allowScheduledLegacyOwner) {
        return {
          tenantId: 'legacy-local-desktop',
          userId: 'legacy-local-user',
        };
      }
      throw new UnauthorizedException('缺少登录上下文，不能管理文章。');
    }

    const user = this.authRequestContext.get()?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后管理文章。');
    }

    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }

  private buildSystemPrompt(
    contentType: ArticleContentType,
    stylePrompt: string,
    contentFormat: ArticleContentFormat,
    templateHtml: string,
    templateNotes: string,
  ): string {
    if (contentType === 'xiaohongshu') {
      return `你现在是一个专业的小红书内容策划与爆款笔记写手，熟悉种草、经验总结、避坑清单、观点表达和互动转化。

【你的写作风格要求】：
${stylePrompt}

【小红书笔记写作要求】：
1. 这是“文字排版优先、图片辅助”的多图卡片笔记，不要把它写成长文章。
2. 一共输出 6 到 7 张卡片，默认适配 3:4 竖版成品卡图。
3. 第 1 张必须是封面大字报，模板固定为 \`cover-poster\`，主标题要强利益点、强冲突或强结果感。
4. 第 2 到第 6/7 张必须使用固定模板集合：\`insight-card\`、\`bullet-list\`、\`checklist-card\`、\`summary-card\`。
5. 每张卡片都必须返回：
- \`role\`：\`cover\` / \`hook\` / \`problem\` / \`solution\` / \`method\` / \`summary\` / \`cta\`
- \`template\`：固定模板名，必须从上面的模板集合里选
- \`title\`：卡片主标题，控制在 8 到 18 个字
- \`body\`：卡片主体说明，控制在 18 到 60 个字
- \`bullets\`：如果是列表模板，返回 2 到 4 条要点，否则返回空数组
- \`highlight\`：该页最值得被记住的一句短话，控制在 6 到 16 个字，可为空字符串
- \`imagePrompt\`：如果需要辅助背景图，给出精准中文提示词；如果不需要，返回空字符串
- \`imageType\`：\`real\` / \`ai\` / \`none\`
6. 只有封面页和极少数页面允许使用图片辅助；大多数页面应以纯文字信息卡为主。
7. 如果素材里存在可复用原图，封面页优先考虑 \`imageType: "real"\`；如果纯文字卡更稳，也可以直接用 \`none\`。
8. 总说明文案（caption）控制在 80 到 160 字，口语化、结论先行，不要长篇展开。
9. 结尾补充 4 到 6 个适合小红书语境的话题标签。
10. 不要输出 Markdown，不要输出解释，只返回 JSON。

【输出格式】：
你的回复必须是纯 JSON：
{"title":"笔记标题","caption":"短说明文案","hashtags":["标签1","标签2"],"slides":[{"role":"cover","template":"cover-poster","title":"封面主标题","body":"封面副标题","bullets":[],"highlight":"适合谁看","imagePrompt":"办公室氛围感背景","imageType":"real"}]}

只能返回 JSON，不要附加解释。`;
    }

    if (contentFormat === 'html') {
      return `你现在是一个爆款文章的资深内容主理人，同时也是一个严格遵守模板的 HTML 编辑器。

【你的写作风格要求】：
${stylePrompt}

【HTML 模板】（模板仅供参考，灵活采用。）：
${templateHtml}

【模板补充说明】：
${templateNotes || '无额外备注'}

【排版与配图法则】：
1. 必须保留模板主体结构、内联样式、模块顺序和视觉层级。
2. 必须直接输出完整 HTML，不要输出 Markdown，不要输出代码块围栏。
3. 模板中的示例文案要替换成真实内容，但不要删除关键模块。
4. 所有图片节点必须保留在 HTML 中，且 \`src\` 使用占位符：
- 真实素材图：\`[real-image-详细描述]\`
- AI 生成图：\`[ai-image-详细精准的视觉画面描述]\`
5. 如果素材中存在可复用原图，至少优先使用 1 张 \`[real-image-...]\`。
6. 不要填写真实图片 URL，不要省略图片节点，不要输出脚本标签。

【输出格式】：
严格按下面格式返回，不要输出 JSON，不要输出 Markdown 代码块，不要附加解释：
TITLE_START
这里写文章标题
TITLE_END
HTML_START
这里写完整 HTML
HTML_END`;
    }

    return `你现在是一个爆款文章的资深内容主理人。

【你的写作风格要求】：
${stylePrompt}

【排版与配图法则】：
你在文章中需要穿插 2 到 3 张配图。根据内容需求选择合适的配图类型：
- 产品截图、数据图表、真实场景照片 → 使用 \`[real-image-详细描述]\`
- 概念图、创意插图、抽象表达 → 使用 \`[ai-image-详细精准的视觉画面描述]\`

重要规则：如果参考素材里存在“有可复用原图”的素材，必须优先至少使用 1 张 \`[real-image-...]\`；只有确实需要概念插图时才使用 \`[ai-image-...]\`。

【输出格式】：
你的回复必须是纯 JSON：
{"title":"文章标题","content":"Markdown 正文（包含图片占位符）"}

只能返回 JSON，不要附加解释。`;
  }

  private buildUserPrompt(params: {
    contentType: ArticleContentType;
    topicTitle: string;
    topicSummary: string;
    keywords: string[];
    materialContents: string;
    templateNotes: string;
    retryReason?: string;
  }): string {
    const retryInstruction = params.retryReason
      ? `\n【上次输出失败原因】：${params.retryReason}
【本次补充要求】：
1. 必须从头输出完整成稿，不要续写半截内容。
2. ${params.contentType === 'xiaohongshu' ? '不要遗漏标题、开场钩子、核心观点和结尾标签。' : '必须覆盖模板中的全部模块，尤其不要省略底部总结、CTA、互动区等尾部结构。'}
3. 如果输出过长，请压缩单段文案长度，而不是删除核心结构。\n`
      : '';

    return `【选题核心方向】：${params.topicTitle}

【选题分析或摘要】：${params.topicSummary}
【相关关键词】：${params.keywords.join(', ')}
【模板注意事项】：${params.templateNotes || '无'}
${retryInstruction}

以下是收集到的客观事实素材（请将它们内化为你的“独立观察”，用你的口吻表达出来，禁忌重复“基于素材”等新闻机器人的废话）：

${params.materialContents}`;
  }

  private async generateXiaohongshuNote(params: {
    modelId: string;
    stylePrompt: string;
    topicTitle: string;
    topicSummary: string;
    keywords: string[];
    materialContents: string;
    materialInfos: MaterialInfo[];
    imageStylePrompt?: string;
    imageStyleParams?: { ratio?: string; resolution?: string };
    imageCreationEnabled: boolean;
    signal?: AbortSignal;
  }): Promise<XiaohongshuNoteData> {
    throwIfAborted(params.signal);
    const textOptions = {
      temperature: 0.8,
      maxTokens: 5000,
      knowledgeMode: 'contextual' as const,
      ...(params.signal ? { signal: params.signal } : {}),
    };
    const aiResponseText = await this.aiClient.generate(
      params.modelId,
      [
        {
          role: 'system',
          content: this.buildSystemPrompt(
            'xiaohongshu',
            params.stylePrompt,
            'markdown',
            '',
            '',
          ),
        },
        {
          role: 'user',
          content: this.buildUserPrompt({
            contentType: 'xiaohongshu',
            topicTitle: params.topicTitle,
            topicSummary: params.topicSummary,
            keywords: params.keywords,
            materialContents: params.materialContents,
            templateNotes: '',
          }),
        },
      ],
      textOptions,
    );

    const payload = this.parseXiaohongshuPayload(
      aiResponseText,
      params.topicTitle,
    );
    const imageParams = {
      ...params.imageStyleParams,
      ratio: '3:4',
    };

    const slides = await Promise.all(
      payload.slides.map(async (slide, index) => {
        const imageUrl =
          params.imageCreationEnabled &&
          slide.imageType !== 'none' &&
          slide.imagePrompt
            ? await (async () => {
                try {
                  const imageType = slide.imageType === 'real' ? 'real' : 'ai';
                  const args = [
                    imageType,
                    slide.imagePrompt,
                    params.materialInfos,
                    params.imageStylePrompt,
                    imageParams,
                  ] as const;
                  return params.signal
                    ? await this.imageSelector.selectImage(
                        ...args,
                        params.signal,
                      )
                    : await this.imageSelector.selectImage(...args);
                } catch (error) {
                  rethrowAbort(error, params.signal);
                  return null;
                }
              })()
            : null;

        const cardSvg = renderXiaohongshuCardSvg({
          role: slide.role,
          template: slide.template,
          title: slide.title,
          body: slide.body,
          bullets: slide.bullets,
          highlight: slide.highlight,
          imageType: slide.imageType,
          backgroundImageUrl: imageUrl,
          pageNumber: index + 1,
          totalPages: payload.slides.length,
        });
        const cardImageUrl = await this.renderXiaohongshuCardPng(
          cardSvg,
          index,
          params.signal,
        );

        return {
          ...slide,
          coverText: slide.title,
          bodyText: slide.body,
          imageUrl,
          backgroundImageUrl: imageUrl,
          cardImageUrl,
        };
      }),
    );

    return {
      title: payload.title,
      caption: payload.caption,
      hashtags: payload.hashtags,
      slides,
    };
  }

  private parseXiaohongshuPayload(
    aiResponseText: string,
    fallbackTitle: string,
  ): GeneratedXiaohongshuPayload {
    const cleanedText = this.stripCodeFence(aiResponseText.trim());

    let parsedPayload: Record<string, unknown> | null = null;
    try {
      parsedPayload = JSON.parse(cleanedText) as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.warn(`小红书 JSON 解析失败，尝试容错提取: ${message}`);
      const fragment = this.extractBalancedJsonFragment(cleanedText);
      if (fragment && fragment !== cleanedText) {
        try {
          parsedPayload = JSON.parse(fragment) as Record<string, unknown>;
        } catch {
          parsedPayload = null;
        }
      }
    }

    if (!parsedPayload) {
      this.logger.warn('小红书 JSON 容错提取失败，已启用兜底卡片骨架');
      return this.buildFallbackXiaohongshuPayload(fallbackTitle);
    }

    const rawSlides = Array.isArray(parsedPayload?.slides)
      ? parsedPayload.slides
      : [];
    const slides = rawSlides
      .map((slide, index) => this.normalizeXiaohongshuSlide(slide, index))
      .filter((slide): slide is XiaohongshuSlidePlan => Boolean(slide));

    if (slides.length < 5) {
      this.logger.warn(
        `小红书卡片数量不足，已启用兜底卡片骨架: slides=${slides.length}`,
      );
      return this.buildFallbackXiaohongshuPayload(fallbackTitle);
    }

    const hashtags = Array.isArray(parsedPayload?.hashtags)
      ? parsedPayload.hashtags
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

    return {
      title: this.normalizeTextValue(parsedPayload?.title, fallbackTitle),
      caption: this.normalizeTextValue(parsedPayload?.caption, ''),
      hashtags: hashtags.slice(0, 8),
      slides: slides.slice(0, 9),
    };
  }

  private buildFallbackXiaohongshuPayload(
    fallbackTitle: string,
  ): GeneratedXiaohongshuPayload {
    const title = this.clampXiaohongshuText(
      this.normalizeTextValue(fallbackTitle, '小红书内容卡片')
        .replace(/\s+/g, ' ')
        .trim(),
      18,
    );
    const baseTitle = title || '小红书内容卡片';
    const coreTitle = baseTitle.replace(/[｜|].*$/, '').trim() || baseTitle;
    const caption = this.clampXiaohongshuText(
      `这次先用稳定的卡片骨架把 ${coreTitle} 跑通，后面再逐步替换成更具体的业务内容。`,
      120,
    );
    const hashtags = [
      '#小红书',
      '#内容运营',
      '#商业验收',
      '#AI写作',
      '#发布中心',
    ];
    const slides: XiaohongshuSlidePlan[] = [
      {
        role: 'cover',
        template: 'cover-poster',
        title: this.clampXiaohongshuText(coreTitle || '小红书内容卡片', 18),
        body: this.clampXiaohongshuText(
          '先把结构跑通，再把细节替换成真实业务素材。',
          48,
        ),
        bullets: [],
        highlight: '先稳定，再优化',
        imagePrompt: '',
        imageType: 'none',
      },
      {
        role: 'hook',
        template: 'insight-card',
        title: '为什么先做骨架',
        body: this.clampXiaohongshuText(
          '当模型偶发不按格式输出时，骨架兜底能保证整条链路继续往下走。',
          56,
        ),
        bullets: [],
        highlight: '不中断比完美更重要',
        imagePrompt: '',
        imageType: 'none',
      },
      {
        role: 'problem',
        template: 'bullet-list',
        title: '常见翻车点',
        body: '格式、长度和结构一乱，卡片生成就容易断。',
        bullets: ['输出不是纯 JSON', '卡片数量不足', '标题和正文层级混乱'],
        highlight: '先把失败面收窄',
        imagePrompt: '',
        imageType: 'none',
      },
      {
        role: 'solution',
        template: 'checklist-card',
        title: '最小可交付清单',
        body: '先保证标题、文案、标签和 5 张以上卡片都能落地。',
        bullets: ['标题可读', '正文完整', '标签可用'],
        highlight: '先达标，再精修',
        imagePrompt: '',
        imageType: 'none',
      },
      {
        role: 'method',
        template: 'checklist-card',
        title: '怎么把链路跑稳',
        body: '先容错，再回退，再补强，最后再把模型输出质量拉上来。',
        bullets: ['先容错解析', '再用骨架兜底', '最后迭代提示词'],
        highlight: '链路优先于模型',
        imagePrompt: '',
        imageType: 'none',
      },
      {
        role: 'summary',
        template: 'summary-card',
        title: '下一步怎么做',
        body: '先让生成、导入和发布都可持续，再逐步把骨架替换成更强的模型结果。',
        bullets: [],
        highlight: '可持续比一次过更值钱',
        imagePrompt: '',
        imageType: 'none',
      },
    ];

    return {
      title: baseTitle,
      caption,
      hashtags,
      slides,
    };
  }

  private extractBalancedJsonFragment(source: string): string {
    const startIndex = source.search(/[{[]/);
    if (startIndex === -1) {
      return '';
    }

    const open = source[startIndex];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === open) {
        depth += 1;
        continue;
      }
      if (char === close) {
        depth -= 1;
        if (depth === 0) {
          return source.slice(startIndex, index + 1).trim();
        }
      }
    }

    return '';
  }

  private normalizeXiaohongshuSlide(
    slide: unknown,
    index: number,
  ): XiaohongshuSlidePlan | null {
    if (!slide || typeof slide !== 'object') {
      return null;
    }

    const record = slide as Record<string, unknown>;
    const title = this.clampXiaohongshuText(
      this.normalizeTextValue(
        record.title,
        this.normalizeTextValue(record.coverText, ''),
      ).trim(),
      index === 0 ? 22 : 24,
    );
    const body = this.clampXiaohongshuText(
      this.normalizeTextValue(
        record.body,
        this.normalizeTextValue(record.bodyText, ''),
      ).trim(),
      index === 0 ? 46 : 88,
    );
    const bullets = Array.isArray(record.bullets)
      ? record.bullets
          .filter((item): item is string => typeof item === 'string')
          .map((item) => this.clampXiaohongshuText(item.trim(), 30))
          .filter(Boolean)
          .slice(0, 4)
      : [];
    const highlight = this.clampXiaohongshuText(
      this.normalizeTextValue(record.highlight, '').trim(),
      18,
    );
    const imagePrompt = this.clampXiaohongshuText(
      this.normalizeTextValue(record.imagePrompt, '').trim(),
      40,
    );
    const rawImageType =
      record.imageType === 'real'
        ? 'real'
        : record.imageType === 'none'
          ? 'none'
          : 'ai';
    const role =
      index === 0 ? 'cover' : this.normalizeXiaohongshuRole(record.role, index);
    const template =
      index === 0
        ? 'cover-poster'
        : this.normalizeXiaohongshuTemplate(
            record.template,
            role,
            bullets,
            index,
          );
    const imageType = imagePrompt ? rawImageType : 'none';

    if (!title || (!body && bullets.length === 0)) {
      return null;
    }

    return {
      role,
      template,
      title,
      body,
      bullets,
      highlight,
      imagePrompt,
      imageType,
    };
  }

  private clampXiaohongshuText(value: string, maxChars: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    const chars = Array.from(normalized);
    if (chars.length <= maxChars) {
      return normalized;
    }

    return `${chars
      .slice(0, Math.max(1, maxChars - 1))
      .join('')
      .replace(/[.。…！!？?，,；;：: ]+$/g, '')}…`;
  }

  private normalizeXiaohongshuRole(
    value: unknown,
    index: number,
  ): XiaohongshuSlideRole {
    const role = typeof value === 'string' ? value.trim() : '';
    const fallbackRoles: XiaohongshuSlideRole[] = [
      'cover',
      'hook',
      'problem',
      'solution',
      'method',
      'summary',
      'cta',
    ];
    const normalizedRole = fallbackRoles.find((item) => item === role);
    return (
      normalizedRole || fallbackRoles[Math.min(index, fallbackRoles.length - 1)]
    );
  }

  private normalizeXiaohongshuTemplate(
    value: unknown,
    role: XiaohongshuSlideRole,
    bullets: string[],
    index: number,
  ): XiaohongshuSlideTemplate {
    const template = typeof value === 'string' ? value.trim() : '';
    const availableTemplates: XiaohongshuSlideTemplate[] = [
      'cover-poster',
      'insight-card',
      'bullet-list',
      'checklist-card',
      'summary-card',
    ];
    const normalized = availableTemplates.find((item) => item === template);
    if (normalized) {
      return normalized;
    }

    if (index === 0 || role === 'cover') {
      return 'cover-poster';
    }
    if (role === 'summary' || role === 'cta') {
      return 'summary-card';
    }
    if (bullets.length >= 3) {
      return role === 'method' ? 'checklist-card' : 'bullet-list';
    }

    return 'insight-card';
  }

  private async renderXiaohongshuCardPng(
    svg: string,
    index: number,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      throwIfAborted(signal);
      const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
      const uploadedUrl = signal
        ? await this.storageService.uploadBuffer(
            pngBuffer,
            'png',
            'xiaohongshu-cards',
            signal,
          )
        : await this.storageService.uploadBuffer(
            pngBuffer,
            'png',
            'xiaohongshu-cards',
          );
      if (uploadedUrl) {
        return uploadedUrl;
      }

      return `data:image/png;base64,${pngBuffer.toString('base64')}`;
    } catch (error) {
      rethrowAbort(error, signal);
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.warn(
        `第 ${index + 1} 张小红书卡图转 PNG 失败，回退 SVG：${message}`,
      );
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }
  }

  private buildXiaohongshuContent(caption: string, hashtags: string[]): string {
    const tagLine =
      hashtags.length > 0
        ? hashtags
            .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
            .join(' ')
        : '';
    return [caption.trim(), tagLine].filter(Boolean).join('\n\n');
  }

  private getContentLabel(contentType: ArticleContentType): string {
    return contentType === 'xiaohongshu' ? '小红书笔记' : '文章';
  }

  private getDefaultStylePrompt(contentType: ArticleContentType): string {
    if (contentType === 'xiaohongshu') {
      return '你是一个懂选题、懂情绪价值、懂口语化表达的小红书内容创作者，请写出真实、有观点、有传播感的中文笔记。';
    }

    return '你是一个专业的内容创作者，请清晰、逻辑严密地撰写文章。';
  }

  private async generateArticlePayload(params: {
    modelId: string;
    systemPrompt: string;
    userPrompt: string;
    fallbackTitle: string;
    contentFormat: ArticleContentFormat;
    templateHtml: string;
    signal?: AbortSignal;
  }): Promise<GeneratedArticlePayload> {
    let lastReason = '';

    for (
      let attempt = 1;
      attempt <= ARTICLE_MAX_GENERATION_ATTEMPTS;
      attempt++
    ) {
      throwIfAborted(params.signal);
      const finalUserPrompt =
        attempt === 1
          ? params.userPrompt
          : `${params.userPrompt}\n\n【重试要求】：${lastReason || '上次输出不完整'}\n请重新完整输出整篇文章。`;

      const aiResponseText = await this.aiClient.generate(
        params.modelId,
        [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: finalUserPrompt },
        ],
        {
          temperature: 0.7,
          maxTokens:
            params.contentFormat === 'html'
              ? ARTICLE_HTML_MAX_TOKENS
              : ARTICLE_MARKDOWN_MAX_TOKENS,
          knowledgeMode: 'contextual',
          ...(params.signal ? { signal: params.signal } : {}),
        },
      );

      const articleData = this.parseArticlePayload(
        aiResponseText,
        params.fallbackTitle,
        params.contentFormat,
      );
      if (!articleData.content || !articleData.title) {
        throw new Error('大语言模型未能按要求生成文章正文和标题');
      }

      if (params.contentFormat !== 'html') {
        return articleData;
      }

      const validation = this.validateHtmlArticle(
        articleData.content,
        params.templateHtml,
      );
      if (validation.isComplete) {
        return articleData;
      }

      const continuedContent = await this.tryContinueHtmlArticle({
        modelId: params.modelId,
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        fallbackTitle: articleData.title || params.fallbackTitle,
        incompleteContent: articleData.content,
        templateHtml: params.templateHtml,
        validationReason: validation.reason,
        signal: params.signal,
      });
      if (continuedContent) {
        return {
          ...articleData,
          content: continuedContent,
        };
      }

      lastReason = validation.reason;
      const warnMsg = `HTML 文章生成第 ${attempt} 次校验未通过：${validation.reason}`;
      this.logger.warn(warnMsg);
      await this.systemLogsService.record(warnMsg, 'warning');
    }

    throw new Error(
      `AI 返回的 HTML 不完整：${lastReason || '未通过完整性校验'}`,
    );
  }

  private parseArticlePayload(
    aiResponseText: string,
    fallbackTitle: string,
    contentFormat: ArticleContentFormat,
  ): GeneratedArticlePayload {
    const cleanedText = this.stripCodeFence(aiResponseText.trim());

    if (contentFormat === 'html') {
      const blockTitle = this.extractBetween(
        cleanedText,
        'TITLE_START',
        'TITLE_END',
      );
      const blockHtml = this.extractBetween(
        cleanedText,
        'HTML_START',
        'HTML_END',
      );
      if (blockTitle.trim() && blockHtml.trim()) {
        return {
          title: blockTitle.trim(),
          content: blockHtml.trim(),
          contentFormat,
        };
      }
    }

    let parsedPayload: Record<string, unknown> | null = null;

    try {
      parsedPayload = JSON.parse(cleanedText) as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`AI JSON 解析失败，进入容错提取: ${message}`);
    }

    const title = this.normalizeTextValue(
      parsedPayload?.title,
      this.extractFieldByRegex(cleanedText, 'title') || fallbackTitle,
    );

    const candidates =
      contentFormat === 'html'
        ? ['rawHtml', 'html', 'content']
        : ['content', 'rawHtml', 'html'];

    let content = '';
    for (const key of candidates) {
      const value = this.normalizeTextValue(parsedPayload?.[key], '');
      if (value.trim()) {
        content = value;
        break;
      }
      const extracted = this.extractFieldTolerantly(cleanedText, key);
      if (extracted.trim()) {
        content = extracted;
        break;
      }
    }

    if (!content.trim() && contentFormat === 'html') {
      content = this.extractHtmlFragment(cleanedText);
    }

    if (!content.trim()) {
      this.logger.warn('正文抽取失败，将直接保存 AI 原始返回');
      content = cleanedText;
    }

    return {
      title,
      content: this.unescapeModelText(content),
      contentFormat,
    };
  }

  private async tryContinueHtmlArticle(params: {
    modelId: string;
    systemPrompt: string;
    userPrompt: string;
    fallbackTitle: string;
    incompleteContent: string;
    templateHtml: string;
    validationReason: string;
    signal?: AbortSignal;
  }): Promise<string | null> {
    throwIfAborted(params.signal);
    const continuationMsg = `HTML 初稿疑似截断，尝试基于同一轮上下文续写补全。原因：${params.validationReason}`;
    this.logger.warn(continuationMsg);
    await this.systemLogsService.record(continuationMsg, 'warning');

    const aiResponseText = await this.aiClient.generate(
      params.modelId,
      [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
        {
          role: 'assistant',
          content: this.buildHtmlAssistantSnapshot(
            params.fallbackTitle,
            params.incompleteContent,
          ),
        },
        {
          role: 'user',
          content: this.buildHtmlContinuationPrompt(
            params.validationReason,
            params.incompleteContent,
          ),
        },
      ],
      {
        temperature: 0.3,
        maxTokens: ARTICLE_HTML_CONTINUATION_MAX_TOKENS,
        knowledgeMode: 'off',
        ...(params.signal ? { signal: params.signal } : {}),
      },
    );

    const standaloneHtml = this.extractStandaloneHtml(aiResponseText);
    if (standaloneHtml) {
      const standaloneValidation = this.validateHtmlArticle(
        standaloneHtml,
        params.templateHtml,
      );
      if (standaloneValidation.isComplete) {
        const successMsg = 'HTML 续写补全返回了完整成稿，直接采用补全结果';
        this.logger.log(successMsg);
        await this.systemLogsService.record(successMsg, 'info');
        return standaloneHtml;
      }
    }

    const continuation = this.extractHtmlContinuation(aiResponseText);
    if (!continuation) {
      const warnMsg = 'HTML 续写补全未提取到有效片段，将回退到整篇重生成';
      this.logger.warn(warnMsg);
      await this.systemLogsService.record(warnMsg, 'warning');
      return null;
    }

    const mergedContent = this.mergeHtmlContinuation(
      params.incompleteContent,
      continuation,
    );
    const mergedValidation = this.validateHtmlArticle(
      mergedContent,
      params.templateHtml,
    );
    if (mergedValidation.isComplete) {
      const successMsg = 'HTML 截断内容已通过续写补全恢复完整';
      this.logger.log(successMsg);
      await this.systemLogsService.record(successMsg, 'info');
      return mergedContent;
    }

    const warnMsg = `HTML 续写补全后仍未通过校验：${mergedValidation.reason}`;
    this.logger.warn(warnMsg);
    await this.systemLogsService.record(warnMsg, 'warning');
    return null;
  }

  private normalizeTextValue(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
  }

  private buildHtmlAssistantSnapshot(
    title: string,
    incompleteContent: string,
  ): string {
    return `TITLE_START
${title}
TITLE_END
HTML_START
${incompleteContent}
HTML_END`;
  }

  private buildHtmlContinuationPrompt(
    validationReason: string,
    incompleteContent: string,
  ): string {
    const tailPreview = incompleteContent.trim().slice(-800);
    return `你上一条消息里的 HTML 没有输出完整，失败原因是：${validationReason}

请严格基于你刚才已经写出的内容继续往后补全，不要重写标题，不要重复前文，不要从头再写。

【补全要求】：
1. 只输出“剩余缺失的 HTML 片段”。
2. 需要把未闭合的结构补齐，并完整收尾。
3. 不要输出解释，不要输出 Markdown 代码块。
4. 如果你判断上一条内容其实已经不适合续写，可以直接从头输出一份完整 HTML。

【上一段结尾参考】：
${tailPreview}

【输出格式】：
如果输出剩余片段，请严格使用：
HTML_CONTINUATION_START
这里写剩余 HTML 片段
HTML_CONTINUATION_END

如果输出完整 HTML，请严格使用：
HTML_START
这里写完整 HTML
HTML_END`;
  }

  private stripCodeFence(source: string): string {
    return source
      .replace(/^```(?:json|html)?\n/i, '')
      .replace(/\n```$/i, '')
      .trim();
  }

  private extractBetween(
    source: string,
    startToken: string,
    endToken: string,
  ): string {
    const startIndex = source.indexOf(startToken);
    if (startIndex === -1) {
      return '';
    }

    const contentStart = startIndex + startToken.length;
    const endIndex = source.indexOf(endToken, contentStart);
    if (endIndex === -1) {
      return '';
    }

    return source.slice(contentStart, endIndex).trim();
  }

  private extractFieldByRegex(source: string, field: string): string {
    const regex = new RegExp(
      `"${field}"\\s*:\\s*"([\\s\\S]*?)"(?:\\s*,|\\s*})`,
      'i',
    );
    const match = source.match(regex);
    return match ? match[1] : '';
  }

  private extractStandaloneHtml(source: string): string {
    const cleanedText = this.stripCodeFence(source.trim());
    const blockHtml = this.extractBetween(
      cleanedText,
      'HTML_START',
      'HTML_END',
    );
    if (blockHtml.trim()) {
      return this.unescapeModelText(blockHtml.trim());
    }

    const extractedHtml = this.extractHtmlFragment(cleanedText);
    return extractedHtml ? this.unescapeModelText(extractedHtml.trim()) : '';
  }

  private extractHtmlContinuation(source: string): string {
    const cleanedText = this.stripCodeFence(source.trim());
    const continuationBlock = this.extractBetween(
      cleanedText,
      'HTML_CONTINUATION_START',
      'HTML_CONTINUATION_END',
    );
    if (continuationBlock.trim()) {
      return this.unescapeModelText(continuationBlock.trim());
    }

    const standaloneHtml = this.extractBetween(
      cleanedText,
      'HTML_START',
      'HTML_END',
    );
    if (standaloneHtml.trim()) {
      return this.unescapeModelText(standaloneHtml.trim());
    }

    return '';
  }

  private mergeHtmlContinuation(
    incompleteContent: string,
    continuation: string,
  ): string {
    const base = incompleteContent.trimEnd();
    const extra = continuation.trim();

    if (!extra) {
      return base;
    }

    if (base.includes(extra)) {
      return base;
    }

    if (extra.includes(base) && extra.length > base.length) {
      return extra;
    }

    const maxOverlap = Math.min(base.length, extra.length, 1200);
    for (let size = maxOverlap; size >= 20; size--) {
      if (base.slice(-size) === extra.slice(0, size)) {
        return `${base}${extra.slice(size)}`;
      }
    }

    return `${base}\n${extra}`;
  }

  private extractFieldTolerantly(source: string, field: string): string {
    const fieldIndex = source.indexOf(`"${field}"`);
    if (fieldIndex === -1) {
      return '';
    }

    const colonIndex = source.indexOf(':', fieldIndex);
    if (colonIndex === -1) {
      return '';
    }

    let valueStart = colonIndex + 1;
    while (valueStart < source.length && /\s/.test(source[valueStart])) {
      valueStart++;
    }

    if (source[valueStart] !== '"') {
      return '';
    }

    valueStart += 1;

    const nextKnownField = this.findNextKnownFieldIndex(source, valueStart);
    if (nextKnownField !== -1) {
      const candidate = source.slice(valueStart, nextKnownField).trimEnd();
      return candidate.replace(/",?\s*$/, '');
    }

    const closingBraceIndex = source.lastIndexOf('}');
    if (closingBraceIndex !== -1 && closingBraceIndex > valueStart) {
      const candidate = source.slice(valueStart, closingBraceIndex).trimEnd();
      return candidate.replace(/"\s*$/, '');
    }

    return source.slice(valueStart).trim();
  }

  private findNextKnownFieldIndex(source: string, fromIndex: number): number {
    const candidates = ['"rawHtml"', '"html"', '"content"', '"title"']
      .map((token) => source.indexOf(`,${token}`, fromIndex))
      .filter((index) => index !== -1);

    return candidates.length > 0 ? Math.min(...candidates) : -1;
  }

  private extractHtmlFragment(source: string): string {
    const htmlStartTokens = ['<section', '<article', '<div', '<main'];
    const positions = htmlStartTokens
      .map((token) => source.indexOf(token))
      .filter((index) => index !== -1);

    if (positions.length === 0) {
      return '';
    }

    const start = Math.min(...positions);
    const candidate = source.slice(start).trim();
    return candidate.replace(/"\s*}\s*$/, '').trim();
  }

  private unescapeModelText(content: string): string {
    return content
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  private validateHtmlArticle(
    content: string,
    templateHtml: string,
  ): HtmlValidationResult {
    const normalizedContent = content.trim();
    if (!normalizedContent) {
      return { isComplete: false, reason: 'HTML 正文为空' };
    }

    if (!/<(section|article|div|main)\b/i.test(normalizedContent)) {
      return { isComplete: false, reason: '未检测到有效 HTML 结构' };
    }

    if (
      !/(<\/section>|<\/article>|<\/div>|<\/main>)\s*$/i.test(normalizedContent)
    ) {
      return { isComplete: false, reason: 'HTML 结尾缺少闭合标签，疑似被截断' };
    }

    const openingSections = (normalizedContent.match(/<section\b/gi) || [])
      .length;
    const closingSections = (normalizedContent.match(/<\/section>/gi) || [])
      .length;
    if (
      openingSections > 0 &&
      closingSections < Math.max(1, openingSections - 2)
    ) {
      return {
        isComplete: false,
        reason: 'section 标签闭合数量明显不足，疑似被截断',
      };
    }

    const tailAnchors = this.extractTemplateAnchors(templateHtml);
    if (tailAnchors.length > 0) {
      const missingAnchor = tailAnchors.find(
        (anchor) => !normalizedContent.includes(anchor),
      );
      if (missingAnchor) {
        return {
          isComplete: false,
          reason: `缺少模板尾部锚点：${missingAnchor}`,
        };
      }
    }

    const lastLine =
      normalizedContent.split('\n').filter(Boolean).pop() || normalizedContent;
    if (!/[>）】。”"'”’]$/.test(lastLine.trim())) {
      return { isComplete: false, reason: 'HTML 结尾像是半句截断' };
    }

    return { isComplete: true, reason: '' };
  }

  private extractTemplateAnchors(templateHtml: string): string[] {
    const commentAnchors = [
      ...templateHtml.matchAll(/<!--\s*([\s\S]*?)\s*-->/g),
    ]
      .map((match) => match[1].replace(/\s+/g, ' ').trim())
      .filter((anchor) => anchor.length >= 4);

    return commentAnchors.slice(-3);
  }

  private readTemplateNotes(parameters: unknown): string {
    if (!parameters || typeof parameters !== 'object') {
      return '';
    }

    const maybeNotes = (parameters as Record<string, unknown>).notes;
    if (typeof maybeNotes === 'string') {
      return maybeNotes;
    }

    return '';
  }

  private async generateCoverImage(params: {
    topicTitle: string;
    topicSummary: string;
    keywords: string[];
    imageStylePrompt?: string;
    imageStyleParams?: { ratio?: string; resolution?: string };
    imageCreationEnabled: boolean;
    signal?: AbortSignal;
  }): Promise<string | null> {
    throwIfAborted(params.signal);
    if (!params.imageCreationEnabled) {
      const warnMsg = `选题「${params.topicTitle}」未配置图片模型，跳过独立封面生成`;
      this.logger.warn(warnMsg);
      await this.systemLogsService.record(warnMsg, 'warning');
      return null;
    }

    const coverPrompt = this.buildCoverImagePrompt(
      params.topicTitle,
      params.topicSummary,
      params.keywords,
    );
    const infoMsg = `选题「${params.topicTitle}」开始独立生成 AI 封面图...`;
    this.logger.log(infoMsg);
    await this.systemLogsService.record(infoMsg, 'info');

    try {
      const coverImage = params.signal
        ? await this.imageSelector.generateCoverImage(
            coverPrompt,
            params.imageStylePrompt,
            params.imageStyleParams,
            params.signal,
          )
        : await this.imageSelector.generateCoverImage(
            coverPrompt,
            params.imageStylePrompt,
            params.imageStyleParams,
          );

      if (coverImage) {
        const successMsg = `选题「${params.topicTitle}」独立封面生成成功`;
        this.logger.log(successMsg);
        await this.systemLogsService.record(successMsg, 'success');
      }

      return coverImage;
    } catch (error) {
      rethrowAbort(error, params.signal);
      const message = error instanceof Error ? error.message : '未知错误';
      const warnMsg = `选题「${params.topicTitle}」独立封面生成失败：${message}`;
      this.logger.warn(warnMsg);
      await this.systemLogsService.record(warnMsg, 'warning');
      return null;
    }
  }

  private buildCoverImagePrompt(
    topicTitle: string,
    topicSummary: string,
    keywords: string[],
  ): string {
    const safeSummary = topicSummary.trim() || '无摘要';
    const keywordText = keywords.length > 0 ? keywords.join('、') : '无';

    return `请为下面这篇文章生成一张“公众号封面图”，这不是正文插图，而是用于文章头图的独立视觉。

【文章标题】
${topicTitle}

【文章摘要】
${safeSummary}

【关键词】
${keywordText}

【封面要求】
1. 画面必须有强烈主视觉，要吸引人。
2. 最好包含核心关键词/标题，但不能文字太多。
3. 不要做成正文配图拼贴，不要做成多宫格截图。`;
  }

  private async renderImages(params: {
    content: string;
    contentFormat: ArticleContentFormat;
    materialInfos: MaterialInfo[];
    imageStylePrompt?: string;
    imageStyleParams?: { ratio?: string; resolution?: string };
    imageCreationEnabled: boolean;
    topicTitle: string;
    signal?: AbortSignal;
  }): Promise<{ content: string; coverImage: string | null }> {
    throwIfAborted(params.signal);
    let renderedContent = params.content;

    const realImageRegex = /\[real-image-([^\]]+)\]/g;
    const aiImageRegex = /\[ai-image-([^\]]+)\]/g;
    const legacyImageRegex = /\[image-([^\]]+)\]/g;

    const availableRealImages = params.materialInfos.filter(
      (m) => m.hasImage && m.imageUrl,
    );

    if (availableRealImages.length > 0) {
      const currentRealMatches = [...renderedContent.matchAll(realImageRegex)];
      const aiOrLegacyMatches = [
        ...[...renderedContent.matchAll(aiImageRegex)].map((match) => ({
          placeholder: match[0],
          prompt: match[1],
        })),
        ...[...renderedContent.matchAll(legacyImageRegex)].map((match) => ({
          placeholder: match[0],
          prompt: match[1],
        })),
      ];

      const desiredRealCount = Math.min(
        availableRealImages.length,
        Math.min(2, currentRealMatches.length + aiOrLegacyMatches.length),
      );
      const missingRealCount = Math.max(
        0,
        desiredRealCount - currentRealMatches.length,
      );

      if (missingRealCount > 0 && aiOrLegacyMatches.length > 0) {
        for (
          let i = 0;
          i < Math.min(missingRealCount, aiOrLegacyMatches.length);
          i++
        ) {
          const item = aiOrLegacyMatches[i];
          renderedContent = renderedContent.replace(
            item.placeholder,
            `[real-image-${item.prompt}]`,
          );
        }
      }
    }

    if (params.imageCreationEnabled) {
      const imageTasks: Promise<ImageTaskResult>[] = [];

      for (const match of renderedContent.matchAll(realImageRegex)) {
        const placeholder = match[0];
        const prompt = match[1];
        imageTasks.push(
          (params.signal
            ? this.imageSelector.selectImage(
                'real',
                prompt,
                params.materialInfos,
                params.imageStylePrompt,
                params.imageStyleParams,
                params.signal,
              )
            : this.imageSelector.selectImage(
                'real',
                prompt,
                params.materialInfos,
                params.imageStylePrompt,
                params.imageStyleParams,
              )
          )
            .then((url) => ({ placeholder, url, success: Boolean(url) }))
            .catch((error: Error) => {
              rethrowAbort(error, params.signal);
              return {
                placeholder,
                url: null,
                success: false,
                errorDetail: error.message,
              };
            }),
        );
      }

      for (const match of renderedContent.matchAll(aiImageRegex)) {
        const placeholder = match[0];
        const prompt = match[1];
        imageTasks.push(
          (params.signal
            ? this.imageSelector.selectImage(
                'ai',
                prompt,
                params.materialInfos,
                params.imageStylePrompt,
                params.imageStyleParams,
                params.signal,
              )
            : this.imageSelector.selectImage(
                'ai',
                prompt,
                params.materialInfos,
                params.imageStylePrompt,
                params.imageStyleParams,
              )
          )
            .then((url) => ({ placeholder, url, success: Boolean(url) }))
            .catch((error: Error) => {
              rethrowAbort(error, params.signal);
              return {
                placeholder,
                url: null,
                success: false,
                errorDetail: error.message,
              };
            }),
        );
      }

      for (const match of renderedContent.matchAll(legacyImageRegex)) {
        const placeholder = match[0];
        const prompt = match[1];
        imageTasks.push(
          (params.signal
            ? this.imageSelector.selectImage(
                'ai',
                prompt,
                params.materialInfos,
                params.imageStylePrompt,
                params.imageStyleParams,
                params.signal,
              )
            : this.imageSelector.selectImage(
                'ai',
                prompt,
                params.materialInfos,
                params.imageStylePrompt,
                params.imageStyleParams,
              )
          )
            .then((url) => ({ placeholder, url, success: Boolean(url) }))
            .catch((error: Error) => {
              rethrowAbort(error, params.signal);
              return {
                placeholder,
                url: null,
                success: false,
                errorDetail: error.message,
              };
            }),
        );
      }

      const imageMsg = `选题「${params.topicTitle}」嗅探到 ${imageTasks.length} 处图片插图，准备启动混合配图管线...`;
      this.logger.log(imageMsg);
      await this.systemLogsService.record(imageMsg, 'info');

      const imageResults = await Promise.all(imageTasks);
      for (const result of imageResults) {
        if (result.success && result.url) {
          renderedContent = this.applyResolvedImage(
            renderedContent,
            result.placeholder,
            result.url,
            params.contentFormat,
          );
        } else {
          renderedContent = this.applyFailedImage(
            renderedContent,
            result.placeholder,
            result.errorDetail || '未知错误',
            params.contentFormat,
          );
        }
      }
    } else {
      renderedContent = this.applyFailedImage(
        renderedContent,
        '[real-image-',
        '未配置画图模型',
        params.contentFormat,
        true,
      );
      renderedContent = this.applyFailedImage(
        renderedContent,
        '[ai-image-',
        '未配置画图模型',
        params.contentFormat,
        true,
      );
      renderedContent = this.applyFailedImage(
        renderedContent,
        '[image-',
        '未配置画图模型',
        params.contentFormat,
        true,
      );
    }

    if (params.contentFormat === 'html') {
      renderedContent = this.cleanupHtml(renderedContent);
    }

    return { content: renderedContent, coverImage: null };
  }

  private applyResolvedImage(
    content: string,
    placeholder: string,
    url: string,
    contentFormat: ArticleContentFormat,
  ): string {
    if (contentFormat === 'html') {
      return content.replaceAll(placeholder, url);
    }

    return content.replaceAll(placeholder, `![](${url})`);
  }

  private applyFailedImage(
    content: string,
    placeholder: string,
    errorMessage: string,
    contentFormat: ArticleContentFormat,
    replaceByPattern = false,
  ): string {
    if (replaceByPattern) {
      const pattern =
        contentFormat === 'html'
          ? new RegExp(`\\[(?:real-image|ai-image|image)-[^\\]]+\\]`, 'g')
          : new RegExp(`\\[(?:real-image|ai-image|image)-([^\\]]+)\\]`, 'g');

      if (contentFormat === 'html') {
        return content.replace(pattern, '');
      }

      return content.replace(
        pattern,
        (_match, prompt: string) =>
          `\n> [未配置画图模型，本欲插图：${prompt}]\n`,
      );
    }

    if (contentFormat === 'html') {
      return content.replaceAll(placeholder, '');
    }

    return content.replaceAll(
      placeholder,
      `\n> [图片获取失败，原因：${errorMessage}]\n`,
    );
  }

  private cleanupHtml(content: string): string {
    return content
      .replace(/<img\b([^>]*?)src=(['"])\s*\2([^>]*)>/gi, '')
      .replace(
        /(<(?:p|div|section|article|blockquote|li|h[1-6])\b[^>]*>)\s+/gi,
        '$1',
      )
      .replace(
        /([\u3400-\u9FFF\uF900-\uFAFF，。！？；：、“”‘’（）《》【】])\s+(<(?:span|strong|em|b|i|a)\b[^>]*>)/g,
        '$1$2',
      )
      .replace(
        /(<\/(?:span|strong|em|b|i|a)>)\s+([\u3400-\u9FFF\uF900-\uFAFF，。！？；：、“”‘’（）《》【】])/g,
        '$1$2',
      )
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
