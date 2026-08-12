"use client";

import { useSearchParams } from "next/navigation";
import { ContentWorkspaceClient } from "./content-workspace-client";
import { ContentWorkspaceIntentEntry } from "./content-workspace-intent-entry";
import { useContentWorkspaceRollout } from "@/lib/content-workspace/rollout";
import {
  parseWorkspaceIntent,
  shouldShowWorkspaceIntent,
} from "./workspace-intent";

export function ContentWorkspaceRoute() {
  const searchParams = useSearchParams();
  const intent = parseWorkspaceIntent(searchParams);
  const showIntent = Boolean(intent && shouldShowWorkspaceIntent(searchParams));
  const rollout = useContentWorkspaceRollout(showIntent);

  const content =
    intent && showIntent && rollout.status === "enabled" ? (
      <ContentWorkspaceIntentEntry intent={intent} rollout={rollout} />
    ) : (
      <ContentWorkspaceClient />
    );

  return <div className="flex min-w-0 flex-col gap-3">{content}</div>;
}
