export function publicIntelligenceText(
  value: string | number | null | undefined,
  fallback = "",
) {
  const text = String(value ?? fallback).trim();
  if (!text) return fallback;

  return text
    .replace(/RedFox\s*情报/gi, "系统情报")
    .replace(/RedFox\s*请求/gi, "数据请求")
    .replace(/RedFox/gi, "系统数据")
    .replace(/Skill\s*install/gi, "功能配置")
    .replace(/Skill\s*catalog/gi, "功能目录")
    .replace(/Skill/gi, "功能能力")
    .replace(/插件/g, "扩展能力")
    .replace(/技能广场/g, "能力中心")
    .replace(/OAuth\s*token/gi, "外部授权")
    .replace(/API\s*Key/gi, "连接凭证")
    .replace(/\bToken\b/gi, "连接凭证")
    .replace(/Webhook/gi, "通知地址")
    .replace(/\bAPI\b/gi, "数据服务")
    .replace(/endpoint/gi, "数据服务")
    .replace(/接口/g, "数据服务")
    .replace(/Base URL/gi, "服务地址")
    .replace(/\bKey\b/gi, "访问凭证")
    .replace(/本地引擎/g, "本机处理服务")
    .replace(/执行器/g, "任务处理服务")
    .replace(/\bruntime\b/gi, "处理服务")
    .replace(/\bMCP\b/gi, "自动化服务")
    .replace(/工作流/g, "流程")
    .replace(/合规负责人/g, "复核负责人")
    .replace(/合规审核|合规审阅|合规复核/g, "风险复核")
    .replace(/需合规/g, "需复核")
    .replace(/先合规/g, "先复核")
    .replace(/合规/g, "风险复核")
    .replace(/Playwright/gi, "浏览器自动化")
    .replace(/\bCLI\b/gi, "命令工具")
    .replace(/tenant/gi, "团队")
    .replace(/租户/g, "团队")
    .replace(/entitlement/gi, "套餐权限")
    .replace(/mock/gi, "预览运行")
    .replace(/demo/gi, "演示")
    .replace(/测试通过/g, "验证成功")
    .replace(/测试连接/g, "检查数据源")
    .replace(/扣费/g, "积分扣减");
}

export function publicIntelligenceList(values: string[]) {
  return values.map((value) => publicIntelligenceText(value));
}
