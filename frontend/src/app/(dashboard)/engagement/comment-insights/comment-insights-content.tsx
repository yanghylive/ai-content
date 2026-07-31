import { MessageCircle } from "lucide-react";
import { RedfoxWorkflowPage } from "../../components/redfox-workflow-page";

export function CommentInsightsContent() {
  return (
    <RedfoxWorkflowPage
      description="把抖音、小红书等评论转成痛点、需求、异议、意向词和回复建议，默认进入人工确认与回复规则沉淀。"
      eyebrow="客户互动洞察"
      icon={MessageCircle}
      metrics={[
        {
          label: "洞察对象",
          value: "评论",
          detail: "作品评论、关键词评论和导入评论样本",
        },
        {
          label: "输出维度",
          value: "5",
          detail: "痛点、需求、异议、意向词、回复建议",
        },
        {
          label: "自动动作",
          value: "禁止",
          detail: "不自动评论、私信、加微或创建高意向线索",
        },
      ]}
      panels={[
        {
          title: "需求提炼",
          description: "从评论里找用户真实问题、购买动机和阻碍因素。",
          items: ["提取痛点", "识别异议", "聚类常见问题"],
        },
        {
          title: "回复建议",
          description: "生成可审查的回复建议和规则建议。",
          items: ["默认待确认", "可沉淀回复规则", "保留来源记录"],
        },
        {
          title: "增长联动",
          description: "把评论洞察作为线索判断参考，而不是自动外联动作。",
          items: ["只生成线索草稿", "人工确认入池", "CRM 后续承接"],
        },
      ]}
      primaryAction="查看回复规则"
      primaryHref="/engagement/rules"
      rows={[
        ["评论分析", "评论洞察入口", "已开放"],
        ["洞察记录", "历史洞察列表", "沉淀中"],
        ["回复规则", "客户互动规则", "可继续完善"],
      ]}
      secondaryAction="查看对标账号"
      secondaryHref="/intelligence/accounts"
      title="评论洞察"
    />
  );
}
