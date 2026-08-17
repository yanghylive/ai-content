// RedFox 技能 catalog（C 档补全，2026-08-16）
// 数据来源：redfox-data/redfox-community 官方仓库 README（redfox.hk/apis 文档目录）。
// 用途：可检索技能列表——前端展示技能广场、运营选技能、开发查能力。
// 说明：文档 ID（如 FXDGJO1V）对应 redfox.hk/apis/<category>/<id> 的 API 文档页；
//       本地已接入的技能在 localSkillCode 标注。
export interface RedFoxSkillEntry {
  /** 技能名（中文，来自官方目录） */
  name: string;
  /** 分类：platform / ai-search / ai-tool / tiktok */
  category: string;
  /** 平台（platform 类有效） */
  platform?: string;
  /** 官方文档 ID（redfox.hk/apis/<category>/<id>） */
  docId: string;
  /** 能力描述（从官方名称推断用途） */
  description: string;
  /** 本地已接入的技能码（redfox-collect/video/account 使用的 skillCode） */
  localSkillCode?: string;
}

/** 本地已接入的技能码（与 redfox-*.service 的 skillCode 对应） */
const LOCAL_SKILLS: Record<string, string> = {
  'media-parse-work': 'media-parse-work',
  'gpt-image-submit': 'gpt-image-submit',
  'gpt-image-result': 'gpt-image-result',
  'douyin-query-work': 'douyin-query-work',
  'douyin-query-user': 'douyin-query-user',
  'seedance-video-submit': 'seedance-video-submit',
  'seedance-video-result': 'seedance-video-result',
};

