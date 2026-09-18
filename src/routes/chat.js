const express = require('express');
const { processMessage } = require('../engine/chatEngine');

const router = express.Router();

// POST /api/chat
// 请求体：{ message: string, history: Array<{role, content, stage?}> }
// 响应：{ stage, type, text, options, isCrisis? }
router.post('/chat', async (req, res) => {
  try {
    const { message = '', history = [] } = req.body;
    const response = await processMessage(message, history);
    res.json(response);
  } catch (err) {
    console.error('对话处理失败:', err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: '抱歉，处理你的消息时出现了一些问题，请稍后再试。'
    });
  }
});

module.exports = router;
