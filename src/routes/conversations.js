const express = require('express');
const db = require('../services/db');

const router = express.Router();

const qConvs = db.prepare(`
  SELECT c.id, c.started_at, c.ended_at, c.start_rating, c.end_rating,
         (SELECT COUNT(*) FROM messages m WHERE m.conv_id = c.id) AS msg_count,
         (SELECT content FROM messages m WHERE m.conv_id = c.id AND m.role = 'bot'
           ORDER BY m.id DESC LIMIT 1) AS last_bot_msg
  FROM conversations c
  WHERE c.user_id = ? AND c.started_at >= datetime('now', '-30 days')
  ORDER BY c.started_at DESC
  LIMIT 50
`);
const qMessages = db.prepare(`
  SELECT id, role, content, stage, created_at FROM messages
  WHERE conv_id = ? ORDER BY id ASC
`);
const qConvOwner = db.prepare('SELECT user_id FROM conversations WHERE id = ?');

// GET /api/conversations —— 最近 30 天会话列表（登录用户）
router.get('/conversations', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: '未登录' });
  }
  const conversations = qConvs.all(req.user.id).map((c) => ({
    id: c.id,
    startedAt: c.started_at,
    endedAt: c.ended_at,
    startRating: c.start_rating,
    endRating: c.end_rating,
    msgCount: c.msg_count,
    preview: c.last_bot_msg ? String(c.last_bot_msg).slice(0, 40) : ''
  }));
  res.json({ conversations });
});

// GET /api/conversations/:id/messages —— 单条会话完整消息（仅本人）
router.get('/conversations/:id/messages', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: '未登录' });
  }
  const convId = Number(req.params.id);
  const conv = Number.isInteger(convId) ? qConvOwner.get(convId) : null;
  if (!conv || conv.user_id !== req.user.id) {
    return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND', message: '会话不存在' });
  }
  const messages = qMessages.all(convId).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    stage: m.stage,
    createdAt: m.created_at
  }));
  res.json({ conversationId: convId, messages });
});

module.exports = router;
