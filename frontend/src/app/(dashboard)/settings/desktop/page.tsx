import { SettingsPageHeader } from "../settings-sections";
import { DesktopSettings } from "../desktop-settings";

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsPageHeader title="桌面设置" sub="微信应用位置、自动恢复连接等本机选项" />
      <div className="kaypal-v3-panel p-6">
        <DesktopSettings />
      </div>
    </div>
  );
}
