"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * P0 规范层 · 全局动画偏好（对应 PRD 验收 check 7）
 *
 * 尊重系统「减少动态效果」（prefers-reduced-motion）：用户开启后，
 * 所有 framer-motion 动画自动降级为无动画，避免眩晕/干扰。
 * 需在 app root layout 挂载一次（下一步集成）。
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
