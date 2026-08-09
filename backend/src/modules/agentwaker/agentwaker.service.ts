import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Article, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { resolveProjectRoot } from '../../common/project-paths';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import {
  ArticlesService,
  type AgentWakerWechatDraftInput,
  type AgentWakerXiaohongshuDraftInput,
} from '../articles/articles.service';
import type {
  AgentConfirmation,
  AgentSession,
  AgentSessionEvent,
} from '../local-engine/local-engine.types';
import { WechatCompiler } from '../publishing/wechat-publisher/wechat-compiler';
import { CreateAgentWakerRunDto } from './dto/create-agentwaker-run.dto';

type AgentWakerRoleId =
  | 'xiaohongshu-operator'
  | 'wechat-official-account-operator';
type AgentWakerWorkflowId = 'note-package' | 'article-pipeline';

type AgentWakerInputs = {
  brand: string;
  audience: string;
  product: string;
  keywords: string[];
  sourceMaterials: string[];
  author: string;
  tone: string;
  accountName: string;
  sourceUrl: string;
};

type PublishingChecklist = {
  ready: boolean;
  items: Array<{ label: string; status: 'ready' | 'warning' | 'blocked' }>;
  risks: string[];
};

type GeneratedXiaohongshuPackage = {
  note: AgentWakerXiaohongshuDraftInput;
  publishingChecklist: PublishingChecklist;
};

type GeneratedWechatPackage = {
  article: Omit<AgentWakerWechatDraftInput, 'html' | 'modelId'>;
  publishingChecklist: PublishingChecklist;
};

type OwnerScope = { tenantId: string; userId: string };
type AgentWakerPersistenceClient = Pick<
  Prisma.TransactionClient,
  'agentSession' | 'agentConfirmation'
>;

const AGENTWAKER_SESSION_SOURCE = 'agentwaker-role';

const ROLE_CONFIG: Record<
  AgentWakerRoleId,
  {
    name: string;
    directory: string;
    workflows: Array<{ id: AgentWakerWorkflowId; name: string }>;
    promptFiles: string[];
  }
> = {
  'xiaohongshu-operator': {
    name: '小红书运营助理',
    directory: 'xiaohongshu-operator',
    workflows: [{ id: 'note-package', name: '笔记与卡图包' }],
    promptFiles: [
      'agent-detail.zh.md',
      'xiaohongshu-operator-skills/trend-research/SKILL.zh.md',
      'xiaohongshu-operator-skills/note-drafting/SKILL.zh.md',
      'xiaohongshu-operator-skills/xiaohongshu-visuals/SKILL.zh.md',
      'xiaohongshu-operator-skills/publishing-checklist/SKILL.zh.md',
    ],
  },
  'wechat-official-account-operator': {
    name: '公众号运营助理',
    directory: 'wechat-official-account-operator',
    workflows: [{ id: 'article-pipeline', name: '深度文章与微信 HTML' }],
    promptFiles: [
      'agent-detail.zh.md',
      'wechat-official-account-operator-skills/research-ai-signals/SKILL.zh.md',
      'wechat-official-account-operator-skills/plan-tech-series/SKILL.zh.md',
      'wechat-official-account-operator-skills/draft-deep-tutorial/SKILL.zh.md',
      'wechat-official-account-operator-skills/design-wechat-visuals/SKILL.zh.md',
      'wechat-official-account-operator-skills/format-wechat-article/SKILL.zh.md',
      'wechat-official-account-operator-skills/jpage-pre-draft-preview/SKILL.zh.md',
      'wechat-official-account-operator-skills/publish-wechat-article/SKILL.zh.md',
      'wechat-official-account-operator-skills/save-wechat-browser-draft/SKILL.zh.md',
      'wechat-official-account-operator-skills/review-wechat-performance/SKILL.zh.md',
    ],
  },
};

