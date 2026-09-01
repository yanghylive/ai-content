import { SettingsPageHeader, AppearanceSettingsSection } from "../settings-sections";

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsPageHeader title="显示设置" sub="文字大小，本机保存" />
      <AppearanceSettingsSection />
    </div>
  );
}
