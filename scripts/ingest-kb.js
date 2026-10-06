// 知识库入库脚本：node scripts/ingest-kb.js [目录]
require('dotenv').config();
const path = require('path');
const { ingestKnowledgeDir } = require('../src/services/kbIngestor');
const { isConfigured, PROVIDER, MODEL } = require('../src/services/embeddingClient');

const dir = process.argv[2] || path.join(__dirname, '..', 'knowledge');

(async () => {
  console.log(`[ingest] 目录: ${dir} | embedding: ${PROVIDER}${isConfigured() ? ` (${MODEL})` : ' (mock 模式)'}`);
  const stats = await ingestKnowledgeDir(dir);
  console.log(`[ingest] 完成：${stats.files} 个文件，${stats.blocks} 个知识块，新向量化 ${stats.embedded} 块`);
  if (!isConfigured()) {
    console.log('[ingest] 提示：当前为 mock 向量，检索效果不代表真实水平；配置 EMBEDDING_API_KEY 后重新执行本脚本即可');
  }
})().catch((err) => {
  console.error('[ingest] 失败:', err.message);
  process.exit(1);
});
