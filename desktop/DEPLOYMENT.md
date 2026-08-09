# AI内容创作桌面应用部署指南

本文中的 `your-domain.com` 仅是部署示例占位。商用发布必须替换成真实 HTTPS 域名，并通过 `AI_CONTENT_UPDATE_URL` 显式传入更新 feed；未配置真实地址时发布脚本会阻断，应用也会禁用自动更新。

## 目录

1. [环境准备](#环境准备)
2. [构建应用](#构建应用)
3. [部署更新服务器](#部署更新服务器)
4. [发布新版本](#发布新版本)
5. [监控和维护](#监控和维护)

## 环境准备

### 开发机器

- **操作系统**: macOS / Windows / Linux
- **Node.js**: 22+
- **Python**: 3.12+
- **Git**: 最新版

### 服务器

- **操作系统**: Ubuntu 22.04 LTS (推荐)
- **配置**: 2核4G (最低), 4核8G (推荐)
- **带宽**: 10Mbps+
- **存储**: 50GB+ SSD

### 域名和证书

- 域名: `your-domain.com`
- SSL证书: Let's Encrypt (免费) 或商业证书

## 构建应用

### 1. 克隆代码

```bash
git clone https://github.com/your-org/ai-content.git
cd ai-content
```

### 2. 安装依赖

```bash
# 前端
cd frontend
npm install
npm run build

# 后端
cd ../backend
npm install
npm run build

# Python 服务
cd ../auto-upload
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Electron 应用
cd ../desktop
npm install
```

桌面包只允许从仓库内 `auto-upload/` 打包 Python 服务。当前仓库缺少该目录时，`npm run build:*` 和发布脚本会明确失败；不能从开发者机器外部路径补资源。

### 3. 构建桌面应用

```bash
cd desktop

# 构建所有平台
npm run build:mac
npm run build:win
npm run build:linux

# 或使用发布脚本；必须显式传入真实更新 feed
AI_CONTENT_UPDATE_URL=https://your-domain.com/updates/ ./publish.sh 1.0.0
```

### 4. 测试安装包

**macOS:**
```bash
open dist/AI内容创作-1.0.0.dmg
```

**Windows:**
```bash
# 在 Windows 机器上测试
dist\AI内容创作 Setup 1.0.0.exe
```

**Linux:**
```bash
chmod +x dist/AI内容创作-1.0.0.AppImage
./dist/AI内容创作-1.0.0.AppImage
```

## 部署更新服务器

### 1. 安装 Nginx

```bash
sudo apt update
sudo apt install nginx
```

### 2. 配置 SSL

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 申请证书
sudo certbot --nginx -d your-domain.com
```

### 3. 配置 Nginx

```bash
sudo nano /etc/nginx/sites-available/your-domain.com
```

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # 更新文件
    location /updates/ {
        alias /var/www/updates/;
        autoindex on;
        
        # 安装包缓存 7 天
        location ~* \.(exe|dmg|zip|AppImage|deb)$ {
            expires 7d;
            add_header Cache-Control "public, immutable";
        }
        
        # 更新信息文件缓存 5 分钟
        location ~* \.yml$ {
            expires 5m;
            add_header Cache-Control "public, must-revalidate";
        }
    }

    # API 服务
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 健康检查
    location /health {
        proxy_pass http://localhost:3000;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

### 4. 创建更新目录

```bash
sudo mkdir -p /var/www/updates
sudo chown -R www-data:www-data /var/www/updates
sudo chmod -R 755 /var/www/updates
```

### 5. 部署更新服务器

```bash
cd desktop/update-server
npm install

# 使用 PM2 管理进程
npm install -g pm2
pm2 start server.js --name update-server
pm2 save
pm2 startup
```

### 6. 重启 Nginx

```bash
sudo nginx -t
sudo systemctl restart nginx
```

### 7. 测试

```bash
curl https://your-domain.com/health
curl https://your-domain.com/updates/latest.yml
```

## 发布新版本

### 1. 更新版本号

```bash
cd desktop
npm version patch  # 1.0.0 -> 1.0.1
# 或
npm version minor  # 1.0.0 -> 1.1.0
# 或
npm version major  # 1.0.0 -> 2.0.0
```

### 2. 构建和发布

```bash
AI_CONTENT_UPDATE_URL=https://your-domain.com/updates/ ./publish.sh
```

### 3. 上传到服务器

```bash
# 使用 scp
scp dist/*.yml dist/*.dmg dist/*.exe dist/*.AppImage user@your-domain.com:/var/www/updates/

# 或使用 rsync
rsync -avz dist/*.{yml,dmg,exe,AppImage} user@your-domain.com:/var/www/updates/
```

### 4. 验证发布

```bash
# 检查更新信息
curl https://your-domain.com/updates/latest.yml
curl https://your-domain.com/updates/latest-mac.yml
curl https://your-domain.com/updates/latest-linux.yml

# 下载安装包
curl -O https://your-domain.com/updates/AI内容创作-1.0.1.dmg
```

### 5. 测试自动更新

1. 安装旧版本 (1.0.0)
2. 启动应用
3. 等待 5 秒（自动检查更新）
4. 确认更新提示出现
5. 点击"立即下载"
6. 等待下载完成
7. 点击"立即重启"
8. 验证新版本已安装

## 监控和维护

### 1. 日志查看

```bash
# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# 更新服务器日志
pm2 logs update-server

# 应用日志（用户端）
# macOS: ~/Library/Logs/AI内容创作/main.log
# Windows: %APPDATA%\AI内容创作\logs\main.log
# Linux: ~/.config/AI内容创作/logs/main.log
```

### 2. 性能监控

```bash
# 安装监控工具
sudo apt install htop iotop nethogs

# 查看系统资源
htop

# 查看磁盘 IO
sudo iotop

# 查看网络流量
sudo nethogs
```

### 3. 自动备份

```bash
# 创建备份脚本
cat > /usr/local/bin/backup-updates.sh <<'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/updates"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
tar -czf $BACKUP_DIR/updates_$DATE.tar.gz /var/www/updates/

# 保留最近 30 天的备份
find $BACKUP_DIR -name "updates_*.tar.gz" -mtime +30 -delete
EOF

chmod +x /usr/local/bin/backup-updates.sh

# 添加定时任务
crontab -e
# 每天凌晨 2 点备份
0 2 * * * /usr/local/bin/backup-updates.sh
```

### 4. 安全加固

```bash
# 配置防火墙
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# 禁用 root SSH 登录
sudo nano /etc/ssh/sshd_config
# PermitRootLogin no

# 重启 SSH
sudo systemctl restart ssh
```

### 5. 自动续期 SSL 证书

```bash
# Certbot 会自动添加定时任务
sudo certbot renew --dry-run

# 查看定时任务
sudo systemctl list-timers | grep certbot
```

## 故障排查

### 1. 更新服务器无法访问

```bash
# 检查 Nginx 状态
sudo systemctl status nginx

# 检查端口
sudo netstat -tlnp | grep -E ':(80|443)'

# 检查防火墙
sudo ufw status
```

### 2. 自动更新失败

```bash
# 检查更新信息文件
curl -I https://your-domain.com/updates/latest.yml

# 检查文件权限
ls -la /var/www/updates/

# 检查 Nginx 配置
sudo nginx -t
```

### 3. 下载速度慢

```bash
# 检查带宽
iperf3 -c your-domain.com

# 启用 gzip 压缩
sudo nano /etc/nginx/nginx.conf
# gzip on;
# gzip_types application/octet-stream;

sudo systemctl restart nginx
```

### 4. 磁盘空间不足

```bash
# 查看磁盘使用
df -h

# 清理旧版本
cd /var/www/updates
ls -lh
# 删除旧版本文件（保留最近 3 个版本）

# 清理日志
sudo journalctl --vacuum-time=7d
```

## 扩展部署

### 1. CDN 加速

使用 Cloudflare 或阿里云 CDN：

1. 注册 CDN 服务
2. 添加域名 `your-domain.com`
3. 配置回源地址
4. 更新 DNS 记录

### 2. 多地域部署

```bash
# 在不同地域部署更新服务器
# 北京: bj.your-domain.com
# 上海: sh.your-domain.com
# 广州: gz.your-domain.com

# 使用 DNS 智能解析
# 根据用户 IP 自动选择最近的服务器
```

### 3. 负载均衡

```bash
# 使用 Nginx 负载均衡
upstream update_servers {
    server 192.168.1.10:80;
    server 192.168.1.11:80;
    server 192.168.1.12:80;
}

server {
    location /updates/ {
        proxy_pass http://update_servers;
    }
}
```

## 版本管理策略

### 版本号规范

- **主版本号 (Major)**: 破坏性更新 (1.0.0 → 2.0.0)
- **次版本号 (Minor)**: 新增功能 (1.0.0 → 1.1.0)
- **修订号 (Patch)**: 修复 bug (1.0.0 → 1.0.1)

### 发布频率

- **紧急修复**: 随时发布 (1.0.0 → 1.0.1)
- **功能更新**: 每 2 周一次 (1.0.0 → 1.1.0)
- **大版本**: 每 3-6 个月一次 (1.0.0 → 2.0.0)

### 回滚策略

如果新版本有严重问题：

1. 从更新服务器删除新版本文件
2. 修改 `latest.yml` 指向旧版本
3. 用户重启应用后会自动回退

或者：

1. 发布修复版本（如 1.0.2）
2. 正常发布流程

## 联系支持

- 技术支持: support@your-domain.com
- 问题反馈: https://github.com/your-org/ai-content/issues
- 文档: https://docs.your-domain.com
