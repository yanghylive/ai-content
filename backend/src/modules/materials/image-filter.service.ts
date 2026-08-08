import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ExtractedImage } from './crawlers/jina-reader.service';

// 图片尺寸信息
interface ImageSize {
  width: number;
  height: number;
}

// 图片质量评分结果
interface ScoredImage {
  url: string;
  score: number;
  size?: ImageSize;
}

// 过滤选项
interface FilterOptions {
  maxCount?: number; // 最多返回几张图片，默认 3
  minWidth?: number; // 最小宽度，默认 400
  minHeight?: number; // 最小高度，默认 300
  minArea?: number; // 最小面积，默认 50000 像素
}

/**
 * 图片质量过滤服务
 * 从网页提取的图片中筛选出优质配图
 */
@Injectable()
export class ImageFilterService {
  private readonly logger = new Logger(ImageFilterService.name);

  // URL 路径黑名单（快速过滤低质量图片）
  private readonly BAD_PATTERNS = [
    /avatar/i,
    /profile/i, // 头像
    /emoji/i,
    /sticker/i, // 表情包
    /icon[-._]?/i,
    /logo/i,
    /favicon/i, // 图标
    /button/i,
    /banner/i, // UI 元素
    /ads?[-._]?\d*\./i, // 广告
    /loading/i,
    /spinner/i, // 加载动画
    /placeholder/i, // 占位图
    /qr[-_]?code/i, // 二维码
    /wechat.*\.png/i, // 微信相关图标
    /weibo.*\.png/i, // 微博相关图标
    /\d+x\d+\.(png|jpg|webp)$/i, // 尺寸命名的缩略图（如 100x100.png）
  ];

  /**
   * 从图片列表中筛选出优质图片
   */
  async filterQualityImages(
    images: ExtractedImage[],
    options?: FilterOptions,
  ): Promise<string[]> {
    const {
      maxCount = 3,
      minWidth = 400,
      minHeight = 300,
      minArea = 50000,
    } = options || {};
    const results: ScoredImage[] = [];

    this.logger.log(
      `开始过滤 ${images.length} 张图片，最多保留 ${maxCount} 张`,
    );

    for (const img of images) {
      // 1. URL 黑名单快速过滤
      if (this.isBadUrl(img.url)) {
        this.logger.debug(`黑名单过滤: ${img.url}`);
        continue;
      }

      // 2. 检测图片尺寸
      const size = await this.getImageSize(img.url);
      if (!size) {
        this.logger.debug(`无法获取尺寸: ${img.url}`);
        continue;
      }

      // 3. 尺寸过滤
      if (size.width < minWidth || size.height < minHeight) {
        this.logger.debug(
          `尺寸过小 (${size.width}x${size.height}): ${img.url}`,
        );
        continue;
      }

      // 4. 面积过滤
      const area = size.width * size.height;
      if (area < minArea) {
        this.logger.debug(`面积过小 (${area}): ${img.url}`);
        continue;
      }

      // 5. 宽高比过滤（排除 banner 等）
      const ratio = size.width / size.height;
      if (ratio > 3 || ratio < 0.3) {
        this.logger.debug(`宽高比异常 (${ratio.toFixed(2)}): ${img.url}`);
        continue;
      }

      // 6. 计算质量分数
      const score = this.calculateScore(img, size);
      results.push({ url: img.url, score, size });
    }

    // 按分数排序，返回前 N 张
    const sorted = results.sort((a, b) => b.score - a.score).slice(0, maxCount);

    this.logger.log(
      `过滤完成，从 ${images.length} 张中选出 ${sorted.length} 张优质图片`,
    );

    return sorted.map((r) => r.url);
  }

  /**
   * 判断 URL 是否匹配黑名单
   */
  private isBadUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return this.BAD_PATTERNS.some((p) => p.test(lowerUrl));
  }

  /**
   * 获取图片尺寸（通过下载图片头部）
   */
  private async getImageSize(url: string): Promise<ImageSize | null> {
    try {
      // 只下载前 64KB 来判断尺寸
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { Range: 'bytes=0-65536' },
        timeout: 10000,
        validateStatus: (status) => status === 200 || status === 206,
      });

      const buffer = Buffer.from(response.data);
      const size = this.parseImageSize(buffer);

      if (size) {
        this.logger.debug(`图片尺寸: ${url} -> ${size.width}x${size.height}`);
      }

      return size;
    } catch {
      // 服务器不支持 Range 请求，尝试完整下载
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 10000,
        });
        const buffer = Buffer.from(response.data);
        return this.parseImageSize(buffer);
      } catch {
        return null;
      }
    }
  }

  /**
   * 从 Buffer 中解析图片尺寸（支持 PNG/JPEG/WebP/GIF）
   */
  private parseImageSize(buffer: Buffer): ImageSize | null {
    try {
      // PNG: 前 8 字节是签名，IHDR 在第 8-24 字节
      if (buffer[0] === 0x89 && buffer[1] === 0x50) {
        // PNG 签名
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }

      // JPEG: 需要找 SOF 标记
      if (buffer[0] === 0xff && buffer[1] === 0xd8) {
        let offset = 2;
        while (offset < buffer.length - 4) {
          if (buffer[offset] !== 0xff) break;
          const marker = buffer[offset + 1];
          // SOF0-SOF15 (除了 SOF4, SOF8, SOF12)
          if (
            marker >= 0xc0 &&
            marker <= 0xcf &&
            marker !== 0xc4 &&
            marker !== 0xc8 &&
            marker !== 0xcc
          ) {
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);
            return { width, height };
          }
          // 跳到下一个段
          const segLen = buffer.readUInt16BE(offset + 2);
          offset += segLen + 2;
        }
      }

      // GIF: 前 6 字节是签名，尺寸在 6-10 字节
      if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        // GIF
        const width = buffer.readUInt16LE(6);
        const height = buffer.readUInt16LE(8);
        return { width, height };
      }

      // WebP: RIFF 头 + VP8
      if (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46
      ) {
        // VP8 格式（简单）
        if (buffer.toString('ascii', 8, 12) === 'VP8 ') {
          const width = buffer.readUInt16LE(26) & 0x3fff;
          const height = buffer.readUInt16LE(28) & 0x3fff;
          return { width, height };
        }
        // VP8L 格式（无损）
        if (buffer.toString('ascii', 8, 12) === 'VP8L') {
          const bits = buffer.readUInt32LE(16);
          const width = (bits & 0x3fff) + 1;
          const height = ((bits >> 14) & 0x3fff) + 1;
          return { width, height };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 计算图片质量分数
   */
  private calculateScore(img: ExtractedImage, size: ImageSize): number {
    let score = 100;

    // 尺寸加分（大图优先）
    if (size.width >= 800 && size.height >= 600) {
      score += 20;
    } else if (size.width >= 600 && size.height >= 400) {
      score += 10;
    }

    // 位置加分（靠前的图片更可能是封面）
    if (img.position < 500) {
      score += 15;
    } else if (img.position < 2000) {
      score += 8;
    }

    // 有描述文字加分
    if (img.context && img.context.length > 5) {
      score += 10;
    }

    // 宽高比接近 16:9 或 4:3 加分（常见配图比例）
    const ratio = size.width / size.height;
    if (ratio > 1.5 && ratio < 1.9) {
      // 接近 16:9
      score += 5;
    } else if (ratio > 1.2 && ratio < 1.5) {
      // 接近 4:3
      score += 3;
    }

    return score;
  }
}
