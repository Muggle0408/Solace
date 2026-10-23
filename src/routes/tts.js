const express = require('express');
const { synthesize, synthesizeStream, isConfigured } = require('../services/ttsClient');
const { logTtsUse } = require('../services/ttsUsageLog');

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
  const startAt = Date.now();
  try {
    const audio = await synthesize(text);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    res.send(audio);
    const convId = Number(req.headers['x-conv-id']);
    logTtsUse({ convId: Number.isInteger(convId) && convId > 0 ? convId : null, userId: req.user ? req.user.id : null, chars: text.length });
    console.log(`[TTS] 合成成功 | ${Date.now() - startAt}ms | ${audio.length}字节`);
  } catch (err) {
    console.error('[TTS] 合成失败:', err.message);
    res.status(502).json({ error: 'TTS_FAILED' });
  }
});

// GET /api/tts/stream?text=…（≤500字）→ 分块音频流（audio/mpeg），首帧即推
// 前端首段播报用：<audio> 边下边播，不再等整段合成完；失败时自行降级缓冲接口
router.get('/tts/stream', async (req, res) => {
  const text = String(req.query.text || '').trim();
  if (!text || text.length > 500) {
    return res.status(400).json({ error: 'INVALID_TEXT', message: '文本为空或过长' });
  }
  if (!isConfigured()) {
    return res.status(501).json({ error: 'TTS_NOT_CONFIGURED' });
  }
  const startAt = Date.now();
  res.set('Content-Type', 'audio/mpeg');
  res.set('Cache-Control', 'no-store');
  res.flushHeaders?.();
  try {
    const { firstFrameMs, bytes } = await synthesizeStream(text, (buf) => {
      if (!res.writableEnded) res.write(buf);
    });
    if (!res.writableEnded) res.end();
    logTtsUse({ convId: null, userId: req.user ? req.user.id : null, chars: text.length });
    console.log(`[TTS流] 首帧 ${firstFrameMs}ms | 共 ${Date.now() - startAt}ms | ${bytes}字节`);
  } catch (err) {
    console.error('[TTS流] 合成失败:', err.message);
    if (!res.writableEnded) res.end(); // 已推出的部分音频仍可播放，余下静默跳过
  }
});

module.exports = router;
