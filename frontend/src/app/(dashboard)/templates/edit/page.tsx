"use client";

import { useEffect, useState } from "react";
import { StyleForm } from "../../styles/style-form";

export default function EditTemplatePage() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  if (id === null) return null;
  return <StyleForm styleId={id || undefined} fixedType="template" />;
}
