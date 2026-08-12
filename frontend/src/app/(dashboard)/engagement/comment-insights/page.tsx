"use client";

import { CommentInsightsContent } from "./comment-insights-content";
import { V2BackButton } from "@/components/v2/v2-back-button";

export default function EngagementCommentInsightsPage() {
  return (
    <div className="flex flex-col gap-4">
      <V2BackButton />
      <CommentInsightsContent />
    </div>
  );
}
