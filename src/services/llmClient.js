const LLM_PROVIDER = process.env.LLM_PROVIDER || 'kimi';

const PROVIDERS = {
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: process.env.KIMI_API_KEY,
    model: process.env.KIMI_MODEL || 'moonshot-v1-8k'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  }
};

const config = PROVIDERS[LLM_PROVIDER];

if (!config) {
  console.warn(`警告：不支持的 LLM_PROVIDER: ${LLM_PROVIDER}，可用值: ${Object.keys(PROVIDERS).join(', ')}`);
}

if (!config?.apiKey) {
  console.warn(`警告：未设置 ${LLM_PROVIDER === 'kimi' ? 'KIMI_API_KEY' : 'DEEPSEEK_API_KEY'} 环境变量，大模型调用将不可用`);
}

/**
 * 调用大模型 Chat Completions API
 * @param {Array} messages - OpenAI 格式的消息数组
 * @param {Object} options - 可选参数
 * @returns {Promise<string>} 模型返回的文本内容
 */
async function chatCompletion(messages, options = {}) {
  if (!config) {
    throw new Error(`不支持的 LLM_PROVIDER: ${LLM_PROVIDER}`);
  }

  if (!config.apiKey) {
    throw new Error(`${LLM_PROVIDER === 'kimi' ? 'KIMI_API_KEY' : 'DEEPSEEK_API_KEY'} 未配置`);
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: Buffer.from(JSON.stringify({
      model: config.model,
      messages,
      max_tokens: options.max_tokens ?? 2000,
      ...options
    }), 'utf-8')
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${LLM_PROVIDER} API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(`${LLM_PROVIDER} API 返回内容为空`);
  }

  return content;
}

module.exports = { chatCompletion, LLM_PROVIDER };
