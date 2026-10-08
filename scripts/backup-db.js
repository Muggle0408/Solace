// 每日数据库备份：node scripts/backup-db.js（由 cron 每日 04:00 触发）
// 使用 better-sqlite3 在线备份 API（WAL 安全热备），保留最近 30 天
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'solace.db');
const backupDir = path.join(__dirname, '..', 'backup');
const KEEP_DAYS = 30;

(async () => {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(backupDir, `solace-${stamp}.sqlite`);

  const db = new Database(dbPath);
  await db.backup(target);
  db.close();

  // 反馈 JSONL 一并拷贝
  const fb = path.join(__dirname, '..', 'data', 'feedback.jsonl');
  if (fs.existsSync(fb)) {
    fs.copyFileSync(fb, path.join(backupDir, `feedback-${stamp}.jsonl`));
  }

  // 清理超期备份
  for (const f of fs.readdirSync(backupDir)) {
    const m = f.match(/(\d{4}-\d{2}-\d{2})/);
    if (m && (Date.now() - new Date(m[1] + 'T00:00:00Z').getTime()) > KEEP_DAYS * 86400 * 1000) {
      fs.unlinkSync(path.join(backupDir, f));
    }
  }

  const size = (fs.statSync(target).size / 1024).toFixed(0);
  console.log(`[backup] ${stamp} 完成: ${target} (${size}KB)`);
})().catch((err) => {
  console.error('[backup] 失败:', err.message);
  process.exit(1);
});
