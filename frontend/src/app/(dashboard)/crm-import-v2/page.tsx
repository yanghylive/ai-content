import { CrmImportFlow } from "../crm/import/crm-import-flow";

// 直接渲染导入流程页（模板下载 + Excel 上传），
// 不再先进 CrmImportCenter 介绍页——用户要的是打开就能导入
export default function CrmImportV2Page() {
  return <CrmImportFlow />;
}
