"use client";

import { CrmImportFlow } from "../../crm/import/crm-import-flow";

/* CrmImportFlow 自带移动原生分支（isMobile），无需 DesktopOnlyGate 包裹 */
export default function CrmImportFlowPage() {
  return <CrmImportFlow />;
}
