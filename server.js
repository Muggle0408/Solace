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
app.use('/api', chatRoutes);

module.exports = { app };

if (require.main === module) {
  app.listen(PORT, () => {
    const mode = USE_LLM ? '大模型模式' : '规则引擎模式';
    console.log(`情绪疏导 Agent 运行在 http://localhost:${PORT} [${mode}]`);
  });
}
