// 会话鉴权：解析 sid Cookie → 挂载 req.user；7 天滚动续期
const crypto = require('crypto');
const db = require('../services/db');

const SESSION_DAYS = 7;

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const qSession = db.prepare(`
  SELECT s.token, s.expires_at, u.id, u.username, u.nickname, u.avatar, u.pref_memory
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token = ?`);
const qTouch = db.prepare(`UPDATE sessions SET expires_at = datetime('now', '+${SESSION_DAYS} days') WHERE token = ?`);

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`)
    .run(token, userId);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Secure 仅在 HTTPS（含反代转发）下附加，保证 http 本地/LAN 环境可用
function setSessionCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `sid=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

// 挂载 req.user（可为 null）；导出供路由使用
function authMiddleware(req, res, next) {
  req.user = null;
  const token = parseCookies(req).sid;
  if (token) {
    const row = qSession.get(token);
    if (row && row.expires_at > new Date().toISOString().replace('T', ' ').slice(0, 19)) {
      req.user = { id: row.id, username: row.username, nickname: row.nickname, avatar: row.avatar, pref_memory: row.pref_memory };
      req.sessionToken = token;
      qTouch.run(token);
    } else if (row) {
      destroySession(token);
    }
  }
  next();
}

module.exports = { authMiddleware, createSession, destroySession, setSessionCookie, clearSessionCookie, parseCookies };
