const express = require('express');
const { synthesize, isConfigured } = require('../services/ttsClient');

const router = express.Router();

// POST /api/tts  请求体：{ text }（≤500字）→ 返回 mp3 音频流
// 未配置火山 Key 时返回 501，前端自动降级浏览器自带朗读
router.post('/tts', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 500) {
    return res.status(400).json({ error: 'INVALID_TEXT', message: '文本为空或过长' });
  }
  if (!isConfigured()) {
    return res.status(501).json({ error: 'TTS_NOT_CONFIGURED' });
  }
  try {
    const audio = await synthesize(text);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    res.send(audio);
  } catch (err) {
    console.error('[TTS] 合成失败:', err.message);
    res.status(502).json({ error: 'TTS_FAILED' });
  }
});

module.exports = router;
