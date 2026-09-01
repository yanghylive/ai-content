import { SettingsPageHeader, NotificationsSettingsSection } from "../settings-sections";

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsPageHeader title="通知设置" sub="什么时候提醒你" />
      <NotificationsSettingsSection />
    </div>
  );
}