@Injectable()
export class AgentWakerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly aiClient: AiClientService,
    private readonly defaultModels: DefaultModelsService,
    private readonly articlesService: ArticlesService,
    private readonly authRequestContext: AuthRequestContextService,
  ) {}

  listRoles() {
    return Object.entries(ROLE_CONFIG).map(([id, role]) => {
      const directory = this.resolveRoleDirectory(id as AgentWakerRoleId);
      return {
        id,
        name: role.name,
        available: this.roleFilesAvailable(directory, role.promptFiles),
        workflows: role.workflows,
      };
    });
  }

  getRolePackageHealth() {
    const roles = this.listRoles();
    return {
      ok: roles.length > 0 && roles.every((role) => role.available),
      roles,
    };
  }

  async listRuns(limit = 20) {
    const scope = await this.resolveOwnerScope();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    const rows = await this.prisma.agentSession.findMany({
      where: { ...scope, scope: { startsWith: 'agentwaker:' } },
      orderBy: { updatedAt: 'desc' },
      take: safeLimit,
    });
    return {
      runs: rows
        .filter((row) => this.isAgentWakerSession(row.sessionJson))
        .map((row) => this.toRun(row.sessionJson)),
    };
  }

  async getRun(id: string) {
    const scope = await this.resolveOwnerScope();
    const row = await this.requireRunRow(id, scope);
    const session = this.readSession(row.sessionJson);
    return this.toRun(session, await this.loadRunArticle(session, scope));
  }

  async createRun(input: CreateAgentWakerRunDto) {
    const role = this.requireRole(input.role);
    if (!role.workflows.some((workflow) => workflow.id === input.workflow)) {
      throw new BadRequestException('当前角色不支持该工作流。');
    }
    const roleDirectory = this.resolveRoleDirectory(input.role);
    if (!this.roleFilesAvailable(roleDirectory, role.promptFiles)) {
      throw new BadRequestException(
        `${role.name}角色尚未安装完整，请检查 vendor/agentwaker 目录。`,
      );
    }

    const scope = await this.resolveOwnerScope();
    const now = new Date().toISOString();
    const id = `agentwaker-${randomUUID()}`;
    const goal = this.cleanText(input.goal, 800);
    if (!goal) throw new BadRequestException('请填写本次运营目标。');
    const inputs = this.normalizeInputs(input.inputs);
    const isWechat = input.role === 'wechat-official-account-operator';
    const session: AgentSession = {
      id,
      ...scope,
      title: `${role.name}：${goal.slice(0, 36)}`,
      instruction: goal,
      status: 'draft',
      statusLabel: '待开始',
      executionScope: 'local-files',
      source: 'agent-console',
      createdAt: now,
      updatedAt: now,
      nextAction: isWechat
        ? '开始生成深度文章、微信 HTML 和发布检查。'
        : '开始生成笔记与卡图。',
      targetApp: isWechat ? '微信公众号' : '小红书',
      targetUrl: isWechat
        ? '/content/wechat-official-assistant'
        : '/content/xiaohongshu-assistant',
      riskLevel: 'low',
      confirmations: [],
      events: [],
      metadata: {
        provider: 'agentwaker',
        role: input.role,
        workflow: input.workflow,
        goal,
        inputs,
        modelId: this.cleanText(input.modelId, 120) || null,
        generateCards: input.generateCards !== false,
      },
    };
    this.pushEvent(session, 'info', '任务已创建', '等待启动角色工作流。');

    await this.prisma.agentSession.create({
      data: {
        id,
        ...scope,
        source: AGENTWAKER_SESSION_SOURCE,
        status: session.status,
        title: session.title,
        scope: `agentwaker:${input.role}:${input.workflow}`,
        targetApp: session.targetApp,
        instruction: goal,
        riskLevel: session.riskLevel,
        events: this.toPrismaJson(session.events),
        confirmations: [],
        evidence: [],
        sessionJson: this.toPrismaJson(session),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    });
    return this.toRun(session);
  }

  async executeRun(id: string) {
    const scope = await this.resolveOwnerScope();
    const row = await this.requireRunRow(id, scope);
    const session = this.readSession(row.sessionJson);
    const metadata = this.readRecord(session.metadata);
    const roleId = this.cleanText(metadata.role, 64) as AgentWakerRoleId;
    const workflow = this.cleanText(
      metadata.workflow,
      64,
    ) as AgentWakerWorkflowId;
    const role = this.requireRole(roleId);
    if (!role.workflows.some((item) => item.id === workflow)) {
      throw new BadRequestException('任务工作流与 AgentWaker 角色不匹配。');
    }
    const roleDirectory = this.resolveRoleDirectory(roleId);
    if (!this.roleFilesAvailable(roleDirectory, role.promptFiles)) {
      throw new BadRequestException(`AgentWaker ${role.name}角色文件不完整。`);
    }
    const staleRunning =
      session.status === 'running' &&
      Date.now() - new Date(row.updatedAt).getTime() > 30 * 60 * 1000;
    if (session.status === 'running') {
      if (!staleRunning) {
        throw new BadRequestException('任务正在运行，请勿重复提交。');
      }
      if (this.cleanText(metadata.articleId, 120)) {
        session.status = 'failed';
        session.statusLabel = '失败';
        session.failureReason =
          '上次执行中断，但内容库产物已经生成。为避免重复草稿，请从任务记录处理现有产物。';
        session.completedAt = new Date().toISOString();
        session.updatedAt = session.completedAt;
        await this.persistSession(session, scope);
        throw new BadRequestException(session.failureReason);
      }
    }
    if (session.status === 'waiting_for_confirmation') {
      return this.toRun(session, await this.loadRunArticle(session, scope));
    }
    if (session.status === 'completed') {
      return this.toRun(session, await this.loadRunArticle(session, scope));
    }
    if (session.status === 'cancelled') {
      throw new BadRequestException('任务已取消，请新建任务后重新生成。');
    }
    if (
      session.status === 'failed' &&
      this.cleanText(metadata.articleId, 120)
    ) {
      throw new BadRequestException(
        '该任务已经生成内容库产物，但后续步骤失败。为避免重复草稿，禁止重新生成；请从任务记录处理现有产物。',
      );
    }

    const claimed = await this.prisma.agentSession.updateMany({
      where: {
        id,
        ...scope,
        status: session.status,
        updatedAt: row.updatedAt,
      },
      data: { status: 'running', updatedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('任务已由其他请求接管，请刷新任务状态。');
    }

    const isWechat = roleId === 'wechat-official-account-operator';
    let createdArticleId = '';
    let artifactCommitted = false;

    try {
      session.status = 'running';
      session.statusLabel = '生成中';
      session.nextAction = isWechat
        ? '正在生成证据账本、深度文章、微信 HTML 和发布检查。'
        : '正在生成结构化笔记、卡图和发布检查。';
      session.failureReason = undefined;
      session.completedAt = undefined;
      session.updatedAt = new Date().toISOString();
      this.pushEvent(
        session,
        staleRunning ? 'warning' : 'info',
        staleRunning ? '恢复超时任务' : '角色已加载',
        staleRunning
          ? '上次执行超过 30 分钟且没有产物记录，已安全重新接管。'
          : isWechat
            ? '已加载信号研究、深度写作、微信排版和发布检查 Skill。'
            : '已加载趋势研究、笔记起草、视觉和发布检查 Skill。',
      );
      await this.persistSession(session, scope);

      const inputs = this.normalizeInputs(metadata.inputs);
      const modelId = await this.resolveModelId(metadata.modelId);
      const systemPrompt = this.buildRolePrompt(roleId, roleDirectory);
      const generatedText = await this.aiClient.generate(
        modelId,
        [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: this.buildRunPrompt(
              roleId,
              this.cleanText(metadata.goal, 800) || session.instruction,
              inputs,
            ),
          },
        ],
        {
          temperature: 0.72,
          maxTokens: 5200,
          knowledgeMode: 'preferred',
          knowledgeQuery: [metadata.goal, inputs.product, ...inputs.keywords]
            .filter(Boolean)
            .join(' '),
        },
      );
      let article: Article;
      let publishingChecklist: PublishingChecklist;
      let generatedMetadata: Record<string, unknown> = {};
      if (roleId === 'xiaohongshu-operator') {
        const generated = this.parseGeneratedPackage(generatedText);
        publishingChecklist = generated.publishingChecklist;
        this.pushEvent(
          session,
          'success',
          '笔记方案已生成',
          `已完成 ${generated.note.slides.length} 页卡片规划。`,
          {
            type: 'text',
            label: '笔记结构摘要',
            value: JSON.stringify(
              {
                title: generated.note.title,
                hashtags: generated.note.hashtags,
                slides: generated.note.slides.map((slide) => slide.title),
              },
              null,
              2,
            ),
            stageKey: 'note-drafting',
          },
        );
        article = await this.articlesService.createXiaohongshuDraftFromAgent({
          ...generated.note,
          modelId,
          generateCards: metadata.generateCards !== false,
          generateBackgrounds: false,
        });
      } else {
        const generated = this.parseWechatGeneratedPackage(generatedText);
        publishingChecklist = generated.publishingChecklist;
        const html = await WechatCompiler.compile(generated.article.markdown);
        article = await this.articlesService.createWechatDraftFromAgent({
          ...generated.article,
          html,
          modelId,
        });
        generatedMetadata = {
          digest: generated.article.digest,
          author: generated.article.author,
          sourceLedger: generated.article.sourceLedger,
          sourceUrl: generated.article.sourceUrl || null,
          wordCount: generated.article.markdown.length,
        };
        this.pushEvent(
          session,
          'success',
          '公众号文章包已生成',
          `已生成 ${generated.article.markdown.length} 字符正文、微信 HTML 和 ${generated.article.sourceLedger.length} 条来源记录。`,
          {
            type: 'text',
            label: '文章与来源摘要',
            value: JSON.stringify(
              {
                title: generated.article.title,
                digest: generated.article.digest,
                sources: generated.article.sourceLedger,
              },
              null,
              2,
            ),
            stageKey: 'wechat-article-drafting',
          },
        );
      }
      createdArticleId = article.id;
      this.pushEvent(
        session,
        'success',
        '产物已回写',
        isWechat
          ? 'Markdown、微信 HTML 和来源账本已写入文章库。'
          : '笔记草稿和卡图已写入小红书笔记库。',
        {
          type: 'text',
          label: '内容库记录',
          value: JSON.stringify(
            { articleId: article.id, title: article.title },
            null,
            2,
          ),
          stageKey: 'artifact-writeback',
        },
      );
      session.metadata = {
        ...metadata,
        modelId,
        articleId: article.id,
        ...generatedMetadata,
      };

      const confirmation = this.buildConfirmation(
        session,
        article.id,
        publishingChecklist,
        scope,
        roleId,
      );
      session.status = 'waiting_for_confirmation';
      session.statusLabel = '待确认';
      session.riskLevel = 'medium';
      session.confirmations = [confirmation];
      session.resumeAction = {
        kind: 'agentwaker-handoff',
        label: isWechat ? '确认进入公众号草稿准备' : '确认进入小红书发布准备',
        articleId: article.id,
        role: roleId,
        workflow,
        targetHref: isWechat
          ? `/content/wechat-official-assistant?runId=${encodeURIComponent(session.id)}`
          : `/content/xiaohongshu?articleId=${encodeURIComponent(article.id)}`,
      };
      session.nextAction = isWechat
        ? '核对正文、移动预览、来源和发布检查后，在“待我确认”中批准。'
        : '核对笔记、卡图和发布检查后，在“待我确认”中批准。';
      session.updatedAt = new Date().toISOString();
      session.metadata = {
        ...this.readRecord(session.metadata),
        modelId,
        articleId: article.id,
        confirmationId: confirmation.id,
        publishingChecklist,
        risks: publishingChecklist.risks,
        ...generatedMetadata,
      };
      this.pushEvent(
        session,
        publishingChecklist.ready ? 'warning' : 'error',
        '等待人工确认',
        publishingChecklist.ready
          ? isWechat
            ? '文章检查已完成；保存平台草稿、发送预览和正式发布分别需要独立确认。'
            : '发布准备检查已完成，外部写入仍需单独确认。'
          : '发布准备检查存在风险，请修改后再确认。',
        {
          type: 'diagnostic_bundle',
          label: '发布前检查',
          value: JSON.stringify(publishingChecklist, null, 2),
          stageKey: 'publishing-checklist',
        },
      );
      await this.persistArtifactHandoff(session, confirmation, scope);
      artifactCommitted = true;
      return this.toRun(session, article);
    } catch (error) {
      if (createdArticleId && !artifactCommitted) {
        const cleaned = await this.prisma.article
          .deleteMany({ where: { id: createdArticleId, ...scope } })
          .then((result) => result.count === 1)
          .catch(() => false);
        if (cleaned) {
          const failedMetadata = this.readRecord(session.metadata);
          delete failedMetadata.articleId;
          delete failedMetadata.confirmationId;
          session.metadata = failedMetadata;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      session.status = 'failed';
      session.statusLabel = '失败';
      session.failureReason = message;
      session.completedAt = new Date().toISOString();
      session.updatedAt = session.completedAt;
      session.nextAction = '检查模型配置、角色文件和输出格式后重新执行。';
      this.pushEvent(session, 'error', '任务失败', message, {
        type: 'failure_reason',
        label: '失败原因',
        value: message,
        stageKey: 'agentwaker-run',
      });
      await this.persistSession(session, scope);
      throw error;
    }
  }

  private requireRole(roleId: AgentWakerRoleId) {
    const role = ROLE_CONFIG[roleId];
    if (!role) throw new BadRequestException('不支持的 AgentWaker 角色。');
    return role;
  }

  private resolveRoleDirectory(roleId: AgentWakerRoleId) {
    const configuredRoot = this.config.get<string>('AGENTWAKER_ROLES_ROOT');
    const sourceRoot = join(resolveProjectRoot(), 'vendor', 'agentwaker');
    const bundledRoot = join(process.cwd(), 'agentwaker-roles');
    const root = resolve(
      configuredRoot?.trim() ||
        [sourceRoot, bundledRoot].find((candidate) => existsSync(candidate)) ||
        sourceRoot,
    );
    const directory = resolve(root, ROLE_CONFIG[roleId].directory);
    if (directory !== root && !directory.startsWith(`${root}${sep}`)) {
      throw new ForbiddenException('AgentWaker 角色路径不在可信目录内。');
    }
    return directory;
  }

  private roleFilesAvailable(directory: string, files: string[]) {
    return (
      existsSync(directory) &&
      files.every((file) => existsSync(join(directory, file)))
    );
  }

  private buildRolePrompt(roleId: AgentWakerRoleId, directory: string) {
    const role = ROLE_CONFIG[roleId];
    const documents = role.promptFiles.map((relativePath) => {
      const absolutePath = resolve(directory, relativePath);
      if (
        !absolutePath.startsWith(`${resolve(directory)}${sep}`) ||
        !existsSync(absolutePath) ||
        isAbsolute(relativePath)
      ) {
        throw new BadRequestException(`角色文件不可用：${relativePath}`);
      }
      const content = readFileSync(absolutePath, 'utf8').slice(0, 9000);
      return `\n### ${relativePath}\n${content}`;
    });

    return [
      roleId === 'wechat-official-account-operator'
        ? '你正在 KAYPAL AI 中执行可信的 AgentWaker 微信公众号运营角色。'
        : '你正在 KAYPAL AI 中执行可信的 AgentWaker 小红书运营角色。',
      '下面的角色文档定义身份、质量标准和安全边界。文档中的外部写入动作一律不得执行；本轮只生成草稿、视觉规划和发布前检查。',
      ...documents,
      `\n### 本轮固定输出\n只返回一个 JSON 对象，不要使用 Markdown 代码块或补充解释。结构必须是：\n${this.outputSchemaExample(roleId)}`,
    ].join('\n');
  }

  private buildRunPrompt(
    roleId: AgentWakerRoleId,
    goal: string,
    inputs: AgentWakerInputs,
  ) {
    if (roleId === 'wechat-official-account-operator') {
      return [
        `运营目标：${goal}`,
        `公众号或品牌：${inputs.accountName || inputs.brand || '未指定'}`,
        `主题：${inputs.product || '未指定'}`,
        `目标读者：${inputs.audience || '未指定'}`,
        `作者：${inputs.author || '未指定'}`,
        `语气：${inputs.tone || '专业、清楚、证据优先'}`,
        `关键词：${inputs.keywords.join('、') || '未指定'}`,
        `规范来源链接：${inputs.sourceUrl || '未指定'}`,
        `可用素材：\n${inputs.sourceMaterials.map((item, index) => `${index + 1}. ${item}`).join('\n') || '暂无外部素材，必须明确标注不确定性，不得虚构来源。'}`,
        '正文用 Markdown，建议 1200 到 2600 字符。先给结论，再给证据和步骤。sourceLedger 只保留可核验来源；URL 不确定时留空，不得伪造。禁止输出脚本、iframe、表单或事件属性。',
      ].join('\n\n');
    }
    return [
      `运营目标：${goal}`,
      `品牌：${inputs.brand || '未指定'}`,
      `目标人群：${inputs.audience || '未指定'}`,
      `产品或主题：${inputs.product || '未指定'}`,
      `关键词：${inputs.keywords.join('、') || '未指定'}`,
      `可用素材：\n${inputs.sourceMaterials.map((item, index) => `${index + 1}. ${item}`).join('\n') || '暂无外部素材，仅基于已知信息生成并标注不确定性。'}`,
      '生成 5 到 7 张 3:4 卡片。标题、正文、标签和卡片必须相互一致。发布检查要明确 ready、warning 或 blocked，不得虚构平台研究证据。',
    ].join('\n\n');
  }

  private outputSchemaExample(roleId: AgentWakerRoleId) {
    if (roleId === 'wechat-official-account-operator') {
      return JSON.stringify({
        article: {
          title: '公众号文章标题',
          digest: '120 字以内摘要',
          author: '作者',
          markdown: '# 标题\n\n正文',
          coverPrompt: '封面视觉说明',
          sourceUrl: 'https://example.com/source',
          sourceLedger: [
            {
              title: '来源标题',
              url: 'https://example.com/source',
              evidence: '该来源支撑的事实',
            },
          ],
        },
        publishingChecklist: {
          ready: true,
          items: [{ label: '事实和来源已核对', status: 'ready' }],
          risks: [],
        },
      });
    }
    return JSON.stringify({
      note: {
        title: '笔记标题',
        caption: '80-160 字正文',
        hashtags: ['标签1', '标签2'],
        slides: [
          {
            role: 'cover',
            template: 'cover-poster',
            title: '卡片标题',
            body: '卡片正文',
            bullets: [],
            highlight: '重点短句',
            imagePrompt: '',
            imageType: 'none',
          },
        ],
      },
      publishingChecklist: {
        ready: true,
        items: [{ label: '标题与正文一致', status: 'ready' }],
        risks: [],
      },
    });
  }

  private parseGeneratedPackage(raw: string): GeneratedXiaohongshuPackage {
    const parsed = this.parseJsonObject(raw);
    const nestedNote = this.readRecord(parsed.note);
    const note = Object.keys(nestedNote).length ? nestedNote : parsed;
    const checklist = this.readRecord(parsed.publishingChecklist);
    const rawItems = Array.isArray(checklist.items) ? checklist.items : [];
    const items = rawItems
      .map((item) => this.readRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        label: this.cleanText(item.label, 120),
        status:
          item.status === 'blocked'
            ? ('blocked' as const)
            : item.status === 'warning'
              ? ('warning' as const)
              : ('ready' as const),
      }))
      .filter((item) => item.label);
    const risks = this.normalizeStringList(checklist.risks, 12, 180);
    return {
      note: {
        title: this.cleanText(note.title, 80),
        caption: this.cleanText(note.caption, 1200),
        hashtags: this.normalizeStringList(note.hashtags, 8, 30),
        slides: this.normalizeSlides(note.slides),
      },
      publishingChecklist: {
        ready:
          checklist.ready === true &&
          !items.some((item) => item.status === 'blocked'),
        items: items.length
          ? items
          : [{ label: '标题、正文、标签和卡片已生成', status: 'ready' }],
        risks,
      },
    };
  }

  private parseWechatGeneratedPackage(raw: string): GeneratedWechatPackage {
    const parsed = this.parseJsonObject(raw);
    const article = this.readRecord(parsed.article);
    const checklist = this.parsePublishingChecklist(parsed.publishingChecklist);
    const title = this.cleanText(article.title, 120);
    const markdown = this.cleanText(article.markdown, 30000);
    if (!title || markdown.length < 200) {
      throw new BadRequestException('公众号文章缺少有效标题或正文。');
    }
    const rawLedger = Array.isArray(article.sourceLedger)
      ? article.sourceLedger
      : [];
    const sourceLedger = rawLedger
      .map((item) => this.readRecord(item))
      .map((item) => ({
        title: this.cleanText(item.title, 180),
        url: this.normalizeHttpUrl(item.url),
        evidence: this.cleanText(item.evidence, 500),
      }))
      .filter((item) => item.title && item.url && item.evidence)
      .slice(0, 30);
    return {
      article: {
        title,
        digest: this.cleanText(article.digest, 240),
        author: this.cleanText(article.author, 80),
        markdown,
        coverPrompt: this.cleanText(article.coverPrompt, 500),
        sourceUrl: this.normalizeHttpUrl(article.sourceUrl),
        sourceLedger,
      },
      publishingChecklist: {
        ...checklist,
        ready:
          checklist.ready &&
          sourceLedger.length > 0 &&
          !checklist.items.some((item) => item.status === 'blocked'),
        risks:
          sourceLedger.length > 0
            ? checklist.risks
            : [...checklist.risks, '缺少可核验来源账本'],
      },
    };
  }

  private parseJsonObject(raw: string) {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new BadRequestException('AgentWaker 未返回可解析的 JSON 产物。');
    }
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<
        string,
        unknown
      >;
    } catch {
      throw new BadRequestException('AgentWaker 返回的 JSON 格式不完整。');
    }
  }

  private parsePublishingChecklist(value: unknown): PublishingChecklist {
    const checklist = this.readRecord(value);
    const rawItems = Array.isArray(checklist.items) ? checklist.items : [];
    const items = rawItems
      .map((item) => this.readRecord(item))
      .map((item) => ({
        label: this.cleanText(item.label, 120),
        status:
          item.status === 'ready'
            ? ('ready' as const)
            : item.status === 'warning'
              ? ('warning' as const)
              : ('blocked' as const),
      }))
      .filter((item) => item.label);
    const effectiveItems = items.length
      ? items
      : [
          {
            label: '模型未返回发布检查项',
            status: 'blocked' as const,
          },
        ];
    return {
      ready:
        checklist.ready === true &&
        !effectiveItems.some((item) => item.status === 'blocked'),
      items: effectiveItems,
      risks: this.normalizeStringList(checklist.risks, 12, 180),
    };
  }

  private buildConfirmation(
    session: AgentSession,
    articleId: string,
    checklist: PublishingChecklist,
    scope: OwnerScope,
    roleId: AgentWakerRoleId,
  ): AgentConfirmation {
    const now = new Date().toISOString();
    const isWechat = roleId === 'wechat-official-account-operator';
    return {
      id: `agentwaker-confirmation-${randomUUID()}`,
      ...scope,
      sessionId: session.id,
      title: isWechat
        ? '确认公众号文章进入草稿准备'
        : '确认小红书笔记进入发布准备',
      description: checklist.risks.length
        ? `${isWechat ? '公众号文章' : '笔记和卡图'}已生成；发布前风险：${checklist.risks.join('；')}`
        : isWechat
          ? '文章和微信 HTML 已生成。批准后仅进入草稿准备；保存平台草稿、发送预览和正式发布仍需分别确认。'
          : '笔记和卡图已生成。批准后仅进入发布准备，不会自动对外发布。',
      actionLabel: isWechat ? '进入公众号草稿准备' : '进入小红书发布准备',
      riskLevel: 'medium',
      status: 'pending',
      confirmationMode: 'standard',
      requiredChecks: [
        {
          key: 'content-reviewed',
          label: isWechat
            ? '已核对标题、摘要、正文和事实来源'
            : '已核对标题、正文和标签',
          required: true,
          category: 'content',
          status: checklist.ready ? 'ready' : 'blocked',
        },
        {
          key: 'visuals-reviewed',
          label: isWechat
            ? '微信 HTML 已生成；远端预览和封面将在保存平台草稿后核对'
            : '已核对封面和全部卡图',
          required: true,
          category: 'content',
          status: isWechat ? 'warning' : 'ready',
        },
        {
          key: 'publish-separate',
          label: '已知正式发布仍需再次确认账号与载荷',
          required: true,
          category: 'send-protection',
          status: 'ready',
        },
      ],
      createdAt: now,
      note: `article:${articleId}`,
    };
  }

  private async persistSession(
    session: AgentSession,
    scope: OwnerScope,
    client: AgentWakerPersistenceClient = this.prisma,
  ) {
    await client.agentSession.update({
      where: { id: session.id },
      data: {
        ...scope,
        status: session.status,
        title: session.title,
        targetApp: session.targetApp || null,
        instruction: session.instruction,
        riskLevel: session.riskLevel,
        events: this.toPrismaJson(session.events),
        confirmations: this.toPrismaJson(session.confirmations),
        evidence: this.toPrismaJson(
          session.events
            .filter((event) => event.evidence)
            .map((event) => event.evidence),
        ),
        sessionJson: this.toPrismaJson(session),
        updatedAt: new Date(session.updatedAt),
        completedAt: session.completedAt ? new Date(session.completedAt) : null,
      },
    });
  }

  private async persistArtifactHandoff(
    session: AgentSession,
    confirmation: AgentConfirmation,
    scope: OwnerScope,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await this.persistSession(session, scope, transaction);
      await this.persistConfirmation(confirmation, scope, transaction);
    });
  }

  private async persistConfirmation(
    confirmation: AgentConfirmation,
    scope: OwnerScope,
    client: AgentWakerPersistenceClient = this.prisma,
  ) {
    await client.agentConfirmation.upsert({
      where: { id: confirmation.id },
      create: {
        id: confirmation.id,
        ...scope,
        sessionId: confirmation.sessionId,
        action: confirmation.actionLabel,
        status: confirmation.status,
        riskLevel: confirmation.riskLevel,
        target: confirmation.title,
        targetLabel: confirmation.title,
        content: confirmation.description,
        note: confirmation.note || null,
        confirmationJson: this.toPrismaJson(confirmation),
        createdAt: new Date(confirmation.createdAt),
      },
      update: {
        status: confirmation.status,
        confirmationJson: this.toPrismaJson(confirmation),
      },
    });
  }

  private async requireRunRow(id: string, scope: OwnerScope) {
    const row = await this.prisma.agentSession.findFirst({
      where: { id, ...scope },
    });
    if (!row || !this.isAgentWakerSession(row.sessionJson)) {
      throw new NotFoundException('AgentWaker 任务不存在。');
    }
    return row;
  }

  private isAgentWakerSession(value: unknown) {
    const record = this.readRecord(value);
    const metadata = this.readRecord(record.metadata);
    return metadata.provider === 'agentwaker';
  }

  private readSession(value: unknown): AgentSession {
    const record = this.readRecord(value);
    if (!record.id || !Array.isArray(record.events)) {
      throw new BadRequestException('AgentWaker 任务记录损坏。');
    }
    return record as unknown as AgentSession;
  }

  private async loadRunArticle(session: AgentSession, scope: OwnerScope) {
    const articleId = this.cleanText(
      this.readRecord(session.metadata).articleId,
      120,
    );
    if (!articleId) return null;
    return this.prisma.article.findFirst({
      where: { id: articleId, ...scope },
    });
  }

  private toRun(sessionValue: unknown, article?: Article | null) {
    const session = this.readSession(sessionValue);
    const metadata = this.readRecord(session.metadata);
    const checklist = this.readRecord(metadata.publishingChecklist);
    const articleData = this.readRecord(article?.xiaohongshuData);
    const wechatData = this.readRecord(article?.wechatData);
    return {
      runId: session.id,
      role: this.cleanText(metadata.role, 64),
      workflow: this.cleanText(metadata.workflow, 64),
      status: session.status,
      statusLabel: session.statusLabel,
      currentStep:
        session.status === 'draft'
          ? 'input'
          : session.status === 'running'
            ? 'generation'
            : session.status === 'waiting_for_confirmation'
              ? 'approval'
              : session.status === 'completed'
                ? 'handoff'
                : 'failed',
      goal: this.cleanText(metadata.goal, 800),
      inputs: this.normalizeInputs(metadata.inputs),
      modelId: this.cleanText(metadata.modelId, 120) || null,
      articleId: this.cleanText(metadata.articleId, 120) || null,
      confirmationId: this.cleanText(metadata.confirmationId, 160) || null,
      checklist,
      risks: Array.isArray(metadata.risks) ? metadata.risks : [],
      events: session.events,
      output: article
        ? {
            articleId: article.id,
            title: article.title,
            content: article.content,
            contentFormat: article.contentFormat,
            finalHtml: article.finalHtml,
            coverImage: article.coverImage,
            channel:
              metadata.role === 'wechat-official-account-operator'
                ? 'wechat-official-account'
                : 'xiaohongshu',
            caption: this.cleanText(articleData.caption, 1200),
            hashtags: Array.isArray(articleData.hashtags)
              ? articleData.hashtags
              : [],
            slides: Array.isArray(articleData.slides) ? articleData.slides : [],
            digest:
              this.cleanText(metadata.digest, 240) ||
              this.cleanText(wechatData.digest, 240),
            author:
              this.cleanText(metadata.author, 80) ||
              this.cleanText(wechatData.author, 80),
            sourceLedger: Array.isArray(metadata.sourceLedger)
              ? metadata.sourceLedger
              : Array.isArray(wechatData.sourceLedger)
                ? wechatData.sourceLedger
                : [],
            wordCount: Number(metadata.wordCount) || article.content.length,
          }
        : null,
      nextAction: session.nextAction,
      failureReason: session.failureReason || null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private pushEvent(
    session: AgentSession,
    level: AgentSessionEvent['level'],
    title: string,
    message: string,
    evidence?: AgentSessionEvent['evidence'],
  ) {
    const createdAt = new Date().toISOString();
    session.events.push({
      id: `agentwaker-event-${randomUUID()}`,
      sessionId: session.id,
      level,
      title,
      message,
      createdAt,
      evidence: evidence
        ? { ...evidence, createdAt, sessionId: session.id }
        : undefined,
    });
    session.updatedAt = createdAt;
  }

  private normalizeInputs(value: unknown): AgentWakerInputs {
    const record = this.readRecord(value);
    return {
      brand: this.cleanText(record.brand, 120),
      audience: this.cleanText(record.audience, 240),
      product: this.cleanText(record.product, 240),
      keywords: this.normalizeStringList(record.keywords, 12, 50),
      sourceMaterials: this.normalizeStringList(
        record.sourceMaterials || record.source_materials,
        20,
        1000,
      ),
      author: this.cleanText(record.author, 80),
      tone: this.cleanText(record.tone, 120),
      accountName: this.cleanText(
        record.accountName || record.account_name,
        120,
      ),
      sourceUrl: this.normalizeHttpUrl(record.sourceUrl || record.source_url),
    };
  }

  private normalizeStringList(
    value: unknown,
    limit: number,
    itemLimit: number,
  ) {
    const items = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/[,，\n]/)
        : [];
    return items
      .map((item) => this.cleanText(item, itemLimit))
      .filter(Boolean)
      .slice(0, limit);
  }

  private cleanText(value: unknown, limit: number) {
    return typeof value === 'string'
      ? value.split('\u0000').join('').trim().slice(0, limit)
      : '';
  }

  private normalizeHttpUrl(value: unknown) {
    const text = this.cleanText(value, 2000);
    if (!text) return '';
    try {
      const parsed = new URL(text);
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        !parsed.username &&
        !parsed.password
      ) {
        return parsed.toString();
      }
    } catch {
      return '';
    }
    return '';
  }

  private readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private normalizeSlides(
    value: unknown,
  ): AgentWakerXiaohongshuDraftInput['slides'] {
    if (!Array.isArray(value)) return [];
    const roles = [
      'cover',
      'hook',
      'problem',
      'solution',
      'method',
      'summary',
      'cta',
    ] as const;
    const templates = [
      'cover-poster',
      'insight-card',
      'bullet-list',
      'checklist-card',
      'summary-card',
    ] as const;
    return value
      .map((item, index) => {
        const record = this.readRecord(item);
        const title = this.cleanText(record.title, 80);
        const body = this.cleanText(record.body, 300);
        const bullets = this.normalizeStringList(record.bullets, 4, 80);
        const role = roles.includes(record.role as (typeof roles)[number])
          ? (record.role as (typeof roles)[number])
          : roles[Math.min(index, roles.length - 1)];
        const template = templates.includes(
          record.template as (typeof templates)[number],
        )
          ? (record.template as (typeof templates)[number])
          : index === 0
            ? 'cover-poster'
            : bullets.length
              ? 'bullet-list'
              : 'insight-card';
        return {
          role,
          template,
          title,
          body,
          bullets,
          highlight: this.cleanText(record.highlight, 80),
          imagePrompt: this.cleanText(record.imagePrompt, 300),
          imageType:
            record.imageType === 'real'
              ? ('real' as const)
              : record.imageType === 'ai'
                ? ('ai' as const)
                : ('none' as const),
        };
      })
      .filter((slide) => slide.title && (slide.body || slide.bullets.length))
      .slice(0, 9);
  }

  private toPrismaJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private async resolveModelId(value: unknown) {
    const configured = this.cleanText(value, 120);
    if (configured) return configured;
    const defaults = await this.defaultModels.getDefaults();
    const modelId = defaults.articleCreation || defaults.topicSelection;
    if (!modelId) {
      throw new BadRequestException('请先配置默认文章创作模型。');
    }
    return modelId;
  }

  private async resolveOwnerScope(): Promise<OwnerScope> {
    if (!this.authRequestContext.hasContext()) {
      throw new UnauthorizedException('缺少登录上下文，不能运行运营助理。');
    }
    const user = this.authRequestContext.get()?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) throw new UnauthorizedException('请先登录后运行运营助理。');
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }
}
