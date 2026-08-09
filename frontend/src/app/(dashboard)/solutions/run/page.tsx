"use client";

import { useEffect, useState } from "react";
import { EditEntryHint } from "@/components/edit-entry-hint";
import { SolutionRunDetail } from "../solution-run-detail";

export default function SolutionRunPage() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  if (id === null) return <EditEntryHint />;
  return <SolutionRunDetail runId={id || ""} />;
}
