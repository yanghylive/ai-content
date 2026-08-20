import { WecomAssistantCenter } from "../interaction/wecom-assistant/wecom-assistant-center";
import { GrayTestBanner } from "@/components/v2/gray-test-banner";

export default function WecomAssistantV2Page() {
  return (
    <>
      <GrayTestBanner feature="企业微信助手" />
      <WecomAssistantCenter />
    </>
  );
}
