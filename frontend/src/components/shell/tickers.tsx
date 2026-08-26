"use client";

import React, { useState } from "react";
import { ShellIcon, type ShellIconName } from "./icons";

/** 无缝横向滚动条：内容渲染两遍 + CSS 位移动画，悬停暂停 */
export function Marquee({
  speed = 46,
  children,
}: {
  speed?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="kx-marquee">
      <div
        className="kx-marquee-track"
        style={{ ["--kx-mq-speed" as string]: `${speed}s` }}
      >
        {children}
        <span aria-hidden="true" style={{ display: "contents" }}>
          {children}
        </span>
      </div>
    </div>
  );
}

export type TickerItem = {
  id: string;
  dot?: "ok" | "warn" | "info" | "blue";
  tag?: { text: string; tint: string };
  text: string;
  src?: string;
  href?: string;
};

/**
 * 静态通知角标：点击展开下拉列表，替代 marquee 滚动。
 * 无通知时显示灰色铃铛；有通知时显示紫色角标 + 数字。
 */
export function Ticker({
  label,
  icon,
  items,
  style,
}: {
  label: string;
  icon: ShellIconName;
  items: TickerItem[];
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const count = items.length;

  return (
    <div className="kx-ticker kx-ticker-static" style={style}>
      <button
        type="button"
        className="kx-ticker-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label} ${count} 条`}
      >
        <ShellIcon name={icon} size={15} />
        <span className="kx-ticker-label-text">{label}</span>
        {count > 0 ? (
          <span className="kx-ticker-badge">{count}</span>
        ) : null}
      </button>
      {open && count > 0 ? (
        <div className="kx-ticker-dropdown" role="list">
          {items.map((item) => {
            const inner = (
              <span className="kx-nt-item" key={item.id}>
                {item.tag ? (
                  <span className={`kx-tag ${item.tag.tint}`}>{item.tag.text}</span>
                ) : item.dot ? (
                  <i className={`kx-dot kx-dot-${item.dot}`} />
                ) : null}
                {item.text}
                {item.src ? <span className="kx-nt-src">{item.src}</span> : null}
              </span>
            );
            return item.href ? (
              <a key={item.id} href={item.href} style={{ textDecoration: "none" }} role="listitem">
                {inner}
              </a>
            ) : (
              <React.Fragment key={item.id}>{inner}</React.Fragment>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
