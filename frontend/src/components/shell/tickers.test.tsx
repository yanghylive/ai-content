import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Marquee } from "./tickers";

describe("Marquee 无缝滚动副本", () => {
  it("渲染两遍内容，第二遍（副本）带 aria-hidden 防读屏重复播报", () => {
    render(
      <Marquee>
        <span>测试内容</span>
      </Marquee>,
    );

    const items = screen.getAllByText("测试内容");
    // 原版 + 副本共两遍
    expect(items).toHaveLength(2);
    // 第一遍（原版）不被 aria-hidden 包裹
    expect(items[0].closest('[aria-hidden="true"]')).toBeNull();
    // 第二遍（副本）被 aria-hidden 包裹
    expect(items[1].closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it("副本用 display:contents，不额外生成可见盒子", () => {
    const { container } = render(
      <Marquee>
        <span>内容</span>
      </Marquee>,
    );
    const clone = container.querySelector('[aria-hidden="true"]');
    expect(clone).toBeTruthy();
    expect((clone as HTMLElement).style.display).toBe("contents");
  });
});
