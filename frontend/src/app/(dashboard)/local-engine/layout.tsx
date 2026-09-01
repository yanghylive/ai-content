"use client";

import { SettingsNavShell } from "@/components/shell/settings-nav-shell";

export default function LocalEngineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SettingsNavShell>{children}</SettingsNavShell>;
}
