/**
 * 行业方案库（Industry Playbooks）
 * 数据来源：scripts/seed-industry-strategies.cjs 的 14 行业策略预设（2026-08-09 手机版 AI 内容生成）
 * 每个行业 2 个场景工作流，步骤链注入行业策略字段（人群/目标/痛点/角度/风格）→ 行业味十足
 */

export type WorkflowStepType =
  | 'strategy'
  | 'content'
  | 'publish'
  | 'acquisition'
  | 'follow-up'
  | 'crm'
  | 'report';

export interface PlaybookStep {
  name: string;
  type: WorkflowStepType;
  riskMode: 'auto' | 'confirm-first' | 'draft-only';
  description: string;
}

export interface IndustryScenario {
  key: string;
  name: string;
  description: string;
  platforms: string[];
  steps: PlaybookStep[];
  riskNotes: string[];
}

interface IndustryMeta {
  industry: string;
  audience: string;
  goal: string;
  pains: string;
  angles: string;
  style: string;
  platforms: string[];
  risk: string[];
  scenarioBName: string;
  scenarioBDesc: string;
}

/** 14 行业策略元数据（源自 seed-industry-strategies.cjs） */
export const WORKFLOW_INDUSTRIES: IndustryMeta[] = [
  {
    industry: '美业',
    audience:
      '25-45 岁注重形象与自我投资的女性，本地消费为主，决策受小红书种草与朋友圈口碑影响',
    goal: '新客到店体验 → 会员办卡 → 周期复购，建立「专业+懂我」的门店信任',
    pains: '怕被强推销、怕效果夸大失望、怕卫生与安全不达标、价格不透明',
    angles:
      '真实效果对比、客户变美故事、专业知识科普、项目避坑指南、限时福利、门店环境展示',
    style:
      '亲切专业、像闺蜜推荐而非销售话术、少套路多真诚、避免夸大承诺（医美需合规）',
    platforms: ['小红书', '抖音', '微信'],
    risk: [
      '医疗广告合规：禁止承诺疗效/绝对化用语',
      '平台违禁词：瘦脸针、水光针等功效描述需合规',
    ],
    scenarioBName: '抖音本地到店引流',
    scenarioBDesc: '抖音同城内容引流 → 私信/留资 → 到店体验 → 办卡复购',
  },
  {
    industry: '餐饮',
    audience:
      '本地 18-50 岁吃货与家庭/朋友聚餐人群，追求性价比与新鲜感，决策受抖音探店/点评影响',
    goal: '到店引流 → 团购/储值 → 复购，建立「本地人爱吃」的烟火气口碑',
    pains: '怕难吃踩雷、怕贵不值、怕排队太久、怕卫生不达标',
    angles:
      '招牌菜实拍种草、隐藏菜单揭秘、老板创业故事、性价比实测、团购福利、聚餐场景',
    style: '烟火气、真实接地气、直给福利、用味道和氛围说话',
    platforms: ['抖音', '微信'],
    risk: [
      '团购套餐需真实可用，避免超卖/隐形消费差评',
      '卫生展示类内容避免踩监管红线',
    ],
    scenarioBName: '本地团购到店转化',
    scenarioBDesc: '抖音团购套餐 → 核销承接 → 好评引导 → 复购触达',
  },
  {
    industry: '教育',
    audience:
      'K12 家长（焦虑决策）与成人学习者（考证/技能提升），重视效果与口碑',
    goal: '课程咨询 → 试听转化 → 报课 → 续费/转介绍，建立「专业可信」的教育品牌',
    pains: '怕无效浪费钱、怕踩坑选错机构、怕孩子落后焦虑、怕老师不专业',
    angles:
      '学习方法干货、误区澄清、学员成果见证、师资展示、限时优惠、教育理念共鸣',
    style: '专业可信、有权威感、共情但不贩卖焦虑、用数据与成果说话',
    platforms: ['抖音', '视频号', '微信'],
    risk: [
      '政策合规：K12 学科类宣传需符合双减要求',
      '禁止承诺提分/保过等绝对化效果',
    ],
    scenarioBName: '抖音私域试听转化',
    scenarioBDesc: '抖音短视频 → 评论钩子 → 私信福利 → 加微 → 试听邀约',
  },
  {
    industry: '微商',
    audience: '微信好友与私域客户（信任型消费），复购与转介绍为核心',
    goal: '加粉 → 发圈种草 → 私聊成交 → 复购转介绍，建立「靠谱人设」的信任生意',
    pains: '发圈没人看被屏蔽、文案同质化、只会硬广、私聊不会开口追单',
    angles: '日常种草、客户真实反馈、下单见证、生活人设、副业机会、限时福利',
    style: '像朋友分享而非推销、真实有温度、先价值后成交、避免刷屏硬广',
    platforms: ['微信'],
    risk: [
      '避免夸大功效/收益承诺，防止被判定虚假宣传',
      '不刷屏：控制发圈频次与硬广占比',
    ],
    scenarioBName: '朋友圈人设种草',
    scenarioBDesc: '朋友圈日常渗透 → 互动破冰 → 私聊成交 → 复购转介绍',
  },
  {
    industry: '直销',
    audience: '想找副业/轻创业机会的 25-45 岁人群，对「时间自由+收入弹性」敏感',
    goal: '事业机会展示 → 招募伙伴 → 团队建设 → 复制成长',
    pains: '怕被当传销、怕投入打水漂、怕没能力做、怕被家人反对',
    angles:
      '事业机会理性展示、制度透明解读、领导人成长故事、新人 30 天见证、招商会邀约',
    style:
      '理性+正能量、不吹嘘不画饼、透明讲清模式与投入、严禁收益承诺与拉人头（传销红线）',
    platforms: ['微信', '抖音'],
    risk: [
      '传销红线：严禁拉人头返利、收益承诺话术',
      '宣传须透明讲清制度与投入，不夸大收入',
    ],
    scenarioBName: '事业机会招商引流',
    scenarioBDesc: '事业内容种草 → 私信沟通 → 招商会邀约 → 新人跟进',
  },
  {
    industry: '健身',
    audience: '20-45 岁关注身材管理与健康的都市人群，效果口碑与体验课影响决策',
    goal: '体验课引流 → 会员卡转化 → 续课/私教课包 → 转介绍',
    pains: '怕坚持不下来浪费钱、怕练错受伤、怕被推销、健身房远/环境差',
    angles:
      '学员前后对比见证、教练专业展示、训练误区科普、体验课福利、训练日常氛围',
    style: '专业有能量、激励但不贩卖焦虑、强调科学训练与陪伴感',
    platforms: ['抖音', '小红书'],
    risk: [
      '效果对比图需真实，避免 P 图夸大',
      '私教宣传避免绝对化承诺（如"30 天瘦 20 斤"）',
    ],
    scenarioBName: '小红书减脂种草',
    scenarioBDesc: '小红书案例种草 → 私信留资 → 体验课 → 办卡',
  },
  {
    industry: '母婴',
    audience: '孕期与 0-6 岁宝宝的父母（妈妈决策为主），高信任型消费',
    goal: '信任建立 → 到店/咨询 → 办卡/服务转化 → 复购转介绍',
    pains: '育儿焦虑、怕产品不安全、怕被坑智商税、产后恢复焦虑',
    angles:
      '育儿知识干货、产品安全科普（成分/认证）、产后恢复科学讲解、真实妈妈案例',
    style: '温暖专业、像懂行的闺蜜妈妈、用知识建立信任、不制造焦虑',
    platforms: ['小红书', '微信'],
    risk: [
      '母婴用品宣传需真实，避免误导性功效描述',
      '育儿内容避免贩卖焦虑引发投诉',
    ],
    scenarioBName: '产后修复到店转化',
    scenarioBDesc: '小红书产后内容 → 私信咨询 → 到店体验 → 办卡',
  },
  {
    industry: '本地生活',
    audience: '本地 25-55 岁家庭，需要保洁/维修/宠物/洗护等上门或到店服务',
    goal: '服务咨询 → 下单转化 → 复购/包年 → 转介绍，建立「靠谱省心」口碑',
    pains: '怕不专业不卫生、怕乱收费、怕来了不走心、找服务麻烦',
    angles:
      '服务过程真实展示（前后对比）、价格透明承诺、专业资质展示、客户好评见证',
    style: '实在靠谱、透明不虚、用细节建立信任、突出省心与保障',
    platforms: ['抖音', '微信'],
    risk: ['服务承诺需与实际一致，避免虚假宣传', '价格透明，避免隐性收费投诉'],
    scenarioBName: '视频号本地获客',
    scenarioBDesc: '视频号服务内容 → 私信留资 → 上门/到店 → 包年复购',
  },
  {
    industry: '电商零售',
    audience:
      '18-45 岁网购人群，决策受种草内容/优惠/评价影响，复购靠品质与体验',
    goal: '新品种草 → 下单转化 → 复购 → 会员沉淀',
    pains: '怕货不对板、怕质量差色差、价格对比焦虑、选择困难',
    angles:
      '新品实拍种草、使用场景展示、材质工艺细节、真实买家秀、限时优惠、搭配攻略',
    style: '活泼种草、真实不吹、用场景与细节说话、突出性价比与售后保障',
    platforms: ['抖音', '小红书', '微信'],
    risk: [
      '商品宣传需与实际一致（材质/功效），避免夸大',
      '优惠活动规则清晰，避免价格欺诈投诉',
    ],
    scenarioBName: '小红书新品种草',
    scenarioBDesc: '小红书新品种草 → 私信/评论区引导 → 店铺转化 → 复购',
  },
  {
    industry: '医疗健康',
    audience: '关心健康与亚健康改善的 25-60 岁人群，对专业资质与口碑高度敏感',
    goal: '科普信任 → 到院咨询/体检 → 服务转化 → 家庭复购',
    pains: '怕误诊不专业、怕过度医疗、怕乱收费、体检怕麻烦',
    angles:
      '健康科普干货、常见误区澄清、医生专业背景展示、体检流程透明、真实患者（脱敏）见证',
    style:
      '专业严谨可信、通俗易懂、用资质与数据说话、严禁疗效承诺与夸大（广告法红线）',
    platforms: ['抖音', '微信公众号'],
    risk: [
      '广告法红线：严禁疗效承诺/绝对化用语',
      '患者案例需脱敏授权，禁止展示可识别信息',
    ],
    scenarioBName: '体检到院转化',
    scenarioBDesc: '健康科普内容 → 私信/表单留资 → 到院体检 → 家庭复购',
  },
  {
    industry: '家装',
    audience:
      '25-50 岁有装修/翻新需求的城市家庭，低频高客单决策，信任与口碑决定签约',
    goal: '案例展示 → 咨询量房 → 签约 → 转介绍',
    pains: '怕跑路增项、怕材料以次充好、怕工期拖延、不懂验收被糊弄',
    angles:
      '真实装修案例前后对比、避坑指南（增项/材料/验收）、报价透明拆解、工地实拍进度',
    style: '专业实在、透明坦诚、用案例与细节说话、直击焦虑但不制造恐慌',
    platforms: ['抖音', '小红书'],
    risk: ['案例实拍需真实，避免盗图/虚假案例', '报价透明，避免增项纠纷'],
    scenarioBName: '小红书装修避坑获客',
    scenarioBDesc: '小红书装修干货 → 私信留资 → 量房 → 签约',
  },
  {
    industry: '汽车后市场',
    audience:
      '20-50 岁车主（家庭主力决策），本地刚需高频服务，决策靠口碑/价格/便利',
    goal: '到店引流 → 保养/美容套餐 → 复购储值',
    pains: '怕被宰过度维修、怕用假配件、怕技术不行伤车、排队久',
    angles:
      '保养知识科普、真假配件鉴别、维修过程透明展示、价格清单公开、会员储值福利',
    style: '懂车实在、透明不坑、用专业细节建立信任、突出性价比与保障',
    platforms: ['抖音'],
    risk: ['保养套餐需真实，避免诱导性消费', '配件来源透明，避免以次充好投诉'],
    scenarioBName: '抖音养车科普引流',
    scenarioBDesc: '抖音养车科普 → 私信/团购 → 到店保养 → 储值复购',
  },
  {
    industry: '房产中介',
    audience: '买房/卖房/租房的本地人群，高客单低频决策，专业与诚信是成交关键',
    goal: '房源曝光 → 咨询带看 → 成交 → 转介绍',
    pains: '怕被中介坑（差价/假房源）、怕手续复杂踩坑、怕错过好房源',
    angles:
      '真实房源实拍介绍、购房流程科普（贷款/税费/过户）、避坑指南、区域价值分析、笋盘速递',
    style: '专业诚信、信息透明、用真实房源与数据说话、不夸大不套路',
    platforms: ['抖音', '微信'],
    risk: ['房源信息需真实，禁止虚假房源引流', '价格/佣金透明，避免差价纠纷'],
    scenarioBName: '抖音笋盘速递获客',
    scenarioBDesc: '抖音房源内容 → 私信留资 → 带看 → 成交',
  },
  {
    industry: '婚庆摄影',
    audience:
      '20-35 岁准新人（新娘决策主导），高客单低频，作品质量与口碑决定选择',
    goal: '作品展示 → 咨询到店 → 下单拍摄 → 转介绍',
    pains: '怕拍出来丑修图假、怕隐性消费加钱、怕成品延期丢片、风格同质化',
    angles:
      '客片实拍展示（不同风格）、拍摄过程花絮、成片前后对比、套餐透明拆解、档期福利',
    style: '审美在线、真诚不套路人、用真实客片说话、突出个性定制与贴心服务',
    platforms: ['小红书', '抖音'],
    risk: ['客片需真实授权，禁止盗用他人作品', '套餐透明，避免隐性加价投诉'],
    scenarioBName: '小红书客片种草',
    scenarioBDesc: '小红书客片展示 → 私信咨询 → 到店 → 下单拍摄',
  },
];

