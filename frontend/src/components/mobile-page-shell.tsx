"use client";

/**
 * 通用移动页壳（P1 精修：桌面中心页在移动端包 mx-header 统一视觉）
 * 用法：const isMobile = useIsMobile(); if (isMobile) return <MobilePageShell title desc>{children}</MobilePageShell>;
 */
import React from "react";

export function MobilePageShell({
  title,
  desc,
  action,
  children,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="kx-mobile-ambient">
      <header className="mx-header">
        <div className="mx-header-row">
          <div style={{ minWidth: 0 }}>
            <div className="mx-brand-eyebrow">JIUZHANG AI</div>
            <h1 className="mx-page-title">{title}</h1>
            {desc ? <p className="mx-page-sub">{desc}</p> : null}
          </div>
          {action}
        </div>
      </header>
      <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
        {children}
      </div>
    </div>
  );
}
