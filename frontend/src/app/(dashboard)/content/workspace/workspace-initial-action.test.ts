import { describe, it, expect } from "vitest";
import { resolveWorkspaceInitialAction } from "./workspace-initial-action";

describe("resolveWorkspaceInitialAction（P1-3 action=new 必须创建新草稿）", () => {
  it("action=new → 创建新草稿（不 fallback 队列第一篇）", () => {
    expect(resolveWorkspaceInitialAction("?action=new")).toEqual({
      type: "create-new",
    });
  });

  it("action=new 优先级高于 articleId（即使带了 articleId 也新建）", () => {
    expect(
      resolveWorkspaceInitialAction("?action=new&articleId=abc"),
    ).toEqual({ type: "create-new" });
  });

  it("articleId 参数 → 加载指定草稿", () => {
    expect(resolveWorkspaceInitialAction("?articleId=abc123")).toEqual({
      type: "load",
      articleId: "abc123",
    });
  });

  it("旧参数 article 也认（兼容）", () => {
    expect(resolveWorkspaceInitialAction("?article=xyz")).toEqual({
      type: "load",
      articleId: "xyz",
    });
  });

  it("articleId 优先于旧参数 article", () => {
    expect(resolveWorkspaceInitialAction("?articleId=new1&article=old1")).toEqual({
      type: "load",
      articleId: "new1",
    });
  });

  it("无参数 → articleId 为 null（调用方 fallback 队列第一篇）", () => {
    expect(resolveWorkspaceInitialAction("")).toEqual({
      type: "load",
      articleId: null,
    });
  });

  it("action=其他值不触发新建", () => {
    expect(resolveWorkspaceInitialAction("?action=edit")).toEqual({
      type: "load",
      articleId: null,
    });
  });

  it("create=true → 创建新草稿（报告 3.2：article-list 的「新建」入口）", () => {
    expect(resolveWorkspaceInitialAction("?create=true")).toEqual({
      type: "create-new",
    });
  });
});
