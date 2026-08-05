import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AiClientService } from '../ai-models/ai-client.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedfoxHotTopicsService } from '../redfox/redfox-hot-topics.service';
import { RedfoxComplianceService } from '../redfox/redfox-compliance.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

/** AI 助手系统提示词（工具使用指南，function calling 触发） */
const SYSTEM_PROMPT = `你是 JIUZHANG AI 的内容运营助手，帮助用户完成内容创作与运营工作。
你可以调用以下工具来直接执行操作：
1. topic_hot：获取今日全网热榜选题（抖音/头条/知乎）。用户问"有什么热点/今天发什么/选题"时调用。
2. compliance_check：检查文案是否含违禁词（参数 text 为待检测文案）。用户要发布内容前调用。
3. knowledge_search：从用户的品牌知识库检索相关资料（参数 query 为检索关键词，如产品名/卖点/品牌）。创作涉及用户自己的产品、品牌、门店、话术时，必须先调用本工具拿到真实资料再写，不要凭空编造产品信息。
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
      description: '检查文案是否含平台违禁词（发布前合规体检），返回风险词与替换建议',
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
    private readonly knowledge: KnowledgeService,
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

    try {
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
      const history = (
        [
          { role: 'system' as const, content: SYSTEM_PROMPT },
          ...messages,
        ] as Array<{
          role: 'system' | 'user' | 'assistant';
          content: string;
        }>
      ).slice(-12); // 上下文窗口保护

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = await client.chat.completions.create({
          model: model.modelId,
          messages: history as never,
          tools: TOOLS as never,
          stream: true,
        });

        let textBuffer = '';
        const toolCalls: Array<{
          id: string;
          name: string;
          args: string;
        }> = [];

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            textBuffer += delta.content;
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
            content: typeof result === 'string' ? result : JSON.stringify(result),
          } as never);
        }
      }

      send({ type: 'done' });
      response.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`AI 对话失败: ${message}`);
      send({ type: 'error', message: `对话失败：${message.slice(0, 120)}` });
      response.end();
    }
  }

  /** 工具白名单执行器（当前 2 个：热榜选题 / 违禁词体检） */
  private async executeTool(
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
        const text = String(args.text ?? '').trim();
        if (!text) return { error: '缺少待检测文案（text）' };
        return this.compliance.checkProhibited(authUser, { text });
      }
      case 'knowledge_search': {
        const query = String(args.query ?? '').trim();
        if (!query) return { error: '缺少检索关键词（query）' };
        const hits = await this.knowledge.recall(authUser, query, 3);
        return { hits };
      }
      default:
        return { error: `未知工具：${name}` };
    }
  }
}
