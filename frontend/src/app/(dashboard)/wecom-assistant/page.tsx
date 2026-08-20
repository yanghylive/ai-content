import { WecomAssistantCenter } from "../interaction/wecom-assistant/wecom-assistant-center";
import { GrayTestOverlay } from "@/components/v2/gray-test-overlay";

export default function WecomAssistantV2Page() {
  return (
    <GrayTestOverlay feature="企业微信助手">
      <WecomAssistantCenter />
    </GrayTestOverlay>
  );
}
