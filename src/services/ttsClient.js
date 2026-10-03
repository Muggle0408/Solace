// 火山引擎语音合成客户端：情感 TTS（Key 仅存服务端，经环境变量注入）
const axios = require('axios');
const crypto = require('crypto');

const APPID = process.env.VOLC_APPID;
const TOKEN = process.env.VOLC_TOKEN;
const CLUSTER = process.env.VOLC_CLUSTER || 'volcano_tts';
// 音色 ID 可在火山控制台「音色列表」试听替换，如 zh_female_qingxin（清新女声）
const VOICE = process.env.VOLC_VOICE || 'zh_female_qingxin';

function isConfigured() {
  return Boolean(APPID && TOKEN);
}

// 返回 mp3 Buffer；失败抛错（由路由层降级浏览器朗读）
async function synthesize(text) {
  if (!isConfigured()) throw new Error('TTS 未配置火山引擎 Key');

  const payload = {
    app: { appid: APPID, token: TOKEN, cluster: CLUSTER },
    user: { uid: 'solace-web' },
    audio: { voice_type: VOICE, encoding: 'mp3', speed_ratio: 1.0 },
    request: { reqid: crypto.randomUUID(), text, operation: 'query' }
  };

  const res = await axios.post('https://openspeech.bytedance.com/api/v1/tts', payload, {
    headers: {
      Authorization: `Bearer;${TOKEN}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  const data = res.data;
  if (data.code !== 3000) {
    throw new Error(`火山TTS错误(${data.code}): ${data.message}`);
  }
  return Buffer.from(data.data, 'base64');
}

module.exports = { synthesize, isConfigured };
