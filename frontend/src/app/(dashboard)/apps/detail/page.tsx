"use client";

import { useEffect, useState } from "react";
import { AppDetail } from "../app-detail";

export default function AppDetailPage() {
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    setKey(new URLSearchParams(window.location.search).get("key"));
  }, []);

  if (key === null) return null;
  return <AppDetail appKey={key || ""} />;
}
