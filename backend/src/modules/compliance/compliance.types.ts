export type CompliancePlatform =
  'all' | 'xiaohongshu' | 'douyin' | 'wechat' | 'bilibili' | 'tiktok';

export type ComplianceTargetType =
  | 'article'
  | 'xiaohongshu_note'
  | 'video_script'
  | 'comment_reply'
  | 'material';

export type ComplianceRiskLevel = 'pass' | 'low' | 'medium' | 'high';

export type ComplianceFinding = {
  id: string;
  category:
    | 'prohibited_word'
    | 'absolute_claim'
    | 'medical_claim'
    | 'traffic_inducement'
    | 'price_claim'
    | 'privacy';
  riskLevel: ComplianceRiskLevel;
  matchedText: string;
  reason: string;
  suggestion: string;
  replacement?: string;
  startIndex?: number;
};

export type ComplianceGate = {
  publishAllowed: boolean;
  manualReviewRequired: boolean;
  reason: string;
  nextActions: string[];
};

export type ComplianceWorkflowTrace = {
  source: 'local_rule' | 'redfox';
  status: 'rule_screening' | 'ready_for_redfox';
  plannedSkill: string;
  redfoxClientHook: string;
  generatedAt: string;
};

export type ComplianceCheckResult = {
  checkId: string;
  targetType: ComplianceTargetType;
  targetId?: string;
  platform: CompliancePlatform;
  riskLevel: ComplianceRiskLevel;
  riskScore: number;
  summary: string;
  findings: ComplianceFinding[];
  suggestions: string[];
  gate: ComplianceGate;
  workflow: ComplianceWorkflowTrace;
};

export type ComplianceChecksListResult = {
  items: ComplianceCheckResult[];
  total: number;
  message: string;
  workflow: ComplianceWorkflowTrace;
};
