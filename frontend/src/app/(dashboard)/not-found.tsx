"use client";

import Link from "next/link";
import { Button } from "@heroui/react";
import { ArrowLeft, SearchX } from "lucide-react";

export default function DashboardNotFound() {
  return (
    <main className="mx-auto flex min-h-[55vh] w-full max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-default-100 text-default-500">
        <SearchX aria-hidden="true" size={24} />
      </span>
      <div>
        <h1 className="text-xl font-semibold text-foreground">没有找到这个页面</h1>
        <p className="mt-2 text-sm leading-6 text-default-500">
          链接可能已失效，或对应记录已经删除、归档。请返回工作台重新查找。
        </p>
      </div>
      <Button
        as={Link}
        color="primary"
        href="/"
        startContent={<ArrowLeft aria-hidden="true" size={16} />}
      >
        返回工作台
      </Button>
    </main>
  );
}
