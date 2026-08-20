import { FlaskConical } from "lucide-react";

/**
 * 灰度测试标注横幅（2026-08-20 大王指令）：
 * BOSS 直聘 / 企业微信 / 微信桌面 / 视频引擎 / 好单库省钱 等
 * 依赖外部资源暂未开放的功能，在页面顶部贴醒目标注。
 * 样式跟随 kaypal-v3 主题 token，暗/亮色自适应。
 */
export function GrayTestBanner({
  feature,
}: {
  /** 功能名，如「BOSS 直聘」「企业微信」 */
  feature: string;
}) {
  return (
    <div
      role="status"
      aria-label={`${feature}灰度测试中`}
      className="mb-4 flex w-full items-center gap-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] px-4 py-3"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--kaypal-v3-radius-xs)] bg-[var(--kaypal-v3-amber)] text-white">
        <FlaskConical className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--kaypal-v3-amber)]">
          {feature} · 灰度测试中，暂未开放使用
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--kaypal-v3-muted)]">
          该功能正在内部灰度验证，正式开放前暂不可用。如有疑问请联系运营。
        </p>
      </div>
    </div>
  );
}
