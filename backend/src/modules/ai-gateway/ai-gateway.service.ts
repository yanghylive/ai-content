import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AiClientService } from '../ai-models/ai-client.service';
import { safeText } from '../../common/text.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { RedfoxHotTopicsService } from '../redfox/redfox-hot-topics.service';
import { RedfoxComplianceService } from '../redfox/redfox-compliance.service';
import { RedfoxPlatformService } from '../redfox/redfox-platform.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { MemoryService } from '../memory/memory.service';
import { AiAuditService } from '../ai-audit/ai-audit.service';

/** AI 助手系统提示词（工具使用指南，function calling 触发） */
const SYSTEM_PROMPT = `你是 JIUZHANG AI 的内容运营助手，帮助用户完成内容创作与运营工作。
你可以调用以下工具来直接执行操作：
1. topic_hot：获取今日全网热榜选题（抖音/头条/知乎）。用户问"有什么热点/今天发什么/选题"时调用。
2. compliance_check：检查文案是否含违禁词（参数 text 为待检测文案）。用户要发布内容前调用。
3. knowledge_search：从用户的品牌知识库检索相关资料（参数 query 为检索关键词，如产品名/卖点/品牌）。创作涉及用户自己的产品、品牌、门店、话术时，必须先调用本工具拿到真实资料再写，不要凭空编造产品信息。
4. content_generate：按选题/要求生成内容文案（参数 topic 选题、platform 目标平台、tone 语气）。用户说"帮我写一篇…"时调用。
5. image_generate：生成配图（参数 prompt 图片描述）。用户说"配图/生成图片"时调用。
6. video_download：从作品链接去水印下载素材（参数 platform 平台、url 链接）。用户给链接要"去水印/下载素材"时调用。
7. material_save：把内容/文案保存到素材库（参数 title 标题、content 内容）。用户说"保存到素材库"时调用。
8. schedule_publish：定时发布内容（参数 content 内容、platform 平台、scheduledAt 时间）。用户说"定时发/排期发布"时调用——注意这是高风险写操作，调用后需要用户到「待我确认」确认才真正执行。
调用工具后，把结果整理成简洁、友好的中文回复给用户。
如果用户请求不在工具能力范围内，直接给出建议，不要编造工具结果。`;

