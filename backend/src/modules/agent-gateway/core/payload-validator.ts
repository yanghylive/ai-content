import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export interface ValidationResult {
  ok: boolean;
  errors?: string;
}

/**
 * 执行前/后载荷校验（P2-10 做实）：
 * 用 ToolSpec.inputSchema / outputSchema 校验请求载荷与执行结果。
 * - ajv-formats 注册 date-time 等 format，真校验（不再"警告并忽略"）
 * - 空 schema（{}）视为任意通过
 * - schema 编译失败不阻断执行（契约测试另做 schema 有效性校验），返回 ok
 */
export class PayloadValidator {
  private ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true });
    addFormats(this.ajv);
  }

  private check(data: unknown, schema: Record<string, unknown>): ValidationResult {
    if (!schema || Object.keys(schema).length === 0) return { ok: true };
    try {
      const ok = this.ajv.validate(schema, data);
      if (ok) return { ok: true };
      return { ok: false, errors: this.ajv.errorsText(this.ajv.errors) };
    } catch {
      // schema 本身编译失败：由契约测试覆盖，运行时放行
      return { ok: true };
    }
  }

  validateInput(payload: Record<string, unknown>, schema: Record<string, unknown>): ValidationResult {
    return this.check(payload, schema);
  }

  validateOutput(data: Record<string, unknown>, schema: Record<string, unknown>): ValidationResult {
    return this.check(data, schema);
  }
}
