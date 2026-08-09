"use client";

import { useEffect, useState } from "react";
import { CustomerServiceConfig } from "../workbench/customer-service-config";
import LegacyPage from "../workbench/page-legacy";

export default function EngagementPage() {
  const [legacy, setLegacy] = useState(false);

  useEffect(() => {
    setLegacy(new URLSearchParams(window.location.search).has("legacy"));
  }, []);

  if (legacy) {
    return <LegacyPage />;
  }
  return <CustomerServiceConfig />;
}
