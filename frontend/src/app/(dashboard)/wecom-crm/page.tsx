import { WecomCrmCenter } from "./wecom-crm-center";
import { GrayTestOverlay } from "@/components/v2/gray-test-overlay";

export default function WecomCrmPage() {
  return (
    <GrayTestOverlay feature="企业微信 CRM">
      <WecomCrmCenter />
    </GrayTestOverlay>
  );
}
