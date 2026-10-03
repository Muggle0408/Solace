// 无条件加载 .env；dotenv 默认不会覆盖已存在的环境变量
require('dotenv').config();

const express = require('express');
const path = require('path');
const chatRoutes = require('./src/routes/chat');
const { LLM_PROVIDER } = require('./src/services/llmClient');

const app = express();
const PORT = process.env.PORT || 3000;
const USE_LLM = process.env.USE_LLM === 'true';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 公网部署时限流，防止 API 额度被刷（内存实现，适合单实例）
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000;
const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX === undefined ? 10 : Number(process.env.RATE_LIMIT_MAX);
const rateHits = new Map();

if (RATE_LIMIT_MAX > 0) {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, times] of rateHits) {
      const recent = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (recent.length === 0) rateHits.delete(ip);
      else rateHits.set(ip, recent);
    }
  }, RATE_LIMIT_WINDOW_MS).unref();
}

function rateLimit(req, res, next) {
  if (RATE_LIMIT_MAX <= 0) return next();
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const times = (rateHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (times.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'RATE_LIMITED', message: '请求太频繁了，请休息片刻再试。' });
  }
  times.push(now);
  rateHits.set(ip, times);
  next();
}

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    llmEnabled: USE_LLM,
    provider: LLM_PROVIDER,
    model: LLM_PROVIDER === 'deepseek'
      ? (process.env.DEEPSEEK_MODEL || 'deepseek-chat')
      : (process.env.KIMI_MODEL || 'none')
  });
});

// 对话接口
app.use('/api/chat', rateLimit);
app.use('/api/tts', rateLimit);
app.use('/api', chatRoutes);
app.use('/api', require('./src/routes/feedback'));
app.use('/api', require('./src/routes/tts'));

module.exports = { app };

if (require.main === module) {
  app.listen(PORT, () => {
    const mode = USE_LLM ? '大模型模式' : '规则引擎模式';
    console.log(`情绪疏导 Agent 运行在 http://localhost:${PORT} [${mode}]`);
  });
}
