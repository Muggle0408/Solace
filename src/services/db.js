// SQLite 连接与表结构（幂等建表）。数据文件：data/solace.db（已 gitignore）
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'solace.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT,
  phone TEXT,
  avatar TEXT,
  nickname TEXT,
  pref_memory INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TEXT DEFAULT (datetime('now')),
  start_rating INTEGER,
  end_rating INTEGER,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, started_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  stage TEXT,
  vote TEXT,
  vote_reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id);

CREATE TABLE IF NOT EXISTS memory_cards (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vc_phone ON verification_codes(phone, id);
`);

// ---- 幂等迁移：老库补列/放宽约束（PRAGMA 检测，已符合则跳过）----
const userCols = db.prepare('PRAGMA table_info(users)').all();
const colNames = userCols.map((c) => c.name);

if (!colNames.includes('phone')) db.exec(`ALTER TABLE users ADD COLUMN phone TEXT`);
if (!colNames.includes('avatar')) db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`);

// pass_hash 原为 NOT NULL（用户名密码时代）；验证码用户无密码，需重建表放宽
const passHashCol = userCols.find((c) => c.name === 'pass_hash');
if (passHashCol && passHashCol.notnull) {
  db.exec(`
    CREATE TABLE users_migrate (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      pass_hash TEXT,
      phone TEXT,
      avatar TEXT,
      nickname TEXT,
      pref_memory INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO users_migrate (id, username, pass_hash, phone, avatar, nickname, pref_memory, created_at)
      SELECT id, username, pass_hash, phone, avatar, nickname, pref_memory, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_migrate RENAME TO users;
  `);
}

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone)`);

module.exports = db;
