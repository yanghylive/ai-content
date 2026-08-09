"use client";

import { useEffect, useState } from "react";
import { EditEntryHint } from "@/components/edit-entry-hint";
import { ModelForm } from "../model-form";

export default function EditModelPage() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  if (id === null) return <EditEntryHint />;
  return <ModelForm modelId={id || undefined} />;
}
