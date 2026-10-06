const express = require('express');
const crypto = require('crypto');
const db = require('../services/db');
const { createSession, destroySession, setSessionCookie, clearSessionCookie, parseCookies } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { sendVerificationCode, isConfigured: smsConfigured } = require('../services/smsClient');
const { sendCodeEmail } = require('../services/mailClient');

const router = express.Router();

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 同号重发间隔（可用 SMS_RESEND_COOLDOWN_SEC 覆盖，测试调小）
const RESEND_COOLDOWN_SEC = process.env.SMS_RESEND_COOLDOWN_SEC === undefined
  ? 60
  : Number(process.env.SMS_RESEND_COOLDOWN_SEC);
const CODE_TTL_MIN = 10;              // 验证码有效期
const MAX_ATTEMPTS = 5;               // 单条验证码最多试错次数
const AUTH_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX === undefined ? 5 : Number(process.env.AUTH_RATE_LIMIT_MAX);
const CODE_DAILY_MAX_PER_IP = process.env.CODE_SEND_DAILY_MAX_PER_IP === undefined
  ? 20
  : Number(process.env.CODE_SEND_DAILY_MAX_PER_IP);
const authLimiter = createRateLimiter(AUTH_LIMIT_MAX);

// 动物头像候选（前后端共用同一份，前端在 app.js 中复制）
const ANIMAL_AVATARS = ['🦊', '🐰', '🐱', '🐻', '🐼', '🦉', '🐳', '🦌', '🐿️', '🐸'];

const CHANNELS = {
  sms: {
    validate: (t) => PHONE_RE.test(t),
    invalidMsg: '请输入正确的 11 位手机号。',
    findUser: db.prepare('SELECT id, username, nickname, avatar, phone, email, pref_memory, created_at FROM users WHERE phone = ?'),
    createUser: db.prepare('INSERT INTO users (username, phone, avatar) VALUES (?, ?, ?)'),
    mask: (t) => t.slice(0, 3) + '****' + t.slice(7)
  },
  email: {
    validate: (t) => EMAIL_RE.test(t) && t.length <= 100,
    invalidMsg: '请输入正确的邮箱地址。',
    findUser: db.prepare('SELECT id, username, nickname, avatar, phone, email, pref_memory, created_at FROM users WHERE email = ?'),
    createUser: db.prepare('INSERT INTO users (username, email, avatar) VALUES (?, ?, ?)'),
    mask: (t) => {
      const [local, domain] = t.split('@');
      return local.slice(0, 1) + '***@' + domain;
    }
  }
};

const qLatestCode = db.prepare(
  'SELECT * FROM verification_codes WHERE target = ? AND channel = ? ORDER BY id DESC LIMIT 1'
);
const iCode = db.prepare(
  `INSERT INTO verification_codes (target, channel, code_hash, expires_at)
   VALUES (?, ?, ?, datetime('now', '+${CODE_TTL_MIN} minutes'))`
);
const uAttempt = db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?');
const uConsume = db.prepare(`UPDATE verification_codes SET consumed_at = datetime('now') WHERE id = ?`);
const uProfile = db.prepare('UPDATE users SET nickname = ?, avatar = ? WHERE id = ?');

