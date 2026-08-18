import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * 案例展示中心 · 测试种子脚本（仅开发/测试环境手动执行，不随启动自动运行）。
 *
 * 内容：
 *   1. 分类种子（平台 / 行业 / 能力，ShowcaseTaxonomy）
 *   2. 8 个测试案例（四类来源各 2 个，SEED-01 ~ SEED-08）
 *   3. 2 条演示体验入口（SEED-01 / SEED-03），用于演示「可体验」标记
 *
 * 幂等策略：
 *   - taxonomy 按 (type, slug) 唯一键 upsert；
 *   - case 按 slug 唯一键 upsert；
 *   - demoEndpoint 仅在目标案例尚无入口时创建。
 *
 * 注意：本脚本为演示数据，published 案例未走 M1 发布校验（未建 media/授权记录），
 * 仅供 M2 列表/详情前端联调；正式上线内容由后台审核流程产生。
 */

const prisma = new PrismaClient();

interface TaxonomySeed {
  type: 'platform' | 'industry' | 'capability';
  slug: string;
  name: string;
  sortOrder: number;
}

const TAXONOMIES: TaxonomySeed[] = [
  // 平台
  { type: 'platform', slug: 'wechat', name: '微信', sortOrder: 1 },
  { type: 'platform', slug: 'douyin', name: '抖音', sortOrder: 2 },
  { type: 'platform', slug: 'xiaohongshu', name: '小红书', sortOrder: 3 },
  { type: 'platform', slug: 'wechat_mini_program', name: '微信小程序', sortOrder: 4 },
  { type: 'platform', slug: 'app', name: 'App', sortOrder: 5 },
  { type: 'platform', slug: 'web', name: 'Web', sortOrder: 6 },
  // 行业
  { type: 'industry', slug: 'retail', name: '零售', sortOrder: 1 },
  { type: 'industry', slug: 'fmcg', name: '快消', sortOrder: 2 },
  { type: 'industry', slug: 'education', name: '教育', sortOrder: 3 },
  { type: 'industry', slug: 'healthcare', name: '医疗健康', sortOrder: 4 },
  { type: 'industry', slug: 'saas', name: 'SaaS', sortOrder: 5 },
  // 能力
  { type: 'capability', slug: 'ai_content_generation', name: 'AI 内容生成', sortOrder: 1 },
  { type: 'capability', slug: 'private_domain', name: '私域运营', sortOrder: 2 },
  { type: 'capability', slug: 'lead_gen', name: '线索获客', sortOrder: 3 },
  { type: 'capability', slug: 'chatbot', name: '智能客服', sortOrder: 4 },
  { type: 'capability', slug: 'data_analysis', name: '数据分析', sortOrder: 5 },
  { type: 'capability', slug: 'automation', name: '流程自动化', sortOrder: 6 },
];

