"use client";

import { Chat } from "@/components/agent-cockpit-canvas/chat/chat";
import { MobileChat } from "@/components/agent-cockpit-canvas/chat/mobile-chat";
import { MainLayout } from "@/components/agent-cockpit-canvas/dashboard/dashboard";
import { useIsMobile } from "@/lib/agent-cockpit-canvas/isMobile";

export default function AgentCockpitCanvasPage() {
  const isMobile = useIsMobile();

  return (
    <main
      className="min-h-screen bg-background text-foreground antialiased grid grid-cols-3 md:grid-cols-3 grid-cols-1 lg:gap-10"
    >
      {isMobile ? <MobileChat /> : <Chat className="h-full max-h-screen" />}
      <div className="col-span-3 lg:col-span-2 overflow-y-auto max-h-screen">
        <MainLayout className="w-full" />
      </div>
    </main>
  );
}
