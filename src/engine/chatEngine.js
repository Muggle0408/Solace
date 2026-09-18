const { detectCrisis } = require('../services/crisisDetector');
const { getCurrentStage, isValidTransition } = require('../config/stages');
const ruleResponder = require('./ruleResponder');
const llmResponder = require('./llmResponder');

const USE_LLM = process.env.USE_LLM === 'true';

async function processMessage(message, history = []) {
  // 1. 危机识别优先
  if (detectCrisis(message)) {
    return ruleResponder.generateCrisisResponse();
  }

  // 2. 从 history 恢复当前 stage
  const currentStage = getCurrentStage(history);

  // 3. 若启用大模型，尝试 LLM 生成；失败或非法跳转则回退规则
  if (USE_LLM) {
    try {
      const response = await llmResponder.generateResponse(message, currentStage, history);
      if (isValidTransition(currentStage, response.stage, message)) {
        return response;
      }
      console.warn(`非法阶段跳转: ${currentStage} -> ${response.stage}，回退规则引擎`);
    } catch (err) {
      console.warn('LLM 响应失败，回退到规则引擎:', err.message);
    }
  }

  // 4. 默认使用规则引擎
  return ruleResponder.generateResponse(message, currentStage);
}

module.exports = { processMessage };