/** 生成标准行业步骤链（注入行业策略字段） */
function standardSteps(meta: IndustryMeta, scenario: string): PlaybookStep[] {
  return [
    {
      name: `${meta.industry}获客目标确认`,
      type: 'strategy',
      riskMode: 'confirm-first',
      description: `目标人群：${meta.audience}。商业目标：${meta.goal}。确认场景「${scenario}」的渠道与成功指标。`,
    },
    {
      name: '内容选题策划',
      type: 'content',
      riskMode: 'confirm-first',
      description: `围绕内容角度产出选题：${meta.angles}。针对核心痛点做内容切入点：${meta.pains}。`,
    },
    {
      name: '内容制作与审核',
      type: 'content',
      riskMode: 'confirm-first',
      description: `按行业语气风格创作：${meta.style}。发布前走内容审核，规避违禁词与夸大表述。`,
    },
    {
      name: `多平台发布（${meta.platforms.join(' / ')}）`,
      type: 'publish',
      riskMode: 'auto',
      description: `发布到 ${meta.platforms.join('、')}，按平台特性调整标题/标签/封面，保持更新节奏。`,
    },
    {
      name: '评论与私信承接',
      type: 'acquisition',
      riskMode: 'confirm-first',
      description: `监控评论区与私信，用行业话术承接咨询，识别高意向线索并引导留资/加微。痛点应对：${meta.pains}。`,
    },
    {
      name: '线索跟进转化',
      type: 'follow-up',
      riskMode: 'confirm-first',
      description: `对留资线索分级跟进（高意向优先），按场景推进：${meta.goal.split('→')[0]?.trim() || '完成转化'}。`,
    },
    {
      name: 'CRM 客户沉淀',
      type: 'crm',
      riskMode: 'auto',
      description: `把成交/未成交客户沉淀到 CRM，打标签（来源/意向/状态），设置复购与转介绍提醒。`,
    },
    {
      name: '效果复盘调优',
      type: 'report',
      riskMode: 'auto',
      description: `汇总各平台曝光/互动/留资/转化数据，复盘内容角度与话术表现，输出下一轮优化动作。`,
    },
  ];
}

