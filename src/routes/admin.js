// 实时数据看板：GET /admin/dashboard?token=<ADMIN_TOKEN>
// 零新表直查 SQLite；token 经环境变量 ADMIN_TOKEN 配置（未配置则看板不启用，返回 404）
const express = require('express');
const { overview, dailyTrend, stageDistribution, recentDowns } = require('../services/adminMetrics');

const router = express.Router();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function authed(req) {
  const t = req.query.token || req.headers['x-admin-token'] ||
    (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('admin_token='));
  return Boolean(ADMIN_TOKEN) && Boolean(t) && t.replace('admin_token=', '') === ADMIN_TOKEN;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function bar(value, max, color) {
  const h = max ? Math.max(3, Math.round((value / max) * 90)) : 3;
  return `<div class="bar" style="height:${h}px;background:${color}"></div>`;
}

function rateCell(v, target, higherBetter = true) {
  if (v === null || v === undefined) return '<span class="dim">—</span>';
  const ok = higherBetter ? v >= target : v <= target;
  return `<span class="${ok ? 'ok' : 'warn'}">${v}%</span><span class="dim"> / ${higherBetter ? '≥' : '≤'}${target}%</span>`;
}

function renderDashboard() {
  const today = overview(1);
  const w7 = overview(7);
  const d30 = overview(30);
  const trend = dailyTrend(14);
  const stages = stageDistribution(30);
  const downs = recentDowns(10);
  const maxSessions = Math.max(1, ...trend.map((t) => t.sessions));
  const maxStage = Math.max(1, ...stages.map((s) => s.n));

  const trendBars = trend.map((t) => `
    <div class="col" title="${t.date}：会话 ${t.sessions}，👎 ${t.downs}">
      ${t.downs ? `<div class="downbar" style="height:${Math.max(3, t.downs * 6)}px" title="👎 ${t.downs}"></div>` : ''}
      ${bar(t.sessions, maxSessions, '#7fa88f')}
      <div class="xlabel">${t.date.slice(3)}</div>
    </div>`).join('');

  const stageRows = stages.map((s) => `
    <div class="stagerow">
      <span class="stagename">${esc(s.s)}</span>
      <div class="track"><div class="fill" style="width:${Math.round((s.n / maxStage) * 100)}%"></div></div>
      <span class="dim">${s.n}</span>
    </div>`).join('');

  const downRows = downs.length ? downs.map((d) => `
    <tr>
      <td class="dim">${esc(d.created_at)}</td>
      <td>${esc(d.stage || '—')}</td>
      <td>${esc(d.vote_reason || '—')}</td>
      <td>${esc(d.email || d.phone || '游客')}</td>
      <td class="clip">${esc(String(d.content).slice(0, 60))}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="dim">近 30 天无 👎 反馈</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="60">
<title>情绪空间 · 数据看板</title>
<style>
  body { margin:0; padding:24px; background:#0e1712; color:#ece5d8; font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; font-weight:300; }
  h1 { font-size:20px; letter-spacing:.2em; margin:0 0 4px; }
  .sub { color:rgba(236,229,216,.55); font-size:12px; margin-bottom:20px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:14px; }
  .card { background:rgba(13,20,15,.72); border:1px solid rgba(236,229,216,.14); border-radius:16px; padding:16px; }
  .card h3 { margin:0 0 10px; font-size:12px; color:rgba(236,229,216,.55); font-weight:400; letter-spacing:.15em; }
  .kpi { font-size:26px; margin:2px 0; }
  .dim { color:rgba(236,229,216,.55); font-size:12px; }
  .ok { color:#9fd3ae; } .warn { color:#d9a08a; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid rgba(236,229,216,.08); }
  .clip { max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chart { display:flex; align-items:flex-end; gap:6px; height:130px; padding-top:10px; }
  .col { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; }
  .bar { width:70%; border-radius:3px 3px 0 0; }
  .downbar { width:70%; background:#c96a5a; border-radius:3px 3px 0 0; margin-bottom:1px; }
  .xlabel { font-size:10px; color:rgba(236,229,216,.45); margin-top:4px; }
  .stagerow { display:flex; align-items:center; gap:10px; margin:6px 0; font-size:12px; }
  .stagename { width:90px; text-align:right; }
  .track { flex:1; background:rgba(236,229,216,.06); border-radius:6px; height:10px; overflow:hidden; }
  .fill { height:100%; background:#7fa88f; border-radius:6px; }
  .row2 { display:grid; grid-template-columns:1.2fr 1fr; gap:14px; margin-top:14px; }
  @media (max-width:800px){ .row2{grid-template-columns:1fr;} }
</style>
</head>
<body>
  <h1>情绪空间 · 数据看板</h1>
  <div class="sub">实时直查 SQLite · 每 60 秒自动刷新 · ${new Date().toLocaleString('zh-CN')}</div>

  <div class="grid">
    <div class="card"><h3>今日</h3>
      <div class="kpi">${today.activeSessions}</div><div class="dim">活跃会话（有消息）</div>
      <div class="dim">新建会话 ${today.sessions} · 消息 ${today.messages}</div>
      <div class="dim">登录用户 ${today.users}</div></div>
    <div class="card"><h3>近 7 天</h3>
      <div class="kpi">${w7.activeSessions}</div><div class="dim">活跃会话</div>
      <div class="dim">新建 ${w7.sessions}</div>
      <div class="dim">完聊率 ${rateCell(w7.completionRate, 50)}</div>
      <div class="dim">反馈参与 ${rateCell(w7.feedbackRate, 15)}</div>
      <div class="dim">👎 率 ${rateCell(w7.downRate, 15, false)}</div></div>
    <div class="card"><h3>近 30 天</h3>
      <div class="kpi">${d30.activeSessions}</div><div class="dim">活跃会话</div>
      <div class="dim">新建 ${d30.sessions}</div>
      <div class="dim">完聊率 ${rateCell(d30.completionRate, 50)}</div>
      <div class="dim">有效疏导 ${rateCell(d30.effectiveRate, 60)}</div>
      <div class="dim">登录用户 ${d30.users}</div></div>
    <div class="card"><h3>红线（30 天）</h3>
      <div class="dim">👎 率 ${rateCell(d30.downRate, 15, false)}（bot 消息 ${d30.botMsgs} 条）</div>
      <div class="dim" style="margin-top:8px">LLM 成功率 / 危机漏检见周报（journalctl）</div></div>
  </div>

  <div class="row2">
    <div class="card"><h3>近 14 天趋势（绿=当日活跃会话，红=👎 数）</h3>
      <div class="chart">${trendBars}</div></div>
    <div class="card"><h3>阶段分布（30 天 bot 消息）</h3>${stageRows}</div>
  </div>

  <div class="card" style="margin-top:14px"><h3>最新 👎 反馈（10 条）</h3>
    <table><tr><th>时间</th><th>阶段</th><th>原因</th><th>用户</th><th>回复摘录</th></tr>${downRows}</table></div>
</body>
</html>`;
}

router.get('/admin/dashboard', (req, res) => {
  if (!ADMIN_TOKEN) {
    return res.status(404).send('看板未启用：服务器需配置 ADMIN_TOKEN 环境变量');
  }
  if (!authed(req)) {
    return res.status(401).send('未授权：请携带 ?token= 或 x-admin-token 访问');
  }
  if (req.query.token) {
    res.setHeader('Set-Cookie', `admin_token=${ADMIN_TOKEN}; Path=/admin; HttpOnly; Max-Age=86400`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderDashboard());
});

module.exports = router;
