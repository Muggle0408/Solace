// RAG 检索：查询向量化 → 余弦相似度 + 阶段加权 → top-k 知识块
// 边界：仅作 prompt 参考注入，不触碰状态机与危机规则门（危机在 chatEngine 更早处拦截）
const db = require('./db');
const { embedTexts } = require('./embeddingClient');

const DEFAULT_TOP_K = Number(process.env.KB_TOP_K) || 4;
const SIM_WEIGHT = 0.75;
const STAGE_BOOST = 0.25;
const MIN_SCORE = 0.05;

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function kbSize() {
  return db.prepare('SELECT COUNT(*) AS n FROM kb_chunks WHERE embedding IS NOT NULL').get().n;
}

// message: 用户消息；stage: 当前阶段码；topK: 返回块数
async function retrieveKnowledge(message, stage, topK = DEFAULT_TOP_K) {
  if (!message || !message.trim() || !kbSize()) return [];

  let q;
  try {
    [q] = await embedTexts([String(message).slice(0, 500)]);
  } catch (err) {
    console.warn('[RAG] 查询向量化失败，本轮回退为无检索:', err.message);
    return [];
  }

  const rows = db.prepare(
    'SELECT layer, title, stages, content, embedding, dims FROM kb_chunks WHERE embedding IS NOT NULL'
  ).all();

  const scored = rows.map((r) => {
    const emb = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.dims);
    const sim = cosine(q, emb);
    const hitStage = stage && r.stages
      && r.stages.split(',').map((s) => s.trim()).includes(stage);
    return {
      layer: r.layer,
      title: r.title,
      stages: r.stages,
      content: r.content,
      score: SIM_WEIGHT * sim + (hitStage ? STAGE_BOOST : 0)
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, topK)
    .filter((r) => r.score >= MIN_SCORE)
    .map((r) => ({ ...r, score: Math.round(r.score * 1000) / 1000 }));
}

module.exports = { retrieveKnowledge, kbSize };
