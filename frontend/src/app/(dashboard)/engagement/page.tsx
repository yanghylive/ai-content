import { CustomerServiceConfig } from "../workbench/customer-service-config";

export default function EngagementPage() {
  /* CustomerServiceConfig 自带移动原生分支（isMobile），无需 DesktopOnlyGate 包裹 */
  return <CustomerServiceConfig />;
}
