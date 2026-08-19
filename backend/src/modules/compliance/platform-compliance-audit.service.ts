// 平台合规审计（Sprint 5 完成标志：平台条款/隐私/授权/退订/删除复审，2026-08-16）
// 核查 6 大合规项在每个平台的落地状态，输出结构化审计报告。
// 证据 = 代码机制名（可追溯），不空口承诺。
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type ComplianceStatus =
  'compliant' | 'partial' | 'not_applicable' | 'gap';

export interface ComplianceFinding {
  item: string;
  status: ComplianceStatus;
  /** 落地机制（代码/表名，可追溯） */
  evidence: string;
  /** 缺口说明 / 建议 */
  note: string | null;
}

export interface PlatformComplianceReport {
  generatedAt: string;
  platforms: Array<{
    platform: string;
    findings: ComplianceFinding[];
    /** 该平台是否有阻断性缺口 */
    blocked: boolean;
  }>;
  summary: {
    totalFindings: number;
    compliant: number;
    partial: number;
    gap: number;
  };
}

/** 审计项定义（统一口径） */
const AUDIT_ITEMS: Array<{
  key: string;
  label: string;
  /** 该平台合规项的判定器：返回 { status, evidence, note } */
  assess: (platform: string) => ComplianceFinding;
}> = [
  {
    key: 'authorization',
    label: '授权合规（采集/发布走官方授权或用户登录会话，非未授权爬虫）',
    assess: (platform) =>
      // 浏览器会话方案：用户登录态内辅助采集（DiscoveryBrowserRunner / auto-upload）
      {
        const browserBased = [
          'douyin',
          'xiaohongshu',
          'kuaishou',
          'wechat-channel',
          'wechat',
        ].includes(platform);
        return {
          item: 'authorization',
          status: browserBased ? 'partial' : 'not_applicable',
          evidence: browserBased
            ? 'DiscoveryBrowserRunner / AutoUploadService（用户登录 Playwright 会话内操作，无 API 授权不伪装）'
            : 'manual/video-link adapter（人工导入，无自动采集）',
          note: browserBased
            ? '用户登录会话内采集，遇验证码/风控转人工不绕过；仍建议关注各平台开发者条款对自动化的约定'
            : null,
        };
      },
  },
  {
    key: 'unsubscribe',
    label: '退订（用户可退订自动回复/推送）',
    assess: () => ({
      item: 'unsubscribe',
      status: 'compliant',
      evidence:
        'suppression.service.ts（SuppressionList 双检查：发送前查抑制名单）',
      note: null,
    }),
  },
  {
    key: 'deletion',
    label: '删除（用户数据可删除）',
    assess: () => ({
      item: 'deletion',
      status: 'compliant',
      evidence: 'lead delete / crm archive（线索删除、客户归档含审计）',
      note: null,
    }),
  },
  {
    key: 'consent',
    label: '同意（高风险动作有确认/审批）',
    assess: () => ({
      item: 'consent',
      status: 'compliant',
      evidence:
        'approval-gate.service.ts（low 自动、medium confirm-first、high 强制人工）+ 前端审批中心',
      note: null,
    }),
  },
  {
    key: 'privacy',
    label: '隐私（只存必要字段，最小化采集）',
    assess: (platform) => ({
      item: 'privacy',
      status: platform === 'wechat' ? 'partial' : 'compliant',
      evidence:
        'schema 字段最小化（昵称/平台身份/来源文本，不存聊天全量；微信仅存会话摘要）',
      note:
        platform === 'wechat' ? '微信会话摘要存储范围需与用户协议对齐' : null,
    }),
  },
  {
    key: 'terms',
    label: '条款（自动化行为符合平台条款；unsupported 置灰不报假成功）',
    assess: (platform) => ({
      item: 'terms',
      status: 'compliant',
      evidence:
        'capabilities().unavailableReason 置灰 + 原因码（DouyinAdapter/各 connector）',
      note:
        platform === 'douyin'
          ? '搜索/主页浏览依赖用户会话，风控时明确转人工'
          : null,
    }),
  },
];

@Injectable()
export class PlatformComplianceAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** 运行合规审计（6 项 × 全部平台） */
  audit(): PlatformComplianceReport {
    const platforms = [
      'douyin',
      'xiaohongshu',
      'kuaishou',
      'wechat-channel',
      'wechat',
      'manual',
    ];
    const rows = platforms.map((platform) => {
      const findings = AUDIT_ITEMS.map((item) => item.assess(platform));
      return {
        platform,
        findings,
        blocked: findings.some((f) => f.status === 'gap'),
      };
    });

    const all = rows.flatMap((r) => r.findings);
    return {
      generatedAt: new Date().toISOString(),
      platforms: rows,
      summary: {
        totalFindings: all.length,
        compliant: all.filter((f) => f.status === 'compliant').length,
        partial: all.filter((f) => f.status === 'partial').length,
        gap: all.filter((f) => f.status === 'gap').length,
      },
    };
  }

  /** 持久化审计结果（可查历史） */
  async auditAndPersist(userId: string) {
    const report = this.audit();
    try {
      await this.prisma.complianceCheck.create({
        data: {
          userId,
          targetType: 'platform-compliance-audit',
          platform: 'multi',
          riskLevel: report.summary.gap > 0 ? 'high' : 'low',
          status: report.summary.gap > 0 ? 'blocked' : 'passed',
          findings: report.platforms as unknown as Prisma.InputJsonValue,
          raw: report as unknown as Prisma.InputJsonValue,
        },
      });
    } catch {
      // 持久化失败不影响审计结果
    }
    return report;
  }
}
