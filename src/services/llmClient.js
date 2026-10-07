const axios = require('axios');

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

  try {
    const response = await axios.post(
      `${config.baseUrl}/chat/completions`,
      {
        model: config.model,
        messages,
        max_tokens: options.max_tokens ?? 2000,
        ...options
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        timeout: 60000
      }
    );

    const content = response.data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error(`${LLM_PROVIDER} API 返回内容为空`);
    }

    return content;
  } catch (err) {
    if (err.response) {
      const errorData = typeof err.response.data === 'object'
        ? JSON.stringify(err.response.data)
        : String(err.response.data);
      throw new Error(`${LLM_PROVIDER} API 错误 (${err.response.status}): ${errorData}`);
    }
    throw err;
  }
}

/**
 * 流式调用：逐 delta 回调增量文本，stream 结束后 resolve 完整内容
 * @param {Array} messages - OpenAI 格式的消息数组
 * @param {(delta: string) => void} onDelta - 增量回调（可能含乱码分片，由调用方拼装）
 * @param {Object} options - 可选参数
 * @returns {Promise<string>} 完整文本
 */
async function chatCompletionStream(messages, onDelta, options = {}) {
  if (!config) {
    throw new Error(`不支持的 LLM_PROVIDER: ${LLM_PROVIDER}`);
  }
  if (!config.apiKey) {
    throw new Error(`${LLM_PROVIDER === 'kimi' ? 'KIMI_API_KEY' : 'DEEPSEEK_API_KEY'} 未配置`);
  }

  const response = await axios.post(
    `${config.baseUrl}/chat/completions`,
    {
      model: config.model,
      messages,
      max_tokens: options.max_tokens ?? 2000,
      stream: true,
      ...options
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        Accept: 'text/event-stream'
      },
      responseType: 'stream',
      timeout: 90000
    }
  );

  return new Promise((resolve, reject) => {
    let raw = '';
    let buffer = '';
    response.data.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 半行留到下一分片
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            raw += delta;
            onDelta(delta);
          }
        } catch {
          // 忽略无法解析的心跳/注释行
        }
      }
    });
    response.data.on('end', () => resolve(raw));
    response.data.on('error', reject);
  });
}

module.exports = { chatCompletion, chatCompletionStream, LLM_PROVIDER };
