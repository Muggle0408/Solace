const HOTLINES = [
  { name: '全国 24 小时心理援助热线', number: '400-161-9995' },
  { name: '北京心理危机研究与干预中心', number: '010-82951332' },
  { name: '生命热线', number: '400-821-1215' }
];

function formatHotlines() {
  return HOTLINES.map(h => `• ${h.name}：${h.number}`).join('\n');
}

module.exports = { HOTLINES, formatHotlines };
