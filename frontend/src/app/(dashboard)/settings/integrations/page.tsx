import { SettingsPageHeader } from "../settings-sections";
import { FileStorageSettings } from "../settings-integrations";

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsPageHeader title="文件存储" sub="生成的图片、视频存在哪里" />
      <FileStorageSettings />
    </div>
  );
}
