"use client";

import { useEffect, useState } from "react";
import { StrategyForm } from "../strategy-form";

export default function EditStrategyPage() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  if (id === null) return null;
  return <StrategyForm strategyId={id || undefined} />;
}
