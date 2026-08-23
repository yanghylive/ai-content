import { CrmNextActionPanel } from "@/components/ops-workbench/crm-next-action-panel";
import { OpsWorkbenchView } from "@/components/ops-workbench/ops-workbench-view";
import { CrmCustomerQueue } from "./crm-customer-queue";

export function CustomersContent() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="kx-greet">客户处理</h1>
        <p className="text-sm text-default-500">
          先看 CRM 待办、成交助手建议和风险机会，再进入抖音、微信等渠道处理。
        </p>
      </div>
      <CrmCustomerQueue />
      <CrmNextActionPanel />
      <OpsWorkbenchView />
    </div>
  );
}
