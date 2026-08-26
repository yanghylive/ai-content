"use client";

import React from "react";
import Link from "next/link";
import { Button, Chip } from "@heroui/react";
import { ArrowRight, RefreshCw, UsersRound } from "lucide-react";
import { listCrmCustomers, type CrmCustomer } from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";
import { SkeletonList } from "@/components/skeleton";

const statusLabels: Record<string, string> = {
  new: "新线索",
  contacted: "已触达",
  interested: "有意向",
  follow_up: "待跟进",
  customer: "已成交",
  invalid: "无效"};

export function CrmCustomerQueue() {
  const [customers, setCustomers] = React.useState<CrmCustomer[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listCrmCustomers();
      setCustomers(result.filter((customer) => !customer.archived).slice(0, 8));
    } catch (reason) {
      setError(toPublicError(reason, "CRM 客户暂时无法加载。"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      aria-labelledby="crm-customer-queue-heading"
      className="border-y border-divider py-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="crm-customer-queue-heading" className="font-semibold">
            最近客户
          </h2>
          <p className="mt-1 text-sm text-default-500">
            {customers.length ? `${customers.length} 位待继续处理` : "客户队列"}
          </p>
        </div>
        <Button
          as={Link}
          endContent={<ArrowRight size={15} />}
          href="/crm"
          size="sm"
          variant="flat"
        >
          查看全部
        </Button>
      </div>

      {loading ? (
        <div className="flex min-h-28 items-center justify-center">
          <SkeletonList rows={3} />
        </div>
      ) : error ? (
        <div className="mt-4 flex min-h-28 flex-col items-center justify-center gap-3 border border-dashed border-danger-200 px-4 text-center">
          <p className="text-sm text-danger">{error}</p>
          <Button
            size="sm"
            startContent={<RefreshCw size={14} />}
            variant="flat"
            onPress={load}
          >
            重新加载
          </Button>
        </div>
      ) : customers.length ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {customers.map((customer) => (
            <article key={customer.id} className="border border-divider p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{customer.displayName}</p>
                  <p className="mt-1 truncate text-xs text-default-500">
                    {customer.sourceAccount?.name ||
                      customer.sourceKeyword ||
                      customer.sourcePlatform ||
                      "手动录入"}
                  </p>
                </div>
                <Chip size="sm" variant="flat">
                  {statusLabels[customer.status] || customer.status}
                </Chip>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-default-400">
                <span>
                  {customer.taskCount} 个任务 · {customer.noteCount} 条备注
                </span>
                <Button
                  as={Link}
                  href={`/crm/customer?id=${encodeURIComponent(customer.id)}`}
                  isIconOnly
                  aria-label={`打开 ${customer.displayName} 客户档案`}
                  size="sm"
                  variant="light"
                >
                  <ArrowRight size={14} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex min-h-32 flex-col items-center justify-center gap-3 border border-dashed border-divider px-4 text-center">
          <UsersRound size={24} className="text-default-400" />
          <p className="text-sm text-default-500">还没有可处理客户</p>
          <Button as={Link} color="primary" href="/crm" size="sm">
            新增客户
          </Button>
        </div>
      )}
    </section>
  );
}
