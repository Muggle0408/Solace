// 如果环境变量未加载，则从 .env 文件加载
if (!process.env.KIMI_API_KEY) {
  require('dotenv').config();
}

const express = require('express');
const path = require('path');
const chatRoutes = require('./src/routes/chat');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// 对话接口
app.use('/api', chatRoutes);

module.exports = { app };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`情绪疏导 Agent 运行在 http://localhost:${PORT}`);
  });
}
