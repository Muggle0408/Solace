const KIMI_API_BASE = 'https://api.moonshot.cn/v1';
const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_MODEL = process.env.KIMI_MODEL || 'moonshot-v1-8k';

if (!KIMI_API_KEY) {
  console.warn('警告：未设置 KIMI_API_KEY 环境变量，大模型调用将不可用');
}

/**
 * 调用 Kimi Chat Completions API
 * @param {Array} messages - OpenAI 格式的消息数组
 * @param {Object} options - 可选参数
 * @returns {Promise<string>} 模型返回的文本内容
 */
async function chatCompletion(messages, options = {}) {
  if (!KIMI_API_KEY) {
    throw new Error('KIMI_API_KEY 未配置');
  }

  const response = await fetch(`${KIMI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KIMI_API_KEY}`
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      messages,
      max_tokens: options.max_tokens ?? 2000,
      ...options
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kimi API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Kimi API 返回内容为空');
  }

  return content;
}

module.exports = { chatCompletion };
