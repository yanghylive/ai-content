"use client";

import {
  Download,
  FileSpreadsheet,
  History,
  Upload,
  Users,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function CrmImportCenter() {
  return (
    <WorkbenchCenter
      title="导入客户"
      subtitle="上传 Excel 或粘贴数据，系统自动识别字段并导入"
      icon={Upload}
      primaryAction={{ label: "开始导入", href: "/crm-import/flow" }}
      quickActions={[
        {
          key: "upload-excel",
          title: "上传 Excel",
          description: "支持 .xlsx / .csv 文件",
          icon: FileSpreadsheet,
          href: "/crm/import?action=upload",
        },
        {
          key: "download-template",
          title: "下载模板",
          description: "按模板格式整理数据",
          icon: Download,
          href: "/crm/import?action=template",
        },
        {
          key: "paste",
          title: "直接粘贴",
          description: "粘贴表格数据快速导入",
          icon: Upload,
          href: "/crm-import/flow",
        },
      ]}
      advancedLinks={[
        { key: "customers", title: "客户列表", icon: Users, href: "/crm" },
        { key: "history", title: "导入记录", icon: History, href: "/crm/import?tab=history" },
      ]}
    />
  );
}
