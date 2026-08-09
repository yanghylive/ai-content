export type CommentInsightsPlatform =
  | 'douyin'
  | 'xiaohongshu'
  | 'wechat_channel'
  | 'bilibili'
  | 'all';

export type CommentSourceType =
  | 'manual_comments'
  | 'source_url'
  | 'work_id'
  | 'keyword';

export type CommentInsightRiskLevel = 'low' | 'medium' | 'high';

export type NormalizedComment = {
  id: string;
  author?: string;
  content: string;
  likedCount?: number;
  publishedAt?: string;
};

export type PainPointInsight = {
  theme: string;
  severity: CommentInsightRiskLevel;
  count: number;
  evidence: string[];
  suggestion: string;
};

export type DemandInsight = {
  demand: string;
  count: number;
  evidence: string[];
  contentOpportunity: string;
};

export type ObjectionInsight = {
  objection: string;
  count: number;
  evidence: string[];
  replyAngle: string;
};

export type IntentKeywordInsight = {
  keyword: string;
  intentLevel: 'browse' | 'consult' | 'purchase';
  count: number;
  evidence: string[];
};

export type ReplySuggestion = {
  scenario: string;
  tone: string;
  content: string;
  riskLevel: CommentInsightRiskLevel;
  requiresHumanReview: boolean;
};

export type CommentInsightsWorkflowTrace = {
  source: 'local_rule' | 'redfox';
  status: 'rule_screening' | 'ready_for_redfox';
  plannedSkill: string;
  redfoxClientHook: string;
  generatedAt: string;
};

export type CommentAnalyzeResult = {
  insightId: string;
  platform: CommentInsightsPlatform;
  sourceType: CommentSourceType;
  sourceUrl?: string;
  workTitle?: string;
  analyzedCount: number;
  summary: string;
  painPoints: PainPointInsight[];
  demands: DemandInsight[];
  objections: ObjectionInsight[];
  intentKeywords: IntentKeywordInsight[];
  topQuestions: string[];
  replySuggestions: ReplySuggestion[];
  suggestedReplyRules: string[];
  workflow: CommentInsightsWorkflowTrace;
};

export type CommentInsightsListResult = {
  items: CommentAnalyzeResult[];
  total: number;
  message: string;
  workflow: CommentInsightsWorkflowTrace;
};
