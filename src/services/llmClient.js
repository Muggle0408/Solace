// Kimi API 薄封装，V1 阶段实现
// 当前保留接口，默认不启用

async function chatCompletion(messages, options = {}) {
  // TODO: V1 接入 Kimi API
  // const apiKey = process.env.KIMI_API_KEY;
  // const response = await fetch('https://api.moonshot.cn/v1/chat/completions', { ... });
  throw new Error('LLM client not implemented yet');
}

module.exports = { chatCompletion };
