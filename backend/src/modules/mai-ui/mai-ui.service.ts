import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AiClientService } from '../ai-models/ai-client.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MAI_UI_SYSTEM_PROMPT } from './mai-ui.prompt';

/**
 * 视觉模型别名（ai_models.modelId）。
 * kaypal-vision = kaypal 网关侧别名（映射 qwen-vl-max）；
 * cmsvis0001visionkaypalvl = 本机/桌面库注册的 Kaypal 视觉模型（同映射）。
 * P1（P5 门禁 2026-08-22）：单一 alias 查不到即 404，按别名列表逐个查找。
 */
const VISION_MODEL_ALIASES = ['kaypal-vision', 'cmsvis0001visionkaypalvl'];

/** P2：单次规划最多返回的候选动作数（防止模型输出爆炸序列拖垮执行器） */
const MAX_PLAN_ACTIONS = 20;

/** P2：合法动作类型白名单（与 mai-ui.prompt.ts 的动作 schema 对齐） */
const ALLOWED_ACTION_TYPES = [
  'click',
  'input',
  'swipe',
  'wait',
  'back',
  'home',
  'ask_user',
  'done',
] as const;
type MaiUiActionType = (typeof ALLOWED_ACTION_TYPES)[number];

const SWIPE_DIRECTIONS = ['up', 'down', 'left', 'right'];

/** 校验单个动作对象：类型白名单 + 字段形态 + bounds 坐标范围 */
function validateMaiUiAction(
  item: unknown,
  width?: number,
  height?: number,
): string | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return '动作不是对象';
  }
  const action = item as Record<string, unknown>;
  const type = action.action;
  if (
    typeof type !== 'string' ||
    !ALLOWED_ACTION_TYPES.includes(type as MaiUiActionType)
  ) {
    return `未知动作类型：${String(type)}`;
  }
  if ('bounds' in action && action.bounds !== undefined) {
    const b = action.bounds;
    if (
      !Array.isArray(b) ||
      b.length !== 4 ||
      !b.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      return `bounds 必须是 4 个数字 [x1, y1, x2, y2]：${JSON.stringify(b)}`;
    }
    const [x1, y1, x2, y2] = b as number[];
    if (x1 >= x2 || y1 >= y2) {
      return `bounds 非法：左上角必须小于右下角 [${x1}, ${y1}, ${x2}, ${y2}]`;
    }
    if (x1 < 0 || y1 < 0) {
      return `bounds 不能为负：[${x1}, ${y1}, ${x2}, ${y2}]`;
    }
    // 提供截图尺寸时，坐标必须落在截图范围内
    if (width && height && (x2 > width || y2 > height)) {
      return `bounds 超出截图范围（${width}×${height}）：[${x1}, ${y1}, ${x2}, ${y2}]`;
    }
  }
  if (type === 'click' && !('target' in action) && !('bounds' in action)) {
    return 'click 动作缺少 target/bounds，执行器无法定位元素';
  }
  if (type === 'input' && typeof action.text !== 'string') {
    return 'input 动作缺少 text 字段';
  }
  if (
    type === 'swipe' &&
    !SWIPE_DIRECTIONS.includes(String(action.direction))
  ) {
    return `swipe direction 必须是 ${SWIPE_DIRECTIONS.join('/')}`;
  }
  if (
    type === 'wait' &&
    (typeof action.ms !== 'number' || action.ms < 0 || action.ms > 60_000)
  ) {
    return 'wait.ms 必须是 0-60000 的毫秒数';
  }
  return null;
}

