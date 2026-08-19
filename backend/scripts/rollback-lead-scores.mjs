// 回滚 lead.score：从四维 totalScore 恢复为重算前的裸分（印象分）。
// 四维快照（lead_score_snapshots）与信号（lead_signals）保留，不删除。
import { execSync } from 'node:child_process';

const DB = `${process.env.HOME}/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite`;
const run = (sql) =>
  execSync(`sqlite3 "${DB}" "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();

// 按 created_at 升序的完整 id → 重算前裸分（from 重算脚本输出）
const restore = [
  ['lead-1785359776323-76a3db', 45],
  ['lead-1785360760829-a413d6', 45],
  ['lead-1785394039749-3cf9ef', 45],
  ['lead-1786432768801-b17085', 74],
  ['lead-1786432768801-434ced', 68],
  ['lead-1786432768801-b87bae', 68],
  ['lead-1786432768801-12e549', 68],
  ['lead-1786432768801-978790', 73],
  ['lead-1786432768801-7c8fb3', 68],
  ['lead-1786432768801-dd572e', 74],
  ['lead-1786432768801-379ea9', 68],
  ['lead-1786432768801-424531', 68],
  ['lead-1786432768801-b27fc3', 73],
  ['lead-1786432768801-75a7eb', 68],
  ['lead-1786432768801-1faaab', 68],
  ['lead-1786432768801-cd1f4f', 68],
  ['lead-1786432768801-1d5a5b', 68],
  ['lead-1786485101923-9ab2f8', 74],
  ['lead-1786485101923-a43523', 68],
  ['lead-1786485101923-69a6e2', 73],
  ['lead-1786485101923-e37eb6', 68],
  ['lead-1786485101923-65f959', 68],
  ['lead-1787022881256-af3c2e', 45],
  ['lead-1787022881313-8569c3', 70],
  ['lead-1787023396860-92b56a', 59],
];

run('BEGIN;');
for (const [id, score] of restore) {
  run(`UPDATE leads SET score=${score} WHERE id='${id}';`);
}
run('COMMIT;');

console.log(`✅ 已恢复 ${restore.length} 条线索的裸分`);
const summary = run(
  "SELECT source_type, MIN(score), MAX(score), ROUND(AVG(score),1), count(*) FROM leads GROUP BY source_type;",
);
console.log('恢复后分布（source_type | min | max | avg | count）:');
console.log(summary);
