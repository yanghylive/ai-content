"use client";

import { useEffect, useState } from "react";
import { StyleForm } from "../style-form";

export default function EditStylePage() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  if (id === null) return null;
  return <StyleForm styleId={id || undefined} />;
}
