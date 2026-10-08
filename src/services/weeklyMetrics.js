// V1 周报核心指标（数据收集分析方案 V1 §2）：6 个数 + 2 条红线，全部来自现有表与日志
// 纯函数化便于测试；weekly-report.js 只负责组装输出
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const db = require('./db');

// ---- 周窗口：ISO 周（周一至周日），返回 [from, to) 的 'YYYY-MM-DD HH:MM:SS' ----
function weekBounds(date = new Date()) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 周一=0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  const nextMonday = new Date(monday.getTime() + 7 * 86400 * 1000);
  const fmt = (x) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} 00:00:00`;
  };
  return { from: fmt(monday), to: fmt(nextMonday) };
}

// ---- 6 个指标（from/to 按 conversations.started_at 过滤）----
function computeMetrics(from, to) {
  const inWin = (extra = '') =>
    `FROM conversations c WHERE c.started_at >= '${from}' AND c.started_at < '${to}' ${extra}`;

  const total = db.prepare(`SELECT COUNT(*) n ${inWin()}`).get().n;
  const withRatings = db.prepare(
    `SELECT COUNT(*) n ${inWin('AND c.start_rating IS NOT NULL AND c.end_rating IS NOT NULL')}`
  ).get().n;
  const effective = db.prepare(
    `SELECT COUNT(*) n ${inWin('AND c.start_rating IS NOT NULL AND c.end_rating IS NOT NULL AND c.end_rating - c.start_rating >= 2')}
     AND EXISTS (SELECT 1 FROM messages m WHERE m.conv_id = c.id AND m.stage IN ('closing','rating'))`
  ).get().n;
  const completed = db.prepare(
    `SELECT COUNT(DISTINCT c.id) n ${inWin("AND EXISTS (SELECT 1 FROM messages m WHERE m.conv_id = c.id AND m.stage IN ('closing','rating'))")}`
  ).get().n;
  const votedConvs = db.prepare(
    `SELECT COUNT(DISTINCT c.id) n ${inWin('AND EXISTS (SELECT 1 FROM messages m WHERE m.conv_id = c.id AND m.vote IS NOT NULL)')}`
  ).get().n;
  const botMsgs = db.prepare(
    `SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conv_id
     WHERE c.started_at >= '${from}' AND c.started_at < '${to}' AND m.role = 'bot'`
  ).get().n;
  const downVotes = db.prepare(
    `SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conv_id
     WHERE c.started_at >= '${from}' AND c.started_at < '${to}' AND m.role = 'bot' AND m.vote = 'down'`
  ).get().n;

  // 语音使用率：有 TTS 调用的会话 ÷ 全部会话（data/tts-usage.jsonl 按 convId 归属）
  let ttsConvs = 0;
  const ttsFile = path.join(__dirname, '..', '..', 'data', 'tts-usage.jsonl');
  if (fs.existsSync(ttsFile)) {
    const convIds = new Set();
    for (const line of fs.readFileSync(ttsFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.convId && r.at >= from && r.at < to) convIds.add(r.convId);
      } catch { /* 跳过坏行 */ }
    }
    ttsConvs = db.prepare(
      `SELECT COUNT(*) n FROM conversations c WHERE c.id IN (${convIds.size ? [...convIds].join(',') : 'NULL'})`
    ).get().n;
  }

  return {
    total,
    effectiveRate: withRatings ? ratio(effective, withRatings) : null,
    effectiveDetail: `${effective}/${withRatings}`,
    completionRate: total ? ratio(completed, total) : null,
    completionDetail: `${completed}/${total}`,
    feedbackRate: total ? ratio(votedConvs, total) : null,
    feedbackDetail: `${votedConvs}/${total}`,
    downRate: botMsgs ? ratio(downVotes, botMsgs) : null,
    downDetail: `${downVotes}/${botMsgs}`,
    voiceRate: total ? ratio(ttsConvs, total) : null,
    voiceDetail: `${ttsConvs}/${total}`
  };
}

function ratio(a, b) {
  return b === 0 ? null : Math.round((a / b) * 1000) / 10;
}

// ---- 👎 明细（本周）----
function listDownVotes(from, to, limit = 20) {
  return db.prepare(`
    SELECT m.id, m.content, m.stage, m.vote_reason, m.created_at, c.id AS conv_id, u.email, u.phone
    FROM messages m
    JOIN conversations c ON c.id = m.conv_id
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.started_at >= '${from}' AND c.started_at < '${to}'
      AND m.role = 'bot' AND m.vote = 'down'
    ORDER BY m.created_at DESC
    LIMIT ${limit}
  `).all();
}

// ---- 红线：LLM 成功率 + 危机门拦截（journalctl，需要 journal 读取权限）----
function redLines(from) {
  const out = { llmOk: null, llmFail: null, crisis: null, note: null };
  try {
    const log = execSync(
      `journalctl -u solace --since "${from}" --no-pager 2>/dev/null`,
      { maxBuffer: 16 * 1024 * 1024, timeout: 15000 }
    ).toString();
    out.llmOk = (log.match(/\[LLM流式\].*->|\[LLM\].*->/g) || []).length;
    out.llmFail = (log.match(/LLM流式->规则|LLM->规则/g) || []).length;
    out.crisis = (log.match(/\[危机门\]/g) || []).length;
  } catch (e) {
    out.note = `journalctl 读取失败（${String(e.message).slice(0, 60)}），红线请手动查：journalctl -u solace --since "${from}" | grep -E "LLM|危机"`;
  }
  return out;
}

function fmtPct(v) {
  return v === null || v === undefined ? '—' : `${v}%`;
}

function delta(cur, prev) {
  if (cur === null || prev === null || prev === undefined) return '';
  const d = Math.round((cur - prev) * 10) / 10;
  if (d === 0) return '（持平）';
  return d > 0 ? `（↑${d}pp）` : `（↓${Math.abs(d)}pp）`;
}

// ---- 组装 markdown 周报 ----
function buildReport(refDate = new Date()) {
  const cur = weekBounds(refDate);
  const prevTo = cur.from;
  const prevFrom = weekBounds(new Date(new Date(`${prevTo.replace(' ', 'T')}Z`).getTime() - 1000)).from;
  const m = computeMetrics(cur.from, cur.to);
  const p = computeMetrics(prevFrom, prevTo);
  const red = redLines(cur.from);
  const downs = listDownVotes(cur.from, cur.to);

  const endOfWeek = new Date(new Date(`${cur.to.replace(' ', 'T')}Z`).getTime() - 1000);
  const lines = [];
  lines.push(`# 周报 ${cur.from.slice(0, 10)} ~ ${endOfWeek.toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push('## 六个数（本周 vs 上周）');
  lines.push('');
  lines.push('| 指标 | 本周 | 上周 | 目标/警戒 |');
  lines.push('|---|---|---|---|');
  lines.push(`| 有效疏导会话占比 | ${fmtPct(m.effectiveRate)} ${m.effectiveDetail} ${delta(m.effectiveRate, p.effectiveRate)} | ${fmtPct(p.effectiveRate)} | ≥60% |`);
  lines.push(`| 完聊率 | ${fmtPct(m.completionRate)} ${m.completionDetail} ${delta(m.completionRate, p.completionRate)} | ${fmtPct(p.completionRate)} | ≥50% |`);
  lines.push(`| 反馈参与率 | ${fmtPct(m.feedbackRate)} ${m.feedbackDetail} ${delta(m.feedbackRate, p.feedbackRate)} | ${fmtPct(p.feedbackRate)} | ≥15% |`);
  lines.push(`| 👎 率 | ${fmtPct(m.downRate)} ${m.downDetail} ${delta(m.downRate, p.downRate)} | ${fmtPct(p.downRate)} | >15% 警惕 |`);
  lines.push(`| 语音使用率 | ${fmtPct(m.voiceRate)} ${m.voiceDetail} | ${fmtPct(p.voiceRate)} | <15% 触发降级讨论 |`);
  lines.push('');
  lines.push('## 红线');
  lines.push('');
  if (red.note) {
    lines.push(`- ${red.note}`);
  } else {
    const total = (red.llmOk || 0) + (red.llmFail || 0);
    const rate = total ? Math.round(((red.llmOk || 0) / total) * 1000) / 10 : null;
    lines.push(`- LLM 生成成功率：${rate === null ? '本周无 LLM 调用' : `${rate}%（成功 ${red.llmOk} / 回退 ${red.llmFail}）`} —— 红线 100%`);
    lines.push(`- 危机门拦截：${red.crisis} 次（规则门全部命中；漏检需人工抽检）—— 红线 0 漏检`);
  }
  lines.push('');
  lines.push(`## 👎 明细（本周 ${downs.length} 条）`);
  lines.push('');
  if (!downs.length) {
    lines.push('（本周无 👎 反馈）');
  } else {
    for (const d of downs) {
      const who = d.email || d.phone || '游客';
      lines.push(`- [${d.created_at}] conv#${d.conv_id} ${who} 阶段=${d.stage}${d.vote_reason ? ` 原因=${d.vote_reason}` : ''}`);
      lines.push(`  > ${String(d.content).slice(0, 80)}`);
    }
  }
  lines.push('');
  lines.push('## 归因与动作（人工填写）');
  lines.push('');
  lines.push('- 断点/差评 Top1：');
  lines.push('- badcase 处理：');
  lines.push('- 下周一个动作：');
  lines.push('');
  return { markdown: lines.join('\n'), from: cur.from };
}

module.exports = { weekBounds, computeMetrics, listDownVotes, redLines, buildReport, ratio };
