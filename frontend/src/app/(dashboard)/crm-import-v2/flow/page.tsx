"use client";

import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";
import { CrmImportFlow } from "../../crm/import/crm-import-flow";

export default function CrmImportFlowPage() {
  return (
    <DesktopOnlyGate
      title="客户批量导入需在电脑端操作"
      desc="CSV 导入、字段映射与预览需要电脑端操作，手机端暂不支持。你可以在手机上浏览客户列表。"
      backHref="/crm"
    >
      <CrmImportFlow />
    </DesktopOnlyGate>
  );
}
