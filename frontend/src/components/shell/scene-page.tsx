"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ShellIcon, type ShellIconName } from "./icons";

export type SceneCard = {
  icon: ShellIconName;
  tint: string;
  title: string;
  desc: string;
  href: string;
  badge?: string;
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
  hint?: { icon: ShellIconName; text: string; actionLabel: string; href: string };
  cards: SceneCard[];
  before?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="kx-view">
      <h1 className="kx-greet">{title}</h1>
      <p className="kx-greet-sub">{sub}</p>

      {before}

      {hint ? (
        <div className="kx-hint-bar">
          <ShellIcon name={hint.icon} />
          {hint.text}
          <button className="kx-hint-act" onClick={() => router.push(hint.href)}>
            {hint.actionLabel} →
          </button>
        </div>
      ) : null}

      <div className="kx-agg-grid">
        {cards.map((card) => (
          <button
            key={card.title}
            className="kx-agg-card"
            onClick={() => router.push(card.href)}
          >
            <div className={`kx-agg-ico ${card.tint}`}>
              <ShellIcon name={card.icon} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="kx-agg-title">{card.title}</div>
              <div className="kx-agg-desc">{card.desc}</div>
            </div>
            {card.badge ? <span className="kx-agg-badge">{card.badge}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
