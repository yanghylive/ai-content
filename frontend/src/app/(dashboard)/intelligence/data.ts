import type { LucideIcon } from "lucide-react";
import {
  BellRing,
  Blocks,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Flame,
  Globe2,
  Inbox,
  MessageSquareText,
  Plug,
  Radar,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
} from "lucide-react";

export type IntelligencePageKey =
  | "overview"
  | "inbox"
  | "reports"
  | "leads"
  | "risks"
  | "rules"
  | "collaboration"
  | "redfox"
  | "skills"
  | "trends"
  | "search"
  | "viral"
  | "accounts"
  | "industries"
  | "monitors"
  | "costs";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export type IntelligenceJob = {
  title: string;
  source: string;
  decision: string;
  output: string;
  risk: string;
  tone?: Tone;
};

export type IntelligenceAction = {
  label: string;
  detail: string;
  href: string;
  tone?: Tone;
};

export type IntelligenceSource = {
  name: string;
  scope: string;
  cadence: string;
  owner: string;
};

export type IntelligenceTable = {
  title: string;
  columns: string[];
  rows: string[][];
};

export type IntelligencePageConfig = {
  key: IntelligencePageKey;
  title: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
  primaryAction: string;
  primaryHref: string;
  secondaryAction: string;
  secondaryHref: string;
  commandTitle: string;
  commandPlaceholder: string;
  filters: string[];
  jobs: IntelligenceJob[];
  actions: IntelligenceAction[];
  sources: IntelligenceSource[];
  table: IntelligenceTable;
};

export const intelligenceNavItems: Array<{
  key: IntelligencePageKey;
  href: string;
  label: string;
}> = [
  { key: "overview", href: "/intelligence", label: "今日工作台" },
  { key: "search", href: "/intelligence/search", label: "一键找线索" },
  { key: "trends", href: "/intelligence/trends", label: "热点雷达" },
  { key: "industries", href: "/intelligence/industries", label: "行业情报" },
  { key: "inbox", href: "/intelligence/inbox", label: "待处理发现" },
  { key: "monitors", href: "/intelligence/monitors", label: "自动监控" },
  { key: "reports", href: "/intelligence/reports", label: "报告中心" },
];

const commonSources: IntelligenceSource[] = [
  {
    name: "系统数据能力",
    scope: "抖音、小红书、B站、公众号、视频号、TikTok",
    cadence: "按任务触发",
    owner: "运营负责人",
  },
  {
    name: "人工关键词",
    scope: "品牌词、竞品词、行业词、地域词",
    cadence: "每日复盘更新",
    owner: "内容策划",
  },
  {
    name: "内容流程",
    scope: "素材、选题、文章、发布、评论洞察",
    cadence: "导入后流转",
    owner: "主账号运营",
  },
];

export const intelligencePages: Record<
  IntelligencePageKey,
  IntelligencePageConfig
