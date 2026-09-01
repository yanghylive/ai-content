"use client";

import { SettingsNavShell } from "@/components/shell/settings-nav-shell";

export default function MineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SettingsNavShell only={["/mine"]}>{children}</SettingsNavShell>;
}
