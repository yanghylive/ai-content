"use client";

import React from "react";
import { Spinner } from "@heroui/react";
import { FileQuestion, Upload, UsersRound } from "lucide-react";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { CustomerDetailClient } from "../customers/[id]/customer-detail-client";

export default function CrmCustomerDetailPage() {
  const [customerId, setCustomerId] = React.useState<string | null | undefined>(
    undefined,
  );

  React.useEffect(() => {
    setCustomerId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  if (customerId === undefined) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  }

  if (!customerId?.trim()) {
    return (
      <div className="mx-auto flex min-h-[55vh] w-full max-w-2xl items-center">
        <FunctionalEmptyState
          actions={[
            {
              href: "/crm",
              icon: UsersRound,
              label: "返回客户与机会",
            },
            { href: "/crm/import", icon: Upload, label: "导入客户" },
          ]}
          description="当前链接没有客户 ID，系统无法确定要打开哪位客户。没有客户资料被修改。"
          icon={FileQuestion}
          title="缺少客户编号"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">客户详情</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">
            查看和管理单个客户的完整档案
          </p>
        </div>
      </div>
      <CustomerDetailClient customerId={customerId} />
    </div>
  );
}
