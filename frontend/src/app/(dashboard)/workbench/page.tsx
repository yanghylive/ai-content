"use client";

import React from "react";
import { Card, CardBody } from "@heroui/react";
import { OpsWorkbenchView } from "@/components/ops-workbench/ops-workbench-view";

export default function WorkbenchOverviewPage() {
    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-2xl font-bold">客户互动</h1>
                <p className="text-sm text-default-500">集中处理抖音评论、抖音私信、视频号评论和视频号私信；微信会话和群发放到二阶段。</p>
            </div>
            <OpsWorkbenchView />
        </div>
    );
}
