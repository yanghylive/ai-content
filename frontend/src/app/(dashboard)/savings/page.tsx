"use client";

import React from "react";
import { SavingsShell } from "@/components/savings/shell";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { GrayTestOverlay } from "@/components/v2/gray-test-overlay";

export default function SavingsPage() {
  return (
    <GrayTestOverlay feature="省钱比价">
      <div>
        <V2BackButton />
        <SavingsShell />
      </div>
    </GrayTestOverlay>
  );
}
