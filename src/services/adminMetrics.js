// 实时看板查询：全部直查现有表（零新表），每次请求即当前数据
// 注意：SQLite datetime('now') 存的是 UTC 字符串；本文件所有边界统一换算为 UTC，避免 8 小时错位
const db = require('./db');

// 本地零点换算为 UTC 字符串（与库内 UTC 存储对齐）
function localMidnightUtc(daysAgo = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function since(days) {
  // 近 N 个本地自然日：从今天零点往前推 N-1 天
  return localMidnightUtc(days - 1);
}

// UTC 字符串 → 本地日期键 'YYYY-MM-DD'
function localDateKey(utcStr) {
  return new Date(String(utcStr).replace(' ', 'T') + 'Z').toLocaleDateString('sv');
}

function overview(days) {
  const from = since(days);
  const sessions = db.prepare('SELECT COUNT(*) n FROM conversations WHERE started_at >= ?').get(from).n;
  const messages = db.prepare(`
    SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conv_id
    WHERE c.started_at >= ?`).get(from).n;
  const users = db.prepare('SELECT COUNT(DISTINCT user_id) n FROM conversations WHERE user_id IS NOT NULL AND started_at >= ?').get(from).n;
  const completed = db.prepare(`
    SELECT COUNT(DISTINCT c.id) n FROM conversations c
    WHERE c.started_at >= ? AND EXISTS (SELECT 1 FROM messages m WHERE m.conv_id=c.id AND m.stage IN ('closing','rating'))`).get(from).n;
  const voted = db.prepare(`
    SELECT COUNT(DISTINCT c.id) n FROM conversations c
    WHERE c.started_at >= ? AND EXISTS (SELECT 1 FROM messages m WHERE m.conv_id=c.id AND m.vote IS NOT NULL)`).get(from).n;
  const botMsgs = db.prepare(`
    SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id=m.conv_id
    WHERE c.started_at >= ? AND m.role='bot'`).get(from).n;
  const downs = db.prepare(`
    SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id=m.conv_id
    WHERE c.started_at >= ? AND m.role='bot' AND m.vote='down'`).get(from).n;
  const withRatings = db.prepare(`
    SELECT COUNT(*) n FROM conversations WHERE started_at >= ? AND start_rating IS NOT NULL AND end_rating IS NOT NULL`).get(from).n;
  const effective = db.prepare(`
    SELECT COUNT(*) n FROM conversations c
    WHERE c.started_at >= ? AND c.start_rating IS NOT NULL AND c.end_rating IS NOT NULL AND c.end_rating - c.start_rating >= 2
      AND EXISTS (SELECT 1 FROM messages m WHERE m.conv_id=c.id AND m.stage IN ('closing','rating'))`).get(from).n;

  const r = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    sessions, messages, users,
    completionRate: r(completed, sessions),
    feedbackRate: r(voted, sessions),
    downRate: r(downs, botMsgs),
    effectiveRate: r(effective, withRatings),
    botMsgs
  };
}

// 近 N 个本地自然日趋势（会话数 + 👎 数），按本地日期分桶补零
function dailyTrend(days = 14) {
  const from = since(days);
  const mapS = {};
  for (const r of db.prepare('SELECT started_at FROM conversations WHERE started_at >= ?').all(from)) {
    const k = localDateKey(r.started_at);
    mapS[k] = (mapS[k] || 0) + 1;
  }
  const mapD = {};
  for (const r of db.prepare("SELECT created_at FROM messages WHERE vote='down' AND created_at >= ?").all(from)) {
    const k = localDateKey(r.created_at);
    mapD[k] = (mapD[k] || 0) + 1;
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date();
    dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() - i);
    const key = dt.toLocaleDateString('sv');
    out.push({ date: key.slice(5), sessions: mapS[key] || 0, downs: mapD[key] || 0 });
  }
  return out;
}

// bot 消息阶段分布（看对话断在哪）
function stageDistribution(days = 30) {
  const from = since(days);
  return db.prepare(`
    SELECT COALESCE(m.stage, '（无阶段）') s, COUNT(*) n
    FROM messages m JOIN conversations c ON c.id = m.conv_id
    WHERE c.started_at >= ? AND m.role='bot'
    GROUP BY m.stage ORDER BY n DESC`).all(from);
}

function recentDowns(limit = 10) {
  return db.prepare(`
    SELECT m.created_at, m.stage, m.vote_reason, m.content, c.id conv_id, u.email, u.phone
    FROM messages m JOIN conversations c ON c.id = m.conv_id LEFT JOIN users u ON u.id = c.user_id
    WHERE m.role='bot' AND m.vote='down' ORDER BY m.created_at DESC LIMIT ?`).all(limit);
}

module.exports = { overview, dailyTrend, stageDistribution, recentDowns, since, localDateKey };
