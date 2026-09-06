import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AutoUploadPublishTask } from "@/lib/api/auto-upload";

const mocks = vi.hoisted(() => ({
  taskPage: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/api/auto-upload", () => ({
  autoUploadApi: {
    taskPage: mocks.taskPage,
    createRetryTaskConfirmation: vi.fn(),
    retryTask: vi.fn(),
    deleteTask: vi.fn(),
  },
  buildRiskConfirmation: vi.fn(() => ({})),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, back: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-media-query", () => ({
  useIsMobile: () => true,
}));

import { DistributionTasks } from "./distribution-tasks";

function makeTask(overrides: Partial<AutoUploadPublishTask>): AutoUploadPublishTask {
  return {
    id: 1,
    title: "测试任务",
    platform_type: 3,
    platform: "抖音",
    account_file: "acc.json",
    file_list: [],
    tags: [],
    dry_run: false,
    status: "completed",
    message: null,
    result: null,
    created_at: "2026-08-15T00:00:00Z",
    updated_at: "2026-08-15T00:00:00Z",
    ...overrides,
  };
}

describe("DistributionTasks 分页加载更多（P1-4）", () => {
  it("首页加载后显示「加载更多（第 1/2 页）」，点击追加第 2 页，到底后按钮消失", async () => {
    mocks.taskPage
      .mockResolvedValueOnce({
        items: [makeTask({ id: 1, title: "任务一" })],
        totalPages: 2,
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [makeTask({ id: 2, title: "任务二" })],
        totalPages: 2,
        total: 2,
      });

    render(<DistributionTasks />);

    // 初始加载第 1 页
    await waitFor(() => {
      expect(screen.getByText("任务一")).toBeInTheDocument();
    });
    expect(mocks.taskPage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
    );

    // 「加载更多」按钮显示当前页/总页数
    const loadMoreBtn = screen.getByText("加载更多（第 1/2 页）");
    expect(loadMoreBtn).toBeInTheDocument();

    // 点击加载更多 → 请求第 2 页并追加（不替换）
    await userEvent.click(loadMoreBtn);
    await waitFor(() => {
      expect(screen.getByText("任务二")).toBeInTheDocument();
    });
    // 第 1 页的任务仍在（append 而非 replace）
    expect(screen.getByText("任务一")).toBeInTheDocument();
    expect(mocks.taskPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );

    // 已到最后一页（page >= totalPages）→ 按钮消失
    await waitFor(() => {
      expect(screen.queryByText(/加载更多/)).not.toBeInTheDocument();
    });
  });

  it("只有 1 页时不显示加载更多按钮", async () => {
    mocks.taskPage.mockResolvedValueOnce({
      items: [makeTask({ id: 1 })],
      totalPages: 1,
      total: 1,
    });

    render(<DistributionTasks />);

    await waitFor(() => {
      expect(screen.getByText("测试任务")).toBeInTheDocument();
    });
    expect(screen.queryByText(/加载更多/)).not.toBeInTheDocument();
  });

  it("taskPage 失败时显示错误提示且不崩溃", async () => {
    mocks.taskPage.mockRejectedValueOnce(new Error("服务暂时不可用"));

    render(<DistributionTasks />);

    // 2026-09-06 复核 P1-2：toPublicError 会把「服务暂时不可用」归一为通用
    // 提示（不再是旧的「发布任务暂时无法读取」具体文案），断言对齐当前行为。
    await waitFor(() => {
      expect(screen.getByText(/服务暂时不可用/)).toBeInTheDocument();
    });
  });
});
