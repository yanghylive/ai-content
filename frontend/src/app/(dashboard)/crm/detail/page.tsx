"use client";

import { useEffect, useState } from "react";
import { EditEntryHint } from "@/components/edit-entry-hint";
import { CustomerProfile } from "../customer-profile";

export default function CustomerDetailPage() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  if (id === null) return <EditEntryHint />;
  return <CustomerProfile customerId={id || ""} />;
}