interface CaseSeed {
  slug: string;
  title: string;
  subtitle: string | null;
  provenanceType: string;
  primaryPlatform: string | null;
  platforms: string[];
  primaryIndustry: string | null;
  industries: string[];
  capabilityTags: string[];
  businessProblem: string;
  solutionSummary: string;
  keyFeatures: Array<{ title: string; description: string }>;
  resultsSummary: string;
  evidenceLevel: string;
  evidenceScope: string | null;
  deliveryModes: string[];
  maturity: string;
  techSummary: string;
  seoTitle: string;
  seoDescription: string;
  publishedDaysAgo: number;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

const CASES: CaseSeed[] = [
  {
    slug: 'retail-private-domain-growth',
    title: '连锁零售私域增长案例',
    subtitle: '把门店会员沉淀到私域，用 AI 内容持续激活复购',
    provenanceType: 'delivery',
    primaryPlatform: 'wechat',
    platforms: ['wechat', 'wechat_mini_program'],
    primaryIndustry: 'retail',
    industries: ['retail'],
    capabilityTags: ['private_domain', 'lead_gen'],
    businessProblem:
      '某连锁零售品牌门店客流下滑，会员分散在 POS 与公众号，缺乏统一的私域触达与复购抓手，营销活动转化率持续走低。',
    solutionSummary:
      '统一会员数据接入企业微信私域，搭建分层运营 SOP，用 AI 批量生产朋友圈 / 社群 / 1v1 触达内容，按会员生命周期自动推送。',
    keyFeatures: [
      { title: '会员数据统一', description: '打通 POS、公众号与企业微信，形成统一会员视图' },
      { title: 'AI 内容批量生产', description: '按人群与场景批量生成合规营销文案' },
      { title: '自动化触达', description: '基于生命周期与行为自动推送，减少人工跟进' },
    ],
    resultsSummary: '试点门店 3 个月复购率提升 18%，社群活跃度提升 40%。',
    evidenceLevel: 'E2',
    evidenceScope: '客户经营数据脱敏回访',
    deliveryModes: ['h5', 'wechat_mini_program'],
    maturity: 'scale',
    techSummary: '企业微信 + 小程序 + AI 内容引擎',
    seoTitle: '连锁零售私域增长案例 - 九章智能',
    seoDescription: '连锁零售品牌私域会员运营与 AI 内容自动化触达交付案例。',
    publishedDaysAgo: 3,
  },
  {
    slug: 'cross-border-content-lead-gen',
    title: '跨境电商内容获客案例',
    subtitle: 'AI 多语种内容矩阵，降低跨境获客成本',
    provenanceType: 'delivery',
    primaryPlatform: 'xiaohongshu',
    platforms: ['douyin', 'xiaohongshu'],
    primaryIndustry: 'saas',
    industries: ['retail', 'saas'],
    capabilityTags: ['ai_content_generation', 'lead_gen'],
    businessProblem:
      '跨境电商 SaaS 厂商缺乏本地化内容生产能力，海外社媒账号长期低活跃，线索获取高度依赖付费广告，成本高企。',
    solutionSummary:
      '搭建 AI 多语种内容生产流水线，围绕目标市场热点自动选题、生成与分发，配合落地页与线索表单完成获客闭环。',
    keyFeatures: [
      { title: '多语种内容生成', description: '一键生成英 / 日 / 西等多语种营销内容' },
      { title: '热点选题', description: '自动抓取目标市场趋势并生成选题建议' },
      { title: '线索归因', description: '从内容点击到表单提交的完整归因链' },
    ],
    resultsSummary: '内容线索占比从 12% 提升至 45%，获客成本下降 30%。',
    evidenceLevel: 'E1',
    evidenceScope: '客户投放与线索数据回访',
    deliveryModes: ['web'],
    maturity: 'product',
    techSummary: 'AI 内容流水线 + 多语言模型',
    seoTitle: '跨境电商内容获客案例 - 九章智能',
    seoDescription: '跨境电商 SaaS 多语种内容矩阵与线索获客交付案例。',
    publishedDaysAgo: 10,
  },
  {
    slug: 'open-source-customer-support-bot',
    title: '开源智能客服助手',
    subtitle: '基于开源大模型的轻量客服机器人',
    provenanceType: 'open_source',
    primaryPlatform: 'web',
    platforms: ['web'],
    primaryIndustry: 'saas',
    industries: ['saas'],
    capabilityTags: ['chatbot'],
    businessProblem:
      '中小团队希望拥有可私有部署的智能客服，但商业方案成本高、数据合规顾虑大。',
    solutionSummary:
      '基于开源大模型与检索增强（RAG）搭建可私有部署的客服助手，支持知识库问答与人工转接。',
    keyFeatures: [
      { title: '可私有部署', description: '数据不出域，满足合规要求' },
      { title: 'RAG 知识库', description: '基于本地文档的检索增强问答' },
      { title: '人工转接', description: '低置信回答自动转人工' },
    ],
    resultsSummary: '开源社区演示环境可回答常见产品问题，支持一键部署。',
    evidenceLevel: 'E1',
    evidenceScope: '开源项目文档与演示环境',
    deliveryModes: ['web', 'download'],
    maturity: 'mvp',
    techSummary: '开源大模型 + 向量检索 + RAG',
    seoTitle: '开源智能客服助手 - 九章智能',
    seoDescription: '基于开源大模型的可私有部署智能客服助手演示。',
    publishedDaysAgo: 15,
  },
  {
    slug: 'open-source-content-workbench',
    title: '开源内容生成工作台',
    subtitle: '开箱即用的 AI 文案与配图工作台',
    provenanceType: 'open_source',
    primaryPlatform: 'web',
    platforms: ['web'],
    primaryIndustry: 'saas',
    industries: ['saas'],
    capabilityTags: ['ai_content_generation'],
    businessProblem:
      '运营人员需要快速产出多平台文案与配图，但现成工具要么付费、要么无法自定义工作流。',
    solutionSummary:
      '开源一个可扩展的 AI 内容工作台，内置多平台文案模板与配图生成，支持自定义 prompt 与工作流。',
    keyFeatures: [
      { title: '多平台模板', description: '内置公众号 / 小红书 / 抖音文案模板' },
      { title: '自定义工作流', description: '可视化编排 prompt 与输出节点' },
      { title: '本地运行', description: '支持本地模型或外部 API 两种模式' },
    ],
    resultsSummary: '开发者可 fork 后二次开发，社区贡献多个行业模板。',
    evidenceLevel: 'E0',
    evidenceScope: null,
    deliveryModes: ['download'],
    maturity: 'prototype',
    techSummary: 'Next.js + 开源模型',
    seoTitle: '开源内容生成工作台 - 九章智能',
    seoDescription: '开源 AI 文案与配图生成工作台演示。',
    publishedDaysAgo: 20,
  },
  {
    slug: 'ai-live-selection-prototype',
    title: 'AI 直播选品概念原型',
    subtitle: '用数据帮主播更快选出好卖的品',
    provenanceType: 'prototype',
    primaryPlatform: 'douyin',
    platforms: ['douyin'],
    primaryIndustry: 'fmcg',
    industries: ['fmcg'],
    capabilityTags: ['data_analysis', 'ai_content_generation'],
    businessProblem:
      '直播选品依赖主播经验，缺乏数据支撑，容易押错品造成库存压力。',
    solutionSummary:
      '聚合直播带货数据，用 AI 生成选品建议与话术要点，辅助主播决策。',
    keyFeatures: [
      { title: '选品打分', description: '按销量、毛利、热度等维度打分排序' },
      { title: '话术生成', description: '针对选定商品自动生成直播话术' },
      { title: '库存预警', description: '结合动销预测给出库存建议' },
    ],
    resultsSummary: '概念原型演示，界面与数据均为演示数据。',
    evidenceLevel: 'E0',
    evidenceScope: null,
    deliveryModes: ['h5'],
    maturity: 'concept',
    techSummary: '数据分析 + AI 生成（概念原型）',
    seoTitle: 'AI 直播选品概念原型 - 九章智能',
    seoDescription: 'AI 直播选品辅助决策概念原型演示。',
    publishedDaysAgo: 5,
  },
  {
    slug: 'smart-store-inspection-prototype',
    title: '智能门店巡检原型',
    subtitle: 'AI 识别门店陈列与卫生问题',
    provenanceType: 'prototype',
    primaryPlatform: 'app',
    platforms: ['app'],
    primaryIndustry: 'retail',
    industries: ['retail'],
    capabilityTags: ['automation', 'data_analysis'],
    businessProblem:
      '门店巡检依赖人工拍照上报，问题识别滞后，整改闭环难以追踪。',
    solutionSummary:
      '用视觉 AI 自动识别门店陈列、缺货与卫生问题，生成整改工单并跟踪闭环。',
    keyFeatures: [
      { title: '视觉识别', description: '自动识别缺货、陈列与卫生问题' },
      { title: '工单闭环', description: '问题自动生成工单并跟踪整改' },
      { title: '巡检报表', description: '自动汇总门店合规率与趋势' },
    ],
    resultsSummary: '概念原型演示，界面与数据均为演示数据。',
    evidenceLevel: 'E0',
    evidenceScope: null,
    deliveryModes: ['app'],
    maturity: 'concept',
    techSummary: '视觉 AI + 工单（概念原型）',
    seoTitle: '智能门店巡检原型 - 九章智能',
    seoDescription: 'AI 门店陈列与卫生巡检概念原型演示。',
    publishedDaysAgo: 8,
  },
  {
    slug: 'wechat-account-operation-template',
    title: '公众号运营模板',
    subtitle: '教育机构可复用的公众号内容运营模板',
    provenanceType: 'template',
    primaryPlatform: 'wechat',
    platforms: ['wechat'],
    primaryIndustry: 'education',
    industries: ['education'],
    capabilityTags: ['ai_content_generation'],
    businessProblem:
      '教育机构想做公众号内容但缺乏持续产出能力与选题规划。',
    solutionSummary:
      '提供可复用的公众号内容运营模板：选题日历、AI 文案模板与发布 SOP。',
    keyFeatures: [
      { title: '选题日历', description: '按招生节奏预设整月选题' },
      { title: 'AI 文案模板', description: '一键套用行业模板生成文章' },
      { title: '发布 SOP', description: '排版、发布与数据复盘全流程' },
    ],
    resultsSummary: '模板演示，界面与数据均为演示数据。',
    evidenceLevel: 'E0',
    evidenceScope: null,
    deliveryModes: ['web'],
    maturity: 'template',
    techSummary: '模板 + AI 生成（可定制）',
    seoTitle: '公众号运营模板 - 九章智能',
    seoDescription: '教育机构公众号内容运营可定制模板演示。',
    publishedDaysAgo: 12,
  },
  {
    slug: 'private-domain-sop-template',
    title: '私域社群 SOP 模板',
    subtitle: '医疗健康行业可复用的私域社群运营模板',
    provenanceType: 'template',
    primaryPlatform: 'wechat',
    platforms: ['wechat'],
    primaryIndustry: 'healthcare',
    industries: ['healthcare'],
    capabilityTags: ['private_domain', 'automation'],
    businessProblem:
      '医疗健康机构私域运营缺乏标准化流程，社群活跃度与转化难以稳定。',
    solutionSummary:
      '提供私域社群 SOP 模板：入群欢迎、内容节奏、活动与转化话术自动化配置。',
    keyFeatures: [
      { title: '社群 SOP', description: '入群到转化的全流程标准话术' },
      { title: '自动化配置', description: '按时间轴自动推送内容' },
      { title: '合规模板', description: '内置医疗健康行业合规话术' },
    ],
    resultsSummary: '模板演示，界面与数据均为演示数据。',
    evidenceLevel: 'E0',
    evidenceScope: null,
    deliveryModes: ['web'],
    maturity: 'template',
    techSummary: '模板 + 自动化（可定制）',
    seoTitle: '私域社群 SOP 模板 - 九章智能',
    seoDescription: '医疗健康行业私域社群运营可定制模板演示。',
    publishedDaysAgo: 18,
  },
];

/** 演示体验入口：真实可访问地址 + 对外短链代码（对应 ShowcaseShortLink） */
interface DemoEndpointSeed {
  slug: string;
  endpointType: string;
  targetUrl: string;
  shortCode: string;
  allowedDevices: string[];
  accessInstruction: string;
}

/** 需要挂「在线体验」入口的案例（targetUrl 为真实公开地址，短链跳转） */
const DEMO_ENDPOINTS: DemoEndpointSeed[] = [
  {
    slug: 'open-source-customer-support-bot',
    endpointType: 'web',
    targetUrl: 'https://wvw.dev/',
    shortCode: 'jzchatbot',
    allowedDevices: ['desktop', 'mobile'],
    accessInstruction: '开源智能客服演示，新窗口打开',
  },
  {
    slug: 'open-source-content-workbench',
    endpointType: 'web',
    targetUrl: 'https://wvw.dev/',
    shortCode: 'jzworkbench',
    allowedDevices: ['desktop'],
    accessInstruction: '开源内容工作台演示，新窗口打开',
  },
  {
    slug: 'ai-live-selection-prototype',
    endpointType: 'web',
    targetUrl: 'https://wvw.dev/',
    shortCode: 'jzlivepick',
    allowedDevices: ['desktop', 'mobile'],
    accessInstruction: 'AI 直播选品原型，新窗口打开',
  },
  {
    slug: 'smart-store-inspection-prototype',
    endpointType: 'web',
    targetUrl: 'https://wvw.dev/',
    shortCode: 'jzinspect',
    allowedDevices: ['mobile'],
    accessInstruction: '智能门店巡检原型，新窗口打开',
  },
];

interface MediaSeed {
  slug: string;
  mediaType: 'image' | 'video';
  fileUrl: string;
  thumbnailUrl: string | null;
  title: string;
  caption: string;
  altText: string;
  deviceFrame: 'desktop' | 'mobile' | 'tablet' | null;
  sortOrder: number;
}

/**
 * 媒体种子（M3）：给 2-3 个案例补充画廊内容。
 * 使用公开占位图（picsum.photos，按 seed 稳定），并标注 altText/caption/deviceFrame，
 * 便于前端画廊/设备框预览联调。正式内容由后台审核流程上传。
 */
const MEDIA_SEEDS: MediaSeed[] = [
  // 连锁零售私域增长案例（delivery，desktop/mobile/tablet 三张）
  {
    slug: 'retail-private-domain-growth',
    mediaType: 'image',
    fileUrl: 'https://picsum.photos/seed/jz-retail-dashboard/1200/750',
    thumbnailUrl: 'https://picsum.photos/seed/jz-retail-dashboard/480/300',
    title: '私域会员看板',
    caption: '统一会员视图与分层运营看板（演示数据）',
    altText: '私域会员分层运营看板截图',
    deviceFrame: 'desktop',
    sortOrder: 1,
  },
  {
    slug: 'retail-private-domain-growth',
    mediaType: 'image',
    fileUrl: 'https://picsum.photos/seed/jz-retail-mini/750/1334',
    thumbnailUrl: 'https://picsum.photos/seed/jz-retail-mini/300/533',
    title: '小程序会员首页',
    caption: '小程序会员首页与复购入口（演示数据）',
    altText: '小程序会员首页截图',
    deviceFrame: 'mobile',
    sortOrder: 2,
  },
  {
    slug: 'retail-private-domain-growth',
    mediaType: 'image',
    fileUrl: 'https://picsum.photos/seed/jz-retail-sop/900/675',
    thumbnailUrl: 'https://picsum.photos/seed/jz-retail-sop/360/270',
    title: '运营 SOP 流程',
    caption: '分层运营 SOP 与自动化触达流程（演示数据）',
    altText: '运营 SOP 自动化触达流程图',
    deviceFrame: 'tablet',
    sortOrder: 3,
  },
  // 开源智能客服助手（open_source，web 聊天界面 desktop/mobile 两张）
  {
    slug: 'open-source-customer-support-bot',
    mediaType: 'image',
    fileUrl: 'https://picsum.photos/seed/jz-chatbot-web/1200/750',
    thumbnailUrl: 'https://picsum.photos/seed/jz-chatbot-web/480/300',
    title: '客服对话界面',
    caption: '基于开源大模型的客服对话界面（演示数据）',
    altText: '智能客服对话界面截图',
    deviceFrame: 'desktop',
    sortOrder: 1,
  },
  {
    slug: 'open-source-customer-support-bot',
    mediaType: 'image',
    fileUrl: 'https://picsum.photos/seed/jz-chatbot-mobile/750/1334',
    thumbnailUrl: 'https://picsum.photos/seed/jz-chatbot-mobile/300/533',
    title: '移动端客服',
    caption: '移动端客服助手与人工转接入口（演示数据）',
    altText: '移动端智能客服截图',
    deviceFrame: 'mobile',
    sortOrder: 2,
  },
  // AI 直播选品概念原型（prototype，mobile 两张）
  {
    slug: 'ai-live-selection-prototype',
    mediaType: 'image',
    fileUrl: 'https://picsum.photos/seed/jz-live-pick/750/1334',
    thumbnailUrl: 'https://picsum.photos/seed/jz-live-pick/300/533',
    title: '选品打分',
    caption: '直播选品打分与排序（演示数据）',
    altText: 'AI 直播选品打分界面截图',
    deviceFrame: 'mobile',
    sortOrder: 1,
  },
  {
    slug: 'ai-live-selection-prototype',
    mediaType: 'image',
    fileUrl: 'https://picsum.photos/seed/jz-live-script/750/1334',
    thumbnailUrl: 'https://picsum.photos/seed/jz-live-script/300/533',
    title: '话术生成',
    caption: '针对选定商品自动生成直播话术（演示数据）',
    altText: 'AI 直播话术生成界面截图',
    deviceFrame: 'mobile',
    sortOrder: 2,
  },
];

async function seedTaxonomies(): Promise<void> {
  for (const tax of TAXONOMIES) {
    await prisma.showcaseTaxonomy.upsert({
      where: { type_slug: { type: tax.type, slug: tax.slug } },
      create: tax,
      update: { name: tax.name, sortOrder: tax.sortOrder, enabled: true },
    });
  }
  console.log(`已种子分类 ${TAXONOMIES.length} 条`);
}

async function seedCases(): Promise<void> {
  for (const item of CASES) {
    await prisma.showcaseCase.upsert({
      where: { slug: item.slug },
      create: {
        slug: item.slug,
        title: item.title,
        subtitle: item.subtitle,
        provenanceType: item.provenanceType,
        clientVisibility: 'public',
        primaryPlatform: item.primaryPlatform,
        platforms: item.platforms,
        primaryIndustry: item.primaryIndustry,
        industries: item.industries,
        capabilityTags: item.capabilityTags,
        businessProblem: item.businessProblem,
        solutionSummary: item.solutionSummary,
        keyFeatures: item.keyFeatures,
        resultsSummary: item.resultsSummary,
        evidenceLevel: item.evidenceLevel,
        evidenceScope: item.evidenceScope,
        deliveryModes: item.deliveryModes,
        maturity: item.maturity,
        techSummary: item.techSummary,
        seoTitle: item.seoTitle,
        seoDescription: item.seoDescription,
        status: 'published',
        publishedAt: daysAgo(item.publishedDaysAgo),
      },
      update: {
        title: item.title,
        subtitle: item.subtitle,
        provenanceType: item.provenanceType,
        primaryPlatform: item.primaryPlatform,
        platforms: item.platforms,
        primaryIndustry: item.primaryIndustry,
        industries: item.industries,
        capabilityTags: item.capabilityTags,
        businessProblem: item.businessProblem,
        solutionSummary: item.solutionSummary,
        keyFeatures: item.keyFeatures,
        resultsSummary: item.resultsSummary,
        evidenceLevel: item.evidenceLevel,
        evidenceScope: item.evidenceScope,
        deliveryModes: item.deliveryModes,
        maturity: item.maturity,
        techSummary: item.techSummary,
        seoTitle: item.seoTitle,
        seoDescription: item.seoDescription,
        status: 'published',
      },
    });
  }
  console.log(`已种子案例 ${CASES.length} 条`);
}

async function seedDemoEndpoints(): Promise<void> {
  for (const item of DEMO_ENDPOINTS) {
    const target = await prisma.showcaseCase.findUnique({
      where: { slug: item.slug },
    });
    if (!target) continue;

    const existing = await prisma.showcaseDemoEndpoint.findFirst({
      where: { caseId: target.id },
    });
    if (existing) continue;

    await prisma.showcaseDemoEndpoint.create({
      data: {
        caseId: target.id,
        endpointType: item.endpointType,
        targetUrl: item.targetUrl,
        shortCode: item.shortCode,
        allowedDevices: item.allowedDevices,
        iframeAllowed: false,
        accessInstruction: item.accessInstruction,
        fallbackType: 'media',
        fallbackTarget: null,
        healthStatus: 'healthy',
      },
    });

    // 同步创建短链记录（/r/:shortCode → targetUrl），让「在线体验」可跳转
    await prisma.showcaseShortLink.upsert({
      where: { shortCode: item.shortCode },
      update: { targetUrl: item.targetUrl, status: 'active' },
      create: {
        shortCode: item.shortCode,
        targetType: 'case',
        targetId: target.id,
        targetUrl: item.targetUrl,
        status: 'active',
      },
    });
  }
  console.log(`已种子演示入口 ${DEMO_ENDPOINTS.length} 条（含短链）`);
}

async function seedMedia(): Promise<void> {
  const seededCases = new Set<string>();
  for (const item of MEDIA_SEEDS) {
    if (seededCases.has(item.slug)) continue;
    seededCases.add(item.slug);

    const target = await prisma.showcaseCase.findUnique({
      where: { slug: item.slug },
    });
    if (!target) continue;

    // 幂等：该案例已有媒体时跳过，避免重复插入
    const existing = await prisma.showcaseMedia.findFirst({
      where: { caseId: target.id },
    });
    if (existing) continue;

    const items = MEDIA_SEEDS.filter((media) => media.slug === item.slug);
    for (const media of items) {
      await prisma.showcaseMedia.create({
        data: {
          caseId: target.id,
          mediaType: media.mediaType,
          fileUrl: media.fileUrl,
          thumbnailUrl: media.thumbnailUrl,
          title: media.title,
          caption: media.caption,
          altText: media.altText,
          deviceFrame: media.deviceFrame,
          sortOrder: media.sortOrder,
        },
      });
    }
  }
  console.log(`已种子媒体 ${MEDIA_SEEDS.length} 条`);
}

/** 授权/来源声明种子（PRD 附录 A「来源与声明」+ §6.1 四类案例发布必要条件） */
interface AuthorizationSeed {
  slug: string;
  recordType: string;
  grantor: string | null;
  scope: string;
  licenseName: string | null;
  sourceUrl: string | null;
  versionOrCommit: string | null;
  restrictionNotes: string | null;
}

const AUTHORIZATIONS: AuthorizationSeed[] = [
  // 九章交付（匿名）——客户授权 + 脱敏声明
  {
    slug: 'retail-private-domain-growth',
    recordType: 'customer_authorization',
    grantor: '客户名称已隐去',
    scope: '已获客户对外展示授权，客户名称与业务数据已脱敏',
    licenseName: null,
    sourceUrl: null,
    versionOrCommit: null,
    restrictionNotes: '匿名案例，客户名称已隐去',
  },
  {
    slug: 'cross-border-content-lead-gen',
    recordType: 'customer_authorization',
    grantor: '客户名称已隐去',
    scope: '已获客户对外展示授权，客户名称与业务数据已脱敏',
    licenseName: null,
    sourceUrl: null,
    versionOrCommit: null,
    restrictionNotes: '匿名案例，客户名称已隐去',
  },
  // 开源演示——PRD 附录 C 真实开源项目 + 许可证 + 版本
  {
    slug: 'open-source-customer-support-bot',
    recordType: 'oss_license',
    grantor: 'f/wvw.dev 项目组',
    scope: '本案例为开源能力演示，非九章客户交付项目',
    licenseName: 'MIT',
    sourceUrl: 'https://github.com/f/wvw.dev',
    versionOrCommit: 'main',
    restrictionNotes: '开源演示，复用前需核验许可证与依赖',
  },
  {
    slug: 'open-source-content-workbench',
    recordType: 'oss_license',
    grantor: 'MrXujiang',
    scope: '本案例为开源能力演示，非九章客户交付项目',
    licenseName: 'GPL-3.0',
    sourceUrl: 'https://github.com/MrXujiang/h5-Dooring',
    versionOrCommit: 'main',
    restrictionNotes: 'GPL-3.0，商业闭源集成需谨慎评估',
  },
  // 概念原型——演示数据声明
  {
    slug: 'ai-live-selection-prototype',
    recordType: 'other',
    grantor: null,
    scope: '本案例用于方案沟通，不代表已正式上线',
    licenseName: null,
    sourceUrl: null,
    versionOrCommit: null,
    restrictionNotes: '概念原型，采用演示数据',
  },
  {
    slug: 'smart-store-inspection-prototype',
    recordType: 'other',
    grantor: null,
    scope: '本案例用于方案沟通，不代表已正式上线',
    licenseName: null,
    sourceUrl: null,
    versionOrCommit: null,
    restrictionNotes: '概念原型，采用演示数据',
  },
  // 可定制模板——模板演示数据声明
  {
    slug: 'wechat-account-operation-template',
    recordType: 'other',
    grantor: null,
    scope: '展示内容为模板和演示数据，实际交付以确认需求为准',
    licenseName: null,
    sourceUrl: null,
    versionOrCommit: null,
    restrictionNotes: '可定制模板，演示数据',
  },
  {
    slug: 'private-domain-sop-template',
    recordType: 'other',
    grantor: null,
    scope: '展示内容为模板和演示数据，实际交付以确认需求为准',
    licenseName: null,
    sourceUrl: null,
    versionOrCommit: null,
    restrictionNotes: '可定制模板，演示数据',
  },
];

async function seedAuthorizations(): Promise<void> {
  for (const item of AUTHORIZATIONS) {
    const target = await prisma.showcaseCase.findUnique({
      where: { slug: item.slug },
    });
    if (!target) continue;

    const existing = await prisma.showcaseAuthorization.findFirst({
      where: { caseId: target.id },
    });
    if (existing) continue;

    await prisma.showcaseAuthorization.create({
      data: {
        caseId: target.id,
        recordType: item.recordType,
        grantor: item.grantor,
        scope: item.scope,
        licenseName: item.licenseName,
        sourceUrl: item.sourceUrl,
        versionOrCommit: item.versionOrCommit,
        reviewStatus: 'approved',
        restrictionNotes: item.restrictionNotes,
      },
    });
  }
  console.log(`已种子授权记录 ${AUTHORIZATIONS.length} 条`);
}

async function main(): Promise<void> {
  await seedTaxonomies();
  await seedCases();
  await seedDemoEndpoints();
  await seedMedia();
  await seedAuthorizations();
  console.log('案例展示中心种子数据完成');
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
