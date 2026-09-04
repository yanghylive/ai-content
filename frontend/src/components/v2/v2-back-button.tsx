"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "@/components/iconpark";

/**
 * 全站唯一「返回上一层」按钮（2026-09-04 重做视觉，规格见 shell.css `.kx-back`）。
 * 形态：圆形图标 chip + 文字胶囊，放在页头标题上方；hover 染主色、箭头左移。
 *
 * 桌面端显隐规则：
 * - 传了 `to` 或 `onClick`（页面显式声明父级）→ 视为功能子页，显示。
 * - 裸 `<V2BackButton />`（只能 router.back()）→ 视为左侧 rail 顶级页，隐藏，
 *   避免「顶级页出现无意义返回」的噪声（2026-09-01 一刀切隐藏的精修版）。
 * - 需要强制显示时传 `show`。移动端一律显示。
 *
 * 所有页面禁止自写 ArrowLeft + router.push 拼装返回，一律用本组件。
 */
export function V2BackButton({
  label = "返回",
  to,
  onClick,
  show = false,
  inline = false,
}: {
  label?: string;
  to?: string;
  onClick?: () => void;
  /** 覆盖「无父级即隐藏」的判断，强制在桌面端显示 */
  show?: boolean;
  /** 与标题同行（面板头部/工具栏/页底操作栏）：取消页头专用间距 */
  inline?: boolean;
}) {
  const router = useRouter();
  const visibleOnDesktop = show || Boolean(to) || Boolean(onClick);
  return (
    <button
      type="button"
      aria-label={label}
      className={`kx-back${inline ? " kx-back--inline" : ""} v2-back-btn${visibleOnDesktop ? " v2-back-btn--show" : ""}`}
      onClick={() => {
        if (onClick) {
          onClick();
          return;
        }
        if (to) {
          router.push(to);
          return;
        }
        router.back();
      }}
    >
      <span className="kx-back-chip" aria-hidden="true">
        <ArrowLeft size={15} strokeWidth={2.4} />
      </span>
      {label}
    </button>
  );
}
