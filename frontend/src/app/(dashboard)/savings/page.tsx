"use client";

import React from "react";
import { SavingsShell } from "@/components/savings/shell";
import { V2BackButton } from "@/components/v2/v2-back-button";

export default function SavingsPage() {
  return (
    <div>
      <V2BackButton />
      <SavingsShell />
    </div>
  );
}
