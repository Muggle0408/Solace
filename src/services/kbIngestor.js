// 知识库入库：Markdown 语义块解析（## 标题 | stages: x,y）→ 切块 → 向量化 → UPSERT
// 块自包含（300-600 字），超长块按 ~500 字 + 10% 重叠二次切分
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { embedTexts } = require('./embeddingClient');

const CHUNK_TARGET = 500;
const OVERLAP_RATIO = 0.1;

const LAYER_BY_PREFIX = [
  [/^1[-_]/, 'hsp'],
  [/^2[-_]/, 'intervention'],
  [/^3[-_]/, 'basic']
];

const qUpsert = db.prepare(`
  INSERT INTO kb_chunks (layer, title, stages, content, content_hash, embedding, dims, source, updated_at)
  VALUES (@layer, @title, @stages, @content, @content_hash, @embedding, @dims, @source, datetime('now'))
  ON CONFLICT(content_hash) DO UPDATE SET
    layer=excluded.layer, title=excluded.title, stages=excluded.stages,
    content=excluded.content, embedding=excluded.embedding, dims=excluded.dims,
    source=excluded.source, updated_at=datetime('now')
`);
const qDeleteMissing = db.prepare('DELETE FROM kb_chunks WHERE source = ? AND content_hash NOT IN (SELECT value FROM json_each(?))');

function layerOf(filename) {
  for (const [re, layer] of LAYER_BY_PREFIX) {
    if (re.test(filename)) return layer;
  }
  return 'basic';
}

// 解析一个知识库 Markdown 文件 → 块数组
function parseKnowledgeFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const blocks = [];
  let title = null;
  let stages = [];
  let buf = [];

  const flush = () => {
    const content = buf.join('\n').trim();
    if (title && content) blocks.push({ title, stages: stages.slice(), content });
    title = null;
    stages = [];
    buf = [];
  };

  for (const line of raw.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*\|\s*stages\s*:\s*([a-zA-Z_,，、\s]+)$/i);
    if (m) {
      flush();
      title = m[1].trim();
      stages = m[2].split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    } else if (/^#\s/.test(line) || /^>\s?/.test(line)) {
      continue; // 跳过文件级标题与引言
    } else if (title) {
      buf.push(line);
    }
  }
  flush();

  // 超长块二次切分（段落边界 + 10% 重叠）
  const out = [];
  for (const b of blocks) {
    if (b.content.length <= CHUNK_TARGET * 1.3) {
      out.push(b);
      continue;
    }
    const paras = b.content.split(/\n\s*\n/);
    let acc = '';
    let tail = '';
    for (const p of paras) {
      const piece = (acc ? '\n\n' : '') + p;
      if ((acc + piece).length > CHUNK_TARGET && acc) {
        out.push({ title: b.title, stages: b.stages, content: (tail + acc).trim() });
        tail = acc.slice(-Math.floor(CHUNK_TARGET * OVERLAP_RATIO));
        acc = p;
      } else {
        acc += piece;
      }
    }
    if (acc.trim()) out.push({ title: b.title, stages: b.stages, content: (tail + acc).trim() });
  }
  return out;
}

// 入库一个目录（默认 knowledge/）。返回统计 {files, blocks, embedded}
async function ingestKnowledgeDir(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  let blocks = 0;
  let embedded = 0;

  for (const file of files) {
    const layer = layerOf(file);
    const parsed = parseKnowledgeFile(path.join(dir, file));
    const hashes = [];

    // 找出需要（重新）向量化的新块
    const fresh = [];
    for (const b of parsed) {
      const hash = crypto.createHash('sha256').update(b.content).digest('hex').slice(0, 32);
      hashes.push(hash);
      const row = db.prepare('SELECT embedding FROM kb_chunks WHERE content_hash = ?').get(hash);
      if (!row || !row.embedding) fresh.push({ ...b, hash });
    }

    // 分批向量化（每批 16 条）
    for (let i = 0; i < fresh.length; i += 16) {
      const batch = fresh.slice(i, i + 16);
      const vecs = await embedTexts(batch.map((b) => `${b.title}\n${b.content}`));
      batch.forEach((b, j) => {
        const vec = Float32Array.from(vecs[j]);
        qUpsert.run({
          layer,
          title: b.title,
          stages: b.stages.join(','),
          content: b.content,
          content_hash: b.hash,
          embedding: Buffer.from(vec.buffer),
          dims: vec.length,
          source: file
        });
        embedded++;
      });
    }

    // 清理该文件中已删除的块
    qDeleteMissing.run(file, JSON.stringify(hashes));
    blocks += parsed.length;
  }
  return { files: files.length, blocks, embedded };
}

module.exports = { ingestKnowledgeDir, parseKnowledgeFile };
