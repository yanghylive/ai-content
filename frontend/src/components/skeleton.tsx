/**
 * 全站通用骨架屏组件。
 *
 * 用法：
 * - 单行文本：<SkeletonLine width="60%" />
 * - 多行文本：<SkeletonText lines={3} />
 * - 圆形头像：<SkeletonCircle size={40} />
 * - 卡片：<SkeletonCard />
 * - 列表行：<SkeletonRow width="70%" />（保持移动端兼容）
 * - 完整列表：<SkeletonList rows={5} />
 */

export function SkeletonLine({
  width = "100%",
  className = "",
}: {
  width?: string | number;
  className?: string;
}) {
  const w = typeof width === "number" ? `${width}px` : width;
  return (
    <div
      className={`kx-skeleton kx-skeleton-line ${className}`}
      style={{ width: w }}
    />
  );
}

export function SkeletonText({
  lines = 3,
  widths = ["100%", "80%", "60%"],
}: {
  lines?: number;
  widths?: string[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine
          key={i}
          width={widths[i % widths.length]}
          className={i === lines - 1 ? "kx-skeleton-line-sm" : ""}
        />
      ))}
    </div>
  );
}

export function SkeletonCircle({ size = 40 }: { size?: number }) {
  return (
    <div
      className="kx-skeleton kx-skeleton-circle"
      style={{ width: size, height: size }}
    />
  );
}

export function SkeletonCard({
  height = 120,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={`kx-skeleton kx-skeleton-card ${className}`}
      style={{ height }}
    />
  );
}

export function SkeletonList({
  rows = 5,
  showIcon = true,
  width = "70%",
}: {
  rows?: number;
  showIcon?: boolean;
  width?: string;
}) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="kx-skeleton-row">
          {showIcon && <SkeletonCircle size={36} />}
          <div style={{ flex: 1 }}>
            <SkeletonLine width={width} />
            <div style={{ height: 8 }} />
            <SkeletonLine width="40%" className="kx-skeleton-line-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 移动端骨架屏单行（图标占位 + 两行文本占位）。
 * 保持向后兼容。
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

export default SkeletonList;
