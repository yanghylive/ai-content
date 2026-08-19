import type { Metadata } from "next";
import { DemoRequestClient } from "./demo-request-client";

/**
 * 公开预约演示页（S10 修复）：案例详情页「预约演示」入口的新落地页。
 *
 * 本文件为 server wrapper：
 * - 客户端组件无法导出 metadata，且运行时 document.title 会被 Next.js
 *   MetadataBoundary 覆盖回 layout 默认值，因此把 metadata 提升到此处，
 *   静态导出构建期即生成正确的 <title>。
 * - 使用 title.absolute 绕开 (cases)/layout.tsx 的 title.template 拼接，
 *   避免出现「预约演示 | 九章智能 - 九章智能」。
 * - 具体 UI（case 参数解析 + InquiryForm）在 demo-request-client.tsx。
 */
export const metadata: Metadata = {
  title: {
    absolute: "预约演示 | 九章智能",
  },
};

export default function DemoRequestPage() {
  return <DemoRequestClient />;
}
