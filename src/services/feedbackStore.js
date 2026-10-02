// 满意度反馈存储：JSONL 追加写入（每行一条记录）
// 看板阶段可平滑迁移 SQLite：替换本模块实现即可，路由层不变
const fs = require('fs');
const path = require('path');

function getFilePath() {
  return process.env.FEEDBACK_FILE
    || path.join(__dirname, '..', '..', 'data', 'feedback.jsonl');
}

// 追加一条反馈；同一 messageId 重复投票会追加新记录，看板按最新一条归并
function saveFeedback(entry) {
  const file = getFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record = { ...entry, receivedAt: new Date().toISOString() };
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
  return record;
}

// 读取全部反馈（供导出与看板使用）
function listFeedback() {
  const file = getFilePath();
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

module.exports = { saveFeedback, listFeedback };
