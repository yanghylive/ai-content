"use client";

import React from "react";
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
        {/* 无缝滚动副本：纯视觉占位，aria-hidden 防读屏重复播报。
            display:contents 让副本不参与 flex 布局，保持与第一遍完全一致的
            视觉/动画，同时不改变移动端 .kx-marquee-track > :not(:first-child)
            的扁平子元素选择语义。 */}
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

export function Ticker({
  label,
  icon,
  items,
  speed = 46,
  labelColor,
  style,
}: {
  label: string;
  icon: ShellIconName;
  items: TickerItem[];
  speed?: number;
  labelColor?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="kx-ticker" style={style}>
      <span className="kx-ticker-label" style={labelColor ? { color: labelColor } : undefined}>
        <ShellIcon name={icon} size={15} />
        {label}
      </span>
      <Marquee speed={speed}>
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
            <a key={item.id} href={item.href} style={{ textDecoration: "none" }}>
              {inner}
            </a>
          ) : (
            <React.Fragment key={item.id}>{inner}</React.Fragment>
          );
        })}
      </Marquee>
    </div>
  );
}
