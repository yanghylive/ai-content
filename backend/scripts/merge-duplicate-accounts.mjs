// 数据清洗：合并 publish_accounts 中 local-engine 双 id 重复记录
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const dbPath = process.argv[2] || path.join(os.homedir(), 'Library/Application Support/ai-content-desktop/kaypal-ai.sqlite');
const db = new Database(dbPath, { readonly: false });
const rows = db.prepare("SELECT id, platform, config FROM publish_accounts WHERE id LIKE 'local-engine-%'").all();

const newFmt = /^local-engine-[a-f0-9]{16}-(\d+)-(.+)$/;  // 新格式 ownerHash16 前缀
const oldFmt = /^local-engine-(\d+)-(.+)-[a-f0-9]{12}$/;  // 旧格式 ownerKey12 后缀

const byEngine = new Map(); // key: platform|engineAccountId -> {newId?, oldIds: []}
for (const r of rows) {
  let m = newFmt.exec(r.id);
  if (m) {
    const key = `${r.platform}|${m[1]}`;
    if (!byEngine.has(key)) byEngine.set(key, { newId: null, oldIds: [] });
    byEngine.get(key).newId = r.id;
    continue;
  }
  m = oldFmt.exec(r.id);
  if (m) {
    const key = `${r.platform}|${m[1]}`;
    if (!byEngine.has(key)) byEngine.set(key, { newId: null, oldIds: [] });
    byEngine.get(key).oldIds.push(r.id);
  }
}

let merged = 0;
for (const [key, v] of byEngine) {
  if (v.newId && v.oldIds.length) {
    for (const oldId of v.oldIds) {
      db.prepare('DELETE FROM publish_accounts WHERE id = ?').run(oldId);
      merged++;
      console.log(`合并: ${oldId} -> ${v.newId} (${key})`);
    }
  }
}
console.log(`\n完成：合并 ${merged} 条旧格式重复记录`);
db.close();
