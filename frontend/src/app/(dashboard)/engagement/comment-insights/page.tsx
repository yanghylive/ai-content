"use client";

import { useEffect, useState } from "react";
import { CommentInsightsCenter } from "./comment-insights-center";
import { CommentInsightsContent } from "./comment-insights-content";
import { BusinessToolResultContext } from "../../components/business-tool-result-context";

export default function EngagementCommentInsightsPage() {
  const [legacy, setLegacy] = useState(false);

  useEffect(() => {
    setLegacy(new URLSearchParams(window.location.search).has("legacy"));
  }, []);

  if (legacy) {
    return (
      <div className="flex flex-col gap-4">
        <BusinessToolResultContext allowedTools={["private-asset-extractor"]} />
        <CommentInsightsContent />
      </div>
    );
  }
  return <CommentInsightsCenter />;
}
