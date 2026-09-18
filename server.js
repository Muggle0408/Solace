const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// 规则版对话接口
app.post('/api/chat', (req, res) => {
  const { message, stage = 'welcome' } = req.body;
  const response = generateRuleBasedResponse(message, stage);
  res.json(response);
});

const CRISIS_KEYWORDS = [
  '自杀', '自殺', '想死', '不想活', '结束生命', '跳楼', '割腕', '自残', '自傷',
  'kill myself', 'suicide', 'end my life', '不想活了', '活不下去', '死了算了'
];

const HOTLINES = [
  { name: '全国 24 小时心理援助热线', number: '400-161-9995' },
  { name: '北京心理危机研究与干预中心', number: '010-82951332' },
  { name: '生命热线', number: '400-821-1215' }
];

function detectCrisis(text) {
  if (!text) return false;
  return CRISIS_KEYWORDS.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
}

function generateRuleBasedResponse(message, stage) {
  const lowerMsg = (message || '').toLowerCase();
  const isCrisis = detectCrisis(message);

  if (isCrisis) {
    return {
      stage: 'crisis',
      type: 'crisis',
      text: '我注意到你现在可能正处于非常痛苦的时刻。我想先确认你的安全。\n\n你并不孤单，以下是可以立刻获得帮助的渠道：\n\n' +
        HOTLINES.map(h => `• ${h.name}：${h.number}`).join('\n') +
        '\n\n如果你愿意，可以告诉我你现在在哪里，或者身边有没有可以陪伴你的人。',
      options: ['我现在安全', '我想继续聊聊', '我需要独处一会儿']
    };
  }

  switch (stage) {
    case 'welcome':
      return {
        stage: 'check_in',
        type: 'text',
        text: '嗨，欢迎来到情绪空间。你现在感觉怎么样？可以用一句话说说此刻最强烈的情绪。',
        options: ['焦虑', '委屈', '愤怒', '疲惫', '孤独', '其他']
      };

    case 'check_in':
      return {
        stage: 'safety',
        type: 'text',
        text: `谢谢你愿意告诉我。"${message}"这种感受一定不好受。我想先陪你看一看它，而不是急着赶走它。\n\n你现在身体有什么感觉吗？比如胸口发紧、心跳加快、或者很疲惫？`,
        options: ['胸口发紧', '心跳很快', '头晕/疲惫', '没什么身体感觉']
      };

    case 'safety':
      return {
        stage: 'awareness',
        type: 'text',
        text: '我听到了。先让身体在这里停一下——这些反应都是正常的，它们在说：你现在压力很大。\n\n接下来，我想邀请你做一个小小的区分：此刻你脑海里最强烈的一个念头是什么？把它说出来，我们把它当成一种"可能性"，而不是"事实"。',
        options: ['我觉得一切都完了', '我肯定被讨厌了', '我做不好任何事', '我不知道该想什么']
      };

    case 'awareness':
      return {
        stage: 'socratic',
        type: 'text',
        text: `好的，你注意到这个念头："${message}"\n\n在应激状态下，我们的大脑会把负面信号放大，同时过滤掉没那么糟糕的信息。我想 gently 地问你：有没有一个时刻，这件事其实没有你想的那么糟？或者，有没有一个证据，是支持"情况没那么确定"的？`,
        options: ['好像有', '我想不到', '可能有但我不确定']
      };

    case 'socratic':
      return {
        stage: 'rebuild',
        type: 'text',
        text: '这很好，愿意重新看信息本身就是很勇敢的事。\n\n如果换成你最信任、最温柔的一位朋友来看这件事，Ta 可能会注意到什么？或者 Ta 会对你说什么？',
        options: ['Ta 可能会说我太苛责自己了', 'Ta 可能会看到事情的另一面', 'Ta 可能会安慰我', '我不知道']
      };

    case 'rebuild':
      return {
        stage: 'regulation',
        type: 'text',
        text: '谢谢你愿意打开这个视角。很多时候，我们不是被事实打败，而是被应激状态下被筛选过的事实打败。\n\n现在情绪可能稍微回落一点了。你想做一个 1 分钟的小练习，让身体也回到当下吗？',
        options: ['做 grounding 练习', '做呼吸练习', '直接结束']
      };

    case 'regulation':
      if (lowerMsg.includes('grounding') || lowerMsg.includes('着陆')) {
        return {
          stage: 'closing',
          type: 'exercise',
          text: '我们一起来做一个简单的 5-4-3-2-1 着陆练习：\n\n说出你看到的 5 样东西、听到的 4 种声音、触摸到的 3 种质感、闻到的 2 种气味、尝到的 1 种味道。\n\n慢慢来，不需要着急。完成后告诉我你的感受。',
          options: ['完成了，感觉平静一些', '完成了，还是很难受', '我想跳过']
        };
      }
      if (lowerMsg.includes('呼吸') || lowerMsg.includes('breath')) {
        return {
          stage: 'closing',
          type: 'exercise',
          text: '我们一起来做几次深呼吸：\n\n吸气 4 秒 → 屏住 4 秒 → 呼气 6 秒。\n\n重复 3-5 次，把注意力放在呼吸上。完成后告诉我你的感受。',
          options: ['完成了，感觉平静一些', '完成了，还是很难受', '我想跳过']
        };
      }
      return {
        stage: 'closing',
        type: 'text',
        text: '没关系，我们就这样说说话也很好。重要的是，你已经走完了从情绪突袭到重新看见自己的一小段路。',
        options: []
      };

    case 'closing':
      return {
        stage: 'rating',
        type: 'text',
        text: '在结束前，我想邀请你给一个 0-10 分的评分：\n\n和刚打开这个页面时相比，你现在的情绪强度是多少？（0 = 完全没有，10 = 强烈到无法承受）',
        options: ['0-3', '4-6', '7-10']
      };

    case 'rating':
      return {
        stage: 'end',
        type: 'summary',
        text: '谢谢你愿意和我分享这一段。\n\n你今天注意到的一个新视角是：即使在一个很强烈的念头面前，你也可以停下来，检查信息的完整性，并找到另一种可能性。\n\n我会把这次记录保存下来，你可以随时回来看看。',
        options: ['保存并结束', '再聊一次']
      };

    case 'end':
      return {
        stage: 'welcome',
        type: 'text',
        text: '好的，我随时在这里。当你需要时，欢迎回来。',
        options: []
      };

    default:
      return {
        stage: 'welcome',
        type: 'text',
        text: '嗨，欢迎来到情绪空间。你现在感觉怎么样？',
        options: ['焦虑', '委屈', '愤怒', '疲惫', '孤独', '其他']
      };
  }
}

module.exports = { app, detectCrisis, generateRuleBasedResponse };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`情绪疏导 Agent 运行在 http://localhost:${PORT}`);
  });
}
