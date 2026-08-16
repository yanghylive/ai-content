import { Suspense } from "react";
import { ContentWorkspaceRoute } from "./content-workspace-route";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ContentWorkspaceRoute />
    </Suspense>
  );
}
