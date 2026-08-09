/**
 * 图片提取功能测试脚本
 */

const TEST_URLS = [
  'https://www.36kr.com/p/2854495873980808',
];

// URL黑名单
const BAD_PATTERNS = [
  /avatar/i, /profile/i, /emoji/i, /icon[-._]?/i, /logo/i, /favicon/i,
  /button/i, /banner/i, /ads?[-._]?\d*\./i, /loading/i, /spinner/i,
  /placeholder/i, /qr[-_]?code/i, /\d+x\d+\.(png|jpg|webp)$/i,
];

function isBadUrl(url) {
  return BAD_PATTERNS.some(p => p.test(url.toLowerCase()));
}

// 解析图片尺寸
function parseImageSize(buffer) {
  try {
    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset < buffer.length - 4) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += buffer.readUInt16BE(offset + 2) + 2;
      }
    }
    return null;
  } catch { return null; }
}

async function testImageExtract(url) {
  console.log(`\n测试 URL: ${url}`);
  
  // 1. 获取Markdown内容
  const encodedUrl = encodeURIComponent(url);
  const response = await fetch(`https://r.jina.ai/${encodedUrl}`, {
    headers: { Accept: 'text/markdown' }
  });
  const markdown = await response.text();
  console.log(`内容长度: ${markdown.length}`);

  // 2. 提取图片
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images = [];
  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    images.push({ alt: match[1], url: match[2], position: match.index });
  }
  console.log(`找到图片: ${images.length} 张`);

  // 3. 过滤和检测尺寸
  const results = [];
  for (const img of images) {
    if (isBadUrl(img.url)) {
      console.log(`[过滤] ${img.url.substring(0, 60)}...`);
      continue;
    }

    try {
      const imgRes = await fetch(img.url);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const size = parseImageSize(buffer);
      
      if (size && size.width >= 400 && size.height >= 300) {
        console.log(`[合格] ${size.width}x${size.height} - ${img.url.substring(0, 50)}...`);
        results.push({ ...img, size });
      } else if (size) {
        console.log(`[太小] ${size.width}x${size.height} - ${img.url.substring(0, 50)}...`);
      } else {
        console.log(`[未知] ${img.url.substring(0, 50)}...`);
      }
    } catch (e) {
      console.log(`[错误] ${img.url.substring(0, 50)}... - ${e.message}`);
    }
  }

  console.log(`\n优质图片: ${results.length} 张`);
  return results;
}

// 运行测试
const url = process.argv[2] || TEST_URLS[0];
testImageExtract(url).catch(console.error);
