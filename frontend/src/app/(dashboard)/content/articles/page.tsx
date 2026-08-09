"use client";

import { useEffect, useState } from "react";
import { ArticleList } from "./article-list";

export default function ContentArticlesPage() {
  const [legacy, setLegacy] = useState(false);
  const [LegacyView, setLegacyView] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    setLegacy(new URLSearchParams(window.location.search).has("legacy"));
  }, []);

  useEffect(() => {
    if (!legacy) return;
    import("../../articles/page").then((mod) => {
      setLegacyView(() => mod.default);
    });
  }, [legacy]);

  if (legacy) {
    return LegacyView ? <LegacyView /> : null;
  }
  return <ArticleList />;
}
