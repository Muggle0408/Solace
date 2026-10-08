// V1 周报生成器（数据收集分析方案 V1 §5）：node scripts/weekly-report.js
// 读 SQLite + journalctl → 输出 markdown 周报到 reports/weekly-<周一>.md 并打印
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { buildReport } = require('../src/services/weeklyMetrics');

const dir = path.join(__dirname, '..', 'reports');
fs.mkdirSync(dir, { recursive: true });

const { markdown, from } = buildReport();
const file = path.join(dir, `weekly-${from.slice(0, 10)}.md`);
fs.writeFileSync(file, markdown, 'utf8');
console.log(markdown);
console.log(`[weekly] 已写入 ${file}`);
