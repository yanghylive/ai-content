import { SettingsPageHeader } from "../settings-sections";
import { SettingsIntegrations } from "../settings-integrations";

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsPageHeader title="AI 服务与存储" sub="模型、内容来源、文件存储" />
      <SettingsIntegrations />
    </div>
  );
}
