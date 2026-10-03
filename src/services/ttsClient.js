// 情感 TTS 客户端：支持火山引擎 / MiniMax 双 Provider，Key 仅存服务端
// 通过 TTS_PROVIDER 环境变量切换：volc（默认）| minimax
const axios = require('axios');
const crypto = require('crypto');

const PROVIDER = process.env.TTS_PROVIDER || 'volc';

// ---------- 火山引擎 ----------
const VOLC_APPID = process.env.VOLC_APPID;
const VOLC_TOKEN = process.env.VOLC_TOKEN;
const VOLC_CLUSTER = process.env.VOLC_CLUSTER || 'volcano_tts';
// 音色 ID 可在火山控制台「音色列表」试听替换
const VOLC_VOICE = process.env.VOLC_VOICE || 'zh_female_qingxin';

async function volcSynthesize(text) {
  const payload = {
    app: { appid: VOLC_APPID, token: VOLC_TOKEN, cluster: VOLC_CLUSTER },
    user: { uid: 'solace-web' },
    audio: { voice_type: VOLC_VOICE, encoding: 'mp3', speed_ratio: 1.0 },
    request: { reqid: crypto.randomUUID(), text, operation: 'query' }
  };
  const res = await axios.post('https://openspeech.bytedance.com/api/v1/tts', payload, {
    headers: { Authorization: `Bearer;${VOLC_TOKEN}`, 'Content-Type': 'application/json' },
    timeout: 15000
  });
  const data = res.data;
  if (data.code !== 3000) throw new Error(`火山TTS错误(${data.code}): ${data.message}`);
  return Buffer.from(data.data, 'base64');
}

// ---------- MiniMax（海螺）----------
const MINIMAX_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimax.cn/v1/t2a_v2';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'speech-02-hd';
// 音色 ID 见文档「系统音色列表」：female-chengshu（成熟女性）/ female-yujie（御姐）等
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
  // MiniMax 返回 hex 编码音频
  return Buffer.from(audio, 'hex');
}

// ---------- 统一入口 ----------
function isConfigured() {
  if (PROVIDER === 'minimax') return Boolean(MINIMAX_KEY);
  return Boolean(VOLC_APPID && VOLC_TOKEN);
}

async function synthesize(text) {
  if (!isConfigured()) throw new Error('TTS 未配置 Key');
  if (PROVIDER === 'minimax') return minimaxSynthesize(text);
  return volcSynthesize(text);
}

module.exports = { synthesize, isConfigured, PROVIDER };
