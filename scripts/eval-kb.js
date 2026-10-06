// RAG 检索命中率评测：node scripts/eval-kb.js
// 命中定义：top-K 结果中存在任一块「stages 含期望阶段」或「标题/正文命中任一关键词」
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { retrieveKnowledge, kbSize } = require('../src/services/kbRetriever');
const { isConfigured, PROVIDER } = require('../src/services/embeddingClient');

const TOP_K = Number(process.env.KB_TOP_K) || 4;

(async () => {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eval', 'kb-eval.json'), 'utf8'));
  console.log(`[eval] ${cases.length} 题 | top-K=${TOP_K} | embedding=${PROVIDER}${isConfigured() ? '' : '（mock，结果不代表真实水平）'}`);
  if (!kbSize()) {
    console.error('[eval] 知识库为空，请先运行 node scripts/ingest-kb.js');
    process.exit(1);
  }

  let hit = 0;
  const rows = [];
  for (const c of cases) {
    const results = await retrieveKnowledge(c.q, c.stage, TOP_K);
    const ok = results.some((r) => {
      const stageHit = r.stages && r.stages.split(',').map((s) => s.trim()).includes(c.stage);
      const kwHit = c.keywords.some((k) => (r.title + r.content).includes(k));
      return stageHit || kwHit;
    });
    if (ok) hit++;
    rows.push(`${ok ? '✅' : '❌'} ${c.q}  →  ${results[0] ? results[0].title : '(无结果)'}`);
  }
  console.log(rows.join('\n'));
  console.log(`[eval] 命中率 hit@${TOP_K} = ${hit}/${cases.length} = ${Math.round((hit / cases.length) * 100)}%（目标 ≥85%）`);
})().catch((err) => {
  console.error('[eval] 失败:', err.message);
  process.exit(1);
});
