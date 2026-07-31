"use client";

import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
} from "@heroui/react";
import { Library, ListFilter } from "lucide-react";
import type { ReactNode } from "react";

export type WorkspaceMobilePanel = "queue" | "context" | null;

type WorkspaceMobileToolsProps = {
  activePanel: WorkspaceMobilePanel;
  queueContent: ReactNode;
  contextContent: ReactNode;
  onPanelChange: (panel: WorkspaceMobilePanel) => void;
};

export function WorkspaceMobileTools({
  activePanel,
  queueContent,
  contextContent,
  onPanelChange,
}: WorkspaceMobileToolsProps) {
  const isQueueOpen = activePanel === "queue";
  const isContextOpen = activePanel === "context";
  const title = isQueueOpen ? "内容队列" : "创作上下文";

  return (
    <>
      <div
        aria-label="工作区辅助面板"
        className="flex min-h-11 items-center justify-end gap-2 border-y border-divider bg-content1 px-3 py-2 xl:hidden"
        role="toolbar"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Button
            aria-expanded={isQueueOpen}
            aria-haspopup="dialog"
            radius="sm"
            size="sm"
            startContent={<ListFilter aria-hidden="true" className="h-4 w-4" />}
            variant="bordered"
            onPress={() => onPanelChange("queue")}
          >
            内容队列
          </Button>
          <Button
            aria-expanded={isContextOpen}
            aria-haspopup="dialog"
            radius="sm"
            size="sm"
            startContent={<Library aria-hidden="true" className="h-4 w-4" />}
            variant="bordered"
            onPress={() => onPanelChange("context")}
          >
            创作上下文
          </Button>
        </div>
      </div>

      <Drawer
        classNames={{ base: "w-[85vw] max-w-[360px]" }}
        isOpen={Boolean(activePanel)}
        placement={isQueueOpen ? "left" : "right"}
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
                {title}
              </DrawerHeader>
              <DrawerBody className="p-0">
                {isQueueOpen ? queueContent : contextContent}
              </DrawerBody>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
