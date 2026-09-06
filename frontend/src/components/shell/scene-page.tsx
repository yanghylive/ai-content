"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ShellIcon, type ShellIconName } from "./icons";
import { BrandIcon, type BrandIconName } from "./brand-icons";

export type SceneCard = {
  icon: ShellIconName;
  /** 升格为层一品牌图形时传该字段（无容器面性），否则渲染线性图标 */
  brand?: BrandIconName;
  tint: string;
  title: string;
  desc: string;
  href: string;
  badge?: string;
  /** 分组名(可选);相邻同组卡片自动成组,组头独占一行 */
  group?: string;
};

export function ScenePage({
  title,
  sub,
  hint,
  cards,
  before,
}: {
  title: string;
  sub: string;
  hint?: { icon?: ShellIconName; brand?: BrandIconName; text: string; actionLabel: string; href: string };
  cards: SceneCard[];
  before?: React.ReactNode;
}) {
  const router = useRouter();

  const groups = React.useMemo(() => {
    const out: Array<{ name: string; cards: SceneCard[] }> = [];
    for (const card of cards) {
      const name = card.group || "";
      const last = out[out.length - 1];
      if (last && last.name === name) {
        last.cards.push(card);
      } else {
        out.push({ name, cards: [card] });
      }
    }
    return out;
  }, [cards]);

  const renderCard = (card: SceneCard) => (
    <button
      key={card.title}
      className="kx-agg-card"
      onClick={() => router.push(card.href)}
    >
      {card.brand ? (
        <div className="kx-agg-ico kx-agg-ico-bare" aria-hidden="true">
          <BrandIcon name={card.brand} size={32} tone="gold" />
        </div>
      ) : (
        <div className={`kx-agg-ico ${card.tint}`}>
          <ShellIcon name={card.icon} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="kx-agg-title">{card.title}</div>
        <div className="kx-agg-desc">{card.desc}</div>
      </div>
      {card.badge ? <span className="kx-agg-badge">{card.badge}</span> : null}
    </button>
  );

  return (
    <div className="kx-view">
      <h1 className="kx-greet">{title}</h1>
      <p className="kx-greet-sub">{sub}</p>

      {before}

      {hint ? (
        <div className="kx-hint-bar">
          {hint.brand ? (
            <BrandIcon name={hint.brand} size={18} />
          ) : hint.icon ? (
            <ShellIcon name={hint.icon} />
          ) : null}
          {hint.text}
          <button className="kx-hint-act" onClick={() => router.push(hint.href)}>
            {hint.actionLabel} →
          </button>
        </div>
      ) : null}

      {groups.map((g, gi) => (
        <div key={g.name || gi}>
          {g.name ? (
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--kx-muted)",
                margin: gi === 0 ? "2px 0 8px" : "18px 0 8px",
                letterSpacing: "0.02em",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {g.name}
              <span style={{ flex: 1, height: 1, background: "var(--kx-border, rgba(120,148,179,.18))" }} />
            </div>
          ) : null}
          <div className="kx-agg-grid">{g.cards.map(renderCard)}</div>
        </div>
      ))}
    </div>
  );
}
