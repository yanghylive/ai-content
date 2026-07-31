import { Center } from "@astryxdesign/core/Center";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Suspense } from "react";
import { ContentWorkspaceRoute } from "./content-workspace-route";

export default function ContentWorkspacePage() {
  return (
    <Suspense
      fallback={
        <Center minHeight={560} width="100%">
          <Spinner label="正在打开内容工作室..." size="sm" />
        </Center>
      }
    >
      <ContentWorkspaceRoute />
    </Suspense>
  );
}
