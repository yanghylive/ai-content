/**
 * 路由别名与面包屑配置（从 layout.tsx 抽出，P0-2 拆分）
 */

export type BreadcrumbRoute = {
  sectionTitle: string;
  title: string;
  selectedKey?: string;
};

export const routeAliases: Record<string, string> = {
  "/": "/today",
  "/admin": "/apps",
  "/admin/account": "/capabilities/account",
  "/admin/ai-employee": "/apps/ai-employee",
  "/admin/commercial-readiness": "/commercial-readiness",
  "/admin/connectors": "/platforms",
  "/admin/executor": "/local-engine",
  "/admin/local-engine": "/local-engine",
  "/admin/memory": "/tasks/evidence",
  "/admin/models": "/capabilities/models",
  "/admin/plugins": "/capabilities/models",
  "/admin/risk": "/capabilities/risk",
  "/admin/sandbox": "/capabilities/risk",
  "/admin/savings": "/savings",
  "/admin/settings": "/settings",
  "/admin/tools": "/local-engine",
  "/admin/users": "/capabilities/account",
  "/admin/redfox": "/intelligence/redfox",
  "/admin/redfox-skills": "/intelligence/skills",
  "/capabilities/users": "/capabilities/account",
  "/capabilities/tools": "/local-engine",
  "/capabilities/plugins": "/capabilities/models",
  "/capabilities/memory": "/tasks/evidence",
  "/capabilities/executor": "/local-engine",
  "/capabilities/sandbox": "/capabilities/risk",
};

 
export const routeBreadcrumbs: Record<string, BreadcrumbRoute> = {
  "/agent-workbench": { sectionTitle: "任务中心", title: "任务历史" },
  "/apps/auto-acquisition": { sectionTitle: "增长获客", title: "自动获客应用", selectedKey: "/growth" },
  "/admin/ai-employee": { sectionTitle: "应用与系统", title: "AI 员工", selectedKey: "/apps" },
  "/admin/commercial-readiness": { sectionTitle: "应用与系统", title: "商用检查", selectedKey: "/capabilities/risk" },
  "/admin/account": { sectionTitle: "设置", title: "账号与设备", selectedKey: "/capabilities/account" },
  "/admin/tools": { sectionTitle: "设置", title: "设备状态", selectedKey: "/local-engine" },
  "/admin/plugins": { sectionTitle: "设置", title: "模型与工具", selectedKey: "/capabilities/models" },
  "/admin/memory": { sectionTitle: "任务中心", title: "结果留存", selectedKey: "/tasks/evidence" },
  "/admin/executor": { sectionTitle: "设置", title: "设备状态", selectedKey: "/local-engine" },
  "/admin/sandbox": { sectionTitle: "应用与系统", title: "安全边界", selectedKey: "/capabilities/risk" },
  "/crm": { sectionTitle: "CRM", title: "客户与机会", selectedKey: "/crm" },
  "/crm/import": { sectionTitle: "CRM", title: "数据导入", selectedKey: "/crm/import" },
  "/crm/closer": { sectionTitle: "CRM", title: "成交助手", selectedKey: "/crm/closer" },
  "/crm/connectors": { sectionTitle: "CRM", title: "CRM 连接", selectedKey: "/crm/connectors" },
  "/local-engine": { sectionTitle: "设置", title: "设备状态", selectedKey: "/local-engine" },
  "/admin/local-engine": { sectionTitle: "设置", title: "设备状态", selectedKey: "/local-engine" },
  "/intelligence/skills": { sectionTitle: "应用与系统", title: "情报功能模板", selectedKey: "/capabilities/models" },
  "/intelligence/redfox": { sectionTitle: "应用与系统", title: "数据来源", selectedKey: "/platforms" },
  "/intelligence/costs": { sectionTitle: "应用与系统", title: "用量明细", selectedKey: "/settings" },
  "/release-notes": { sectionTitle: "应用与系统", title: "版本更新" },
  "/sessions": { sectionTitle: "任务中心", title: "任务历史" },
};

 
export const routeBreadcrumbPrefixes: Array<[string, BreadcrumbRoute]> = [
  ["/crm", { sectionTitle: "CRM", title: "客户与机会", selectedKey: "/crm" }],
];
