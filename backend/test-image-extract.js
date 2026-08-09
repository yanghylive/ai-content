/**
 * 图片提取功能测试脚本
 * 测试 Jina Reader 和 ImageFilter 的图片提取能力
 */

const axios = require('axios');

const BACKEND_URL = 'http://localhost:3001/api';

// 测试用的文章URL（有图片的文章）
const TEST_URLS = [
  'https://www.36kr.com/p/2854495873980808',  // 36氪文章
  'https://www.jiqizhixin.com/articles/2024-01-15',  // 机器之心
];

async function testJinaReaderExtractImages() {
  console.log('\n=== 测试 Jina Reader 图片提取 ===\n');

  for (const url of TEST_URLS) {
    try {
      console.log(`测试 URL: ${url}`);

      // 调用 Jina Reader API 直接测试
      const encodedUrl = encodeURIComponent(url);
      const response = await axios.get(`https://r.jina.ai/${encodedUrl}`, {
        headers: { Accept: 'text/markdown' },
        timeout: 30000,
      });

      const markdown = response.data || '';
      console.log(`  - 内容长度: ${markdown.length}`);

      // 提取图片
      const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      const images = [];
      let match;
      while ((match = imageRegex.exec(markdown)) !== null) {
        images.push({
          alt: match[1],
          url: match[2],
        });
      }

      console.log(`  - 找到图片: ${images.length} 张`);
      images.slice(0, 3).forEach((img, i) => {
        console.log(`    ${i + 1}. ${img.url.substring(0, 80)}...`);
      });

    } catch (error) {
      console.log(`  - 错误: ${error.message}`);
    }
    console.log('');
  }
}

async function testImageSizeDetection() {
  console.log('\n=== 测试图片尺寸检测 ===\n');

  const testImages = [
    'https://img.36krcdn.com/hsossms/20241223/v2_7f8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e_1920x1080.png',
    'https://pic4.zhimg.com/v2-abc123_720w.jpg',
    'https://www.google.com/favicon.ico',  // 小图标，应该被过滤
  ];

  for (const url of testImages) {
    try {
      console.log(`测试图片: ${url.substring(0, 60)}...`);

      // 只请求前 64KB
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { Range: 'bytes=0-65536' },
        timeout: 10000,
        validateStatus: (status) => status === 200 || status === 206,
      });

      const buffer = Buffer.from(response.data);
      const size = parseImageSize(buffer);

      if (size) {
        console.log(`  - 尺寸: ${size.width}x${size.height}`);
      } else {
        console.log(`  - 无法解析尺寸`);
      }

    } catch (error) {
      console.log(`  - 错误: ${error.message}`);
    }
  }
}

// 简单的图片尺寸解析
function parseImageSize(buffer) {
  try {
    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }
    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset < buffer.length - 4) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          };
        }
        const segLen = buffer.readUInt16BE(offset + 2);
        offset += segLen + 2;
      }
    }
    // GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return {
        width: buffer.readUInt16LE(6),
        height: buffer.readUInt16LE(8),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('图片采集功能测试');
  console.log('='.repeat(60));

  await testJinaReaderExtractImages();
  await testImageSizeDetection();

  console.log('\n测试完成！');
}

main().catch(console.error);