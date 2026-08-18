import DOMPurify from "dompurify";

/**
 * 外部站点 HTML 白名单净化（防存储型 XSS，2026-08-18 S1 安全修复）。
 * article.content 来自第三方站点原始 HTML，不得未经净化直接渲染。
 * DOMPurify 默认已剥离 script/style/iframe/事件属性，此处再加白名单收窄。
 */
export function sanitizeArticleHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
      "strong", "b", "em", "i", "u", "s", "mark", "small",
      "a", "img", "figure", "figcaption",
      "ul", "ol", "li", "dl", "dt", "dd",
      "blockquote", "pre", "code",
      "table", "thead", "tbody", "tr", "th", "td",
      "span", "div", "sub", "sup",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel", "src", "alt", "width", "height"],
    ALLOW_DATA_ATTR: false,
  });
}
