"use client";

import { useEffect, useState } from "react";
import { EditEntryHint } from "@/components/edit-entry-hint";
import { AppDetail } from "../app-detail";

export default function AppDetailPage() {
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    setKey(new URLSearchParams(window.location.search).get("key"));
  }, []);

  if (key === null) return <EditEntryHint />;
  return <AppDetail appKey={key || ""} />;
}
