// 无条件加载 .env；dotenv 默认不会覆盖已存在的环境变量
require('dotenv').config();

const express = require('express');
const path = require('path');
const chatRoutes = require('./src/routes/chat');
const { LLM_PROVIDER } = require('./src/services/llmClient');
const { createRateLimiter } = require('./src/middleware/rateLimit');
const { authMiddleware } = require('./src/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const USE_LLM = process.env.USE_LLM === 'true';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 公网部署时限流，防止 API 额度被刷（内存实现，适合单实例）
// 每个接口独立配额：对话 10 次/分（防刷），朗读 30 次/分（功能正常使用）
const CHAT_LIMIT_MAX = process.env.RATE_LIMIT_MAX === undefined ? 10 : Number(process.env.RATE_LIMIT_MAX);
const TTS_LIMIT_MAX = process.env.TTS_RATE_LIMIT_MAX === undefined ? 30 : Number(process.env.TTS_RATE_LIMIT_MAX);

const chatLimiter = createRateLimiter(CHAT_LIMIT_MAX);
const ttsLimiter = createRateLimiter(TTS_LIMIT_MAX);

// 会话鉴权：解析 sid Cookie，挂载 req.user（全局生效，未登录为 null）
app.use(authMiddleware);

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
app.use('/api/chat', chatLimiter);
app.use('/api/tts', ttsLimiter);
app.use('/api', require('./src/routes/auth'));
app.use('/api', require('./src/routes/conversations'));
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
