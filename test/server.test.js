const { describe, it } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../server');
const { detectCrisis } = require('../src/services/crisisDetector');
const ruleResponder = require('../src/engine/ruleResponder');

describe('健康检查', () => {
  it('GET /api/health 返回服务状态', async () => {
    const res = await request(app).get('/api/health').expect(200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(res.body.version, '0.1.0');
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

describe('对话流程', () => {
  it('welcome 阶段返回初始问候', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: '', stage: 'welcome' })
      .expect(200);

    assert.strictEqual(res.body.stage, 'check_in');
    assert.ok(res.body.text.includes('你现在感觉怎么样'));
    assert.ok(res.body.options.length > 0);
  });

  it('危机输入直接触发 crisis 阶段', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: '我想自杀', stage: 'check_in' })
      .expect(200);

    assert.strictEqual(res.body.stage, 'crisis');
    assert.strictEqual(res.body.type, 'crisis');
    assert.ok(res.body.text.includes('400-161-9995'));
  });

  it('完整流程从 welcome 推进到 closing', async () => {
    const stages = [
      { stage: 'welcome', msg: '焦虑', expected: 'check_in' },
      { stage: 'check_in', msg: '胸口发紧', expected: 'safety' },
      { stage: 'safety', msg: '我觉得一切都完了', expected: 'awareness' },
      { stage: 'awareness', msg: '好像有', expected: 'socratic' },
      { stage: 'socratic', msg: 'Ta 可能会说我太苛责自己了', expected: 'rebuild' },
      { stage: 'rebuild', msg: '做呼吸练习', expected: 'regulation' },
      { stage: 'regulation', msg: '完成了，感觉平静一些', expected: 'closing' }
    ];

    for (const step of stages) {
      const res = await request(app)
        .post('/api/chat')
        .send({ message: step.msg, stage: step.stage })
        .expect(200);
      assert.strictEqual(res.body.stage, step.expected, `阶段 ${step.stage} 应跳转到 ${step.expected}`);
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
