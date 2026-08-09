import { BusinessToolResultContext } from "../../components/business-tool-result-context";
import { ComplianceWorkbench } from "./compliance-workbench";

export default function CompliancePage() {
  return (
    <div className="flex flex-col gap-4">
      <BusinessToolResultContext allowedTools={["publish-compliance"]} />
      <ComplianceWorkbench />
    </div>
  );
}
