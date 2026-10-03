// 情感 TTS 客户端：豆包语音大模型2.0（火山引擎 V3 接口）/ MiniMax 双 Provider
// Key 仅存服务端，经环境变量注入；TTS_PROVIDER=volc（默认）| minimax
const axios = require('axios');
const crypto = require('crypto');

const PROVIDER = process.env.TTS_PROVIDER || 'volc';

// ---------- 豆包语音大模型 2.0（火山引擎 V3 HTTP Chunked）----------
// 文档：https://docs.volcengine.com/docs/6561/2528925
const VOLC_API_KEY = process.env.VOLC_API_KEY;
// 音色 ID 见豆包语音控制台「音色库」，如 zh_female_meilinvyou_uranus_bigtts（魅力女友）
const VOLC_VOICE = process.env.VOLC_VOICE || 'zh_female_meilinvyou_uranus_bigtts';
const VOLC_RESOURCE = process.env.VOLC_RESOURCE || 'seed-tts-2.0';

async function volcSynthesize(text) {
  const res = await axios.post(
    'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
    {
      req_params: {
        text,
        speaker: VOLC_VOICE,
        audio_params: { format: 'mp3', sample_rate: 24000 }
      }
    },
    {
      headers: {
        'X-Api-Key': VOLC_API_KEY,
        'X-Api-Resource-Id': VOLC_RESOURCE,
        'X-Api-Request-Id': crypto.randomUUID(),
        'Content-Type': 'application/json'
      },
      timeout: 20000,
      responseType: 'text'
    }
  );

  // 响应可能为单个 JSON 或多行 chunked JSON，统一解析并拼接音频数据
  const raw = res.data;
  let code = 0;
  let message = 'OK';
  let data = '';
  try {
    const payload = JSON.parse(raw);
    code = payload.code;
    message = payload.message;
    data = payload.data || '';
  } catch {
    const parts = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    const failed = parts.find(p => p.code !== 0);
    code = failed ? failed.code : 0;
    message = failed ? failed.message : 'OK';
    data = parts.map(p => p.data || '').join('');
  }
  if (code !== 0) throw new Error(`豆包TTS错误(${code}): ${message}`);
  return Buffer.from(data, 'base64');
}

// ---------- MiniMax（海螺）----------
const MINIMAX_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimax.cn/v1/t2a_v2';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'speech-02-hd';
const MINIMAX_VOICE = process.env.MINIMAX_VOICE || 'female-chengshu';

async function minimaxSynthesize(text) {
  const payload = {
    model: MINIMAX_MODEL,
    text,
    stream: false,
    voice_setting: { voice_id: MINIMAX_VOICE, speed: 1.0, vol: 1.0, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }
  };
  const res = await axios.post(MINIMAX_BASE_URL, payload, {
    headers: { Authorization: `Bearer ${MINIMAX_KEY}`, 'Content-Type': 'application/json' },
    timeout: 20000
  });
  const audio = res.data?.data?.audio;
  if (!audio) throw new Error(`MiniMax TTS 无音频返回: ${JSON.stringify(res.data).slice(0, 200)}`);
  return Buffer.from(audio, 'hex');
}

// ---------- 统一入口 ----------
function isConfigured() {
  if (PROVIDER === 'minimax') return Boolean(MINIMAX_KEY);
  return Boolean(VOLC_API_KEY);
}

async function synthesize(text) {
  if (!isConfigured()) throw new Error('TTS 未配置 Key');
  if (PROVIDER === 'minimax') return minimaxSynthesize(text);
  return volcSynthesize(text);
}

module.exports = { synthesize, isConfigured, PROVIDER };
