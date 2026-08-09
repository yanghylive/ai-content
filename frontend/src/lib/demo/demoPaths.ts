/**
 * Demo 路径识别（供 demo-guard 与 runtime gate 使用）
 *
 * 合规书第五节第 1 条：所有 demo 代码置于 `demo` 目录或 `*.demo.ts(x)`
 */

const DEMO_PATH_HINTS = [
  '/demo/',
  '/demo\\',
  '.demo.ts',
  '.demo.tsx',
  '.demo.js',
  '.demo.jsx',
  '.demo.mjs',
  '.demo.cjs',
];

/**
 * 判断文件路径是否属于演示舱
 */
export function isDemoPath(filePath: string): boolean {
  const normalized = filePath.replace(/[/\\]/g, '/');
  return DEMO_PATH_HINTS.some((hint) => normalized.includes(hint.replace(/[/\\]/g, '/')));
}

/**
 * 演示舱专用 fixture 路径
 */
export function getDemoFixturePath(fixtureName: string): string {
  return `/demo/fixtures/${fixtureName}.json`;
}
