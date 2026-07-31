"use client";

import { useEffect, useState } from "react";
import { SolutionConfigure } from "../solution-configure";

export default function SolutionConfigurePage() {
  const [pkg, setPkg] = useState<string | null>(null);

  useEffect(() => {
    setPkg(new URLSearchParams(window.location.search).get("package"));
  }, []);

  if (pkg === null) return null;
  return <SolutionConfigure packageCode={pkg || ""} />;
}
