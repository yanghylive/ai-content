const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const app = express();
const PORT = process.env.PORT || 3000;
const UPDATES_DIR = path.join(__dirname, 'updates');

// 确保更新目录存在
if (!fs.existsSync(UPDATES_DIR)) {
  fs.mkdirSync(UPDATES_DIR, { recursive: true });
}

// 静态文件服务
app.use('/updates', express.static(UPDATES_DIR));

// 获取最新版本信息
app.get('/api/latest/:platform', (req, res) => {
  const { platform } = req.params;
  const ymlFile = path.join(UPDATES_DIR, `latest-${platform}.yml`);

  if (!fs.existsSync(ymlFile)) {
    return res.status(404).json({ error: 'No updates available' });
  }

  try {
    const content = fs.readFileSync(ymlFile, 'utf8');
    const data = yaml.load(content);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read update info' });
  }
});

// 下载更新包
app.get('/api/download/:platform/:filename', (req, res) => {
  const { platform, filename } = req.params;
  const filePath = path.join(UPDATES_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath);
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 列出所有可用更新
app.get('/api/updates', (req, res) => {
  const files = fs.readdirSync(UPDATES_DIR);
  const ymlFiles = files.filter(f => f.endsWith('.yml'));
  
  const updates = ymlFiles.map(file => {
    const content = fs.readFileSync(path.join(UPDATES_DIR, file), 'utf8');
    const data = yaml.load(content);
    return {
      platform: file.replace('latest-', '').replace('.yml', ''),
      ...data
    };
  });

  res.json(updates);
});

app.listen(PORT, () => {
  console.log(`Update server running on http://localhost:${PORT}`);
  console.log(`Updates directory: ${UPDATES_DIR}`);
});
