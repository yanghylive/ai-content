// OSS 错误报告只读检查工具（每日自动化复用）
// 用法:
//   node scripts/oss-error-report-scan.cjs dirs            # 列出所有日期目录统计
//   node scripts/oss-error-report-scan.cjs list YYYY-MM-DD # 列出某日期目录对象
//   node scripts/oss-error-report-scan.cjs get key [key...] # 下载并打印报告内容
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');

const desktopDir = '/Users/yanghy/Documents/New project/ai-content/desktop';
const requireFromDesktop = createRequire(path.join(desktopDir, 'noop.js'));
const OSS = requireFromDesktop('ali-oss');

const envPath = path.join(desktopDir, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const client = new OSS({
  region: env.OSS_REGION,
  accessKeyId: env.OSS_ACCESS_KEY_ID,
  accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
  bucket: env.OSS_BUCKET,
});

async function listAll(prefix) {
  let marker = null;
  const objects = [];
  do {
    const result = await client.list({ prefix, marker, 'max-keys': 1000 });
    objects.push(...result.objects || []);
    marker = result.nextMarker || null;
  } while (marker);
  return objects;
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'dirs') {
    const objects = await listAll('error-reports/');
    const dirs = {};
    for (const o of objects) {
      const m = o.name.match(/^error-reports\/([^/]+)\//);
      if (!m) continue;
      const d = m[1];
      if (!dirs[d]) dirs[d] = { count: 0, latest: 0, latestName: '' };
      dirs[d].count++;
      const t = new Date(o.lastModified).getTime();
      if (t > dirs[d].latest) { dirs[d].latest = t; dirs[d].latestName = o.name; }
    }
    for (const d of Object.keys(dirs).sort()) {
      const i = dirs[d];
      console.log(d + '\tcount=' + i.count + '\tlatest=' + new Date(i.latest).toISOString() + '\t' + i.latestName);
    }
  } else if (cmd === 'list') {
    const prefix = 'error-reports/' + process.argv[3] + '/';
    const objects = await listAll(prefix);
    objects.sort((a, b) => (a.name < b.name ? -1 : 1));
    console.log('count=' + objects.length);
    for (const o of objects) console.log(o.name + '\t' + o.size);
  } else if (cmd === 'get') {
    for (const key of process.argv.slice(3)) {
      try {
        const r = await client.get(key);
        console.log('=== ' + key + ' ===');
        console.log(r.content.toString('utf8'));
      } catch (e) { console.log('=== ' + key + ' GET ERR: ' + e.message); }
    }
  } else {
    console.log('usage: dirs | list YYYY-MM-DD | get key...');
  }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
