import { SettingsPageHeader, AccountSettingsSection } from "../settings-sections";

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsPageHeader title="账号与安全" sub="个人资料、登录密码" />
      <AccountSettingsSection />
    </div>
  );
}
