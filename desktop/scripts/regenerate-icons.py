#!/usr/bin/env python3
"""
从 brand-source 源图重新生成全部图标文件
- logo-black-bg.png   → 桌面 icon (icns/ico/png)、登录 logo (webp/png)
- logo-transparent.png → favicon.ico

每次 build 前自动执行，确保图标永久一致。
"""
import os, subprocess
from PIL import Image

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")
SRC_BLACK = os.path.join(ASSETS, "brand-source", "logo-black-bg.png")
SRC_TRANS = os.path.join(ASSETS, "brand-source", "logo-transparent.png")

if not os.path.exists(SRC_BLACK):
    raise SystemExit(f"源图缺失: {SRC_BLACK}")
if not os.path.exists(SRC_TRANS):
    raise SystemExit(f"源图缺失: {SRC_TRANS}")

img_b = Image.open(SRC_BLACK).convert("RGBA")
img_t = Image.open(SRC_TRANS).convert("RGBA")

# icon.png (512)
img_b.resize((512, 512), Image.LANCZOS).save(os.path.join(ASSETS, "icon.png"))

# icon_256.png
img_b.resize((256, 256), Image.LANCZOS).save(os.path.join(ASSETS, "icon_256.png"))

# icon.iconset -> icon.icns
iconset = os.path.join(ASSETS, "icon.iconset")
os.makedirs(iconset, exist_ok=True)
for s in [16, 32, 128, 256, 512]:
    img_b.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}.png"))
    img_b.resize((s*2, s*2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"))
subprocess.run(["iconutil", "-c", "icns", "-o", os.path.join(ASSETS, "icon.icns"), iconset], check=True)

# icon.ico (ImageMagick, 多尺寸)
subprocess.run(["convert", os.path.join(ASSETS, "icon.png"),
    "-define", "icon:auto-resize=256,128,64,48,32,16",
    os.path.join(ASSETS, "icon.ico")], check=True)

# favicon.ico (透明图)
FRONTEND_APP = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src", "app")
subprocess.run(["convert", SRC_TRANS,
    "-resize", "64x64",
    "-define", "icon:auto-resize=64,48,32,16",
    os.path.join(FRONTEND_APP, "favicon.ico")], check=True)

# 前端 brand 图标
BRAND = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "brand")
img_b.resize((512, 512), Image.LANCZOS).save(os.path.join(BRAND, "jiuzhang-ai-icon.png"))
img_b.resize((512, 512), Image.LANCZOS).save(os.path.join(BRAND, "jiuzhang-ai-icon.webp"), format="WEBP", quality=90)
img_b.save(os.path.join(BRAND, "jiuzhang-ai-logo.png"))
img_b.save(os.path.join(BRAND, "jiuzhang-ai-logo.webp"), format="WEBP", quality=92)

print("OK: 全部图标已从 brand-source 重新生成")
