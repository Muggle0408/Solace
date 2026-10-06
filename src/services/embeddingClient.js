// 文本向量化：SiliconFlow 云端 BGE-M3（默认）/ 确定性 mock（未配置密钥时，供开发测试离线）
// BGE-M3 为 1024 维稠密向量；mock 为 256 维字符-bigram 哈希投影（仅保证语义重叠的文本相似度高）
const crypto = require('crypto');
const axios = require('axios');

const PROVIDER = process.env.EMBEDDING_PROVIDER
  || (process.env.EMBEDDING_API_KEY ? 'siliconflow' : 'mock');
const BASE_URL = process.env.EMBEDDING_BASE_URL || 'https://api.siliconflow.cn/v1';
const MODEL = process.env.EMBEDDING_MODEL || 'BAAI/bge-m3';
const MOCK_DIMS = 256;

function isConfigured() {
  return PROVIDER !== 'mock' && Boolean(process.env.EMBEDDING_API_KEY);
}

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

// 确定性 mock：字符 bigram → 双哈希槽位 ±1，保证相同/相似文本向量稳定且相近
function mockEmbed(text) {
  const vec = new Float32Array(MOCK_DIMS);
  const chars = [...String(text).toLowerCase().replace(/\s+/g, '')];
  for (let i = 0; i < chars.length - 1; i++) {
    const h = crypto.createHash('sha256').update(chars[i] + chars[i + 1]).digest();
    const i1 = h.readUInt32BE(0) % MOCK_DIMS;
    const i2 = h.readUInt32BE(4) % MOCK_DIMS;
    vec[i1] += 1;
    vec[i2] += h[8] % 2 === 0 ? 1 : -1;
  }
  return normalize(Array.from(vec));
}

// texts: string[] → number[][]（均为单位向量）
async function embedTexts(texts) {
  if (!isConfigured()) {
    return texts.map(mockEmbed);
  }
  const res = await axios.post(
    `${BASE_URL}/embeddings`,
    { model: MODEL, input: texts },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.EMBEDDING_API_KEY}`
      },
      timeout: 30000
    }
  );
  const data = res.data && res.data.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error('embedding API 返回格式异常');
  }
  return data.map((d) => normalize(d.embedding));
}

module.exports = { embedTexts, isConfigured, PROVIDER, MODEL };
