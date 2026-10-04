const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../services/db');
const { createSession, destroySession, setSessionCookie, clearSessionCookie } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const AUTH_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX === undefined ? 5 : Number(process.env.AUTH_RATE_LIMIT_MAX);
const authLimiter = createRateLimiter(AUTH_LIMIT_MAX);

const qUserByName = db.prepare('SELECT id, username, pass_hash, nickname, pref_memory FROM users WHERE username = ?');
const qUserById = db.prepare('SELECT id, username, nickname, pref_memory, created_at FROM users WHERE id = ?');
const iUser = db.prepare('INSERT INTO users (username, pass_hash, nickname) VALUES (?, ?, ?)');

function publicUser(row) {
  return { id: row.id, username: row.username, nickname: row.nickname, pref_memory: row.pref_memory };
}

function validateCredentials(req, res) {
  const { username = '', password = '', nickname } = req.body || {};
  const uname = String(username).trim();
  const pwd = String(password);
  if (!USERNAME_RE.test(uname)) {
    res.status(400).json({ error: 'INVALID_USERNAME', message: '用户名需为 3-20 位字母、数字或下划线。' });
    return null;
  }
  if (pwd.length < 6 || pwd.length > 64) {
    res.status(400).json({ error: 'INVALID_PASSWORD', message: '密码长度需为 6-64 位。' });
    return null;
  }
  if (nickname !== undefined && nickname !== null && String(nickname).trim().length > 20) {
    res.status(400).json({ error: 'INVALID_NICKNAME', message: '昵称最长 20 个字符。' });
    return null;
  }
  return { username: uname, password: pwd, nickname: nickname ? String(nickname).trim() : null };
}

// 登录失败延迟，拖慢暴力破解
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// POST /api/auth/register —— 注册即登录
router.post('/auth/register', authLimiter, async (req, res) => {
  const valid = validateCredentials(req, res);
  if (!valid) return;

  const existing = qUserByName.get(valid.username);
  if (existing) {
    return res.status(409).json({ error: 'USERNAME_TAKEN', message: '这个用户名已经被使用了，换一个试试吧。' });
  }

  const passHash = await bcrypt.hash(valid.password, 10);
  const info = iUser.run(valid.username, passHash, valid.nickname);
  const token = createSession(info.lastInsertRowid);
  setSessionCookie(req, res, token);

  const row = qUserById.get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(row) });
});

// POST /api/auth/login
router.post('/auth/login', authLimiter, async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const row = qUserByName.get(String(username).trim());
  const ok = row && await bcrypt.compare(String(password), row.pass_hash);
  if (!ok) {
    await delay(400);
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '用户名或密码不正确。' });
  }

  const token = createSession(row.id);
  setSessionCookie(req, res, token);
  res.json({ user: publicUser(row) });
});

// POST /api/auth/logout
router.post('/auth/logout', (req, res) => {
  const token = require('../middleware/auth').parseCookies(req).sid;
  destroySession(token);
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

module.exports = router;
