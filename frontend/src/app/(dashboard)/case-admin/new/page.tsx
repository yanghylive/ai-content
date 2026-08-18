"use client";

import React from "react";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { OpsDesktopPage } from "../../components/desktop-ops-ui";
import { CaseForm } from "../case-form";

export default function NewCasePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <V2BackButton label="返回" to="/case-admin" />
      <OpsDesktopPage title="新建案例" description="填写基础信息、分类标签、媒体与体验入口后保存为草稿，再提交审核">
        <CaseForm />
      </OpsDesktopPage>
    </div>
  );
}
