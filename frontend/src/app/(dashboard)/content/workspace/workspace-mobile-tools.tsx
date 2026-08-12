"use client";

import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
} from "@heroui/react";
import { Library } from "lucide-react";
import type { ReactNode } from "react";
import { V2GhostButton } from "@/components/v2/ui-kit";

export type WorkspaceMobilePanel = "context" | null;

type WorkspaceMobileToolsProps = {
  activePanel: WorkspaceMobilePanel;
  contextContent: ReactNode;
  onPanelChange: (panel: WorkspaceMobilePanel) => void;
};

export function WorkspaceMobileTools({
  activePanel,
  contextContent,
  onPanelChange,
}: WorkspaceMobileToolsProps) {
  const isContextOpen = activePanel === "context";

  return (
    <>
      <div
        aria-label="工作区辅助面板"
        className="flex min-h-11 items-center justify-end gap-2 border-y border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-2"
        role="toolbar"
      >
        <V2GhostButton
          aria-expanded={isContextOpen}
          aria-haspopup="dialog"
          icon={Library}
          onClick={() => onPanelChange("context")}
        >
          创作上下文
        </V2GhostButton>
      </div>

      <Drawer
        classNames={{ base: "w-[85vw] max-w-[360px]" }}
        isOpen={isContextOpen}
        placement="right"
        scrollBehavior="inside"
        size="sm"
        onOpenChange={(open) => {
          if (!open) onPanelChange(null);
        }}
      >
        <DrawerContent>
          {() => (
            <>
              <DrawerHeader className="border-b border-divider px-4 py-3 text-base">
                创作上下文
              </DrawerHeader>
              <DrawerBody className="p-0">{contextContent}</DrawerBody>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
