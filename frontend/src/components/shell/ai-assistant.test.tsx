import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { markdownComponents } from "./ai-assistant";

/**
 * S7 安全修复验证（2026-08-18）：
 * ai-assistant 消息渲染改用 react-markdown 后，原始 HTML 必须当纯文本处理，
 * 不得产生可执行元素（img onerror / script / iframe 等），同时 markdown
 * 语义（加粗/列表/链接）与换行行为保持。
 */
describe("AiAssistant markdown 渲染（S7 XSS 防护）", () => {
  const renderMd = (text: string) =>
    render(
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>,
    );

  it("恶意 HTML 按纯文本输出，不产生可执行元素", () => {
    const dirty = `<img src=x onerror="alert(1)"> <script>alert(2)</script> <iframe src="https://evil"></iframe>`;
    const { container } = renderMd(dirty);

    // 不产生 img/script/iframe 元素
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    // 原始 HTML 以文本形式可见（用户看到字面量，而非执行）
    expect(container.textContent).toContain("<img src=x onerror");
    expect(container.textContent).toContain("<script>");
  });

  it("markdown 语义正常（加粗/斜体/列表/标题）", () => {
    const { container } = renderMd(
      "**加粗** 与 *斜体*\n\n- 列表项一\n- 列表项二\n\n## 小标题",
    );
    expect(container.querySelector("strong")?.textContent).toBe("加粗");
    expect(container.querySelector("em")?.textContent).toBe("斜体");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("h2")?.textContent).toBe("小标题");
  });

  it("换行渲染为 <br>（remark-breaks 保持原行为）", () => {
    const { container } = renderMd("第一行\n第二行");
    expect(container.querySelector("br")).not.toBeNull();
    expect(container.textContent).toContain("第一行");
    expect(container.textContent).toContain("第二行");
  });

  it("链接安全属性 target=_blank + rel=noopener noreferrer", () => {
    const { container } = renderMd("[点我](https://example.com)");
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toContain("noopener");
    expect(a?.getAttribute("rel")).toContain("noreferrer");
  });

  it("javascript: 伪协议链接被过滤", () => {
    const { container } = renderMd("[坏链接](javascript:alert(1))");
    const a = container.querySelector("a");
    // react-markdown 对 javascript: 链接默认不渲染 href（或渲染安全 href）
    expect(a?.getAttribute("href") || "").not.toContain("javascript:");
  });
});
