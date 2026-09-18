// 7 阶段应激干预流程定义

const STAGES = {
  WELCOME: 'welcome',
  CHECK_IN: 'check_in',
  SAFETY: 'safety',
  AWARENESS: 'awareness',
  SOCRATIC: 'socratic',
  REBUILD: 'rebuild',
  REGULATION: 'regulation',
  CLOSING: 'closing',
  RATING: 'rating',
  END: 'end',
  CRISIS: 'crisis'
};

// 每个阶段的目标
const STAGE_GOALS = {
  [STAGES.WELCOME]: '开场，邀请用户表达当前最强烈的情绪',
  [STAGES.CHECK_IN]: '确认情绪，询问身体感受',
  [STAGES.SAFETY]: '建立安全感，让用户感到被接住',
  [STAGES.AWARENESS]: '引导用户区分事实与应激状态下的解读',
  [STAGES.SOCRATIC]: '用苏格拉底式反问挑战信息扭曲',
  [STAGES.REBUILD]: '引导用户补充被忽略的其他可能性',
  [STAGES.REGULATION]: '提供 grounding 或呼吸等轻调节练习',
  [STAGES.CLOSING]: '收尾，邀请情绪评分',
  [STAGES.RATING]: '总结关键洞察，结束对话',
  [STAGES.END]: '结束对话，给出正向收尾'
};

// 阶段信号词参考（给大模型和后端做参考，非硬规则）
const STAGE_SIGNALS = {
  [STAGES.WELCOME]: ['刚来', '你好', '在吗'],
  [STAGES.CHECK_IN]: ['焦虑', '委屈', '愤怒', '疲惫', '孤独', '难过', '不开心'],
  [STAGES.SAFETY]: ['胸口', '心跳', '头晕', '发抖', '麻木', '身体', '睡不着'],
  [STAGES.AWARENESS]: ['完了', '一定', '肯定', '绝对', '不可能', '我敢肯定'],
  [STAGES.SOCRATIC]: ['好像有', '也许', '可能', '不一定', '那次'],
  [STAGES.REBUILD]: ['朋友', 'Ta', '别人', '另一面', '换个角度'],
  [STAGES.REGULATION]: ['练习', '呼吸', 'grounding', '着陆', '平静'],
  [STAGES.CLOSING]: ['评分', '打分', '好了一些', '平静', '结束'],
  [STAGES.RATING]: ['保存', '结束', '再聊'],
  [STAGES.END]: ['谢谢', '再见', '拜拜']
};

// 合法阶段跳转表
const VALID_TRANSITIONS = {
  [STAGES.WELCOME]: [STAGES.CHECK_IN],
  [STAGES.CHECK_IN]: [STAGES.SAFETY],
  [STAGES.SAFETY]: [STAGES.AWARENESS],
  [STAGES.AWARENESS]: [STAGES.SOCRATIC],
  [STAGES.SOCRATIC]: [STAGES.REBUILD],
  [STAGES.REBUILD]: [STAGES.REGULATION, STAGES.CLOSING],
  [STAGES.REGULATION]: [STAGES.CLOSING],
  [STAGES.CLOSING]: [STAGES.RATING],
  [STAGES.RATING]: [STAGES.END],
  [STAGES.END]: [STAGES.WELCOME],
  [STAGES.CRISIS]: [STAGES.WELCOME]
};

// 判断阶段跳转是否合法
function isValidTransition(currentStage, nextStage, message = '') {
  if (!currentStage || !nextStage) return false;
  const allowed = VALID_TRANSITIONS[currentStage] || [];
  if (!allowed.includes(nextStage)) return false;

  // 用户明确拒绝推进时，不进入下一阶段
  const refusalWords = ['不想', '不要', '跳过', '算了', '别问', '不说'];
  if (refusalWords.some(w => message.includes(w))) return false;

  return true;
}

// 从对话历史中恢复当前阶段
function getCurrentStage(history = []) {
  if (!history || history.length === 0) return STAGES.WELCOME;

  // 从后往前找最后一条 bot 消息的 stage
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'bot' && history[i].stage) {
      return history[i].stage;
    }
  }

  return STAGES.WELCOME;
}

module.exports = {
  STAGES,
  STAGE_GOALS,
  STAGE_SIGNALS,
  VALID_TRANSITIONS,
  isValidTransition,
  getCurrentStage
};
