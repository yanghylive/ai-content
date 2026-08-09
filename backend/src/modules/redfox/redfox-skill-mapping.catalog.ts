import type { RedfoxClientRequestOptions } from './redfox.types';

export interface RedfoxSkillHubRef {
  skillNo: string;
  skillCode: string;
  skillName: string;
  url: string;
  repoUrl: string | null;
  requiresApiKey: boolean;
}

export interface RedfoxSkillMapping {
  code: string;
  skillCode: string;
  skillName: string;
  aliases: string[];
  platform: string;
  scenario: string;
  method: NonNullable<RedfoxClientRequestOptions['method']>;
  path: string;
  bodyEncoding?: 'json' | 'form';
  estimatedCostPoints: number;
  inputContract: {
    requiredAny?: string[];
    required?: string[];
    optional?: string[];
  };
  outputObjects: string[];
  source: string;
  skillHubRefs?: RedfoxSkillHubRef[];
}

function skillHubRef(input: {
  skillNo: string;
  skillCode: string;
  skillName: string;
  repoUrl?: string;
  requiresApiKey?: boolean;
}): RedfoxSkillHubRef {
  return {
    skillNo: input.skillNo,
    skillCode: input.skillCode,
    skillName: input.skillName,
    url: `https://redfox.hk/skills/no/${input.skillNo}`,
    repoUrl: input.repoUrl || null,
    requiresApiKey: input.requiresApiKey ?? true,
  };
}

