export type OptimizationPlatform =
  'all' | 'xiaohongshu' | 'douyin' | 'wechat' | 'bilibili' | 'tiktok';

export type OptimizationSource = 'local_scoring' | 'redfox';

export type TitleQualityLevel =
  'excellent' | 'good' | 'needs_improvement' | 'weak';

export type ScoreDimension = {
  key: string;
  label: string;
  score: number;
  evidence: string;
};

export type OptimizationHitItem = {
  type: 'hook' | 'keyword' | 'risk' | 'structure';
  text: string;
  reason: string;
};

export type WorkflowTrace = {
  source: OptimizationSource;
  status: 'local_scoring' | 'ready_for_redfox';
  plannedSkill: string;
  redfoxClientHook: string;
  generatedAt: string;
};

export type TitleScoreResult = {
  workflowId: string;
  platform: OptimizationPlatform;
  originalTitle: string;
  overallScore: number;
  qualityLevel: TitleQualityLevel;
  dimensions: ScoreDimension[];
  hitItems: OptimizationHitItem[];
  suggestions: string[];
  rewriteCandidates: string[];
  workflow: WorkflowTrace;
};

export type RewriteVariant = {
  label: string;
  title: string;
  content: string;
  highlight: string;
};

export type RewriteResult = {
  workflowId: string;
  platform: OptimizationPlatform;
  originalContent: string;
  rewrittenContent: string;
  variants: RewriteVariant[];
  changes: string[];
  suggestions: string[];
  workflow: WorkflowTrace;
};

export type XhsNoteOptimizationResult = {
  workflowId: string;
  original: {
    title?: string;
    content: string;
    hashtags: string[];
  };
  optimized: {
    title: string;
    opening: string;
    body: string;
    hashtags: string[];
    callToAction: string;
  };
  score: {
    overall: number;
    coverHook: number;
    searchKeyword: number;
    trustBuilding: number;
    interactionIntent: number;
  };
  hitItems: OptimizationHitItem[];
  suggestions: string[];
  workflow: WorkflowTrace;
};