/** 官方目录（redfox-data/redfox-community README 提取，2026-08-16） */
export const REDFOX_SKILL_CATALOG: RedFoxSkillEntry[] = [
  // —— 抖音 ——
  { name: '获取抖音作品内容详情', category: 'platform', platform: 'douyin', docId: '0OT1E306', description: '按作品 ID/链接获取抖音作品详情（播放/点赞/评论数）', localSkillCode: 'douyin-query-work' },
  { name: '获取抖音账号信息', category: 'platform', platform: 'douyin', docId: 'XUT4CECZ', description: '按账号 ID/链接获取抖音账号信息（粉丝/作品数）', localSkillCode: 'douyin-query-user' },
  { name: '搜索关键词获取抖音账号', category: 'platform', platform: 'douyin', docId: 'P5CHB3BZ', description: '关键词搜索抖音账号（找潜在客户/竞品）' },
  { name: '搜索关键词获取抖音作品', category: 'platform', platform: 'douyin', docId: '774OBKK0', description: '关键词搜索抖音作品（选题/热点发现）' },
  { name: '获取抖音账号作品列表', category: 'platform', platform: 'douyin', docId: 'QEQLCKD6', description: '按账号获取作品列表（目标账号主页采集）' },
  { name: '搜索关键词获取抖音 AI 作品', category: 'platform', platform: 'douyin', docId: 'I8P3HTVH', description: '搜索抖音 AI 生成作品（AI 内容趋势）' },
  { name: '视频提文案-提交任务', category: 'platform', platform: 'douyin', docId: '8DCJW2ZF', description: '视频链接提取文案（素材复用）' },
  // —— 小红书 ——
  { name: '获取小红书账号信息', category: 'platform', platform: 'xiaohongshu', docId: '4IVIDHEN', description: '按账号 ID/链接获取小红书账号信息' },
  { name: '获取小红书作品内容详情', category: 'platform', platform: 'xiaohongshu', docId: 'KR1LPTBF', description: '按作品 ID/链接获取笔记详情（互动数）' },
  { name: '搜索关键词获取小红书账号', category: 'platform', platform: 'xiaohongshu', docId: '439NFLBD', description: '关键词搜索小红书账号' },
  { name: '搜索关键词获取小红书作品', category: 'platform', platform: 'xiaohongshu', docId: '384C6W6B', description: '关键词搜索小红书笔记（选题/热点）' },
  { name: '搜索关键词获取小红书 AI 作品', category: 'platform', platform: 'xiaohongshu', docId: '047JJ3UA', description: '搜索小红书 AI 生成笔记' },
  { name: '小红书爆款笔记洞察', category: 'platform', platform: 'xiaohongshu', docId: '3X8FGEEM', description: '爆款笔记数据分析（低粉爆款挖掘）' },
  { name: '小红书七日爆款笔记', category: 'platform', platform: 'xiaohongshu', docId: 'LBYLC5AK', description: '近七日爆款笔记榜单' },
  { name: '视频提文案-提交任务', category: 'platform', platform: 'xiaohongshu', docId: 'DCZW5V7A', description: '视频链接提取文案' },
  // —— 公众号 ——
  { name: '获取公众号账号信息', category: 'platform', platform: 'wechat', docId: '6C4A77XR', description: '按账号 ID 获取公众号信息' },
  { name: '根据作品 uuid 获取公众号作品', category: 'platform', platform: 'wechat', docId: 'XEO0QQNF', description: '按 uuid 获取公众号作品详情' },
  { name: '搜索关键词获取公众号账号', category: 'platform', platform: 'wechat', docId: 'DNVPQZEZ', description: '关键词搜索公众号账号' },
  { name: '搜索关键词获取公众号作品', category: 'platform', platform: 'wechat', docId: 'PW97QFBS', description: '关键词搜索公众号文章（选题）' },
  { name: '获取公众号账号作品列表', category: 'platform', platform: 'wechat', docId: 'XNV30XZ3', description: '按账号获取文章列表' },
  { name: '根据作品地址获取公众号作品', category: 'platform', platform: 'wechat', docId: 'VUTTKTP6', description: '按文章地址获取作品详情' },
  { name: '搜索关键词获取公众号 AI 创作作品', category: 'platform', platform: 'wechat', docId: 'IE0887SO', description: '搜索公众号 AI 创作文章' },
  // —— 视频号/快手/B站/头条 ——
  { name: '链接提文案-提交任务', category: 'platform', platform: 'wechat-channel', docId: 'HR8CU3GG', description: '视频号链接提取文案' },
  { name: '视频提文案-提交任务', category: 'platform', platform: 'kuaishou', docId: '8TUUDDCJ', description: '快手视频提取文案' },
  { name: '获取哔哩哔哩作品内容详情', category: 'platform', platform: 'bilibili', docId: 'TIN1NMTZ', description: '按作品 ID 获取 B 站视频详情' },
  { name: '获取哔哩哔哩账号信息', category: 'platform', platform: 'bilibili', docId: 'EH53TOT7', description: '按账号获取 B 站账号信息' },
  { name: '搜索关键词获取哔哩哔哩账号', category: 'platform', platform: 'bilibili', docId: 'ZXJLJQ21', description: '关键词搜索 B 站账号' },
  { name: '搜索关键词获取哔哩哔哩作品', category: 'platform', platform: 'bilibili', docId: 'LEN9QXR3', description: '关键词搜索 B 站视频' },
  { name: '获取哔哩哔哩账号作品列表', category: 'platform', platform: 'bilibili', docId: 'VPA67I98', description: '按账号获取 B 站视频列表' },
  { name: '获取今日头条账号作品列表', category: 'platform', platform: 'jinritoutiao', docId: '28CFGF5I', description: '今日头条账号作品列表（实时）' },
  { name: '获取今日头条作品内容详情', category: 'platform', platform: 'jinritoutiao', docId: 'PAB6Z75Y', description: '今日头条作品详情（实时）' },
  // —— AI 搜索 ——
  { name: 'kimi 纯文字搜索', category: 'ai-search', docId: 'USDIOVU23', description: 'Kimi AI 文字搜索（情报收集）' },
  { name: '豆包纯文字搜索', category: 'ai-search', docId: 'I9R9LIDL', description: '豆包 AI 文字搜索' },
  { name: 'Deepseek 纯文字搜索', category: 'ai-search', docId: 'KGX4SDXQ', description: 'DeepSeek AI 文字搜索' },
  // —— AI 工具 ——
  { name: 'GPT 图片生成', category: 'ai-tool', docId: 'HUV4KRFQ', description: 'GPT 文生图', localSkillCode: 'gpt-image-submit' },
  { name: '豆包图片生成', category: 'ai-tool', docId: '7OM96HCF', description: '豆包文生图' },
  { name: '豆包视频生成', category: 'ai-tool', docId: 'ER2ATHKI', description: '豆包文生视频', localSkillCode: 'seedance-video-submit' },
  { name: '上传图片', category: 'ai-tool', docId: 'FXDGJO1V', description: '上传图片素材（供图片生成/编辑使用）' },
  { name: '上传视频/图片/音频', category: 'ai-tool', docId: '6L178PZD', description: '上传多媒体素材（多模态任务）' },
  { name: '短视频下载器', category: 'ai-tool', docId: 'AWUTFI4V', description: '通用短视频下载' },
  { name: 'YouTube 视频下载', category: 'ai-tool', docId: 'D52IUEIM', description: 'YouTube 视频下载' },
  { name: 'X(Twitter) 视频下载', category: 'ai-tool', docId: '7UW1PT1F', description: 'X 视频下载' },
  { name: 'TikTok 视频下载', category: 'ai-tool', docId: 'MQMDU19Q', description: 'TikTok 视频下载' },
  { name: '小红书视频下载', category: 'ai-tool', docId: 'QPNFJRG1', description: '小红书视频下载' },
  { name: '视频号视频下载', category: 'ai-tool', docId: 'U2NJ13MW', description: '视频号视频下载' },
  { name: '抖音视频下载', category: 'ai-tool', docId: '0W27H3O6', description: '抖音视频下载' },
  { name: '快手视频下载', category: 'ai-tool', docId: '0ZIWOO8P', description: '快手视频下载' },
  { name: '哔哩哔哩视频下载', category: 'ai-tool', docId: 'CWX77QIH', description: 'B 站视频下载' },
  { name: 'Instagram 视频下载', category: 'ai-tool', docId: 'UUSP1G1P', description: 'Instagram 视频下载' },
  // —— TikTok ——
  { name: '获取单个作品数据', category: 'tiktok', docId: '6SE9WIHJ', description: 'TikTok 单作品数据' },
  { name: '获取用户主页作品数据', category: 'tiktok', docId: 'R473NUE9', description: 'TikTok 用户主页作品数据' },
  { name: '关键词视频搜索', category: 'tiktok', docId: 'PXZXY8KQ', description: 'TikTok 关键词搜索视频' },
  { name: 'TikTok 关键词搜索账号', category: 'tiktok', docId: '20070019', description: 'TikTok 关键词搜索账号' },
];

export function findRedfoxSkill(
  query: string,
): RedFoxSkillEntry[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return REDFOX_SKILL_CATALOG;
  return REDFOX_SKILL_CATALOG.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.platform?.includes(q) ||
      s.category.includes(q) ||
      s.docId.toLowerCase() === q,
  );
}

export function redfoxSkillByDocId(docId: string): RedFoxSkillEntry | undefined {
  return REDFOX_SKILL_CATALOG.find((s) => s.docId === docId);
}
