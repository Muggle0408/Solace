const express = require('express');
const db = require('../services/db');
const { processMessage } = require('../engine/chatEngine');

const router = express.Router();

const qConvOwned = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?');
const iConv = db.prepare('INSERT INTO conversations (user_id) VALUES (?)');
const iMessage = db.prepare('INSERT INTO messages (conv_id, role, content, stage) VALUES (?, ?, ?, ?)');
const uStartRating = db.prepare('UPDATE conversations SET start_rating = ? WHERE id = ?');
const uEndRating = db.prepare('UPDATE conversations SET end_rating = ? WHERE id = ?');
const uEnded = db.prepare(`UPDATE conversations SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL`);

// 登录用户：校验请求头 X-Conv-Id 归属（防止串号），无效则开新会话
function resolveConversation(req) {
  const headerId = Number(req.headers['x-conv-id']);
  if (Number.isInteger(headerId) && headerId > 0) {
    const row = qConvOwned.get(headerId, req.user.id);
    if (row) return row.id;
  }
  return iConv.run(req.user.id).lastInsertRowid;
}

function validRating(v) {
  return Number.isInteger(v) && v >= 0 && v <= 10;
}

// POST /api/chat
// 请求体：{ message: string, history: Array<{role, content, stage?}>, startRating?, endRating? }
// 响应：{ stage, type, text, options, isCrisis?, convId?, botMessageId? }
router.post('/chat', async (req, res) => {
  try {
    const { message = '', history = [] } = req.body;
    let convId = null;

    if (req.user) {
      convId = resolveConversation(req);
      // 用户消息先落库，引擎异常时也不丢
      iMessage.run(convId, 'user', String(message).slice(0, 4000), null);
      const { startRating, endRating } = req.body;
      if (validRating(startRating)) uStartRating.run(startRating, convId);
      if (validRating(endRating)) uEndRating.run(endRating, convId);
    }

    const response = await processMessage(message, history);

    if (req.user) {
      const info = iMessage.run(convId, 'bot', String(response.text).slice(0, 4000), response.stage || null);
      if (response.stage === 'end') uEnded.run(convId);
      response.convId = convId;
      response.botMessageId = info.lastInsertRowid;
    }

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
