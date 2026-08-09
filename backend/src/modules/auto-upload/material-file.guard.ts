/**
 * 素材文件上传安全校验（P0 公网加固）
 *
 * 校验规则（双保险）：
 * 1. MIME 白名单：image/*、video/*（浏览器上报，可伪造 → 只作第一道）
 * 2. 扩展名白名单：图片/视频常见后缀（第二道；兼容服务端内部导入——
 *    成片导入的伪造文件 mimetype 为 application/octet-stream，靠扩展名通过）
 * 3. 大小上限：50MB（防磁盘耗尽）
 *
 * 两个白名单任一命中即放行（正常上传 MIME 命中；内部导入扩展名命中）。
 * 恶意文件（text/php 等）两者均不命中 → 拒绝。
 */
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

/** 允许的 MIME 前缀（图片/视频/音频） */
const ALLOWED_MIME = /^(image|video|audio)\//i;

/** 允许的文件扩展名（图片 + 视频 + 音频常见格式，兼容服务端内部导入） */
const ALLOWED_EXT =
  /\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|avi|mkv|mp3|wav|m4a|aac|ogg|flac)$/i;

/** 单文件大小上限：50MB */
export const MAX_MATERIAL_SIZE = 50 * 1024 * 1024;

export interface MaterialFileLike {
  mimetype?: string;
  originalname?: string;
  size?: number;
  buffer?: Buffer;
}

/** 文件是否通过 MIME/扩展名白名单 */
export function isAllowedMaterialFile(file: MaterialFileLike): boolean {
  const mime = String(file.mimetype ?? '');
  const name = String(file.originalname ?? '');
  return ALLOWED_MIME.test(mime) || ALLOWED_EXT.test(name);
}

/** 校验文件大小（不抛返回 false） */
export function isWithinMaterialSizeLimit(file: MaterialFileLike): boolean {
  const size = file.size ?? file.buffer?.byteLength ?? 0;
  return size <= MAX_MATERIAL_SIZE;
}

/** 强校验：不通过抛 BadRequestException / PayloadTooLargeException */
export function assertMaterialFileSafe(file: MaterialFileLike): void {
  if (!isWithinMaterialSizeLimit(file)) {
    throw new PayloadTooLargeException('文件过大（上限 50MB）');
  }
  if (!isAllowedMaterialFile(file)) {
    throw new BadRequestException('仅支持图片/视频文件');
  }
}
