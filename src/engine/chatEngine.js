const { detectCrisis } = require('../services/crisisDetector');
const ruleResponder = require('./ruleResponder');
const llmResponder = require('./llmResponder');

const USE_LLM = process.env.USE_LLM === 'true';

async function processMessage(message, stage = 'welcome', history = []) {
  // 1. 危机识别优先
  if (detectCrisis(message)) {
    return ruleResponder.generateCrisisResponse();
  }

  // 2. 若启用大模型，尝试 LLM 生成；失败则回退规则
  if (USE_LLM) {
    try {
      return await llmResponder.generateResponse(message, stage, history);
    } catch (err) {
      console.warn('LLM 响应失败，回退到规则引擎:', err.message);
    }
  }

  // 3. 默认使用规则引擎
  return ruleResponder.generateResponse(message, stage);
}

module.exports = { processMessage };
