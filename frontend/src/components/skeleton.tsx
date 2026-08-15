/**
 * 移动端骨架屏单行（图标占位 + 两行文本占位）。
 *
 * 原为 25+ 个移动端页面重复手写的 <div className="mx-skeleton-row"> 结构，
 * 统一抽成组件。width 控制首行文本宽度（不同页面用 70%/58%/76% 等）。
 */
export function SkeletonRow({ width = "70%" }: { width?: string }) {
  return (
    <div className="mx-skeleton-row">
      <span className="mx-skeleton mx-skeleton-ic" />
      <div style={{ flex: 1 }}>
        <div className="mx-skeleton mx-skeleton-line" style={{ width }} />
        <div
          className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm"
          style={{ marginTop: 7 }}
        />
      </div>
    </div>
  );
}
