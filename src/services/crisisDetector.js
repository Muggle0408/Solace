const CRISIS_KEYWORDS = [
  '自杀', '自殺', '想死', '不想活', '结束生命', '跳楼', '割腕', '自残', '自傷',
  'kill myself', 'suicide', 'end my life', '不想活了', '活不下去', '死了算了'
];

function detectCrisis(text) {
  if (!text) return false;
  return CRISIS_KEYWORDS.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
}

module.exports = { detectCrisis };
