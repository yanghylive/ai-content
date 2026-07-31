"use client";

import { useEffect, useState } from "react";
import { ScheduleForm } from "../schedule-form";

export default function EditSchedulePage() {
  const [taskType, setTaskType] = useState<string | null>(null);

  useEffect(() => {
    setTaskType(new URLSearchParams(window.location.search).get("taskType"));
  }, []);

  if (taskType === null) return null;
  return <ScheduleForm taskType={taskType || undefined} />;
}
