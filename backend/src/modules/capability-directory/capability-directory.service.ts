import { Injectable } from '@nestjs/common';
import { getCapabilityCenter } from '../ai-gateway/ai-gateway.service';
import { AiEmployeeService } from '../ai-employee/ai-employee.service';

/**
 * 全量能力目录（2026-09-03）。
 *
 * 把各业务线已存在的「能力源」聚合成一份统一目录，供 Web 与手机 App
 * 复用（登录用户通用）。归一化结构：
 *   groups: [{ source, title, subtitle, count, summary?, items: [{ key, name, desc, ... }] }]
 *
 * 能力源接入约定：新增能力模块时，在此 service 注册一个 builder 即可。
 */
export interface DirectoryItem {
  key: string;
  name: string;
  desc: string;
  example?: string;
  group?: string;
  domain?: string;
  platform?: string;
  status?: string;
  riskLevel?: string;
  nextAction?: string;
}

export interface DirectoryGroup {
  source: string;
  title: string;
  subtitle: string;
  count: number;
  summary?: Record<string, unknown>;
  items: DirectoryItem[];
}

@Injectable()
export class CapabilityDirectoryService {
  constructor(private readonly aiEmployee: AiEmployeeService) {}

  /** 归一 AI 助手工具（ai-gateway TOOLS 元数据，纯静态） */
  private buildAiAssistantGroup(): DirectoryGroup {
    const center = getCapabilityCenter();
    return {
      source: 'ai-assistant',
      title: 'AI 助手',
      subtitle: '对话即可触发的 23 类内容/返利/获客工具',
      count: center.total,
      items: center.groups.flatMap((g) =>
        g.items.map((item) => ({
          key: item.key,
          name: item.name,
          desc: item.desc,
          example: item.example,
          group: g.title,
        })),
      ),
    };
  }

  /** 归一 AI 员工能力快照（real/simulated/needs_config/unavailable 实时状态） */
  private async buildAiEmployeeGroup(): Promise<DirectoryGroup> {
    const snapshot = await this.aiEmployee.getCapabilities();
    return {
      source: 'ai-employee',
      title: 'AI 员工',
      subtitle: '内容曝光/发布/客服/获客自动化员工与就绪状态',
      count: snapshot.summary.total,
      summary: {
        real: snapshot.summary.real,
        simulated: snapshot.summary.simulated,
        needsConfig: snapshot.summary.needsConfig,
        unavailable: snapshot.summary.unavailable,
        localEngineReady: snapshot.summary.localEngineReady,
      },
      items: snapshot.capabilities.map((c) => ({
        key: c.key,
        name: c.title,
        desc: c.message,
        domain: c.domain,
        platform: c.platform,
        status: c.status,
        riskLevel: c.riskLevel,
        nextAction: c.nextAction,
      })),
    };
  }

  /** 聚合所有能力源 → 统一目录 */
  async buildDirectory() {
    const groups: DirectoryGroup[] = [
      this.buildAiAssistantGroup(),
      await this.buildAiEmployeeGroup(),
    ];
    return {
      generatedAt: new Date().toISOString(),
      total: groups.reduce((n, g) => n + g.count, 0),
      sources: groups.map((g) => g.source),
      groups,
    };
  }
}