const nowStr = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// 发码日限额（防短信/邮件轰炸刷费）：每 IP 每天 N 条
const sendCounts = new Map(); // ip -> { day: 'YYYY-MM-DD', count: number }
function dailyCapHit(ip) {
  if (CODE_DAILY_MAX_PER_IP <= 0) return false;
  const today = new Date().toISOString().slice(0, 10);
  const rec = sendCounts.get(ip);
  return !!rec && rec.day === today && rec.count >= CODE_DAILY_MAX_PER_IP;
}
function recordSend(ip) {
  const today = new Date().toISOString().slice(0, 10);
  const rec = sendCounts.get(ip);
  if (!rec || rec.day !== today) sendCounts.set(ip, { day: today, count: 1 });
  else rec.count++;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function publicUser(row) {
  return {
    id: row.id,
    nickname: row.nickname,
    avatar: row.avatar,
    phone: row.phone ? CHANNELS.sms.mask(row.phone) : null,
    email: row.email ? CHANNELS.email.mask(row.email) : null,
    pref_memory: row.pref_memory
  };
}

function normalizeTarget(channel, raw) {
  const t = String(raw || '').trim();
  return channel === 'email' ? t.toLowerCase() : t;
}

// 短信通道需企业资质 + 腾讯云密钥；未配置时禁用（防止模拟模式回显验证码被滥用）
function channelDisabled(channel) {
  return channel === 'sms' && !smsConfigured();
}

// POST /api/auth/code/request —— 发送登录验证码（sms 走腾讯云/模拟，email 走 SMTP/模拟）
router.post('/auth/code/request', authLimiter, async (req, res) => {
  const channel = String((req.body || {}).channel || 'sms');
  const cfg = CHANNELS[channel];
  if (!cfg) {
    return res.status(400).json({ error: 'INVALID_CHANNEL', message: '不支持的验证方式。' });
  }
  if (channelDisabled(channel)) {
    return res.status(400).json({ error: 'CHANNEL_DISABLED', message: '手机号登录暂未开放，请使用邮箱登录。' });
  }
  const target = normalizeTarget(channel, (req.body || {}).target);
  if (!cfg.validate(target)) {
    return res.status(400).json({ error: 'INVALID_TARGET', message: cfg.invalidMsg });
  }

  const ip = clientIp(req);
  if (dailyCapHit(ip)) {
    return res.status(429).json({
      error: 'DAILY_CAP_HIT',
      message: '今天发送次数已达上限，请明天再试。'
    });
  }

  const latest = qLatestCode.get(target, channel);
  if (latest) {
    const elapsedSec = (new Date(nowStr()) - new Date(latest.created_at)) / 1000;
    if (elapsedSec < RESEND_COOLDOWN_SEC) {
      return res.status(429).json({
        error: 'CODE_COOLDOWN',
        message: `发送太频繁了，请 ${RESEND_COOLDOWN_SEC - Math.floor(elapsedSec)} 秒后再试。`,
        retryAfter: RESEND_COOLDOWN_SEC - Math.floor(elapsedSec)
      });
    }
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  iCode.run(target, channel, crypto.createHash('sha256').update(code).digest('hex'));

  try {
    const result = channel === 'sms'
      ? await sendVerificationCode(target, code)
      : await sendCodeEmail(target, code);
    recordSend(ip);
    res.json({ ok: true, expiresIn: CODE_TTL_MIN * 60, mock: result.mock, devCode: result.devCode });
  } catch (err) {
    console.error(`${channel} 验证码发送失败:`, err.message);
    res.status(502).json({ error: 'SEND_FAILED', message: '验证码发送失败，请稍后再试。' });
  }
});

// POST /api/auth/code/login —— 验证码登录；未注册则自动创建唯一账号
router.post('/auth/code/login', authLimiter, async (req, res) => {
  const channel = String((req.body || {}).channel || 'sms');
  const cfg = CHANNELS[channel];
  if (!cfg) {
    return res.status(400).json({ error: 'INVALID_CHANNEL', message: '不支持的验证方式。' });
  }
  if (channelDisabled(channel)) {
    return res.status(400).json({ error: 'CHANNEL_DISABLED', message: '手机号登录暂未开放，请使用邮箱登录。' });
  }
  const target = normalizeTarget(channel, (req.body || {}).target);
  const code = String((req.body || {}).code || '').trim();
  if (!cfg.validate(target) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '账号或验证码格式不正确。' });
  }

  const record = qLatestCode.get(target, channel);
  const fail = (msg) => res.status(401).json({ error: 'INVALID_CODE', message: msg });
  if (!record || record.consumed_at) return fail('验证码不正确或已过期，请重新获取。');
  if (record.expires_at <= nowStr()) return fail('验证码已过期，请重新获取。');
  if (record.attempts >= MAX_ATTEMPTS) {
    uConsume.run(record.id);
    return fail('验证码已失效，请重新获取。');
  }

  const hash = crypto.createHash('sha256').update(code).digest('hex');
  if (hash !== record.code_hash) {
    uAttempt.run(record.id);
    return fail('验证码不正确或已过期，请重新获取。');
  }
  uConsume.run(record.id);

  try {
    let user = cfg.findUser.get(target);
    let isNew = false;
    if (!user) {
      // 首次登录：自动建号（该手机号/邮箱即唯一账号）；username 为内部占位
      isNew = true;
      const username = 'u' + crypto.randomBytes(6).toString('hex');
      const avatar = ANIMAL_AVATARS[crypto.randomInt(0, ANIMAL_AVATARS.length)];
      const info = cfg.createUser.run(username, target, avatar);
      user = cfg.findUser.get(target)
        || { id: info.lastInsertRowid, username, nickname: null, avatar, phone: null, email: null, pref_memory: 1 };
    }

    const token = createSession(user.id);
    setSessionCookie(req, res, token);
    res.json({ user: publicUser(user), isNew });
  } catch (err) {
    console.error('验证码登录失败:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '登录失败，请稍后再试。' });
  }
});

// POST /api/auth/logout
router.post('/auth/logout', (req, res) => {
  destroySession(parseCookies(req).sid);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/auth/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: '未登录' });
  }
  res.json({ user: req.user });
});

// PATCH /api/user/profile —— 个人中心：昵称 + 动物头像
router.patch('/user/profile', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: '未登录' });
  }
  const { nickname, avatar } = req.body || {};
  const nick = nickname === undefined || nickname === null ? req.user.nickname : String(nickname).trim().slice(0, 20);
  const av = avatar === undefined || avatar === null ? req.user.avatar : String(avatar);
  if (nick && nick.length === 0) {
    return res.status(400).json({ error: 'INVALID_NICKNAME', message: '昵称不能为空。' });
  }
  if (!ANIMAL_AVATARS.includes(av)) {
    return res.status(400).json({ error: 'INVALID_AVATAR', message: '头像选择无效。' });
  }
  uProfile.run(nick || null, av, req.user.id);
  res.json({ user: { ...req.user, nickname: nick || null, avatar: av } });
});

module.exports = router;