/** 工具白名单（function calling schema） */
const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'topic_hot',
      description:
        '获取今日全网热榜选题（抖音/头条/知乎，含热度），用户问有什么热点/今天发什么/找选题时调用',
      parameters: {
        type: 'object' as const,
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'compliance_check',
      description:
        '检查文案是否含平台违禁词（发布前合规体检），返回风险词与替换建议',
      parameters: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: '待检测的完整文案' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'knowledge_search',
      description:
        '从用户的品牌知识库检索资料（产品信息/品牌介绍/门店信息/话术库）。创作内容涉及用户自己的产品、品牌、门店时，必须先调用本工具获取真实资料，严禁编造',
      parameters: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: '检索关键词，如产品名/卖点/品牌名/行业',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'content_generate',
      description:
        '按选题/要求生成内容文案（公众号/小红书/抖音等平台风格）。用户说"帮我写一篇/生成文案/写个种草文"时调用',
      parameters: {
        type: 'object' as const,
        properties: {
          topic: { type: 'string', description: '内容选题或主题' },
          platform: {
            type: 'string',
            description: '目标平台（公众号/小红书/抖音等），默认公众号',
          },
          tone: {
            type: 'string',
            description: '语气风格（专业/亲切/活泼等），可选',
          },
        },
        required: ['topic'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'image_generate',
      description:
        '根据描述生成配图（AI 生图）。用户说"配图/生成图片/做张封面"时调用',
      parameters: {
        type: 'object' as const,
        properties: {
          prompt: {
            type: 'string',
            description: '图片内容描述（主体/场景/风格）',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'video_download',
      description:
        '从作品分享链接去水印下载素材（支持抖音/快手/小红书/视频号/B站/TikTok/YouTube/X/Instagram）。用户给链接说"去水印/下载这个视频/采集素材"时调用',
      parameters: {
        type: 'object' as const,
        properties: {
          platform: {
            type: 'string',
            description:
              '平台标识（douyin/kuaishou/xhs/sph/bilibili/tiktok/youtube/x/instagram）',
          },
          url: { type: 'string', description: '作品分享链接' },
        },
        required: ['platform', 'url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'material_save',
      description:
        '把生成的文案/内容保存到素材库。用户说"保存到素材库/存一下"时调用',
      parameters: {
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: '素材标题' },
          content: { type: 'string', description: '素材内容（文案全文）' },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'schedule_publish',
      description:
        '定时发布内容（需用户确认后执行）。用户说"定时发/晚上8点发/排期发布"时调用。⚠️ 高风险写操作：调用后生成确认卡，用户确认后才真正调度',
      parameters: {
        type: 'object' as const,
        properties: {
          content: { type: 'string', description: '要发布的内容全文' },
          platform: {
            type: 'string',
            description: '发布平台（公众号/小红书/抖音/视频号等）',
          },
          scheduledAt: {
            type: 'string',
            description: '计划发布时间（如 2026-08-09 20:00）',
          },
          title: { type: 'string', description: '内容标题（可选）' },
        },
        required: ['content', 'platform', 'scheduledAt'],
      },
    },
  },
];

const MAX_TOOL_ROUNDS = 4;

/**
 * AI 对话网关（P0.5 核心）：
 * 千问/kaypal 模型（OpenAI 兼容）+ function calling 工具循环 + SSE 流式输出。
 * 工具白名单：topic_hot / compliance_check（复用 RedFox 能力，后端唯一出口）。
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly aiClient: AiClientService,
    private readonly prisma: PrismaService,
    private readonly hotTopics: RedfoxHotTopicsService,
    private readonly compliance: RedfoxComplianceService,
    private readonly platform: RedfoxPlatformService,
    private readonly knowledge: KnowledgeService,
    private readonly memory: MemoryService,
    private readonly audit: AiAuditService,
  ) {}

  /**
   * SSE 对话入口：模型流式输出 + 工具调用循环，直到模型给出最终回答。
   * 事件协议：{type:'text',content} / {type:'tool_exec',name,summary} / {type:'done'} / {type:'error'}
   */
  async chatStream(
    authUser: AuthenticatedUser,
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    response: Response,
  ): Promise<void> {
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const send = (payload: unknown) => {
      try {
        response.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        /* client 已断开 */
      }
    };

    const chatStart = Date.now();
    try {
      // B6 配额检查：对话超限直接拒绝（不扣减）
      if (authUser?.id) {
        const quota = await this.audit.canChat(authUser.id);
        if (!quota.ok) {
          send({
            type: 'error',
            message: `今日 AI 对话次数已用完（${quota.quota.chatLimit}/${quota.quota.chatLimit}），请明天再试`,
          });
          response.end();
          return;
        }
      }

      const platform = await this.prisma.aIPlatform.findFirst({
        where: { enabled: true },
        orderBy: { createdAt: 'desc' },
      });
      const model = await this.prisma.aIModel.findFirst({
        where: { platformId: platform?.id ?? '' },
        orderBy: { createdAt: 'desc' },
      });
      if (!platform || !model) {
        send({
          type: 'error',
          message: 'AI 模型未配置，请联系管理员在模型设置中同步',
        });
        response.end();
        return;
      }

      const client = await this.aiClient.getClient(platform.id);

      // B4 记忆注入：recall persona + 相关记忆（5s 超时降级，绝不阻塞对话）
      let memoryInject = '';
      const lastUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === 'user');
      if (authUser?.id && lastUserMsg?.content) {
        const mem = await this.memory.recall(authUser.id, lastUserMsg.content);
        if (mem.persona.length > 0) {
          memoryInject += `\n\n<user-persona>${mem.persona.join('；')}</user-persona>`;
        }
        if (mem.relevant.length > 0) {
          memoryInject += `\n<relevant-memories>${mem.relevant.join('；')}</relevant-memories>`;
        }
      }
      const systemContent = memoryInject
        ? `${SYSTEM_PROMPT}${memoryInject}\n\n（上述记忆来自用户过往对话，仅作参考，与当前事实冲突时以用户最新表述为准）`
        : SYSTEM_PROMPT;

      const history = (
        [
          { role: 'system' as const, content: systemContent },
          ...messages,
        ] as Array<{
          role: 'system' | 'user' | 'assistant';
          content: string;
        }>
      ).slice(-12); // 上下文窗口保护

      let toolRounds = 0;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = await client.chat.completions.create({
          model: model.modelId,
          messages: history as never,
          tools: TOOLS as never,
          stream: true,
        });

        const toolCalls: Array<{
          id: string;
          name: string;
          args: string;
        }> = [];

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            send({ type: 'text', content: delta.content });
          }
          for (const tc of delta?.tool_calls ?? []) {
            const index = tc.index ?? 0;
            toolCalls[index] ??= { id: '', name: '', args: '' };
            if (tc.id) toolCalls[index].id = tc.id;
            if (tc.function?.name) toolCalls[index].name += tc.function.name;
            if (tc.function?.arguments) {
              toolCalls[index].args += tc.function.arguments;
            }
          }
        }

        const calls = toolCalls.filter((t) => t.id && t.name);
        if (calls.length === 0) break;

        // 工具调用 → 执行 → 回填
        for (const call of calls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = call.args
              ? (JSON.parse(call.args) as Record<string, unknown>)
              : {};
          } catch {
            /* 参数解析失败按空处理 */
          }
          const summary = `正在执行「${call.name}」…`;
          toolRounds += 1;
          send({ type: 'tool_exec', name: call.name, summary });
          const result = await this.executeTool(
            call.name,
            parsedArgs,
            authUser,
          );
          history.push({
            role: 'assistant' as const,
            content: '',
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: 'function' as const,
              function: { name: c.name, arguments: c.args },
            })),
          } as never);
          history.push({
            role: 'tool' as const,
            tool_call_id: call.id,
            content:
              typeof result === 'string' ? result : JSON.stringify(result),
          } as never);
        }
      }

      // B4 记忆捕获：异步写轮次 + 抽取原子记忆（不阻塞回包）
      if (authUser?.id) {
        void this.memory.capture(authUser.id, messages);
      }
      // B6 审计：记录会话（ok）
      if (authUser?.id) {
        void this.audit.recordChat({
          userId: authUser.id,
          model: model?.modelId ?? undefined,
          platform: platform?.name ?? undefined,
          messages: messages.length,
          toolCalls: toolRounds,
          status: 'ok',
          durationMs: Date.now() - chatStart,
        });
      }
      send({ type: 'done' });
      response.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`AI 对话失败: ${message}`);
      if (authUser?.id) {
        void this.audit.recordChat({
          userId: authUser.id,
          messages: messages.length,
          toolCalls: 0,
          status: 'error',
          errorMsg: message.slice(0, 200),
          durationMs: Date.now() - chatStart,
        });
      }
      send({ type: 'error', message: `对话失败：${message.slice(0, 120)}` });
      response.end();
    }
  }

  /** 工具白名单执行器（当前 3 个：热榜选题 / 违禁词体检 / 知识库检索） */
  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    authUser: AuthenticatedUser,
  ): Promise<unknown> {
    const t0 = Date.now();
    const userId = authUser?.id;
    if (userId) {
      const quota = await this.audit.canUseTool(userId);
      if (!quota.ok) {
        await this.audit.recordTool({
          userId,
          tool: name,
          args,
          resultOk: false,
          errorMsg: '工具配额超限',
          durationMs: Date.now() - t0,
        });
        return {
          error: `今日工具调用次数已用完（${quota.quota.toolLimit}/${quota.quota.toolLimit}），请明天再试`,
        };
      }
    }
    let result: unknown;
    let resultOk = true;
    let errorMsg: string | undefined;
    try {
      result = await this.runTool(name, args, authUser);
      if (result && typeof result === 'object' && 'error' in result) {
        resultOk = false;
        errorMsg = String((result as { error: unknown }).error).slice(0, 200);
      }
    } catch (error) {
      resultOk = false;
      errorMsg =
        error instanceof Error ? error.message.slice(0, 200) : String(error);
      result = { error: errorMsg };
    }
    if (userId) {
      void this.audit.recordTool({
        userId,
        tool: name,
        args,
        resultOk,
        errorMsg,
        durationMs: Date.now() - t0,
      });
    }
    return result;
  }

  /** 工具实现（switch 分派；写工具接入时在此加 confirmation 卡逻辑） */
  private async runTool(
    name: string,
    args: Record<string, unknown>,
    authUser: AuthenticatedUser,
  ): Promise<unknown> {
    switch (name) {
      case 'topic_hot': {
        const result = await this.hotTopics.getHotTopics(authUser);
        return { items: result.items.slice(0, 5) };
      }
      case 'compliance_check': {
        const text = safeText(args.text ?? '').trim();
        if (!text) return { error: '缺少待检测文案（text）' };
        return this.compliance.checkProhibited(authUser, { text });
      }
      case 'knowledge_search': {
        const query = safeText(args.query ?? '').trim();
        if (!query) return { error: '缺少检索关键词（query）' };
        const hits = await this.knowledge.recall(authUser, query, 3);
        return { hits };
      }
      case 'content_generate': {
        const topic = safeText(args.topic ?? '').trim();
        if (!topic) return { error: '缺少内容选题（topic）' };
        const platformLabel = safeText(args.platform ?? '').trim() || '公众号';
        const tone = safeText(args.tone ?? '').trim();
        const modelId = await this.resolveDefaultChatModelId();
        const prompt = [
          `请以「${platformLabel}」内容风格，围绕「${topic}」创作一篇完整文案。`,
          tone ? `语气要求：${tone}。` : '',
          '要求：标题吸引人、正文结构清晰、结尾有行动引导；直接输出正文，不要解释。',
        ]
          .filter(Boolean)
          .join('\n');
        const text = await this.aiClient.generate(
          modelId,
          [
            { role: 'system', content: '你是专业的新媒体内容创作者。' },
            { role: 'user', content: prompt },
          ],
          { maxTokens: 1200 },
        );
        return { content: text.trim(), platform: platformLabel, topic };
      }
      case 'image_generate': {
        const prompt = safeText(args.prompt ?? '').trim();
        if (!prompt) return { error: '缺少图片描述（prompt）' };
        const result = await this.platform.seedreamPro(authUser, { prompt });
        return result;
      }
      case 'video_download': {
        const platformKey = safeText(args.platform ?? '')
          .trim()
          .toLowerCase();
        const url = safeText(args.url ?? '').trim();
        if (!platformKey || !url) {
          return { error: '缺少平台（platform）或链接（url）' };
        }
        const result = await this.platform.download(authUser, {
          platform: platformKey,
          url,
        });
        return result;
      }
      case 'material_save': {
        const title = safeText(args.title ?? '').trim();
        const content = safeText(args.content ?? '').trim();
        if (!title || !content)
          return { error: '缺少标题（title）或内容（content）' };
        const saved = await this.prisma.material.create({
          data: {
            title,
            content,
            kind: 'text',
            source: 'ai-assistant',
          } as never,
        });
        return { ok: true, materialId: saved.id, title };
      }
      case 'schedule_publish': {
        // 高风险写操作：创建待确认记录（复用 agentConfirmation 表），用户确认后才真正调度。
        const content = safeText(args.content ?? '').trim();
        const platformLabel = safeText(args.platform ?? '').trim();
        const scheduledAt = safeText(args.scheduledAt ?? '').trim();
        const title = safeText(args.title ?? '').trim() || 'AI 助手定时发布';
        if (!content || !platformLabel || !scheduledAt) {
          return {
            error:
              '缺少发布内容（content）/平台（platform）/时间（scheduledAt）',
          };
        }
        const confirmation = await this.prisma.agentConfirmation.create({
          data: {
            userId: authUser?.id || 'legacy-local-user',
            tenantId: 'legacy-local-desktop',
            sessionId: `ai-assistant-${Date.now()}`,
            action: 'schedule_publish',
            status: 'waiting_for_confirmation',
            riskLevel: 'high',
            target: platformLabel,
            targetLabel: `${platformLabel} 定时发布`,
            content,
            replyText: `计划发布时间：${scheduledAt}`,
            confirmationJson: {
              tool: 'schedule_publish',
              title,
              content,
              platform: platformLabel,
              scheduledAt,
              source: 'ai-assistant',
            } as never,
          } as never,
        });
        return {
          requiresConfirmation: true,
          confirmationId: confirmation.id,
          summary: `已生成「${platformLabel}」定时发布确认卡（${scheduledAt}），请到「待我确认」确认后执行`,
          action: { label: '去确认', target: '/tasks/confirmations' },
        };
      }
      default:
        return { error: `未知工具：${name}` };
    }
  }

  /** 解析默认对话模型 ID（工具 content_generate 用） */
  private async resolveDefaultChatModelId(): Promise<string> {
    const fallback = await this.prisma.aIModel.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (fallback?.id) return fallback.id;
    throw new Error('未配置可用的 AI 模型');
  }
}
