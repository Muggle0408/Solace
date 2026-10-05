// 测试默认关闭大模型调用，避免真实 API 请求带来的延迟和费用
process.env.USE_LLM = 'false';
// 关闭限流，避免高频测试请求被拦截
process.env.RATE_LIMIT_MAX = '0';
// 认证接口同样关闭限流
process.env.AUTH_RATE_LIMIT_MAX = '0';
// 反馈数据写入临时目录，不污染仓库
process.env.FEEDBACK_FILE = require('path').join(require('os').tmpdir(), `fb-test-${Date.now()}.jsonl`);
// 数据库使用临时文件，不污染 data/solace.db
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `solace-test-${Date.now()}.db`);
// 短信强制走模拟模式（不依赖真实密钥），重发冷却缩到 1 秒便于测试
process.env.TENCENT_SMS_SECRET_ID = '';
process.env.TENCENT_SMS_SECRET_KEY = '';
process.env.TENCENT_SMS_SDK_APP_ID = '';
process.env.TENCENT_SMS_SIGN_NAME = '';
process.env.TENCENT_SMS_TEMPLATE_ID = '';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.SMS_RESEND_COOLDOWN_SEC = '1';
process.env.CODE_SEND_DAILY_MAX_PER_IP = '3';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../server');
const { detectCrisis } = require('../src/services/crisisDetector');
const ruleResponder = require('../src/engine/ruleResponder');
const { getCurrentStage, isValidTransition } = require('../src/config/stages');

// 测试工具：唯一账号 + 验证码一键登录（短信/邮件均为模拟模式）
let ipSeq = 0;
function freshIp() {
  ipSeq += 1;
  return `10.9.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
}
const uniquePhone = () => '13' + String(Math.floor(Math.random() * 900000000) + 100000000);
const uniqueEmail = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.com`;

function requestCode(agent, channel, target, ip = freshIp()) {
  return agent.post('/api/auth/code/request')
    .set('X-Forwarded-For', ip)
    .send({ channel, target });
}
async function loginUser(agent, channel, target) {
  const r = await requestCode(agent, channel, target);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.mock, true);
  const res = await agent.post('/api/auth/code/login')
    .set('X-Forwarded-For', freshIp())
    .send({ channel, target, code: r.body.devCode });
  assert.strictEqual(res.status, 200);
  return res.body;
}

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

describe('账号系统（多通道验证码）', () => {
  it('非法格式与不支持的通道被拒', async () => {
    await requestCode(request(app), 'sms', '123').expect(400);
    await requestCode(request(app), 'email', 'not-an-email').expect(400);
    await requestCode(request(app), 'wechat', 'whatever').expect(400);
    const agent = request.agent(app);
    await requestCode(agent, 'email', uniqueEmail());
    await agent.post('/api/auth/code/login')
      .set('X-Forwarded-For', freshIp())
      .send({ channel: 'email', target: uniqueEmail(), code: '12' })
      .expect(400);
  });

  it('邮箱完整流程：发码（模拟回显）→ 错码 401 → 正码登录 → me 可见 → 退出失效', async () => {
    const agent = request.agent(app);
    const email = uniqueEmail();
    const r1 = await requestCode(agent, 'email', email).expect(200);
    assert.strictEqual(r1.body.mock, true);
    assert.ok(/^\d{6}$/.test(r1.body.devCode));

    const wrong = r1.body.devCode === '000000' ? '000001' : '000000';
    await agent.post('/api/auth/code/login')
      .set('X-Forwarded-For', freshIp())
      .send({ channel: 'email', target: email, code: wrong })
      .expect(401);

    const r2 = await agent.post('/api/auth/code/login')
      .set('X-Forwarded-For', freshIp())
      .send({ channel: 'email', target: email, code: r1.body.devCode })
      .expect(200);
    assert.strictEqual(r2.body.isNew, true);
    assert.ok(r2.body.user.avatar);
    assert.strictEqual(r2.body.user.email, email[0] + '***@' + email.split('@')[1]);

    const me = await agent.get('/api/auth/me').expect(200);
    assert.strictEqual(me.body.user.id, r2.body.user.id);

    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);
  });

  it('同一邮箱再登录是同一账号；已消费的验证码不能复用', async () => {
    const email = uniqueEmail();
    const agentA = request.agent(app);
    const first = await loginUser(agentA, 'email', email);
    assert.strictEqual(first.isNew, true);

    // 已消费验证码复用 → 401
    const agentReplay = request.agent(app);
    await agentReplay.post('/api/auth/code/login')
      .set('X-Forwarded-For', freshIp())
      .send({ channel: 'email', target: email, code: '000000' })
      .expect(401);

    // 冷却过后重发新码 → 同一用户
    await new Promise((r) => setTimeout(r, 1100));
    const agentB = request.agent(app);
    const again = await loginUser(agentB, 'email', email);
    assert.strictEqual(again.isNew, false);
    assert.strictEqual(again.user.id, first.user.id);
  });

  it('手机号通道同样建立唯一账号', async () => {
    const phone = uniquePhone();
    const first = await loginUser(request.agent(app), 'sms', phone);
    assert.strictEqual(first.isNew, true);
    assert.strictEqual(first.user.phone, phone.slice(0, 3) + '****' + phone.slice(7));

    await new Promise((r) => setTimeout(r, 1100));
    const again = await loginUser(request.agent(app), 'sms', phone);
    assert.strictEqual(again.isNew, false);
    assert.strictEqual(again.user.id, first.user.id);
  });

  it('重发冷却期内重复请求返回 429', async () => {
    const email = uniqueEmail();
    await requestCode(request.agent(app), 'email', email).expect(200);
    const res = await requestCode(request.agent(app), 'email', email).expect(429);
    assert.strictEqual(res.body.error, 'CODE_COOLDOWN');
  });

  it('试错 5 次后验证码失效', async () => {
    const email = uniqueEmail();
    const r1 = await requestCode(request.agent(app), 'email', email).expect(200);
    const wrong = r1.body.devCode === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) {
      await request.agent(app).post('/api/auth/code/login')
        .set('X-Forwarded-For', freshIp())
        .send({ channel: 'email', target: email, code: wrong })
        .expect(401);
    }
    await request.agent(app).post('/api/auth/code/login')
      .set('X-Forwarded-For', freshIp())
      .send({ channel: 'email', target: email, code: r1.body.devCode })
      .expect(401);
  });

  it('单 IP 每日发码上限（防轰炸）', async () => {
    const ip = freshIp(); // 固定同一 IP，发 3 条（上限）后第 4 条被拒
    await requestCode(request.agent(app), 'email', uniqueEmail(), ip).expect(200);
    await requestCode(request.agent(app), 'email', uniqueEmail(), ip).expect(200);
    await requestCode(request.agent(app), 'email', uniqueEmail(), ip).expect(200);
    const res = await requestCode(request.agent(app), 'email', uniqueEmail(), ip).expect(429);
    assert.strictEqual(res.body.error, 'DAILY_CAP_HIT');
  });

  it('个人中心可改昵称与头像，非法头像被拒', async () => {
    const agent = request.agent(app);
    await loginUser(agent, 'email', uniqueEmail());

    const bad = await agent.patch('/api/user/profile').send({ avatar: '🐯' }).expect(400);
    assert.strictEqual(bad.body.error, 'INVALID_AVATAR');

    const ok = await agent.patch('/api/user/profile').send({ nickname: '小鹿', avatar: '🦌' }).expect(200);
    assert.strictEqual(ok.body.user.nickname, '小鹿');
    assert.strictEqual(ok.body.user.avatar, '🦌');

    const me = await agent.get('/api/auth/me').expect(200);
    assert.strictEqual(me.body.user.nickname, '小鹿');
    assert.strictEqual(me.body.user.avatar, '🦌');
  });

  it('未登录访问历史接口返回 401', async () => {
    await request(app).get('/api/conversations').expect(401);
  });
});

