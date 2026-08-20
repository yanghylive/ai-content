import { WecomCrmCenter } from "./wecom-crm-center";
import { GrayTestBanner } from "@/components/v2/gray-test-banner";

export default function WecomCrmPage() {
  return (
    <>
      <GrayTestBanner feature="企业微信 CRM" />
      <WecomCrmCenter />
    </>
  );
}
