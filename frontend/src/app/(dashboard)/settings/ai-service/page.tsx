import { SettingsPageHeader } from "../settings-sections";
import { AiServiceSettings } from "../ai-service-settings";

/**
 * AI 服务管理（2026-09-03 恢复入口）
 *
 * 桌面端设置子路由：账号 AI 服务同步 + 默认模型选择 + 连接检查。
 * 组件 AiServiceSettings 原为 /settings?tab=ai 时代遗留，入口被 WorkBuddy 化
 * 移除后失去挂载点；此处以独立子页恢复，并已接入统一同步错误提示模块。
 */
export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsPageHeader
        title="AI 服务"
        sub="默认模型、账号同步与连接检查"
      />
      <AiServiceSettings />
    </div>
  );
}
