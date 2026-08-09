#!/usr/bin/env node

const sharp = require('/Users/yanghy/Documents/New project/ai-content/backend/node_modules/sharp');

async function main() {
  const [, , screenshotPath, windowXArg, windowYArg, windowWArg, windowHArg, expectedXArg, expectedYArg] =
    process.argv;
  if (!screenshotPath) {
    throw new Error('Usage: find-moments-send-button.js screenshot x y w h [expectedX expectedY]');
  }
  const windowX = Number(windowXArg || 0);
  const windowY = Number(windowYArg || 0);
  const windowW = Number(windowWArg || 0);
  const windowH = Number(windowHArg || 0);
  const expectedX = Number(expectedXArg || NaN);
  const expectedY = Number(expectedYArg || NaN);
  const hasExpectedPosition = Number.isFinite(expectedX) && Number.isFinite(expectedY) && expectedX > 0 && expectedY > 0;
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

  const isSendGreen = (r, g, b) =>
    g >= 120 &&
    g <= 230 &&
    r >= 0 &&
    r <= 130 &&
    b >= 55 &&
    b <= 170 &&
    g >= r + 40 &&
    g >= b + 10;

  const minX = Math.floor(width * 0.45);
  const maxX = Math.floor(width * 0.98);
  const minY = Math.floor(height * 0.35);
  const maxY = Math.floor(height * 0.9);
  const mask = new Uint8Array(width * height);
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const idx = (y * width + x) * channels;
      if (isSendGreen(crop[idx], crop[idx + 1], crop[idx + 2])) {
        mask[y * width + x] = 1;
      }
    }
  }

  const seen = new Uint8Array(width * height);
  const stack = [];
  const components = [];
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
      if (count >= 100 && cw >= 40 && ch >= 18) {
        const centerX = sumX / count / scaleX;
        const centerY = sumY / count / scaleY;
        const logicalWidth = cw / scaleX;
        const logicalHeight = ch / scaleY;
        if (
          hasExpectedPosition &&
          (Math.abs(centerX - expectedX) > 70 ||
            Math.abs(centerY - expectedY) > 80 ||
            logicalWidth < 35 ||
            logicalWidth > 140 ||
            logicalHeight < 16 ||
            logicalHeight > 80)
        ) {
          continue;
        }
        components.push({
          count,
          x: centerX,
          y: centerY,
          minX: minCx / scaleX,
          maxX: maxCx / scaleX,
          minY: minCy / scaleY,
          maxY: maxCy / scaleY,
        });
      }
    }
  }
  if (!components.length) {
    throw new Error('No moments send button found');
  }
  components.sort((a, b) => b.count - a.count);
  const selected = components[0];
  process.stdout.write(
    JSON.stringify({
      x: Math.round(selected.x),
      y: Math.round(selected.y),
      candidates: components.slice(0, 5).map((item) => ({
        x: Math.round(item.x),
        y: Math.round(item.y),
        count: item.count,
      })),
    }),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
