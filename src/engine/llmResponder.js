const { chatCompletion } = require('../services/llmClient');

async function generateResponse(message, stage, history = []) {
  // TODO: V1 实现基于 Kimi 大模型的对话生成
  // 1. 构建系统 Prompt（角色 + 7 阶段约束 + 安全规则）
  // 2. 拼接历史对话
  // 3. 调用 llmClient.chatCompletion
  // 4. 解析 JSON 输出并校验
  // 5. 不符合状态时回退到规则引擎
  throw new Error('LLM responder not implemented yet');
}

module.exports = { generateResponse };
