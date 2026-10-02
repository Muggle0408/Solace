const express = require('express');
const { saveFeedback, listFeedback } = require('../services/feedbackStore');

const router = express.Router();

// POST /api/feedback
// 请求体：{ messageId, stage, vote: 'up' | 'down', reason?, text? }
router.post('/feedback', (req, res) => {
  const { messageId, stage, vote, reason, text } = req.body || {};
  if (!messageId || !['up', 'down'].includes(vote)) {
    return res.status(400).json({ error: 'INVALID_FEEDBACK', message: '反馈参数不完整' });
  }
  const record = saveFeedback({
    messageId: String(messageId).slice(0, 64),
    stage: String(stage || 'unknown'),
    vote,
    reason: reason ? String(reason).slice(0, 50) : null,
    text: String(text || '').slice(0, 500)
  });
  res.json({ ok: true, receivedAt: record.receivedAt });
});

// GET /api/feedback/export —— 看板数据源
router.get('/feedback/export', (req, res) => {
  const items = listFeedback();
  res.json({ count: items.length, items });
});

module.exports = router;
