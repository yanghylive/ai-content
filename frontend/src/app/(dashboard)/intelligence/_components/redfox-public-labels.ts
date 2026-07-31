type PublicAbilityInput = {
  type?: string | null;
  platform?: string | null;
  redfoxSkill?: {
    code?: string | null;
    name?: string | null;
  } | null;
};

const exactAbilityLabels: Record<string, string> = {
  "douyin-ai-feed": "抖音内容发现",
  "douyin-account-search": "抖音账号发现",
  "xiaohongshu-ai-feed": "小红书内容发现",
  "xiaohongshu-comment": "小红书账号与评论洞察",
  "bilibili-ai-feed": "B站内容发现",
  "bilibili-portfolio-search": "B站账号作品集",
  "cultural-tourism-wechat-feed": "公众号内容发现",
  "gzh-astock-top": "公众号账号观察",
  "gzh-query-article": "公众号文章互动分析",
  "playlet-wechat-feed": "公众号短剧内容发现",
  "wechat-channels-search": "视频号内容发现",
  "cultural-tourism-bilibili-feed": "B站行业内容发现",
  "cultural-tourism-xiaohongshu-feed": "小红书行业内容发现",
  "redfox-skill-catalog": "系统能力刷新",
  "redfox-interface-catalog": "数据范围刷新",
};

const platformLabels: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  gongzhonghao: "公众号",
  wechat: "公众号",
};

export function publicAbilityLabel(skillCode?: string | null) {
  const normalized = (skillCode || "").trim().toLowerCase();
  if (!normalized || normalized === "unknown") return "通用数据能力";
  if (exactAbilityLabels[normalized]) return exactAbilityLabels[normalized];
  if (normalized.startsWith("redfox-interface:")) return "数据范围刷新";
  if (normalized.includes("catalog")) return "系统能力刷新";

  const platform = Object.entries(platformLabels).find(([key]) =>
    normalized.includes(key),
  )?.[1];
  const prefix = platform ? `${platform}` : "";

  if (normalized.includes("portfolio")) return `${prefix || "账号"}作品集`;
  if (normalized.includes("account") || normalized.includes("user")) {
    return `${prefix || "账号"}账号观察`;
  }
  if (normalized.includes("comment")) return `${prefix || ""}评论洞察`;
  if (normalized.includes("hot") || normalized.includes("trend")) {
    return `${prefix || ""}热点发现`;
  }
  if (normalized.includes("feed")) return `${prefix || ""}内容发现`;
  if (normalized.includes("search")) return `${prefix || ""}线索查找`;

  return "业务数据能力";
}

export function publicSourceLabelForItem(item: PublicAbilityInput) {
  if (item.redfoxSkill?.code) {
    return publicAbilityLabel(item.redfoxSkill.code);
  }

  const type = (item.type || "").toLowerCase();
  if (type.includes("trend") || type.includes("hot")) return "热点雷达";
  if (type.includes("search")) return "一键找线索";
  if (type.includes("viral")) return "爆款拆解";
  if (type.includes("account")) return "对标账号";
  if (type.includes("engagement")) return "文章互动分析";
  if (type.includes("comment") || type.includes("lead")) return "线索洞察";
  if (type.includes("risk") || type.includes("compliance")) return "风险审核";
  if (type.includes("industry")) return "行业来源";

  const platform = platformLabels[(item.platform || "").toLowerCase()];
  return platform ? `${platform}数据能力` : "系统数据能力";
}
