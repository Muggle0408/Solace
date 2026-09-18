const express = require('express');
const { processMessage } = require('../engine/chatEngine');

const router = express.Router();

router.post('/chat', async (req, res) => {
  try {
    const { message, stage = 'welcome', history = [] } = req.body;
    const response = await processMessage(message, stage, history);
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
