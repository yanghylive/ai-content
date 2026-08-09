"use client";

import { useEffect, useState } from "react";
import { EditEntryHint } from "@/components/edit-entry-hint";
import { ScheduleForm } from "../schedule-form";

export default function EditSchedulePage() {
  const [taskType, setTaskType] = useState<string | null>(null);

  useEffect(() => {
    setTaskType(new URLSearchParams(window.location.search).get("taskType"));
  }, []);

  if (taskType === null) return <EditEntryHint />;
  return <ScheduleForm taskType={taskType || undefined} />;
}
