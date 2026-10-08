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
// RAG：强制 mock 向量（测试离线可跑，不依赖 embedding 密钥）
process.env.EMBEDDING_PROVIDER = 'mock';

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
    // 短信通道未配置密钥 → 明确拒绝
    const disabled = await requestCode(request(app), 'sms', uniquePhone());
    assert.strictEqual(disabled.status, 400);
    assert.strictEqual(disabled.body.error, 'CHANNEL_DISABLED');

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

describe('V1 周报指标', () => {
  it('周窗口与指标计算：会话/完聊/反馈口径正确', () => {
    const { weekBounds, computeMetrics, ratio } = require('../src/services/weeklyMetrics');
    const wb = weekBounds(new Date('2026-10-07T12:00:00'));
    assert.ok(wb.from.startsWith('2026-10-05')); // 周一
    assert.ok(wb.to.startsWith('2026-10-12'));

    // 造数据：一次完聊(含 closing 消息+双评分改善≥2)、一次未完聊
    const db = require('../src/services/db');
    const c1 = db.prepare(`INSERT INTO conversations (user_id, start_rating, end_rating, ended_at) VALUES (NULL, 6, 3, datetime('now'))`).run().lastInsertRowid;
    db.prepare(`INSERT INTO messages (conv_id, role, content, stage) VALUES (${c1}, 'bot', 'a', 'closing'), (${c1}, 'bot', 'b', NULL)`).run();
    db.prepare(`UPDATE messages SET vote='down', vote_reason='太敷衍' WHERE conv_id=${c1} AND stage IS NULL`).run();
    const c2 = db.prepare('INSERT INTO conversations (user_id) VALUES (NULL)').run().lastInsertRowid;
    db.prepare(`INSERT INTO messages (conv_id, role, content) VALUES (${c2}, 'bot', 'x')`).run();

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const future = new Date(Date.now() + 86400 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const m = computeMetrics('2000-01-01 00:00:00', future);
    assert.ok(m.total >= 2, `总会话 ${m.total}`);
    assert.strictEqual(m.effectiveRate !== null, true);
    assert.strictEqual(m.completionRate !== null, true);
    assert.strictEqual(m.feedbackRate !== null, true);
    assert.strictEqual(m.downRate !== null, true);
    assert.strictEqual(ratio(1, 4), 25);
    assert.strictEqual(ratio(1, 0), null);
    assert.ok(/^[0-9]+\/[0-9]+$/.test(m.downDetail), 'downDetail=' + m.downDetail);
    assert.ok(now <= future);
  });
});

describe('RAG 知识库', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { parseKnowledgeFile, ingestKnowledgeDir } = require('../src/services/kbIngestor');
  const { retrieveKnowledge, kbSize } = require('../src/services/kbRetriever');
  const { buildPrompt } = require('../src/engine/llmResponder');

  it('语料解析：三个文件 ≥15 块，每块带标题/阶段/正文', () => {
    const dir = path.join(__dirname, '..', 'knowledge');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    assert.strictEqual(files.length, 3);
    let total = 0;
    for (const f of files) {
      const blocks = parseKnowledgeFile(path.join(dir, f));
      assert.ok(blocks.length >= 4, `${f} 至少 4 块`);
      for (const b of blocks) {
        assert.ok(b.title.length > 0);
        assert.ok(b.stages.length > 0);
        assert.ok(b.content.length >= 100, `${b.title} 正文过短`);
      }
      total += blocks.length;
    }
    assert.ok(total >= 15, `总块数 ${total} 应 ≥15`);
  });

  it('入库（mock 向量）后可检索，阶段加权生效', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
    fs.writeFileSync(path.join(dir, '2-test.md'), [
      '# 测试干预层',
      '',
      '## 呼吸练习 | stages: regulation',
      '四七八呼吸法：吸气四秒、屏息七秒、呼气八秒，适合情绪回落期使用，先征得用户同意再引导，不做超过五轮。',
      '',
      '## 认知解离 | stages: awareness',
      '帮助用户区分事实与解读，用两部分句式切开事实和大脑补出来的剧情，让用户自己完成区分。',
      ''
    ].join('\n'));

    const stats = await ingestKnowledgeDir(dir);
    assert.strictEqual(stats.blocks, 2);
    assert.strictEqual(kbSize(), 2);

    const q = '我现在很紧张，能带我做呼吸练习吗';
    const hitsReg = await retrieveKnowledge(q, 'regulation');
    assert.strictEqual(hitsReg[0].title, '呼吸练习');

    const hitsAwa = await retrieveKnowledge(q, 'awareness');
    assert.ok(hitsReg[0].score >= hitsAwa[0].score, '阶段加权应使 regulation 得分不低于 awareness');
  });

  it('prompt 注入：有知识块出现【可参考的专业依据】区块，无则不含', () => {
    const withKb = buildPrompt('测试', 'awareness', [],
      [{ layer: 'intervention', title: '呼吸练习', content: '4-7-8 呼吸法' }]);
    assert.ok(withKb.includes('【可参考的专业依据】'));
    const withoutKb = buildPrompt('测试', 'awareness', []);
    assert.ok(!withoutKb.includes('【可参考的专业依据】'));
  });
});

describe('流式对话（SSE）', () => {
  it('规则模式：直接 done，内容为规则响应', async () => {
    const res = await request(app).post('/api/chat/stream')
      .send({ message: '焦虑', history: [] })
      .expect(200);
    assert.ok(res.headers['content-type'].includes('text/event-stream'));
    assert.ok(res.text.includes('event: done'));
    assert.ok(res.text.includes('"stage":"check_in"'));
    assert.ok(!res.text.includes('event: delta'));
  });

  it('危机输入：走危机规则响应，无 delta', async () => {
    const res = await request(app).post('/api/chat/stream')
      .send({ message: '我想自杀', history: [] })
      .expect(200);
    assert.ok(!res.text.includes('event: delta'));
    assert.ok(res.text.includes('"isCrisis":true'));
    assert.ok(res.text.includes('400-161-9995'));
  });

  it('流式提取器：JSON 碎片增量抽出 text 字段，结束后续字段不泄漏', () => {
    const { makeStreamExtractor } = require('../src/engine/llmResponder');
    const ex = makeStreamExtractor();
    const chunks = [
      '{\"stage\":\"check_in\",\"type\":\"text\",\"text\":\"你',
      '好，',
      '世界',
      '\"',                                  // text 值结束的引号（单独到达）
      ',\"options\":[\"a\",\"b\"]',     // 值结束之后还有多批 delta（曾因此把 JSON 尾巴泄进正文）
      ',\"isCrisis\":false}'
    ];
    let text = '';
    for (const c of chunks) text += ex.feed(c);
    assert.strictEqual(text, '你好，世界');
    assert.ok(ex.raw().includes('\"isCrisis\"'));
  });

  it('流式提取器：不误匹配 type 字段的 text 值', () => {
    const { makeStreamExtractor } = require('../src/engine/llmResponder');
    const ex = makeStreamExtractor();
    let text = '';
    for (const c of ['{\"stage\":\"check_in\",\"type\":\"text\",\"text\":\"正文\"}']) {
      text += ex.feed(c);
    }
    assert.strictEqual(text, '正文');
  });
});
