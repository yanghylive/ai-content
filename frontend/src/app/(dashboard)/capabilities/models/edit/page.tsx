"use client";

import { useEffect, useState } from "react";
import { ModelForm } from "../model-form";

export default function EditModelPage() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  if (id === null) return null;
  return <ModelForm modelId={id || undefined} />;
}
