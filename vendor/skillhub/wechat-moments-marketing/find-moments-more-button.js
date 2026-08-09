#!/usr/bin/env node

const sharp = require('/Users/yanghy/Documents/New project/ai-content/backend/node_modules/sharp');

async function main() {
  const [, , screenshotPath, windowXArg, windowYArg, windowWArg, windowHArg, browseIndexArg] =
    process.argv;
  if (!screenshotPath) {
    throw new Error('Usage: find-moments-more-button.js screenshot x y w h browseIndex');
  }
  const windowX = Number(windowXArg || 0);
  const windowY = Number(windowYArg || 0);
  const windowW = Number(windowWArg || 0);
  const windowH = Number(windowHArg || 0);
  const browseIndex = Math.max(1, Math.min(100, Number(browseIndexArg || 1) || 1));
  if (![windowX, windowY, windowW, windowH].every(Number.isFinite) || windowW <= 0 || windowH <= 0) {
    throw new Error('Invalid window bounds');
  }

  const image = sharp(screenshotPath);
  const metadata = await image.metadata();
  const scaleX = metadata.width / 1512;
  const scaleY = metadata.height / 982;
  const left = Math.max(0, Math.round(windowX * scaleX));
  const top = Math.max(0, Math.round(windowY * scaleY));
  const width = Math.min(metadata.width - left, Math.round(windowW * scaleX));
  const height = Math.min(metadata.height - top, Math.round(windowH * scaleY));
  const { data: crop, info } = await image
    .extract({ left, top, width, height })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;

  const isDotPixel = (r, g, b) =>
    r >= 55 &&
    r <= 150 &&
    g >= 65 &&
    g <= 165 &&
    b >= 85 &&
    b <= 200 &&
    b >= r + 8 &&
    Math.abs(g - r) <= 35;

  const minX = Math.floor(width * 0.72);
  const maxX = Math.floor(width * 0.99);
  const minY = Math.floor(height * 0.18);
  const maxY = Math.floor(height * 0.99);
  const mask = new Uint8Array(width * height);
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const idx = (y * width + x) * channels;
      const r = crop[idx];
      const g = crop[idx + 1];
      const b = crop[idx + 2];
      if (isDotPixel(r, g, b)) {
        mask[y * width + x] = 1;
      }
    }
  }

  const seen = new Uint8Array(width * height);
  const components = [];
  const stack = [];
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const start = y * width + x;
      if (!mask[start] || seen[start]) continue;
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      let minCx = x;
      let maxCx = x;
      let minCy = y;
      let maxCy = y;
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const current = stack.pop();
        const cx = current % width;
        const cy = Math.floor(current / width);
        count += 1;
        sumX += cx;
        sumY += cy;
        minCx = Math.min(minCx, cx);
        maxCx = Math.max(maxCx, cx);
        minCy = Math.min(minCy, cy);
        maxCy = Math.max(maxCy, cy);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < minX || nx >= maxX || ny < minY || ny >= maxY) continue;
            const next = ny * width + nx;
            if (mask[next] && !seen[next]) {
              seen[next] = 1;
              stack.push(next);
            }
          }
        }
      }
      const cw = maxCx - minCx + 1;
      const ch = maxCy - minCy + 1;
      if (count >= 20 && count <= 260 && cw >= 3 && cw <= 22 && ch >= 3 && ch <= 22) {
        components.push({
          count,
          x: sumX / count / scaleX,
          y: sumY / count / scaleY,
          minX: minCx / scaleX,
          maxX: maxCx / scaleX,
          minY: minCy / scaleY,
          maxY: maxCy / scaleY,
        });
      }
    }
  }

  const pairs = [];
  for (const leftDot of components) {
    for (const rightDot of components) {
      if (rightDot.x <= leftDot.x) continue;
      const dx = rightDot.x - leftDot.x;
      const dy = Math.abs(rightDot.y - leftDot.y);
      if (dx >= 5 && dx <= 14 && dy <= 3) {
        pairs.push({
          x: (leftDot.x + rightDot.x) / 2,
          y: (leftDot.y + rightDot.y) / 2,
          score: leftDot.count + rightDot.count - dy * 3 - Math.abs(dx - 8),
        });
      }
    }
  }

  const unique = [];
  for (const pair of pairs.sort((a, b) => a.y - b.y || b.score - a.score)) {
    if (unique.some((item) => Math.abs(item.y - pair.y) < 18)) continue;
    unique.push(pair);
  }
  if (!unique.length) {
    throw new Error('No moments more button found');
  }
  const selected = unique[Math.min(browseIndex - 1, unique.length - 1)];
  process.stdout.write(
    JSON.stringify({
      x: Math.round(selected.x),
      y: Math.round(selected.y),
      candidates: unique.map((item) => ({
        x: Math.round(item.x),
        y: Math.round(item.y),
        score: Math.round(item.score),
      })),
    }),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
