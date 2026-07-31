"use client";

import { useEffect, useState } from "react";
import { SolutionRunDetail } from "../solution-run-detail";

export default function SolutionRunPage() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  if (id === null) return null;
  return <SolutionRunDetail runId={id || ""} />;
}
