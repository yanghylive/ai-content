import { describe, it, expect } from "vitest";
import {
  MOBILE_STATUS_BADGE,
  MOBILE_STATUS_DOT,
  MOBILE_STATUS_LABEL,
  RUNNING_STALE_THRESHOLD_MS,
  isStaleRunning,
  mapBackendStatus,
  statusGroup,
  type PublishStatus,
} from "./publish-status";

describe("statusGroup 状态归类（P1-4 列表筛选核心）", () => {
  it("完成类状态归 done", () => {
    for (const s of ["success", "completed", "done", "published"]) {
      expect(statusGroup(s)).toBe("done");
    }
  });

  it("失败类状态归 failed", () => {
    for (const s of ["failed", "error", "blocked"]) {
      expect(statusGroup(s)).toBe("failed");
    }
  });

  it("进行类状态归 pending（含 waiting* 前缀）", () => {
    for (const s of [
      "queued",
      "running",
      "pending",
      "publishing",
      "waiting",
      "waiting_for_send_confirmation",
    ]) {
      expect(statusGroup(s)).toBe("pending");
    }
  });

  it("未知状态归 other，空/undefined 不抛异常", () => {
    expect(statusGroup("unknown")).toBe("other");
    expect(statusGroup("")).toBe("other");
    expect(statusGroup(undefined)).toBe("other");
  });

  it("大小写不敏感", () => {
    expect(statusGroup("RUNNING")).toBe("pending");
    expect(statusGroup("Done")).toBe("done");
    expect(statusGroup("FAILED")).toBe("failed");
  });
});

describe("移动端状态映射（P1-1 状态中间态）", () => {
  const ALL: PublishStatus[] = [
    "draft",
    "pending",
    "queued",
    "running",
    "cancelled",
    "done",
    "failed",
  ];

  it("所有展示状态都有 label/badge/dot（不缺失导致 undefined 渲染）", () => {
    for (const s of ALL) {
      expect(MOBILE_STATUS_LABEL[s]).toBeTruthy();
      expect(MOBILE_STATUS_BADGE[s]).toBeTruthy();
      expect(MOBILE_STATUS_DOT[s]).toBeTruthy();
    }
  });

  it("P1-1 新增的执行中/已取消状态有正确文案", () => {
    expect(MOBILE_STATUS_LABEL.running).toBe("执行中");
    expect(MOBILE_STATUS_LABEL.cancelled).toBe("已取消");
    expect(MOBILE_STATUS_LABEL.queued).toBe("排队中");
  });

  it("进行类状态（queued/running）共用蓝色 badge 与 dot", () => {
    expect(MOBILE_STATUS_BADGE.queued).toBe(MOBILE_STATUS_BADGE.running);
    expect(MOBILE_STATUS_DOT.queued).toBe(MOBILE_STATUS_DOT.running);
  });
});

describe("mapBackendStatus 后端状态 → 展示状态（P1-1 核心映射）", () => {
  it("claimed/running/publishing 归 running（执行中）", () => {
    for (const s of ["claimed", "running", "publishing"]) {
      expect(mapBackendStatus(s)).toBe("running");
    }
  });

  it("cancelled/canceled 归 cancelled（已取消）", () => {
    expect(mapBackendStatus("cancelled")).toBe("cancelled");
    expect(mapBackendStatus("canceled")).toBe("cancelled");
  });

  it("waiting* 前缀与 pending 归 pending（计划中）", () => {
    expect(mapBackendStatus("waiting")).toBe("pending");
    expect(mapBackendStatus("waiting_for_send_confirmation")).toBe("pending");
    expect(mapBackendStatus("pending")).toBe("pending");
  });

  it("success/completed/done 归 done；failed/error/blocked 归 failed", () => {
    for (const s of ["success", "completed", "done"]) {
      expect(mapBackendStatus(s)).toBe("done");
    }
    for (const s of ["failed", "error", "blocked"]) {
      expect(mapBackendStatus(s)).toBe("failed");
    }
  });

  it("未知状态与空值归 draft（兜底不崩溃）", () => {
    expect(mapBackendStatus("")).toBe("draft");
    expect(mapBackendStatus(undefined)).toBe("draft");
    expect(mapBackendStatus("weird-status")).toBe("draft");
  });
});

describe("isStaleRunning 卡住任务检测（P1-1 租约超时）", () => {
  const now = 1_000_000;

  it("running 且超过租约时长 → 卡住", () => {
    const updatedAt = new Date(now - RUNNING_STALE_THRESHOLD_MS - 1).toISOString();
    expect(isStaleRunning("running", updatedAt, now)).toBe(true);
  });

  it("running 但未超租约 → 不卡住", () => {
    const updatedAt = new Date(now - RUNNING_STALE_THRESHOLD_MS + 1).toISOString();
    expect(isStaleRunning("running", updatedAt, now)).toBe(false);
  });

  it("非 running 状态永不判卡住（即使时间很久）", () => {
    const old = new Date(now - 999_999).toISOString();
    for (const s of ["queued", "pending", "done", "failed", "cancelled", "draft"]) {
      expect(isStaleRunning(s as PublishStatus, old, now)).toBe(false);
    }
  });

  it("无 updatedAt 或非法时间 → 不判卡住", () => {
    expect(isStaleRunning("running", undefined, now)).toBe(false);
    expect(isStaleRunning("running", "not-a-date", now)).toBe(false);
  });
});