describe('对话落库与历史恢复', () => {
  it('登录用户对话写入 messages，可用 X-Conv-Id 延续同一会话', async () => {
    const agent = request.agent(app);
    await loginUser(agent, 'email', uniqueEmail());

    const r1 = await agent.post('/api/chat').send({ message: '焦虑', history: [] }).expect(200);
    assert.ok(Number.isInteger(r1.body.convId));
    assert.ok(Number.isInteger(r1.body.botMessageId));

    const r2 = await agent.post('/api/chat')
      .set('X-Conv-Id', String(r1.body.convId))
      .send({ message: '胸口发紧', history: [{ role: 'bot', content: '...', stage: 'check_in' }], startRating: 6 })
      .expect(200);
    assert.strictEqual(r2.body.convId, r1.body.convId);

    const msgs = await agent.get(`/api/conversations/${r1.body.convId}/messages`).expect(200);
    assert.strictEqual(msgs.body.messages.length, 4);
    assert.deepStrictEqual(msgs.body.messages.map(m => m.role), ['user', 'bot', 'user', 'bot']);

    const list = await agent.get('/api/conversations').expect(200);
    const conv = list.body.conversations.find(c => c.id === r1.body.convId);
    assert.ok(conv);
    assert.strictEqual(conv.startRating, 6);
    assert.strictEqual(conv.msgCount, 4);
  });

  it('他人会话 id 不会串号：自动开新会话', async () => {
    const agentA = request.agent(app);
    await loginUser(agentA, 'email', uniqueEmail());
    const r1 = await agentA.post('/api/chat').send({ message: '焦虑', history: [] }).expect(200);

    const agentB = request.agent(app);
    await loginUser(agentB, 'email', uniqueEmail());
    const r2 = await agentB.post('/api/chat')
      .set('X-Conv-Id', String(r1.body.convId))
      .send({ message: '焦虑', history: [] })
      .expect(200);
    assert.notStrictEqual(r2.body.convId, r1.body.convId);
    await agentB.get(`/api/conversations/${r1.body.convId}/messages`).expect(404);
  });

  it('游客对话不落库（响应无 convId）', async () => {
    const res = await request(app).post('/api/chat').send({ message: '焦虑', history: [] }).expect(200);
    assert.strictEqual('convId' in res.body, false);
  });

  it('👍/👎 反馈写入 messages.vote（同时保留 JSONL）', async () => {
    const agent = request.agent(app);
    await loginUser(agent, 'email', uniqueEmail());
    const chat = await agent.post('/api/chat').send({ message: '焦虑', history: [] }).expect(200);

    const res = await agent.post('/api/feedback')
      .send({ messageId: chat.body.botMessageId, stage: 'check_in', vote: 'down', reason: '太敷衍' })
      .expect(200);
    assert.strictEqual(res.body.persistedToDb, true);

    const db = require('../src/services/db');
    const row = db.prepare('SELECT vote, vote_reason FROM messages WHERE id = ?').get(chat.body.botMessageId);
    assert.strictEqual(row.vote, 'down');
    assert.strictEqual(row.vote_reason, '太敷衍');
  });

  it('游客的反馈（非数字 messageId）仅写 JSONL 不报错', async () => {
    const res = await request(app).post('/api/feedback')
      .send({ messageId: 'mguest123', stage: 'check_in', vote: 'up' })
      .expect(200);
    assert.strictEqual(res.body.persistedToDb, false);
  });
});
