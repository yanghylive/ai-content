/**
 * 唯一行业获客词库（Industry Keyword Presets）——彻底重构：单一词库来源。
 * 数据来源：growth-playbooks.data.ts 的 14 行业 pains（痛点→意向词）+ angles（角度→行业词）。
 *
 * 字段：
 *  - sourceKeywords：第一段「搜账号」用；
 *  - demandKeywords：匹配评论/私信识别真实客户；
 *  - excludeKeywords：过滤招聘/招商/同行/教程等干扰；
 *  - demandSynonymGroups：意向词同义词簇（命中簇内任一词即算命中该意向，替代纯子串单点匹配）；
 *  - isLocal：本地行业标记（到店/上门服务，可叠加地域词维度做「地域+行业词」搜索）。
 */

export interface IndustryKeywordPreset {
  industry: string;
  aliases: string[];
  sourceKeywords: string[];
  demandKeywords: string[];
  excludeKeywords: string[];
  /** 意向词同义词簇：每个 string[] 是一组同义表达 */
  demandSynonymGroups?: string[][];
  /** 本地行业（需要地域词维度） */
  isLocal?: boolean;
}

export const INDUSTRY_KEYWORD_PRESETS: IndustryKeywordPreset[] = [
  {
    industry: "美业",
    aliases: ["美业", "美容", "美甲", "护肤"],
    sourceKeywords: ["美甲", "皮肤管理", "医美", "祛痘", "美容护肤", "纹眉", "脱毛", "美发"],
    demandKeywords: ["多少钱", "价格", "效果怎么样", "靠谱吗", "推荐", "预约", "地址", "安全吗"],
    excludeKeywords: ["招聘", "招商", "加盟", "培训", "收徒", "批发", "代理"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["地址", "在哪", "位置", "预约", "导航", "定位", "电话", "联系方式"], ["效果怎么样", "效果", "有用吗", "好不好", "明显吗"]],
    isLocal: true,
  },
  {
    industry: "餐饮",
    aliases: ["餐饮", "美食", "餐厅", "火锅"],
    sourceKeywords: ["探店", "美食", "团购", "外卖", "餐厅", "小吃", "火锅", "烧烤"],
    demandKeywords: ["多少钱", "团购", "优惠", "口味", "推荐", "定位", "人均", "预约"],
    excludeKeywords: ["招聘", "招商", "加盟", "培训", "收徒", "加盟费"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["地址", "在哪", "位置", "预约", "导航", "定位", "电话", "联系方式"], ["团购", "套餐", "优惠", "折扣", "券"], ["好吃吗", "味道", "口味", "怎么样"]],
    isLocal: true,
  },
  {
    industry: "教育",
    aliases: ["教育", "培训", "课程", "升学"],
    sourceKeywords: ["补课", "升学", "考研", "职业培训", "考证", "课程", "少儿编程", "试听"],
    demandKeywords: ["多少钱", "效果", "师资", "试听", "报名", "靠谱吗", "通过率", "口碑"],
    excludeKeywords: ["招聘", "招商", "加盟", "兼职", "代理"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["试听", "体验课", "试课", "免费课"], ["效果", "提分", "通过率", "有用吗"]],
    isLocal: false,
  },
  {
    industry: "微商",
    aliases: ["微商", "私域", "朋友圈"],
    sourceKeywords: ["副业", "货源", "朋友圈", "私域", "微商", "一件代发", "社交电商"],
    demandKeywords: ["代理", "拿货", "赚", "靠谱吗", "求带", "怎么做", "利润", "好卖吗", "加盟"],
    excludeKeywords: ["招聘", "招商会", "加盟", "拉人头", "培训"],
    demandSynonymGroups: [["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["代理", "拿货", "货源", "一件代发"], ["求带", "怎么做", "求教", "带带"], ["赚", "利润", "收益", "赚钱"]],
    isLocal: false,
  },
  {
    industry: "直销",
    aliases: ["直销", "轻创业", "招商"],
    sourceKeywords: ["副业", "轻创业", "项目", "兼职", "招商", "自由职业", "创业"],
    demandKeywords: ["怎么做", "靠谱吗", "投入", "收益", "求带", "模式", "风险", "加盟", "招商"],
    excludeKeywords: ["传销", "拉人头", "招聘", "收徒", "贷款"],
    demandSynonymGroups: [["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["加盟", "招商", "代理", "合作"], ["投入", "成本", "门槛", "启动资金"], ["收益", "赚", "利润", "收入"]],
    isLocal: false,
  },
  {
    industry: "健身",
    aliases: ["健身", "减脂", "私教"],
    sourceKeywords: ["健身", "减脂", "私教", "增肌", "瑜伽", "普拉提", "塑形"],
    demandKeywords: ["多少钱", "效果", "体验课", "靠谱吗", "推荐", "课表", "位置", "私教课"],
    excludeKeywords: ["招聘", "教练培训", "加盟", "代理"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["地址", "在哪", "位置", "预约", "导航", "定位", "电话", "联系方式"], ["体验课", "试课", "私教课", "团课"], ["效果", "瘦", "减脂", "增肌"]],
    isLocal: true,
  },
  {
    industry: "母婴",
    aliases: ["母婴", "育儿", "产后"],
    sourceKeywords: ["育儿", "产后恢复", "母婴", "月嫂", "托育", "早教", "宝宝"],
    demandKeywords: ["多少钱", "靠谱吗", "安全", "推荐", "预约", "产后修复", "月嫂价格"],
    excludeKeywords: ["招聘", "招商", "加盟", "代理"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["地址", "在哪", "位置", "预约", "导航", "定位", "电话", "联系方式"], ["安全", "放心", "安心", "靠谱"]],
    isLocal: true,
  },
  {
    industry: "本地生活",
    aliases: ["本地生活", "家政", "上门"],
    sourceKeywords: ["家政", "保洁", "维修", "宠物", "洗护", "开锁", "搬家", "上门服务"],
    demandKeywords: ["多少钱", "上门", "靠谱吗", "推荐", "预约", "价格", "服务"],
    excludeKeywords: ["招聘", "招商", "加盟", "兼职"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["地址", "在哪", "位置", "预约", "导航", "定位", "电话", "联系方式"], ["上门", "到家", "服务", "收费标准"]],
    isLocal: true,
  },
  {
    industry: "电商零售",
    aliases: ["电商零售", "电商", "零售", "好物"],
    sourceKeywords: ["好物", "测评", "种草", "穿搭", "同款", "美妆", "数码", "开箱"],
    demandKeywords: ["多少钱", "链接", "怎么买", "靠谱吗", "求链接", "包邮", "好用吗"],
    excludeKeywords: ["招聘", "招商", "代理", "加盟", "批发"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["链接", "怎么买", "求链接", "在哪买", "店铺"], ["好用吗", "好用", "测评", "种草"]],
    isLocal: false,
  },
  {
    industry: "医疗健康",
    aliases: ["医疗健康", "医疗", "健康", "体检"],
    sourceKeywords: ["体检", "健康管理", "养生", "口腔", "中医", "理疗", "慢病"],
    demandKeywords: ["多少钱", "预约", "靠谱吗", "推荐", "挂号", "检查", "复诊"],
    excludeKeywords: ["招聘", "招商", "加盟", "代理"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["地址", "在哪", "位置", "预约", "导航", "定位", "电话", "联系方式"], ["预约", "挂号", "检查", "体检"]],
    isLocal: true,
  },
  {
    industry: "家装",
    aliases: ["家装", "装修", "翻新", "定制"],
    sourceKeywords: ["装修", "旧房翻新", "全屋定制", "设计师", "本地装修", "整装", "软装"],
    demandKeywords: ["多少钱", "报价", "增项", "材料", "验收", "工期", "靠谱吗", "预算"],
    excludeKeywords: ["招聘", "招商", "加盟", "收徒", "培训"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["地址", "在哪", "位置", "预约", "导航", "定位", "电话", "联系方式"], ["增项", "隐形消费", "乱收费", "加钱", "坐地起价"], ["验收", "质量", "工程质量"], ["工期", "多久", "多长时间", "拖期", "延期"]],
    isLocal: true,
  },
  {
    industry: "汽车后市场",
    aliases: ["汽车后市场", "养车", "汽修"],
    sourceKeywords: ["养车", "洗车", "保养", "汽修", "汽车美容", "轮胎", "钣金"],
    demandKeywords: ["多少钱", "被宰", "靠谱吗", "推荐", "价格", "工时费", "配件"],
    excludeKeywords: ["招聘", "招商", "加盟", "培训"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["地址", "在哪", "位置", "预约", "导航", "定位", "电话", "联系方式"], ["被宰", "坑", "乱收费", "过度维修"], ["工时费", "配件", "价格", "报价"]],
    isLocal: true,
  },
  {
    industry: "房产中介",
    aliases: ["房产中介", "房产", "买房", "租房"],
    sourceKeywords: ["买房", "看房", "二手房", "租房", "商铺", "学区房", "笋盘"],
    demandKeywords: ["多少钱", "靠谱吗", "房源", "中介费", "过户", "贷款", "税费"],
    excludeKeywords: ["招聘", "招商", "加盟", "培训"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["地址", "在哪", "位置", "预约", "导航", "定位", "电话", "联系方式"], ["房源", "笋盘", "看房", "带看"], ["中介费", "税费", "过户", "贷款"]],
    isLocal: true,
  },
  {
    industry: "婚庆摄影",
    aliases: ["婚庆摄影", "婚庆", "婚纱照", "摄影"],
    sourceKeywords: ["婚纱照", "婚礼", "婚庆", "跟拍", "写真", "旅拍", "婚宴"],
    demandKeywords: ["多少钱", "套餐", "靠谱吗", "客片", "推荐", "档期", "修图"],
    excludeKeywords: ["招聘", "招商", "加盟", "培训"],
    demandSynonymGroups: [["多少钱", "价格", "报价", "价位", "收费", "费用", "预算", "贵吗", "便宜", "人均"], ["靠谱吗", "怎么样", "稳不稳", "坑吗", "靠谱不", "安全吗", "放心吗", "口碑", "靠谱的"], ["地址", "在哪", "位置", "预约", "导航", "定位", "电话", "联系方式"], ["套餐", "客片", "风格", "档期"]],
    isLocal: true,
  },
];

/** 按行业名或别名查词库（大小写/空白不敏感） */
export function industryKeywordPreset(
  industry: string,
): IndustryKeywordPreset | undefined {
  const key = (industry || '').trim();
  if (!key) return undefined;
  return INDUSTRY_KEYWORD_PRESETS.find(
    (p) => p.industry === key || p.aliases.some((a) => a === key),
  );
}

/**
 * 用来源词（行业词）反查命中的行业词库预设：
 * 取 sourceKeywords 与来源词交集最多的行业（用于排除词兜底 / 地域词维度）。
 */
export function resolveIndustryBySourceKeywords(
  sourceInputs: string[],
): IndustryKeywordPreset | undefined {
  const inputs = (sourceInputs || []).map((s) => s.trim()).filter(Boolean);
  if (!inputs.length) return undefined;
  let best: IndustryKeywordPreset | undefined;
  let bestScore = 0;
  for (const preset of INDUSTRY_KEYWORD_PRESETS) {
    const score = preset.sourceKeywords.filter((k) =>
      inputs.some((s) => s === k || k.includes(s) || s.includes(k)),
    ).length;
    if (score > bestScore) {
      bestScore = score;
      best = preset;
    }
  }
  return bestScore > 0 ? best : undefined;
}

/**
 * 意向词展开：把每个意向词命中词库同义词簇后，返回该簇全量 + 原词。
 * 这样评分/匹配用展开后的词表，同义表达（报价→价位/收费/多少钱）都能命中。
 */
export function expandDemandKeywordsWithSynonyms(
  keywords: string[],
): string[] {
  const input = (keywords || []).map((s) => s.trim()).filter(Boolean);
  if (!input.length) return [];
  const expanded = new Set<string>(input);
  for (const kw of input) {
    for (const preset of INDUSTRY_KEYWORD_PRESETS) {
      for (const group of preset.demandSynonymGroups ?? []) {
        if (group.some((w) => w === kw)) {
          for (const w of group) expanded.add(w);
        }
      }
    }
  }
  return Array.from(expanded);
}
