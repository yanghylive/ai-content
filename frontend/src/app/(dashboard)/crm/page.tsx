import { CrmCenter } from "./crm-center";

export default function Page() {
  // ?filter=follow-up / ?action=new 由 v2 CrmCenter 客户端自消费
  return <CrmCenter />;
}
