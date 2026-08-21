"use client";

import React, { useEffect, useState } from "react";
import { Spinner } from "@heroui/react";
import { ExternalLink, Route } from "lucide-react";
import {
  getCrmCustomerAttribution,
  type CrmCustomerAttribution,
} from "@/lib/api/crm";

const HOP_LABEL: Record<string, string> = {
  content: "内容",
  publish: "发布",
  interaction: "互动",
  lead: "线索",
  customer: "客户",
  opportunity: "商机",
};

/**
 * P2 T05：客户来源归因区块。
 * 展示 内容 → 发布 → 互动 → 线索 → 客户 的归因链；
 * 导入/手动客户（无 Lead）→ layer=manual，显示「手动录入」。
 */
export function CustomerAttributionPanel({ customerId }: { customerId: string }) {
  const [data, setData] = useState<CrmCustomerAttribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCrmCustomerAttribution(customerId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setError("归因数据暂不可用");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-default-400">
        <Spinner size="sm" /> 正在解析来源归因…
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-default-400">{error}</p>;
  }
  if (!data) return null;

  if (data.layer === "manual" || data.hops.length === 0) {
    return (
      <p className="text-sm text-default-400">
        手动录入 / 无来源归因（该客户未关联线索或来源内容）
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {data.hops.map((hop, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Route size={13} className="text-default-400" />}
            <span className="rounded-md bg-default-100 px-2 py-0.5 text-xs font-medium text-default-700">
              {HOP_LABEL[hop.fromType] ?? hop.fromType}
              {hop.label === "qualified_by" ? "·资格" : ""}
            </span>
          </React.Fragment>
        ))}
        {data.hops.length > 0 && <Route size={13} className="text-default-400" />}
        <span className="rounded-md bg-success-50 px-2 py-0.5 text-xs font-semibold text-success-700">
          客户
        </span>
      </div>

      {data.lead?.sourceUrl && (
        <a
          href={data.lead.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink size={12} /> 查看来源内容
        </a>
      )}
      {data.lead?.sourceText && (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-default-500">
          {data.lead.sourceText.slice(0, 200)}
        </p>
      )}
    </div>
  );
}
