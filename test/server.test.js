// 测试默认关闭大模型调用，避免真实 API 请求带来的延迟和费用
process.env.USE_LLM = 'false';
// 关闭限流，避免高频测试请求被拦截
process.env.RATE_LIMIT_MAX = '0';
// 反馈数据写入临时目录，不污染仓库
process.env.FEEDBACK_FILE = require('path').join(require('os').tmpdir(), `fb-test-${Date.now()}.jsonl`);

const { describe, it } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../server');
const { detectCrisis } = require('../src/services/crisisDetector');
const ruleResponder = require('../src/engine/ruleResponder');
const { getCurrentStage, isValidTransition } = require('../src/config/stages');

describe('健康检查', () => {
  it('GET /api/health 返回服务状态和 LLM 模式', async () => {
    const res = await request(app).get('/api/health').expect(200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(res.body.version, '0.1.0');
    assert.strictEqual(res.body.llmEnabled, false);
    assert.ok(res.body.provider);
    assert.ok(res.body.model);
  });
});

describe('静态资源', () => {
  it('GET / 返回首页 HTML', async () => {
    const res = await request(app).get('/').expect(200);
    assert.ok(res.text.includes('情绪空间'));
  });
});

describe('危机识别', () => {
  it('识别中文自杀相关表达', () => {
    assert.strictEqual(detectCrisis('我想自杀'), true);
    assert.strictEqual(detectCrisis('我不想活了'), true);
  });

  it('识别英文自杀相关表达', () => {
    assert.strictEqual(detectCrisis('I want to kill myself'), true);
    assert.strictEqual(detectCrisis('I am thinking about suicide'), true);
  });

  it('正常情绪表达不触发危机', () => {
    assert.strictEqual(detectCrisis('我今天很焦虑'), false);
    assert.strictEqual(detectCrisis('我感到委屈'), false);
  });
});

describe('阶段工具函数', () => {
  it('从 history 恢复当前 stage', () => {
    const history = [
      { role: 'bot', content: '你好', stage: 'welcome' },
      { role: 'user', content: '焦虑' },
      { role: 'bot', content: '谢谢', stage: 'check_in' }
    ];
    assert.strictEqual(getCurrentStage(history), 'check_in');
  });

  it('空 history 返回 welcome', () => {
    assert.strictEqual(getCurrentStage([]), 'welcome');
  });

  it('合法跳转校验', () => {
    assert.strictEqual(isValidTransition('welcome', 'check_in'), true);
    assert.strictEqual(isValidTransition('welcome', 'safety'), false);
    assert.strictEqual(isValidTransition('check_in', 'check_in'), true);
  });

  it('用户拒绝时不推进', () => {
    assert.strictEqual(isValidTransition('rebuild', 'regulation', '我不想做'), false);
  });
});

describe('对话流程', () => {
  it('welcome 阶段返回初始问候', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: '', history: [] })
      .expect(200);

    assert.strictEqual(res.body.stage, 'check_in');
    assert.ok(res.body.text.includes('你现在感觉怎么样'));
    assert.ok(res.body.options.length > 0);
  });

  it('危机输入直接触发 crisis 阶段', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: '我想自杀', history: [] })
      .expect(200);

    assert.strictEqual(res.body.stage, 'crisis');
    assert.strictEqual(res.body.type, 'crisis');
    assert.ok(res.body.text.includes('400-161-9995'));
  });

  it('完整流程从 welcome 推进到 closing', async () => {
    const steps = [
      { msg: '焦虑', history: [], expected: 'check_in' },
      { msg: '胸口发紧', history: [
        { role: 'bot', content: '...', stage: 'check_in' }
      ], expected: 'safety' },
      { msg: '我觉得一切都完了', history: [
        { role: 'bot', content: '...', stage: 'check_in' },
        { role: 'bot', content: '...', stage: 'safety' }
      ], expected: 'awareness' },
      { msg: '好像有', history: [
        { role: 'bot', content: '...', stage: 'check_in' },
        { role: 'bot', content: '...', stage: 'safety' },
        { role: 'bot', content: '...', stage: 'awareness' }
      ], expected: 'socratic' },
      { msg: 'Ta 可能会说我太苛责自己了', history: [
        { role: 'bot', content: '...', stage: 'check_in' },
        { role: 'bot', content: '...', stage: 'safety' },
        { role: 'bot', content: '...', stage: 'awareness' },
        { role: 'bot', content: '...', stage: 'socratic' }
      ], expected: 'rebuild' },
      { msg: '做呼吸练习', history: [
        { role: 'bot', content: '...', stage: 'check_in' },
        { role: 'bot', content: '...', stage: 'safety' },
        { role: 'bot', content: '...', stage: 'awareness' },
        { role: 'bot', content: '...', stage: 'socratic' },
        { role: 'bot', content: '...', stage: 'rebuild' }
      ], expected: 'regulation' },
      { msg: '完成了，感觉平静一些', history: [
        { role: 'bot', content: '...', stage: 'check_in' },
        { role: 'bot', content: '...', stage: 'safety' },
        { role: 'bot', content: '...', stage: 'awareness' },
        { role: 'bot', content: '...', stage: 'socratic' },
        { role: 'bot', content: '...', stage: 'rebuild' },
        { role: 'bot', content: '...', stage: 'regulation' }
      ], expected: 'closing' }
    ];

    for (const step of steps) {
      const res = await request(app)
        .post('/api/chat')
        .send({ message: step.msg, history: step.history })
        .expect(200);
      assert.strictEqual(res.body.stage, step.expected, `消息 "${step.msg}" 应跳转到 ${step.expected}`);
    }
  });
});

describe('规则响应器', () => {
  it('生成危机响应包含热线信息', () => {
    const res = ruleResponder.generateCrisisResponse();
    assert.strictEqual(res.stage, 'crisis');
    assert.strictEqual(res.isCrisis, true);
    assert.ok(res.text.includes('全国 24 小时心理援助热线'));
  });
});

describe('满意度反馈', () => {
  it('POST /api/feedback 接收 👍 反馈并落盘', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .send({ messageId: 'test-msg-1', stage: 'check_in', vote: 'up' })
      .expect(200);
    assert.strictEqual(res.body.ok, true);
  });

  it('拒绝非法 vote 值', async () => {
    await request(app)
      .post('/api/feedback')
      .send({ messageId: 'test-msg-2', vote: 'meh' })
      .expect(400);
  });

  it('导出接口返回已落盘的反馈', async () => {
    const res = await request(app).get('/api/feedback/export').expect(200);
    assert.ok(res.body.count >= 1);
    assert.ok(Array.isArray(res.body.items));
  });
});

describe('语音合成', () => {
  it('未配置火山 Key 时 TTS 返回 501（前端降级浏览器朗读）', async () => {
    const res = await request(app)
      .post('/api/tts')
      .send({ text: '你好' })
      .expect(501);
    assert.strictEqual(res.body.error, 'TTS_NOT_CONFIGURED');
  });

  it('拒绝空文本或过长的文本', async () => {
    await request(app).post('/api/tts').send({ text: '' }).expect(400);
    await request(app).post('/api/tts').send({ text: '长'.repeat(501) }).expect(400);
  });
});
