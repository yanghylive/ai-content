import { Capabilities, ToolSpec } from './types';

/**
 * 工具注册表 —— 对齐《补充包》5.1/5.2。
 * 业务模式只开放已注册工具；高级模式由 Octop 提供通用工具。
 * 结构校验交给契约测试(AJV)与显式 required 字段检查，引擎不依赖外部校验库。
 */
export class ToolRegistry {
  private specs = new Map<string, ToolSpec>();

  register(spec: ToolSpec): void {
    this.assertStructure(spec);
    this.specs.set(spec.name, spec);
  }

  registerMany(specs: ToolSpec[]): void {
    for (const s of specs) this.register(s);
  }

  get(name: string): ToolSpec | undefined {
    return this.specs.get(name);
  }

  require(name: string): ToolSpec {
    const spec = this.specs.get(name);
    if (!spec) throw new Error(`未注册工具: ${name}`);
    return spec;
  }

  list(): ToolSpec[] {
    return [...this.specs.values()];
  }

  /** 检查工具所需能力是否可用（如 rpa.browser）。未知能力一律视为不满足（fail-closed）。 */
  capabilitiesSatisfied(spec: ToolSpec, caps: Capabilities): boolean {
    return spec.requiredCapabilities.every((cap) => {
      if (cap === 'rpa.browser') return caps.browser.available;
      if (cap === 'rpa.mobile') return caps.mobile.available;
      if (cap === 'computer') return caps.computer.available;
      if (cap === 'file') return caps.file.available;
      // 未知能力：默认拒绝（拼错如 rpa.brower 也会被拦下）
      return false;
    });
  }

  private assertStructure(spec: ToolSpec): void {
    const required: (keyof ToolSpec)[] = [
      'name',
      'version',
      'domain',
      'readOnly',
      'risk',
      'requiresConfirmation',
      'supportsPause',
      'supportsResume',
      'requiredCapabilities',
      'inputSchema',
      'outputSchema',
      'idempotencyScope',
      'evidenceTypes',
      'compensation',
    ];
    for (const k of required) {
      if ((spec as unknown as Record<string, unknown>)[k] === undefined) {
        throw new Error(`ToolSpec 缺少字段: ${k} (${spec.name})`);
      }
    }
    if (!/^\d+\.\d+\.\d+$/.test(spec.version)) {
      throw new Error(`ToolSpec 版本号不合法: ${spec.version}`);
    }
  }
}
