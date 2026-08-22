import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AiClientService } from '../ai-models/ai-client.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MAI_UI_SYSTEM_PROMPT } from './mai-ui.prompt';

/** 视觉模型别名（ai_models.modelId），网关映射 qwen-vl-max */
const VISION_MODEL_ALIAS = 'kaypal-vision';

export interface MaiUiPlanInput {
  /** 手机截图 base64（png/jpeg） */
  imageBase64: string;
  /** 自然语言操作指令 */
  instruction: string;
  /** 截图宽度（可选，帮助模型理解坐标比例） */
  width?: number;
  /** 截图高度（可选） */
  height?: number;
  /** 可选的最近几步执行摘要（多步上下文） */
  context?: string;
}

export interface MaiUiPlanResult {
  ok: boolean;
  actions: unknown[];
  raw: string;
  model: string;
  parseError?: string;
}

/** 从模型文本中稳健提取 JSON 数组（容忍 ```json 包裹与前后杂音） */
function extractJsonArray(text: string): {
  value: unknown[] | null;
  error?: string;
} {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    return { value: null, error: '输出中未找到 JSON 数组' };
  }
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    return Array.isArray(parsed)
      ? { value: parsed }
      : { value: null, error: '解析结果不是数组' };
  } catch (e) {
    return {
      value: null,
      error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

@Injectable()
export class MaiUiService {
  private readonly logger = new Logger(MaiUiService.name);

  constructor(
    private readonly aiClient: AiClientService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 截图 + 指令 → 结构化候选动作（MAI-UI 最小可用）。
   * 视觉模型：kaypal-vision（网关映射 qwen-vl-max，走 kaypal 计费）。
   */
  async planActions(input: MaiUiPlanInput): Promise<MaiUiPlanResult> {
    if (!input.imageBase64?.trim()) {
      throw new BadRequestException('imageBase64 不能为空');
    }
    if (!input.instruction?.trim()) {
      throw new BadRequestException('instruction 不能为空');
    }
    // base64 长度粗校验（至少是一张有效缩略图）
    if (input.imageBase64.length < 100) {
      throw new BadRequestException('imageBase64 内容过短，请传入完整截图');
    }

    // 视觉模型按别名查（modelId=kaypal-vision，网关映射 qwen-vl-max）
    const model = await this.prisma.aIModel.findFirst({
      where: { modelId: VISION_MODEL_ALIAS },
      include: { platform: true },
    });
    if (!model) {
      throw new NotFoundException(
        `未找到视觉模型 ${VISION_MODEL_ALIAS}（ai_models 表缺少该模型记录）`,
      );
    }

    const dimHint =
      input.width && input.height
        ? `\n截图尺寸：${input.width}×${input.height} 像素，bounds 坐标请按此坐标系给出。`
        : '';
    const ctxHint = input.context?.trim()
      ? `\n最近已执行的步骤：${input.context.trim()}`
      : '';

    const prompt = `${input.instruction.trim()}${dimHint}${ctxHint}`;

    try {
      const raw = await this.aiClient.generateWithImage(model.id, {
        system: MAI_UI_SYSTEM_PROMPT,
        prompt,
        imageBase64: input.imageBase64,
      });

      const { value: actions, error } = extractJsonArray(raw);
      if (!actions) {
        this.logger.warn(
          `MAI-UI 输出非 JSON（${error}），raw 前 120 字: ${raw.slice(0, 120)}`,
        );
        return {
          ok: false,
          actions: [],
          raw,
          model: model.modelId,
          parseError: error,
        };
      }

      this.logger.log(
        `MAI-UI 规划成功: ${actions.length} 个候选动作（${model.modelId}）`,
      );
      return { ok: true, actions, raw, model: model.modelId };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`MAI-UI 视觉模型调用失败: ${message}`);
      throw new BadRequestException(`MAI-UI 视觉模型调用失败: ${message}`);
    }
  }
}