> = {
  overview: {
    key: "overview",
    title: "数据情报总控台",
    eyebrow: "运营情报",
    description:
      "把外部内容、账号、评论和行业变化收口成运营流程：发现话题、筛选样本、沉淀素材、生成选题、支撑获客。",
    icon: Radar,
    primaryAction: "开始找线索",
    primaryHref: "/intelligence/search",
    secondaryAction: "AI 能力",
    secondaryHref: "/capabilities/models",
    commandTitle: "今天要找什么情报",
    commandPlaceholder:
      "输入行业、关键词、账号或内容方向，例如：本地生活获客、小红书低粉爆款",
    filters: [
      "全部平台",
      "热点",
      "爆款",
      "账号",
      "行业源",
      "未入库",
      "可转选题",
    ],
    jobs: [
      {
        title: "先看热点，再决定内容方向",
        source: "热点雷达",
        decision: "按行业和平台筛掉无关话题",
        output: "生成选题或导入素材",
        risk: "发布前走风险复核",
        tone: "accent",
      },
      {
        title: "找低粉爆款，拆标题和结构",
        source: "爆款拆解",
        decision: "看互动质量，不只看播放量",
        output: "沉淀到内容素材",
        risk: "避免搬运原文",
        tone: "success",
      },
      {
        title: "把竞品账号变成监控对象",
        source: "对标账号",
        decision: "只保留定位相近账号",
        output: "进入账号池和获客策略",
        risk: "不自动触达用户",
        tone: "warning",
      },
    ],
    actions: [
      {
        label: "AI 能力管理",
        detail: "查看系统当前能做的业务动作",
        href: "/capabilities/models",
        tone: "accent",
      },
      {
        label: "创建关键词搜索",
        detail: "从一键找线索开始沉淀样本",
        href: "/intelligence/search",
      },
      {
        label: "配置监控",
        detail: "把高价值关键词、账号、行业源转成周期任务",
        href: "/intelligence/monitors",
      },
    ],
    sources: commonSources,
    table: {
      title: "运营流程",
      columns: ["入口", "判断标准", "产出", "去向"],
      rows: [
        ["热点雷达", "热度上升、行业相关、可表达观点", "选题草稿", "选题库"],
        ["一键找线索", "标题清晰、评论有效、来源可信", "内容样本", "内容素材"],
        ["爆款拆解", "低粉高互动、结构可复用", "拆解笔记", "创作优化"],
        ["对标账号", "定位相近、更新稳定、互动真实", "账号观察项", "增长获客"],
      ],
    },
  },
  inbox: {
    key: "inbox",
    title: "待处理发现",
    eyebrow: "统一收件箱",
    description:
      "统一承接热点、搜索、账号、评论和行业源对象，按状态、风险、负责人和去向分流。",
    icon: Inbox,
    primaryAction: "处理发现",
    primaryHref: "/intelligence/inbox",
    secondaryAction: "跑搜索",
    secondaryHref: "/intelligence/search",
    commandTitle: "筛选情报对象",
    commandPlaceholder: "输入平台、关键词、账号、评论问题或负责人",
    filters: ["新发现", "待判断", "需复核", "已派发", "监控异常", "今日"],
    jobs: [
      {
        title: "把多源信号统一成情报对象",
        source: "待处理发现",
        decision: "证据完整、负责人明确、风险可判断",
        output: "可派发对象",
        risk: "高风险先审核",
        tone: "accent",
      },
    ],
    actions: [
      {
        label: "处理发现",
        detail: "进入对象级判断和派发",
        href: "/intelligence/inbox",
        tone: "accent",
      },
    ],
    sources: commonSources,
    table: {
      title: "发现分流",
      columns: ["对象", "判断", "去向", "边界"],
      rows: [
        ["热点", "业务相关和时效明确", "选题 / 报告", "敏感话题先审核"],
        ["评论", "问题集中且可沉淀", "线索洞察 / 回复规则", "不自动触达"],
        ["账号", "定位相近且互动真实", "对标账号 / 监控", "不采集隐私字段"],
      ],
    },
  },
  reports: {
    key: "reports",
    title: "报告中心",
    eyebrow: "交付物",
    description:
      "把情报对象沉淀成日报、竞品周报、选题机会和风险摘要，报告必须能追溯证据和负责人。",
    icon: FileText,
    primaryAction: "查看报告",
    primaryHref: "/intelligence/reports",
    secondaryAction: "回到待处理发现",
    secondaryHref: "/intelligence/inbox",
    commandTitle: "查报告",
    commandPlaceholder: "输入报告类型、负责人、行业或时间",
    filters: ["日报", "周报", "竞品", "选题", "风险", "待审阅"],
    jobs: [
      {
        title: "从已判断对象生成报告",
        source: "报告中心",
        decision: "结论明确、证据完整、责任人可追溯",
        output: "可交付报告",
        risk: "高风险单列",
        tone: "success",
      },
    ],
    actions: [
      {
        label: "生成日报",
        detail: "汇总机会、风险、派发和用量",
        href: "/intelligence/reports",
        tone: "accent",
      },
    ],
    sources: commonSources,
    table: {
      title: "报告类型",
      columns: ["报告", "输入", "输出", "负责人"],
      rows: [
        ["今日简报", "已判断情报", "机会和风险摘要", "运营负责人"],
        ["竞品周报", "对标账号和评论", "增长策略", "增长负责人"],
        ["风险摘要", "需复核对象", "审核结论", "复核负责人"],
      ],
    },
  },
  leads: {
    key: "leads",
    title: "线索洞察",
    eyebrow: "评论到需求",
    description:
      "从评论和搜索样本中提炼用户问题、购买异议、意向词和回复规则，只生成洞察，不自动外联。",
    icon: MessageSquareText,
    primaryAction: "查看洞察",
    primaryHref: "/intelligence/leads",
    secondaryAction: "回复规则",
    secondaryHref: "/intelligence/rules",
    commandTitle: "查线索问题",
    commandPlaceholder: "输入问题、异议、意向词或平台",
    filters: ["痛点", "异议", "意向词", "FAQ", "人工确认", "禁止自动触达"],
    jobs: [
      {
        title: "把评论转成用户问题",
        source: "评论洞察",
        decision: "是否能沉淀 FAQ、选题或线索判断",
        output: "线索洞察",
        risk: "不自动私信",
        tone: "warning",
      },
    ],
    actions: [
      {
        label: "沉淀 FAQ",
        detail: "把高频异议转成回复规则",
        href: "/intelligence/rules",
        tone: "accent",
      },
    ],
    sources: commonSources,
    table: {
      title: "洞察分流",
      columns: ["信号", "判断", "产出", "边界"],
      rows: [
        ["价格问题", "高频出现", "FAQ / 选题", "不承诺结果"],
        ["购买异议", "可解释可复用", "回复规则", "人工确认"],
        ["意向词", "具备转化可能", "线索判断", "不自动外联"],
      ],
    },
  },
  risks: {
    key: "risks",
    title: "风险审核",
    eyebrow: "风险守门",
    description:
      "在情报派发前处理版权、敏感话题、夸大表达和自动触达风险，高风险对象不能直接进入生产。",
    icon: ShieldAlert,
    primaryAction: "查看风险",
    primaryHref: "/intelligence/risks",
    secondaryAction: "配置规则",
    secondaryHref: "/intelligence/rules",
    commandTitle: "查风险对象",
    commandPlaceholder: "输入风险类型、平台、来源或负责人",
    filters: ["高风险", "需复核", "版权", "夸大表达", "自动触达", "已放行"],
    jobs: [
      {
        title: "把高风险样本从业务流程中隔离",
        source: "风险审核",
        decision: "需处理、复核或放行",
        output: "审核结论",
        risk: "必须留证据",
        tone: "danger",
      },
    ],
    actions: [
      {
        label: "沉淀风险规则",
        detail: "把风险原因写入情报规则",
        href: "/intelligence/rules",
        tone: "accent",
      },
    ],
    sources: commonSources,
    table: {
      title: "风险边界",
      columns: ["风险", "处理", "去向", "负责人"],
      rows: [
        ["版权不清", "暂停生产", "记录留存", "复核负责人"],
        ["夸大表达", "复核改写", "回复规则", "内容策划"],
        ["自动触达", "默认禁止", "人工确认", "增长负责人"],
      ],
    },
  },
  rules: {
    key: "rules",
    title: "情报规则",
    eyebrow: "策略配置",
    description:
      "配置关键词、账号、行业来源、平台范围、积分扣减和风险边界，让情报生产有稳定规则。",
    icon: SlidersHorizontal,
    primaryAction: "配置规则",
    primaryHref: "/intelligence/rules",
    secondaryAction: "创建监控",
    secondaryHref: "/intelligence/monitors",
    commandTitle: "查规则",
    commandPlaceholder: "输入关键词组、账号、平台、积分扣减或风险边界",
    filters: ["关键词", "账号", "行业源", "平台", "积分扣减", "风险规则"],
    jobs: [
      {
        title: "规则决定情报采集和派发边界",
        source: "情报规则",
        decision: "对象、频率、积分和风险是否清晰",
        output: "监控和派发策略",
        risk: "成功采集直接扣积分",
        tone: "accent",
      },
    ],
    actions: [
      {
        label: "同步监控",
        detail: "把规则应用到周期任务",
        href: "/intelligence/monitors",
        tone: "accent",
      },
    ],
    sources: commonSources,
    table: {
      title: "规则类型",
      columns: ["类型", "配置", "作用", "负责人"],
      rows: [
        ["关键词", "平台和频次", "生成待处理发现", "运营负责人"],
        ["账号", "观察范围", "对标和监控", "增长负责人"],
        ["风险", "需处理条件", "风险复核", "复核负责人"],
      ],
    },
  },
  collaboration: {
    key: "collaboration",
    title: "团队协作",
    eyebrow: "责任流转",
    description:
      "让每条情报都有负责人、状态、审阅意见和交接记录，避免情报只被看见、没有人处理。",
    icon: ClipboardList,
    primaryAction: "查看协作",
    primaryHref: "/intelligence/collaboration",
    secondaryAction: "查看报告",
    secondaryHref: "/intelligence/reports",
    commandTitle: "查负责人和状态",
    commandPlaceholder: "输入负责人、状态、对象或交接事项",
    filters: [
      "待审阅",
      "待补充",
      "已派发",
      "逾期",
      "运营",
      "内容",
      "增长",
      "风险复核",
    ],
    jobs: [
      {
        title: "把情报处理责任落到人",
        source: "团队协作",
        decision: "谁处理、何时处理、结论是什么",
        output: "交接记录",
        risk: "逾期提醒",
        tone: "warning",
      },
    ],
    actions: [
      {
        label: "查看待审阅",
        detail: "处理跨组交接和补证据事项",
        href: "/intelligence/collaboration",
        tone: "accent",
      },
    ],
    sources: commonSources,
    table: {
      title: "协作状态",
      columns: ["状态", "处理人", "产出", "边界"],
      rows: [
        ["新发现", "运营负责人", "初筛结论", "当天处理"],
        ["需复核", "复核负责人", "放行或需处理", "必须留记录"],
        ["已派发", "目标团队", "任务历史", "保留去向"],
      ],
    },
  },
  redfox: {
    key: "redfox",
    title: "数据来源",
    eyebrow: "管理员设置",
    description:
      "只给管理员检查外部数据能不能用、功能目录有没有同步、真实采集是否扣积分。普通用户应该去方案中心、一键找线索或自动监控。",
    icon: Plug,
    primaryAction: "检查数据源",
    primaryHref: "/intelligence/redfox",
    secondaryAction: "回方案中心",
    secondaryHref: "/solutions",
    commandTitle: "数据源检查",
    commandPlaceholder: "检查服务地址、访问凭证、超时、积分和团队权限",
    filters: ["已连接", "待检查", "积分扣减", "错误", "团队权限"],
    jobs: [
      {
        title: "确认访问凭证是否可用",
        source: "外部数据源",
        decision: "连通成功才开放刷新能力",
        output: "连接状态",
        risk: "访问凭证不在前端暴露",
        tone: "success",
      },
      {
        title: "确认真实采集扣积分",
        source: "积分扣减",
        decision: "成功返回后直接结算积分",
        output: "积分策略",
        risk: "失败不结算",
        tone: "warning",
      },
    ],
    actions: [
      {
        label: "检查数据源",
        detail: "立即检查只读数据是否可用",
        href: "/intelligence/redfox",
        tone: "accent",
      },
      {
        label: "回方案中心",
        detail: "选择业务场景并运行一次",
        href: "/solutions",
      },
      {
        label: "刷新能力",
        detail: "连接正常后刷新能力目录",
        href: "/intelligence/skills",
      },
    ],
    sources: commonSources,
    table: {
      title: "连接治理",
      columns: ["项目", "商用要求", "失败处理", "可见范围"],
      rows: [
        ["访问凭证", "系统加密保存", "提示重新配置", "仅显示是否已配置"],
        ["数据源超时", "明确超时毫秒", "保留本地旧目录", "运营可见"],
        ["积分扣减", "按真实采集点数结算", "失败释放冻结", "系统自动执行"],
      ],
    },
  },
  skills: {
    key: "skills",
    title: "功能模板",
    eyebrow: "系统能力",
    description:
      "不要把大量底层能力原样丢给用户。按业务场景启用：热点、搜索、爆款、账号、风险复核、评论和行业源。",
    icon: Blocks,
    primaryAction: "刷新模板",
    primaryHref: "/intelligence/skills",
    secondaryAction: "查用量",
    secondaryHref: "/intelligence/costs",
    commandTitle: "按场景找功能",
    commandPlaceholder:
      "搜索功能、平台、标签，例如：小红书账号诊断、B站关键词找内容",
    filters: [
      "已启用",
      "小红书",
      "抖音",
      "B站",
      "公众号",
      "账号",
      "内容",
      "风险复核",
    ],
    jobs: [
      {
        title: "启用热点和搜索能力",
        source: "系统能力库",
        decision: "先开低风险只读能力",
        output: "情报入口可用",
        risk: "按实际使用扣积分",
        tone: "accent",
      },
      {
        title: "绑定业务场景",
        source: "功能配置",
        decision: "每个能力有明确去向",
        output: "素材、选题、获客或风险复核",
        risk: "不用的能力保持关闭",
        tone: "success",
      },
    ],
    actions: [
      {
        label: "刷新全部能力",
        detail: "获取最新可用目录",
        href: "/intelligence/skills",
        tone: "accent",
      },
      {
        label: "只看已启用",
        detail: "检查商用入口是否过宽",
        href: "/intelligence/skills",
      },
    ],
    sources: commonSources,
    table: {
      title: "能力映射",
      columns: ["能力", "页面入口", "运营产出", "安全边界"],
      rows: [
        ["热榜/热搜", "热点雷达", "今日选题", "只读"],
        ["关键词找内容", "一键找线索", "内容样本", "人工导入"],
        ["低粉爆款", "爆款拆解", "结构参考", "禁止搬运"],
        ["账号诊断", "对标账号", "账号观察", "不自动触达"],
      ],
    },
  },
  trends: {
    key: "trends",
    title: "热点雷达",
    eyebrow: "趋势发现",
    description:
      "面向运营的热点筛选台：先判断是否和业务有关，再决定导入素材、生成选题或加入监控。",
    icon: Flame,
    primaryAction: "生成选题",
    primaryHref: "/content/topics",
    secondaryAction: "导入素材",
    secondaryHref: "/content",
    commandTitle: "抓取热点",
    commandPlaceholder: "输入行业或主题，例如：文旅暑期、短剧投流、AI 工具出海",
    filters: [
      "全网",
      "抖音",
      "小红书",
      "B站",
      "近24小时",
      "可转选题",
      "未处理",
    ],
    jobs: [
      {
        title: "判断热点是否值得写",
        source: "热点来源",
        decision: "相关性、时效、表达空间",
        output: "选题草稿",
        risk: "政策和争议话题先审核",
        tone: "accent",
      },
      {
        title: "把平台热点转成内容角度",
        source: "平台热榜",
        decision: "平台语境是否匹配账号",
        output: "平台化标题和大纲",
        risk: "避免跨平台硬搬",
        tone: "success",
      },
    ],
    actions: [
      {
        label: "拉取今日热点",
        detail: "按行业关键词筛一次",
        href: "/intelligence/trends",
        tone: "accent",
      },
      {
        label: "转选题",
        detail: "把通过筛选的话题送到选题库",
        href: "/content/topics",
      },
    ],
    sources: commonSources,
    table: {
      title: "热点筛选规则",
      columns: ["判断项", "通过条件", "不通过原因", "下一步"],
      rows: [
        ["业务相关", "能连接产品、案例或观点", "纯娱乐无转化价值", "生成选题"],
        ["表达空间", "能写出新角度", "只有标题党价值", "加入观察"],
        ["发布风险", "无明显政策和版权风险", "争议/敏感/侵权", "风险复核"],
      ],
    },
  },
  search: {
    key: "search",
    title: "一键找线索",
    eyebrow: "样本检索",
    description:
      "按关键词同时找作品、账号和评论线索。结果先进入人工筛选，再沉淀为素材、对标账号或获客线索。",
    icon: Search,
    primaryAction: "导入素材",
    primaryHref: "/content",
    secondaryAction: "看爆款",
    secondaryHref: "/intelligence/viral",
    commandTitle: "搜索样本",
    commandPlaceholder:
      "输入关键词，例如：私域获客、AI 视频、同城探店、老板 IP",
    filters: [
      "作品",
      "账号",
      "评论",
      "小红书",
      "抖音",
      "B站",
      "高互动",
      "近7天",
    ],
    jobs: [
      {
        title: "搜作品，找内容样本",
        source: "关键词搜作品",
        decision: "标题、互动、评论质量",
        output: "内容素材",
        risk: "保留来源链接",
        tone: "accent",
      },
      {
        title: "搜账号，找对标对象",
        source: "关键词搜账号",
        decision: "定位、更新频率、账号体量",
        output: "对标账号",
        risk: "不自动触达",
        tone: "success",
      },
    ],
    actions: [
      {
        label: "创建搜索任务",
        detail: "输入关键词和平台范围",
        href: "/intelligence/search",
        tone: "accent",
      },
      {
        label: "转为监控",
        detail: "高价值关键词每日追踪",
        href: "/intelligence/monitors",
      },
    ],
    sources: commonSources,
    table: {
      title: "搜索结果处理",
      columns: ["结果类型", "看什么", "保存为", "动作"],
      rows: [
        ["作品", "标题、正文、互动、评论", "内容素材", "导入"],
        ["账号", "定位、粉丝、最近作品", "对标账号", "观察"],
        ["评论", "痛点、异议、购买意图", "评论洞察", "分析"],
      ],
    },
  },
  viral: {
    key: "viral",
    title: "爆款拆解",
    eyebrow: "样本分析",
    description:
      "不是看热闹，是把爆款拆成可复用的标题、结构、开头、证据、评论钩子和发布策略。",
    icon: Sparkles,
    primaryAction: "进入创作优化",
    primaryHref: "/content/optimization",
    secondaryAction: "搜更多样本",
    secondaryHref: "/intelligence/search",
    commandTitle: "拆解爆款",
    commandPlaceholder:
      "输入平台、行业或账号，例如：小红书低粉爆款、本地生活探店",
    filters: [
      "低粉爆款",
      "高收藏",
      "高评论",
      "近7天",
      "图文",
      "视频",
      "可复用",
    ],
    jobs: [
      {
        title: "找低粉高互动样本",
        source: "爆款来源",
        decision: "粉丝少但互动强",
        output: "结构拆解",
        risk: "禁止照搬原文",
        tone: "accent",
      },
      {
        title: "抽取标题和开头套路",
        source: "内容样本",
        decision: "是否适合当前账号语气",
        output: "创作优化建议",
        risk: "保留原创改写",
        tone: "success",
      },
    ],
    actions: [
      {
        label: "筛低粉爆款",
        detail: "更适合中小账号学习",
        href: "/intelligence/viral",
        tone: "accent",
      },
      {
        label: "生成改写方向",
        detail: "把结构送到创作优化",
        href: "/content/optimization",
      },
    ],
    sources: commonSources,
    table: {
      title: "拆解维度",
      columns: ["维度", "要看什么", "沉淀位置", "注意"],
      rows: [
        ["标题", "利益点、冲突、关键词", "标题库", "不复制"],
        ["开头", "前三秒/前三行钩子", "素材库", "改写"],
        ["评论", "痛点、异议、追问", "评论洞察", "脱敏"],
      ],
    },
  },
  accounts: {
    key: "accounts",
    title: "对标账号",
    eyebrow: "账号观察",
    description:
      "把竞品、同行和高增长账号变成观察对象：看定位、内容节奏、爆款结构和可借鉴的增长动作。",
    icon: UsersRound,
    primaryAction: "新增观察账号",
    primaryHref: "/intelligence/accounts",
    secondaryAction: "进入增长",
    secondaryHref: "/growth",
    commandTitle: "找账号",
    commandPlaceholder:
      "输入行业、关键词或账号昵称，例如：本地生活老板 IP、AI 工具号",
    filters: [
      "竞品",
      "同行",
      "低粉高互动",
      "高频更新",
      "小红书",
      "抖音",
      "B站",
    ],
    jobs: [
      {
        title: "发现可学习账号",
        source: "关键词搜账号",
        decision: "定位相近、增长稳定",
        output: "账号池",
        risk: "不抓取隐私字段",
        tone: "accent",
      },
      {
        title: "拆账号内容节奏",
        source: "账号作品",
        decision: "选题栏目是否可复制",
        output: "增长策略",
        risk: "不自动私信",
        tone: "warning",
      },
    ],
    actions: [
      {
        label: "搜索对标账号",
        detail: "按行业和关键词找账号",
        href: "/intelligence/accounts",
        tone: "accent",
      },
      {
        label: "加入增长策略",
        detail: "把账号观察变成执行计划",
        href: "/growth?view=strategies",
      },
    ],
    sources: commonSources,
    table: {
      title: "账号判断",
      columns: ["判断项", "通过标准", "产出", "边界"],
      rows: [
        ["定位", "目标客户和内容主题相近", "观察对象", "人工确认"],
        ["内容节奏", "稳定更新且栏目清晰", "栏目参考", "不复制"],
        ["互动质量", "评论有真实需求", "线索假设", "不自动触达"],
      ],
    },
  },
  industries: {
    key: "industries",
    title: "行业源",
    eyebrow: "垂直情报",
    description:
      "为文旅、短剧、AI、A股、出海等行业维护可信来源。行业源不是文章列表，是内容生产和获客策略的输入池。",
    icon: Globe2,
    primaryAction: "沉淀知识",
    primaryHref: "/content/knowledge",
    secondaryAction: "创建监控",
    secondaryHref: "/intelligence/monitors",
    commandTitle: "配置行业源",
    commandPlaceholder:
      "输入行业和来源，例如：文旅政策、AI 工具案例、TikTok 平台政策",
    filters: ["文旅", "AI", "短剧", "出海", "A股", "政策", "案例", "可入库"],
    jobs: [
      {
        title: "维护高可信来源",
        source: "行业源",
        decision: "官方、媒体、头部账号优先",
        output: "知识库资料",
        risk: "来源可信度标注",
        tone: "accent",
      },
      {
        title: "把行业变化转成选题",
        source: "行业监控",
        decision: "是否影响客户决策",
        output: "行业选题",
        risk: "敏感行业先审核",
        tone: "success",
      },
    ],
    actions: [
      {
        label: "添加行业来源",
        detail: "维护源名称、平台和抓取频率",
        href: "/intelligence/industries",
        tone: "accent",
      },
      {
        label: "沉淀知识库",
        detail: "把可信条目转为长期上下文",
        href: "/content/knowledge",
      },
    ],
    sources: commonSources,
    table: {
      title: "行业源策略",
      columns: ["行业", "优先来源", "用途", "审核要求"],
      rows: [
        ["文旅", "政策、景区、酒店、城市热点", "本地生活内容", "政策原文"],
        ["AI", "工具发布、模型更新、应用案例", "产品型内容", "事实核验"],
        ["出海", "平台政策、跨境案例、TikTok 趋势", "跨平台选题", "来源标注"],
      ],
    },
  },
  monitors: {
    key: "monitors",
    title: "自动监控",
    eyebrow: "周期任务",
    description:
      "把高价值关键词、账号和行业源变成固定节奏的情报任务。成功采集后直接扣积分，异常会记录并提醒人工处理。",
    icon: BellRing,
    primaryAction: "创建监控",
    primaryHref: "/intelligence/monitors",
    secondaryAction: "查看用量",
    secondaryHref: "/intelligence/costs",
    commandTitle: "创建周期监控",
    commandPlaceholder:
      "输入监控对象，例如：小红书低粉爆款、竞品账号、AI 工具出海",
    filters: ["关键词", "账号", "行业源", "每日", "每周", "失败", "积分记录"],
    jobs: [
      {
        title: "关键词每日追踪",
        source: "搜索能力",
        decision: "有新增再提醒",
        output: "待处理情报",
        risk: "成功后扣积分",
        tone: "accent",
      },
      {
        title: "账号更新监控",
        source: "账号观察能力",
        decision: "爆款或异常更新提醒",
        output: "账号观察",
        risk: "不自动互动",
        tone: "warning",
      },
    ],
    actions: [
      {
        label: "新建监控",
        detail: "设置对象、频率和积分记录",
        href: "/intelligence/monitors",
        tone: "accent",
      },
      {
        label: "看失败任务",
        detail: "优先处理凭证、积分、超时问题",
        href: "/intelligence/costs",
      },
    ],
    sources: commonSources,
    table: {
      title: "监控规则",
      columns: ["对象", "频率", "产出", "停止条件"],
      rows: [
        ["关键词", "每日", "新增样本", "连续无结果"],
        ["账号", "每日/每周", "更新摘要", "账号失效"],
        ["行业源", "每周", "知识条目", "来源不可信"],
      ],
    },
  },
  costs: {
    key: "costs",
    title: "积分明细",
    eyebrow: "积分和使用",
    description:
      "每次查找和自动跟踪都要可追踪：谁使用、做了什么、扣了多少积分、失败在哪里、是否完成结算。",
    icon: CircleDollarSign,
    primaryAction: "查看日志",
    primaryHref: "/intelligence/costs",
    secondaryAction: "功能模板",
    secondaryHref: "/intelligence/skills",
    commandTitle: "用量巡检",
    commandPlaceholder: "按功能、状态或时间筛记录",
    filters: ["成功", "失败", "需处理", "扣积分", "今日", "本周", "按功能"],
    jobs: [
      {
        title: "看今日使用是否异常",
        source: "使用记录",
        decision: "失败率、耗时、点数",
        output: "用量摘要",
        risk: "异常能力暂停",
        tone: "accent",
      },
      {
        title: "检查积分是否扣除",
        source: "积分扣减",
        decision: "成功、失败和结算状态",
        output: "积分明细",
        risk: "失败不扣分",
        tone: "warning",
      },
    ],
    actions: [
      {
        label: "刷新用量",
        detail: "读取使用记录",
        href: "/intelligence/costs",
        tone: "accent",
      },
      {
        label: "停用异常能力",
        detail: "从功能模板页处理",
        href: "/intelligence/skills",
      },
    ],
    sources: commonSources,
    table: {
      title: "用量治理",
      columns: ["风险", "判断", "处理", "负责人"],
      rows: [
        ["失败率升高", "连续失败或超时", "暂停相关能力", "管理员"],
        ["积分异常", "单日消耗偏高", "降低频率", "运营负责人"],
        ["结算异常", "采集成功但积分未更新", "检查积分状态", "管理员"],
      ],
    },
  },
};