export const REDFOX_SKILL_MAPPINGS: RedfoxSkillMapping[] = [
  {
    code: 'douyin-query-work',
    skillCode: 'douyin-query-work',
    skillName: '抖音作品详情查询',
    aliases: [
      '0OT1E306',
      '抖音作品详情',
      '抖音作品查询',
      '作品查询',
      'douyin-query-work',
    ],
    platform: 'douyin',
    scenario: 'work_detail',
    method: 'POST',
    path: '/story/api/dyData/queryWork',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['workId', 'workUrl'],
    },
    outputObjects: [
      'IntelligenceItem',
      'Material',
      'BenchmarkAccount',
      'RedfoxCallLog',
    ],
    source: 'https://redfox.hk/apis/douyin/0OT1E306',
  },
  {
    code: 'douyin-comment',
    skillCode: 'douyin-comment',
    skillName: '抖音评论分析',
    aliases: ['抖音评论分析', 'douyin-comment'],
    platform: 'douyin',
    scenario: 'comment_insight',
    method: 'POST',
    path: '/story/api/dy/work/comment',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['videoId', 'workId', 'workUrl'],
      optional: ['offset'],
    },
    outputObjects: ['CommentInsight', 'GrowthLead', 'RedfoxCallLog'],
    source:
      'backend/src/modules/intelligence/intelligence-monitor-runner.service.ts',
  },
  {
    code: 'xiaohongshu-comment',
    skillCode: 'xiaohongshu-comment',
    skillName: '小红书评论分析',
    aliases: ['小红书评论分析', 'xiaohongshu-comment', 'xhs-comment'],
    platform: 'xiaohongshu',
    scenario: 'comment_insight',
    method: 'POST',
    path: '/story/api/xhs/ability/commentList',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['noteId', 'workId', 'workUrl'],
      optional: ['cursor', 'sort'],
    },
    outputObjects: ['CommentInsight', 'GrowthLead', 'RedfoxCallLog'],
    source:
      'backend/src/modules/intelligence/intelligence-monitor-runner.service.ts',
  },
  {
    code: 'bilibili-comment-submit',
    skillCode: 'bilibili-comment',
    skillName: 'B 站评论分析',
    aliases: ['B 站评论分析', 'B站评论分析', 'bilibili-comment'],
    platform: 'bilibili',
    scenario: 'comment_insight',
    method: 'POST',
    path: '/story/api/bili/commentSubmit',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['opusId', 'workId', 'workUrl'],
      optional: ['sortType', 'dataNum', 'offset'],
    },
    outputObjects: ['CommentInsight', 'GrowthLead', 'RedfoxCallLog'],
    source:
      'backend/src/modules/intelligence/intelligence-monitor-runner.service.ts',
  },
  {
    code: 'bilibili-comment-result',
    skillCode: 'bilibili-comment-result',
    skillName: 'B 站评论结果读取',
    aliases: ['B 站评论结果', 'B站评论结果', 'bilibili-comment-result'],
    platform: 'bilibili',
    scenario: 'comment_insight',
    method: 'POST',
    path: '/story/api/bili/commentResult',
    bodyEncoding: 'form',
    estimatedCostPoints: 0,
    inputContract: {
      required: ['taskId'],
    },
    outputObjects: ['CommentInsight', 'RedfoxCallLog'],
    source:
      'backend/src/modules/intelligence/intelligence-monitor-runner.service.ts',
  },
  {
    code: 'douyin-search-article',
    skillCode: 'douyin-search-article',
    skillName: '抖音作品搜索',
    aliases: ['抖音热门/点赞飙升', '抖音作品搜索', '抖音搜索作品'],
    platform: 'douyin',
    scenario: 'content_search',
    method: 'POST',
    path: '/story/api/dyData/searchArticle',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['inquiryText', 'keyword', 'query', 'q'],
      optional: ['limit'],
    },
    outputObjects: ['IntelligenceItem', 'Material', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.ts#officialMonitorPaths',
  },
  {
    code: 'douyin-search-user',
    skillCode: 'douyin-search-user',
    skillName: '抖音账号搜索',
    aliases: [
      'douyin-account-search',
      '抖音账号搜索',
      '抖音账号搜索/热门/相似/诊断',
      '抖音热门相似账号',
    ],
    platform: 'douyin',
    scenario: 'account_search',
    method: 'POST',
    path: '/story/api/dyData/searchUser',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['keyword', 'query', 'q', 'account'],
      optional: ['limit'],
    },
    outputObjects: ['BenchmarkAccount', 'GrowthLead', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.ts#officialMonitorPaths',
  },
  {
    code: 'douyin-query-user',
    skillCode: 'douyin-query-user',
    skillName: '抖音账号详情',
    aliases: ['抖音账号诊断', '抖音账号详情', '抖音/公众号订阅追踪'],
    platform: 'douyin',
    scenario: 'account_detail',
    method: 'POST',
    path: '/story/api/dyData/queryUser',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['accountId', 'secUid', 'userId', 'accountUrl'],
    },
    outputObjects: ['BenchmarkAccount', 'GrowthAccountHealth', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.ts#officialMonitorPaths',
  },
  {
    code: 'xiaohongshu-search-article',
    skillCode: 'xiaohongshu-search-article',
    skillName: '小红书作品搜索',
    aliases: [
      '小红书爆款',
      '小红书低粉爆款',
      '小红书每日/七日爆款',
      '小红书作品搜索',
    ],
    platform: 'xiaohongshu',
    scenario: 'content_search',
    method: 'POST',
    path: '/story/api/xhsUser/searchArticle',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['inquiryText', 'keyword', 'query', 'q'],
      optional: ['limit'],
    },
    outputObjects: ['IntelligenceItem', 'Material', 'Topic', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.ts#officialMonitorPaths',
  },
  {
    code: 'xiaohongshu-search-user',
    skillCode: 'xiaohongshu-search-user',
    skillName: '小红书账号搜索',
    aliases: ['小红书账号搜索/热门/相似/诊断', '小红书热门相似账号'],
    platform: 'xiaohongshu',
    scenario: 'account_search',
    method: 'POST',
    path: '/story/api/xhsUser/searchUser',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['keyword', 'query', 'q', 'account'],
      optional: ['limit'],
    },
    outputObjects: ['BenchmarkAccount', 'GrowthLead', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.ts#officialMonitorPaths',
  },
  {
    code: 'xiaohongshu-query-account',
    skillCode: 'xiaohongshu-query-account',
    skillName: '小红书账号详情',
    aliases: ['小红书账号诊断', '小红书账号详情'],
    platform: 'xiaohongshu',
    scenario: 'account_detail',
    method: 'POST',
    path: '/story/api/xhsUser/queryAccountDetail',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['accountId', 'userId', 'accountUrl', 'profileUrl'],
    },
    outputObjects: ['BenchmarkAccount', 'GrowthAccountHealth', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.ts#officialMonitorPaths',
  },
  {
    code: 'gzh-search-article',
    skillCode: 'gzh-search-article',
    skillName: '公众号文章搜索',
    aliases: ['公众号 10w+', '公众号黑马/10w+', '公众号热门文章'],
    platform: 'gzh',
    scenario: 'content_search',
    method: 'POST',
    path: '/story/api/gzhData/searchArticle',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['keyword', 'query', 'q'],
      optional: ['limit'],
    },
    outputObjects: ['IntelligenceItem', 'Material', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.ts#officialMonitorPaths',
  },
  {
    code: 'gzh-search-user',
    skillCode: 'gzh-search-user',
    skillName: '公众号账号搜索',
    aliases: ['公众号账号搜索', '公众号热门相似账号'],
    platform: 'gzh',
    scenario: 'account_search',
    method: 'POST',
    path: '/story/api/gzhData/searchUser',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['keyword', 'query', 'q', 'account'],
      optional: ['limit'],
    },
    outputObjects: ['BenchmarkAccount', 'GrowthLead', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.ts#officialMonitorPaths',
  },
  {
    code: 'gzh-query-article',
    skillCode: 'gzh-query-article',
    skillName: '公众号文章互动分析',
    aliases: [
      '公众号文章详情',
      '公众号作品详情',
      '公众号文章互动',
      '公众号文章互动分析',
    ],
    platform: 'gzh',
    scenario: 'article_engagement',
    method: 'POST',
    path: '/story/api/gzhData/queryArticleDetail',
    bodyEncoding: 'json',
    estimatedCostPoints: 80,
    inputContract: {
      requiredAny: ['articleId', 'workId', 'workUrl', 'url'],
    },
    outputObjects: [
      'IntelligenceItem',
      'Material',
      'Engagement',
      'RedfoxCallLog',
    ],
    source: 'https://redfox.hk/story/web/api/doc/detail/no/VUTTKTP6',
  },
  {
    code: 'bilibili-work-detail',
    skillCode: 'bilibili-work-detail',
    skillName: 'B 站作品详情',
    aliases: ['B 站作品集', 'B站作品集', 'B 站作品详情', 'B站作品详情'],
    platform: 'bilibili',
    scenario: 'work_detail',
    method: 'POST',
    path: '/story/api/bili/data/workDetail',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['bvId', 'bvid', 'opusId', 'workId', 'workUrl'],
    },
    outputObjects: ['IntelligenceItem', 'Material', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.spec.ts',
  },
  {
    code: 'bilibili-account-detail',
    skillCode: 'bilibili-account-detail',
    skillName: 'B 站账号详情',
    aliases: ['B 站搜账号', 'B站搜账号', 'B 站账号详情', 'B站账号详情'],
    platform: 'bilibili',
    scenario: 'account_detail',
    method: 'POST',
    path: '/story/api/bili/data/accountDetail',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['mid', 'accountId', 'accountUrl'],
    },
    outputObjects: ['BenchmarkAccount', 'GrowthLead', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.spec.ts',
  },
  {
    code: 'deepsearch-doubao-submit',
    skillCode: 'deepsearch-doubao-submit',
    skillName: '豆包 WebSearch 提交',
    aliases: [
      'Deepseek/豆包 WebSearch',
      '豆包 WebSearch',
      '全网出海信息源',
      'AI 信息源',
      '文旅多平台信息源',
      '短剧多平台信息源',
      'A 股新闻/大 V/调查员',
    ],
    platform: 'web',
    scenario: 'web_search_submit',
    method: 'POST',
    path: '/story/api/deepSearch/dbSubmit',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['keyword', 'query', 'q'],
      optional: ['limit'],
    },
    outputObjects: ['IntelligenceItem', 'IntelligenceReport', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.ts#officialMonitorPaths',
  },
  {
    code: 'deepsearch-doubao-result',
    skillCode: 'deepsearch-doubao-result',
    skillName: '豆包 WebSearch 结果',
    aliases: ['豆包 WebSearch 结果'],
    platform: 'web',
    scenario: 'web_search_result',
    method: 'POST',
    path: '/story/api/deepSearch/dbResult',
    bodyEncoding: 'json',
    estimatedCostPoints: 0,
    inputContract: {
      required: ['taskId'],
    },
    outputObjects: ['IntelligenceItem', 'IntelligenceReport', 'RedfoxCallLog'],
    source:
      'backend/src/modules/redfox/redfox-interface-catalog.service.ts#officialMonitorPaths',
  },
  {
    code: 'gzh-query-user',
    skillCode: 'gzh-query-user',
    skillName: '公众号账号详情',
    aliases: ['公众号账号诊断', '公众号账号详情', '公众号账号信息'],
    platform: 'gzh',
    scenario: 'account_detail',
    method: 'POST',
    path: '/story/api/gzhData/queryUser',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['account', 'accountName', 'accountId', 'profileUrl'],
    },
    outputObjects: ['BenchmarkAccount', 'GrowthAccountHealth', 'RedfoxCallLog'],
    source: 'https://redfox.hk/apis/gongzhonghao/6C4A77XR',
  },
  {
    code: 'tiktok-search-user',
    skillCode: 'tiktok-search-user',
    skillName: 'TikTok 账号搜索',
    aliases: ['TikTok 账号搜索', 'Tiktok关键词搜索账号'],
    platform: 'tiktok',
    scenario: 'account_search',
    method: 'POST',
    path: '/story/api/deepSearch/tk/searchUser',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['keyword', 'query', 'q', 'account'],
      optional: ['cursor', 'rid', 'limit', 'region'],
    },
    outputObjects: ['BenchmarkAccount', 'GrowthLead', 'RedfoxCallLog'],
    source: 'https://redfox.hk/apis/tool-tiktok/20070019',
  },
  {
    code: 'media-parse-work',
    skillCode: 'media-parse-work',
    skillName: '短视频下载器',
    aliases: ['短视频下载', '作品爬取', '短视频下载器'],
    platform: 'media',
    scenario: 'asset_extraction',
    method: 'POST',
    path: '/story/api/parseWork/parse',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['url', 'workUrl'],
      optional: ['sourcePlatform', 'authorizationStatus'],
    },
    outputObjects: ['Material', 'RedfoxCallLog'],
    source: 'https://redfox.hk/apis/tool/AWUTFI4V',
  },
  {
    code: 'gpt-image-submit',
    skillCode: 'gpt-image-submit',
    skillName: 'image2-GPT 提交任务',
    aliases: ['GPT-image2', 'image2-GPT', 'GPT 图片生成'],
    platform: 'aigc',
    scenario: 'image_generation_submit',
    method: 'POST',
    path: '/story/api/parseWork/imageGen/submitSkill',
    bodyEncoding: 'json',
    estimatedCostPoints: 10,
    inputContract: {
      requiredAny: ['prompt'],
      optional: [
        'parameters',
        'modelName',
        'n',
        'size',
        'quality',
        'referenceImage',
      ],
    },
    outputObjects: ['Material', 'RuntimeExecution', 'RedfoxCallLog'],
    source: 'https://redfox.hk/apis/tool-gpt-image/HUV4KRFQ',
  },
  {
    code: 'gpt-image-result',
    skillCode: 'gpt-image-result',
    skillName: 'image2-GPT 查询任务结果',
    aliases: ['GPT-image2 结果', 'image2-GPT 结果'],
    platform: 'aigc',
    scenario: 'image_generation_result',
    method: 'POST',
    path: '/story/api/parseWork/imageGen/result',
    bodyEncoding: 'json',
    estimatedCostPoints: 0,
    inputContract: {
      required: ['taskId'],
    },
    outputObjects: ['Material', 'RuntimeExecution', 'RedfoxCallLog'],
    source: 'https://redfox.hk/apis/tool-gpt-image/H9NINDBH',
  },
  {
    code: 'seedream-image-submit',
    skillCode: 'seedream-image-submit',
    skillName: 'Seedream 5.0 lite 提交任务',
    aliases: [
      'seedream',
      'Seedream',
      'Seedream/图片生成',
      '封面制作',
      '小红书/公众号封面',
    ],
    platform: 'aigc',
    scenario: 'image_generation_submit',
    method: 'POST',
    path: '/story/api/parseWork/imageGen/arkSubmit',
    bodyEncoding: 'json',
    estimatedCostPoints: 8,
    inputContract: {
      requiredAny: ['prompt', 'topic', 'brief'],
      optional: [
        'image',
        'size',
        'model',
        'responseFormat',
        'outputFormat',
        'watermark',
        'style',
        'ratio',
        'platforms',
        'referenceImage',
      ],
    },
    outputObjects: ['Material', 'RuntimeExecution', 'RedfoxCallLog'],
    source: 'https://redfox.hk/apis/tool-doubao-image/7OM96HCF',
  },
  {
    code: 'seedream-image-result',
    skillCode: 'seedream-image-result',
    skillName: 'Seedream 5.0 lite 查询任务',
    aliases: ['Seedream 结果', 'seedream 结果'],
    platform: 'aigc',
    scenario: 'image_generation_result',
    method: 'POST',
    path: '/story/api/parseWork/imageGen/arkResult',
    bodyEncoding: 'json',
    estimatedCostPoints: 0,
    inputContract: {
      required: ['taskId'],
    },
    outputObjects: ['Material', 'RuntimeExecution', 'RedfoxCallLog'],
    source: 'https://redfox.hk/apis/tool-doubao-image/WH5U8KZE',
  },
  {
    code: 'seedance-video-submit',
    skillCode: 'seedance-video-submit',
    skillName: 'Seedance 2.0 视频生成提交任务',
    aliases: [
      'Seedance',
      'seendance',
      'Seedance/视频生成',
      'Seedance/图片生成',
    ],
    platform: 'aigc',
    scenario: 'video_generation_submit',
    method: 'POST',
    path: '/story/api/parseWork/videoGen/submit',
    bodyEncoding: 'json',
    estimatedCostPoints: 150,
    inputContract: {
      requiredAny: ['content', 'prompt', 'text'],
      optional: [
        'model',
        'type',
        'imageUrl',
        'videoUrl',
        'audioUrl',
        'duration',
        'watermark',
        'generateAudio',
        'resolution',
        'ratio',
      ],
    },
    outputObjects: ['Material', 'RuntimeExecution', 'RedfoxCallLog'],
    source: 'https://redfox.hk/apis/tool-doubao-video/ER2ATHKI',
  },
  {
    code: 'seedance-video-result',
    skillCode: 'seedance-video-result',
    skillName: 'Seedance 2.0 视频生成查询任务',
    aliases: ['Seedance 结果', 'seendance 结果'],
    platform: 'aigc',
    scenario: 'video_generation_result',
    method: 'POST',
    path: '/story/api/parseWork/videoGen/result',
    bodyEncoding: 'json',
    estimatedCostPoints: 0,
    inputContract: {
      required: ['taskId'],
    },
    outputObjects: ['Material', 'RuntimeExecution', 'RedfoxCallLog'],
    source: 'https://redfox.hk/apis/tool-doubao-video/XJUVPXJ8',
  },
  {
    code: 'contract-web-hot-search',
    skillCode: 'contract-web-hot-search',
    skillName: '全网热搜 SkillHub 映射',
    aliases: ['全网热搜', '全网热搜/聚合热点', '平台搜索'],
    platform: 'web',
    scenario: 'hot_topic_aggregation',
    method: 'POST',
    path: '',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['keyword', 'query', 'q'],
      optional: ['platforms', 'limit', 'timeRange'],
    },
    outputObjects: ['IntelligenceItem', 'Topic', 'Material'],
    source: 'https://redfox.hk/skills',
    skillHubRefs: [
      skillHubRef({
        skillNo: 'KJq7uXHY',
        skillCode: 'trending-hub',
        skillName: '全网热搜查询',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/trending-hub',
      }),
      skillHubRef({
        skillNo: 'npSuapcy',
        skillCode: 'trending-hub-top10',
        skillName: '全网聚合热点榜单top10',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/trending-hub-top10',
      }),
      skillHubRef({
        skillNo: 'mUeuhzkp',
        skillCode: 'cn-last30days',
        skillName: 'Last 30 Days—CN版',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/cn-last30days',
      }),
    ],
  },
  {
    code: 'contract-industry-sources',
    skillCode: 'contract-industry-sources',
    skillName: '行业信息源契约映射',
    aliases: [],
    platform: 'web',
    scenario: 'industry_intelligence',
    method: 'POST',
    path: '',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['keyword', 'industry', 'query'],
      optional: ['platforms', 'timeRange', 'limit'],
    },
    outputObjects: ['IntelligenceItem', 'IntelligenceReport', 'Topic'],
    source: 'solution_contract_mapping_without_verified_redfox_api_path',
  },
  {
    code: 'contract-content-rewrite',
    skillCode: 'contract-content-rewrite',
    skillName: '多平台创作 SkillHub 映射',
    aliases: [
      '标题生成评分',
      '小红书标题生成评分与创作',
      '公众号标题生成评分与创作',
      '多平台改写',
      '多平台风格改写',
      '小红书改写',
      '公众号改写',
      '知乎改写',
      '视频提示词',
    ],
    platform: 'content_ai',
    scenario: 'content_generation',
    method: 'POST',
    path: '',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['topic', 'text', 'brief', 'keyword'],
      optional: ['platforms', 'tone', 'style', 'targetAudience'],
    },
    outputObjects: ['Article', 'Material', 'PublishRecord'],
    source: 'https://redfox.hk/skills',
    skillHubRefs: [
      skillHubRef({
        skillNo: 'y6HMNcJT',
        skillCode: 'xiaohongshu-title-score',
        skillName: '小红书标题生成与评分',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/xiaohongshu-title-score',
      }),
      skillHubRef({
        skillNo: 'dNyAZJXe',
        skillCode: 'wechat-title',
        skillName: '公众号标题生成与评分',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/wechat-title',
      }),
      skillHubRef({
        skillNo: 'pura5VDP',
        skillCode: 'multi-rewrite',
        skillName: '多平台文案风格改写',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/multi-rewrite',
        requiresApiKey: false,
      }),
      skillHubRef({
        skillNo: 'tmcjp4jB',
        skillCode: 'xiaohongshu-rewrite',
        skillName: '小红书文案改写',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/xiaohongshu-rewrite',
        requiresApiKey: false,
      }),
      skillHubRef({
        skillNo: 'D5V2dq8n',
        skillCode: 'wechat-rewrite',
        skillName: '公众号文案改写',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/wechat-rewrite',
        requiresApiKey: false,
      }),
      skillHubRef({
        skillNo: '26qBBMsT',
        skillCode: 'zhihu-rewrite',
        skillName: '知乎文案改写',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/zhihu-rewrite',
        requiresApiKey: false,
      }),
      skillHubRef({
        skillNo: 'C5NRmNrn',
        skillCode: 'video-prompt-expert',
        skillName: '视频提示词生成器（Seedance2.0）',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/video-prompt-expert',
      }),
    ],
  },
  {
    code: 'contract-compliance-check',
    skillCode: 'contract-compliance-check',
    skillName: '多平台合规检测 SkillHub 映射',
    aliases: [
      '多平台违禁词检测',
      '抖音违禁词检测',
      '小红书违禁词检测',
      '公众号违禁词检测',
    ],
    platform: 'compliance',
    scenario: 'content_compliance',
    method: 'POST',
    path: '',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['text', 'article', 'content'],
      optional: ['platforms', 'riskLevel'],
    },
    outputObjects: ['ComplianceCheck', 'RiskEvidence', 'AgentConfirmation'],
    source: 'https://redfox.hk/skills',
    skillHubRefs: [
      skillHubRef({
        skillNo: 'wn2Hrw42',
        skillCode: 'multi-wordcheck',
        skillName: '多平台违禁词检测',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/multi-wordcheck',
      }),
      skillHubRef({
        skillNo: 'F3jCHerW',
        skillCode: 'douyin-prohibited-word',
        skillName: '抖音违禁词检测',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/douyin-prohibited-word',
      }),
      skillHubRef({
        skillNo: 'AVZkdH2g',
        skillCode: 'xiaohongshu-prohibited-word',
        skillName: '小红书违禁词检测',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/xiaohongshu-prohibited-word',
      }),
      skillHubRef({
        skillNo: '4AdnxkH3',
        skillCode: 'wechat-prohibited-word',
        skillName: '公众号违禁词检测',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/wechat-prohibited-word',
      }),
    ],
  },
  {
    code: 'contract-asset-generation',
    skillCode: 'contract-asset-generation',
    skillName: 'AIGC 素材契约映射',
    aliases: [],
    platform: 'aigc',
    scenario: 'asset_generation',
    method: 'POST',
    path: '',
    bodyEncoding: 'json',
    estimatedCostPoints: 2,
    inputContract: {
      requiredAny: ['prompt', 'topic', 'brief'],
      optional: ['style', 'ratio', 'platforms', 'referenceImage'],
    },
    outputObjects: ['Material', 'RuntimeExecution'],
    source: 'solution_contract_mapping_without_verified_redfox_api_path',
  },
  {
    code: 'contract-media-extraction',
    skillCode: 'contract-media-extraction',
    skillName: '素材提取 SkillHub 映射',
    aliases: ['PDF/图片文字提取'],
    platform: 'media',
    scenario: 'asset_extraction',
    method: 'POST',
    path: '',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['url', 'fileUrl', 'workUrl'],
      optional: ['sourcePlatform', 'authorizationStatus'],
    },
    outputObjects: ['Material', 'KnowledgeItem', 'EvidenceAttachment'],
    source: 'https://redfox.hk/skills/no/mWVYT9mf',
    skillHubRefs: [
      skillHubRef({
        skillNo: 'mWVYT9mf',
        skillCode: 'pdf-image-text-extractor',
        skillName: 'PDF和图片文字提取',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/pdf-image-text-extractor',
        requiresApiKey: false,
      }),
    ],
  },
  {
    code: 'contract-growth-ranking',
    skillCode: 'contract-growth-ranking',
    skillName: '增长榜单 SkillHub 映射',
    aliases: ['抖音涨粉/点赞榜'],
    platform: 'growth',
    scenario: 'growth_ranking',
    method: 'POST',
    path: '',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['keyword', 'industry', 'account'],
      optional: ['platforms', 'limit', 'region'],
    },
    outputObjects: ['BenchmarkAccount', 'GrowthLead', 'GrowthReport'],
    source: 'https://redfox.hk/skills',
    skillHubRefs: [
      skillHubRef({
        skillNo: 'EZTwMSse',
        skillCode: 'douyin-rise-ranking',
        skillName: '抖音涨粉账号推荐',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/douyin-rise-ranking',
      }),
      skillHubRef({
        skillNo: 'M4zkHt29',
        skillCode: 'douyin-content-surge',
        skillName: '抖音每日点赞飙升榜',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/douyin-content-surge',
      }),
      skillHubRef({
        skillNo: '8Q8kUrHv',
        skillCode: 'douyin-weekly-surge',
        skillName: '抖音七日点赞飙升榜',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/douyin-weekly-surge',
      }),
    ],
  },
  {
    code: 'contract-account-diagnosis',
    skillCode: 'contract-account-diagnosis',
    skillName: '账号诊断契约映射',
    aliases: [],
    platform: 'gzh',
    scenario: 'account_diagnosis',
    method: 'POST',
    path: '',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['account', 'accountId', 'profileUrl'],
      optional: ['timeRange'],
    },
    outputObjects: ['BenchmarkAccount', 'GrowthAccountHealth', 'GrowthReport'],
    source: 'solution_contract_mapping_without_verified_redfox_api_path',
  },
  {
    code: 'contract-generic-comment-insight',
    skillCode: 'contract-generic-comment-insight',
    skillName: '评论洞察 SkillHub 映射',
    aliases: ['评论分析'],
    platform: 'multi_platform',
    scenario: 'comment_insight',
    method: 'POST',
    path: '',
    bodyEncoding: 'json',
    estimatedCostPoints: 1,
    inputContract: {
      requiredAny: ['workUrl', 'url', 'keyword'],
      optional: ['platforms', 'limit'],
    },
    outputObjects: ['CommentInsight', 'GrowthLead', 'AgentConfirmation'],
    source: 'https://redfox.hk/skills',
    skillHubRefs: [
      skillHubRef({
        skillNo: 'HBjH7jCY',
        skillCode: 'douyin-comment',
        skillName: '抖音评论分析',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/douyin-comment',
      }),
      skillHubRef({
        skillNo: 'CpwGzGnY',
        skillCode: 'xiaohongshu-comment',
        skillName: '小红书评论分析',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/xiaohongshu-comment',
      }),
      skillHubRef({
        skillNo: 'pyhVpkYD',
        skillCode: 'bilibili-comment',
        skillName: 'B站作品评论分析',
        repoUrl:
          'https://github.com/redfox-data/redfox-community/tree/main/skills/bilibili-comment',
      }),
    ],
  },
];

export function findRedfoxSkillMapping(
  value?: string | null,
): RedfoxSkillMapping | null {
  const normalized = normalizeMappingKey(value);
  if (!normalized) return null;
  return (
    REDFOX_SKILL_MAPPINGS.find((item) =>
      [
        item.code,
        item.skillCode,
        item.skillName,
        item.path,
        ...item.aliases,
        ...(item.skillHubRefs || []).flatMap((skillHubRef) => [
          skillHubRef.skillNo,
          skillHubRef.skillCode,
          skillHubRef.skillName,
        ]),
      ]
        .map(normalizeMappingKey)
        .includes(normalized),
    ) || null
  );
}

export function findRedfoxSkillMappingByPath(
  path?: string | null,
): RedfoxSkillMapping | null {
  const normalized = normalizeMappingPath(path);
  if (!normalized) return null;
  return (
    REDFOX_SKILL_MAPPINGS.find(
      (item) => normalizeMappingPath(item.path) === normalized,
    ) || null
  );
}

function normalizeMappingKey(value?: string | null) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeMappingPath(value?: string | null) {
  return (value || '').trim().replace(/\/+$/, '');
}