/** 场景 B：平台差异化场景（用行业自定义的引流路径） */
function scenarioBSteps(meta: IndustryMeta): PlaybookStep[] {
  return [
    {
      name: `${meta.industry}引流目标确认`,
      type: 'strategy',
      riskMode: 'confirm-first',
      description: `场景：${meta.scenarioBDesc}。目标人群：${meta.audience}。确认主平台与转化指标。`,
    },
    {
      name: '引流内容创作',
      type: 'content',
      riskMode: 'confirm-first',
      description: `按「${meta.angles.split('、')[0]}」等角度制作引流内容，开头 3 秒钩子 + 结尾引导动作。`,
    },
    {
      name: '平台发布与置顶',
      type: 'publish',
      riskMode: 'auto',
      description: `发布到 ${meta.platforms[0]}，配置话题标签与评论区引导语（如"评论区扣 1/私信领取"）。`,
    },
    {
      name: '私信/留资承接',
      type: 'acquisition',
      riskMode: 'confirm-first',
      description: `自动/人工承接私信咨询，发送引导资料或预约话术，把线索转到微信/表单。`,
    },
    {
      name: '到店/转化邀约',
      type: 'follow-up',
      riskMode: 'confirm-first',
      description: `跟进留资线索，邀约到店体验/咨询/试听，记录意向等级与跟进结果。`,
    },
    {
      name: '客户沉淀与复购',
      type: 'crm',
      riskMode: 'auto',
      description: `沉淀客户到 CRM，标记来源场景与转化状态，设置周期复购触达。`,
    },
  ];
}

