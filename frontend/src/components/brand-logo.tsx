/**
 * JIUZHANG AI 品牌星形 logo（四角星 sparkle 图形）。
 *
 * 原为 20 个移动端页面在 mx-brand-eyebrow 里重复手写的 <svg>，统一抽成组件。
 * 尺寸由 CSS（mobile.css 的 .mx-brand-eyebrow svg）控制，组件不设 width/height。
 */
export function BrandLogo() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 .304.377l6.001 4.1a.5.5 0 0 1-.29.908l-6.985.49a1 1 0 0 0-.673.42l-3.45 4.8a.5.5 0 0 1-.84 0l-3.45-4.8a1 1 0 0 0-.673-.42l-6.985-.49a.5.5 0 0 1-.29-.908l6.001-4.1a1 1 0 0 0 .304-.377z" />
    </svg>
  );
}
