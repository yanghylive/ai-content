#!/bin/bash

# AI内容创作桌面应用发布脚本
# 用法: ./publish.sh [version]
# 示例: ./publish.sh 1.0.1

set -e

VERSION=${1:-$(node -p "require('./package.json').version")}
UPDATE_SERVER=${AI_CONTENT_UPDATE_URL:-${UPDATE_SERVER:-}}
UPDATE_DIR=${UPDATE_DIR:-"/var/www/updates"}

echo "========================================="
echo "AI内容创作桌面应用发布工具"
echo "========================================="
echo "版本: $VERSION"
echo "更新服务器: $UPDATE_SERVER"
echo "更新目录: $UPDATE_DIR"
echo "========================================="

# 检查版本号
if [ -z "$VERSION" ]; then
  echo "错误: 请提供版本号"
  echo "用法: ./publish.sh [version]"
  exit 1
fi

if [ -z "$UPDATE_SERVER" ]; then
  echo "错误: 请设置真实更新地址，例如："
  echo "AI_CONTENT_UPDATE_URL=https://updates.example.com/updates/ ./publish.sh $VERSION"
  exit 1
fi

if [[ "$UPDATE_SERVER" == *"your-server"* || "$UPDATE_SERVER" == *"your-domain"* ]]; then
  echo "错误: 更新地址仍是占位域名，不能用于商用发布：$UPDATE_SERVER"
  exit 1
fi

export AI_CONTENT_UPDATE_URL="$UPDATE_SERVER"

node scripts/check-update-feed.js

# 更新 package.json 版本号
echo "更新 package.json 版本号为 $VERSION..."
npm version $VERSION --no-git-tag-version

# 构建所有平台
echo ""
echo "构建 macOS 版本..."
npm run build:mac

echo ""
echo "构建 Windows 版本..."
npm run build:win

echo ""
echo "构建 Linux 版本..."
npm run build:linux

# 生成更新信息
echo ""
echo "生成更新信息..."

# macOS
cat > dist/latest-mac.yml <<EOF
version: $VERSION
files:
  - url: AI内容创作-$VERSION.dmg
    sha512: $(shasum -a 512 dist/AI内容创作-$VERSION.dmg | cut -d' ' -f1)
    size: $(stat -f%z dist/AI内容创作-$VERSION.dmg)
path: AI内容创作-$VERSION.dmg
sha512: $(shasum -a 512 dist/AI内容创作-$VERSION.dmg | cut -d' ' -f1)
releaseDate: $(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
EOF

# Windows
cat > dist/latest.yml <<EOF
version: $VERSION
files:
  - url: AI内容创作 Setup $VERSION.exe
    sha512: $(shasum -a 512 "dist/AI内容创作 Setup $VERSION.exe" | cut -d' ' -f1)
    size: $(stat -f%z "dist/AI内容创作 Setup $VERSION.exe")
path: AI内容创作 Setup $VERSION.exe
sha512: $(shasum -a 512 "dist/AI内容创作 Setup $VERSION.exe" | cut -d' ' -f1)
releaseDate: $(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
EOF

# Linux
cat > dist/latest-linux.yml <<EOF
version: $VERSION
files:
  - url: AI内容创作-$VERSION.AppImage
    sha512: $(shasum -a 512 dist/AI内容创作-$VERSION.AppImage | cut -d' ' -f1)
    size: $(stat -f%z dist/AI内容创作-$VERSION.AppImage)
path: AI内容创作-$VERSION.AppImage
sha512: $(shasum -a 512 dist/AI内容创作-$VERSION.AppImage | cut -d' ' -f1)
releaseDate: $(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
EOF

echo "更新信息已生成"

# 上传到服务器
echo ""
echo "上传到更新服务器..."

# 使用 scp 上传（需要配置 SSH 密钥）
# scp dist/*.yml dist/*.dmg dist/*.exe dist/*.AppImage user@updates.example.com:$UPDATE_DIR/

echo ""
echo "========================================="
echo "发布完成!"
echo "========================================="
echo "版本: $VERSION"
echo ""
echo "构建产物:"
ls -lh dist/*.{yml,dmg,exe,AppImage} 2>/dev/null || true
echo ""
echo "下一步:"
echo "1. 将 dist/ 目录中的文件上传到 $UPDATE_SERVER"
echo "2. 确保 latest*.yml 文件可访问"
echo "3. 测试自动更新功能"
echo "========================================="
