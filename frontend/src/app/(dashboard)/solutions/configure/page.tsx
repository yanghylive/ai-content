"use client";

import { useEffect, useState } from "react";
import { EditEntryHint } from "@/components/edit-entry-hint";
import { SolutionConfigure } from "../solution-configure";

export default function SolutionConfigurePage() {
  const [pkg, setPkg] = useState<string | null>(null);

  useEffect(() => {
    setPkg(new URLSearchParams(window.location.search).get("package"));
  }, []);

  if (pkg === null) return <EditEntryHint />;
  return <SolutionConfigure packageCode={pkg || ""} />;
}
