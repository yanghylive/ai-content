import { describe, it, expect } from "vitest";
import { sanitizeArticleHtml } from "./sanitize-article-html";

describe("sanitizeArticleHtml（S1 存储型 XSS 防护）", () => {
  it("剥除 script / 事件属性 / iframe / svg / 危险协议", () => {
    const dirty =
      `<p>正文段落</p>` +
      `<script>alert(1)</script>` +
      `<img src="https://evil/x.png" onerror="alert(2)">` +
      `<iframe src="https://evil.com"></iframe>` +
      `<a href="javascript:alert(3)">点我</a>` +
      `<svg onload="alert(4)"></svg>` +
      `<div onclick="alert(5)">div</div>`;

    const clean = sanitizeArticleHtml(dirty);

    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<svg");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("正文段落");
    expect(clean).toContain("<p>");
  });

  it("保留白名单内的合法内容与属性", () => {
    const clean = sanitizeArticleHtml(
      `<h2>标题</h2><p><strong>加粗</strong> 与 <em>斜体</em></p>` +
        `<a href="https://example.com/article" target="_blank">链接</a>` +
        `<img src="https://cdn.example.com/cover.png" alt="封面" width="800">` +
        `<ul><li>列表项</li></ul>`,
    );

    expect(clean).toContain("<h2>");
    expect(clean).toContain("<strong>");
    expect(clean).toContain("<em>");
    expect(clean).toContain('href="https://example.com/article"');
    expect(clean).toContain("<img");
    expect(clean).toContain("<ul>");
    expect(clean).toContain("<li>");
  });

  it("剥除 data 属性与 style 属性（白名单外）", () => {
    const clean = sanitizeArticleHtml(
      `<div data-custom="x" style="position:fixed;top:0">内容</div>` +
        `<span class="keep">span</span>`,
    );

    expect(clean).not.toContain("data-custom");
    expect(clean).not.toContain("style=");
    expect(clean).not.toContain("position:fixed");
    // class 不在 ALLOWED_ATTR 中，应被剥除；span 文本保留
    expect(clean).toContain("span");
    expect(clean).toContain("内容");
  });

  it("容忍被截断的 HTML（预览切片场景）", () => {
    const truncated = `<p>开头段落<img src="https://cdn/x.png" al`;
    const clean = sanitizeArticleHtml(truncated);
    // 不抛异常，且不包含未闭合的危险内容
    expect(typeof clean).toBe("string");
    expect(clean).not.toContain("<script");
  });
});
