"use client";

import React from "react";
import { SavingsShell } from "@/components/savings/shell";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { GrayTestBanner } from "@/components/v2/gray-test-banner";

export default function SavingsPage() {
  return (
    <div>
      <V2BackButton />
      <GrayTestBanner feature="省钱比价" />
      <SavingsShell />
    </div>
  );
}
