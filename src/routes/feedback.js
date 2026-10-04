const express = require('express');
const db = require('../services/db');
const { saveFeedback, listFeedback } = require('../services/feedbackStore');

const router = express.Router();

// 👍/👎 同步落库 messages.vote（过渡期与 JSONL 双写；游客/历史消息无对应行则仅 JSONL）
const uVote = db.prepare(`
  UPDATE messages SET vote = ?, vote_reason = ?
  WHERE id = ? AND conv_id IN (SELECT id FROM conversations WHERE user_id = ?)
`);

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

  let persistedToDb = false;
  const msgId = Number(messageId);
  if (req.user && Number.isInteger(msgId) && msgId > 0) {
    persistedToDb = uVote.run(vote, reason ? String(reason).slice(0, 50) : null, msgId, req.user.id).changes > 0;
  }

  res.json({ ok: true, receivedAt: record.receivedAt, persistedToDb });
});

// GET /api/feedback/export —— 看板数据源
router.get('/feedback/export', (req, res) => {
  const items = listFeedback();
  res.json({ count: items.length, items });
});

module.exports = router;
