import { notFound } from "next/navigation";
import { ClearBrowserCacheClient } from "./clear-browser-cache-client";

export default function ClearBrowserCachePage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <ClearBrowserCacheClient />;
}
