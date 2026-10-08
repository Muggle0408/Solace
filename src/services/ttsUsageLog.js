// TTS 用量落盘（V1 周报"语音使用率"数据源）：每次合成成功追加一行 JSONL（data/ 已 gitignore）
const fs = require('fs');
const path = require('path');

function logTtsUse({ convId = null, userId = null, chars = 0 }) {
  try {
    const file = path.join(__dirname, '..', '..', 'data', 'tts-usage.jsonl');
    const rec = { at: new Date().toISOString().replace('T', ' ').slice(0, 19), convId, userId, chars };
    fs.appendFileSync(file, JSON.stringify(rec) + '\n');
  } catch { /* 落盘失败不影响主流程 */ }
}

module.exports = { logTtsUse };