/** P2：校验动作序列——数量上限 + 逐项校验，返回合法动作与违规明细 */
function validateMaiUiActions(
  items: unknown[],
  width?: number,
  height?: number,
): { actions: unknown[]; rejected: string[] } {
  // 单点 bounds（x1==x2 且 y1==y2）归一化为 ±10px 小矩形：
  // 模型常输出点击点而非矩形（2026-08-22 验收发现），先归一化再走范围校验
  for (const item of items) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      const b = rec.bounds;
      if (
        Array.isArray(b) &&
        b.length === 4 &&
        b.every((v) => typeof v === 'number')
      ) {
        const [x1, y1, x2, y2] = b;
        if (x1 === x2 && y1 === y2) {
          const pad = 10;
          rec.bounds = [
            Math.max(0, x1 - pad),
            Math.max(0, y1 - pad),
            x1 + pad,
            y1 + pad,
          ];
        }
      }
    }
  }
  const rejected: string[] = [];
  if (items.length > MAX_PLAN_ACTIONS) {
    rejected.push(
      `动作数 ${items.length} 超过上限 ${MAX_PLAN_ACTIONS}，仅取前 ${MAX_PLAN_ACTIONS} 个`,
    );
  }
  const actions: unknown[] = [];
  for (const item of items.slice(0, MAX_PLAN_ACTIONS)) {
    const error = validateMaiUiAction(item, width, height);
    if (error) {
      rejected.push(error);
      continue;
    }
    actions.push(item);
  }
  return { actions, rejected };
}

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
  /** P2：被校验拒绝的动作明细（类型白名单/坐标范围/数量上限） */
  rejectedActions?: string[];
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

    // P1（P5 门禁 2026-08-22）：视觉模型按别名列表查找——
    // 服务端别名 kaypal-vision 与本机注册名 cmsvis0001visionkaypalvl 任一命中即可，
    // 并过滤 enabled（禁用模型不参与规划）。单一别名查不到即 404 是断链根因。
    const model = await this.prisma.aIModel.findFirst({
      where: {
        modelId: { in: VISION_MODEL_ALIASES },
        enabled: true,
      },
      include: { platform: true },
    });
    if (!model) {
      throw new NotFoundException(
        `未找到可用的视觉模型（ai_models 缺少任一启用的 ${VISION_MODEL_ALIASES.join(' / ')} 记录）`,
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
      // 生成 + 解析，LLM 偶发截断时重试一次（2026-08-22 验收发现 raw 仅 "[" 的情况）
      let raw = '';
      let parsed: unknown[] | null = null;
      let parseError: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        raw = await this.aiClient.generateWithImage(
          model.id,
          {
            system: MAI_UI_SYSTEM_PROMPT,
            prompt,
            imageBase64: input.imageBase64,
          },
          { maxTokens: 2000 }, // 2026-08-22：qwen-vl-max 输出 1200 偶发截断，放宽
        );
        const r = extractJsonArray(raw);
        if (r.value) {
          parsed = r.value;
          break;
        }
        parseError = r.error;
        this.logger.warn(
          `MAI-UI 第 ${attempt + 1} 次输出非 JSON（${r.error}），raw 前 120 字: ${raw.slice(0, 120)}`,
        );
      }

      if (!parsed) {
        return {
          ok: false,
          actions: [],
          raw,
          model: model.modelId,
          parseError,
        };
      }

      // P2（P5 门禁 2026-08-22）：动作序列校验——类型白名单/坐标范围/数量上限，
      // 违规项剔除并在 rejectedActions 留痕，避免把脏动作喂给执行器
      const { actions, rejected } = validateMaiUiActions(
        parsed,
        input.width,
        input.height,
      );

      if (rejected.length) {
        this.logger.warn(
          `MAI-UI 剔除 ${rejected.length} 个非法动作：${rejected.join('；')}`,
        );
      }
      this.logger.log(
        `MAI-UI 规划成功: ${actions.length} 个候选动作（${model.modelId}）`,
      );
      return {
        ok: actions.length > 0,
        actions,
        raw,
        model: model.modelId,
        ...(rejected.length ? { rejectedActions: rejected } : {}),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`MAI-UI 视觉模型调用失败: ${message}`);
      throw new BadRequestException(`MAI-UI 视觉模型调用失败: ${message}`);
    }
  }
}