/** 查询行业场景 Playbook */
export function industryPlaybook(
  industry: string,
  scenarioKey?: string,
): IndustryScenario | undefined {
  const meta = WORKFLOW_INDUSTRIES.find((m) => m.industry === industry);
  if (!meta) return undefined;
  const isB =
    scenarioKey === 'local-conversion' || scenarioKey === 'platform-b';
  const scenarioB = {
    key: 'local-conversion',
    name: meta.scenarioBName,
    description: meta.scenarioBDesc,
    platforms: meta.platforms,
    steps: scenarioBSteps(meta),
    riskNotes: meta.risk,
  };
  const scenarioA: IndustryScenario = {
    key: 'content-to-growth',
    name: '内容种草获客闭环',
    description: `内容种草 → 私信留资 → 跟进转化 → CRM 沉淀的完整获客闭环`,
    platforms: meta.platforms,
    steps: standardSteps(meta, '内容种草获客闭环'),
    riskNotes: meta.risk,
  };
  return isB ? scenarioB : scenarioA;
}

/** 全部行业 × 场景（前端方案库渲染用，不含完整步骤） */
export function listWorkflowPlaybooks(): Array<{
  industry: string;
  scenarios: Array<{
    key: string;
    name: string;
    description: string;
    platforms: string[];
    stepCount: number;
    riskNotes: string[];
  }>;
}> {
  return WORKFLOW_INDUSTRIES.map((meta) => {
    const a = industryPlaybook(meta.industry, 'content-to-growth')!;
    const b = industryPlaybook(meta.industry, 'local-conversion')!;
    return {
      industry: meta.industry,
      scenarios: [
        {
          key: a.key,
          name: a.name,
          description: a.description,
          platforms: a.platforms,
          stepCount: a.steps.length,
          riskNotes: a.riskNotes,
        },
        {
          key: b.key,
          name: b.name,
          description: b.description,
          platforms: b.platforms,
          stepCount: b.steps.length,
          riskNotes: b.riskNotes,
        },
      ],
    };
  });
}
