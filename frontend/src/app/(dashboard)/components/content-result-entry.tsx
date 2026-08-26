"use client";

import {
  ArrowRight,
  FileCheck2,
  FilePenLine,
  Files,
  RefreshCw,
} from "lucide-react";
import {
  WORKSPACE_INTENTS,
  buildWorkspaceIntentHref,
  type WorkspaceIntent,
} from "../content/workspace/workspace-intent";
import {
  recordContentWorkspaceMetric,
  useContentWorkspaceRollout,
} from "@/lib/content-workspace/rollout";
import { useEffect, useRef } from "react";

const intentIcons: Record<WorkspaceIntent, typeof FilePenLine> = {
  create: FilePenLine,
  rewrite: RefreshCw,
  multiplatform: Files,
  prepare: FileCheck2,
};

export function ContentResultEntry() {
  const rollout = useContentWorkspaceRollout();
  const viewed = useRef(false);

  useEffect(() => {
    if (rollout.status !== "enabled" || viewed.current) return;
    viewed.current = true;
    recordContentWorkspaceMetric("result_entry_viewed", rollout);
  }, [rollout]);

  if (rollout.status !== "enabled") return null;

  return (
    <section className="p-4 bg-default-100">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-xl font-bold">直接开始内容工作</h2>
          <p className="text-sm text-default-500">
            选择想要的结果，确认目标和平台后即可进入可编辑简报。
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-default-200">
          <li className="flex flex-col py-2">
            <span className="font-semibold">选择结果</span>
          </li>
          {WORKSPACE_INTENTS.map((intent) => {
            const Icon = intentIcons[intent.id];
            return (
              <li key={intent.id} className="flex flex-col">
                <a
                  href={buildWorkspaceIntentHref(intent.id)}
                  className="flex flex-row items-center gap-3 py-3"
                >
                  <Icon aria-hidden="true" size={18} />
                  <span className="flex flex-col">
                    <span>{intent.label}</span>
                    <span className="text-sm text-default-500">
                      {intent.description}
                    </span>
                  </span>
                  <ArrowRight aria-hidden="true" size={16} className="ml-auto" />
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
