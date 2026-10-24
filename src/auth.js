const crypto = require('crypto');
const { db } = require('./db');

const SESSION_DAYS = 30;
const COOKIE = 'pc_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

const newToken = () => crypto.randomBytes(24).toString('hex');

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function createSession(res, userId) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires.toISOString());
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}`);
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  req.user = null;
  if (token) {
    const row = db.prepare(`SELECT u.id, u.email, u.name, u.role, u.ics_token, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
    if (row && new Date(row.expires_at) > new Date()) {
      delete row.expires_at;
      req.user = row;
    }
  }
  next();
}

const RANK = { viewer: 1, editor: 2, admin: 3 };

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (RANK[req.user.role] < RANK[role]) return res.status(403).json({ error: 'You do not have permission for this.' });
    next();
  };
}

module.exports = { hashPassword, verifyPassword, newToken, createSession, destroySession, loadUser, requireRole };
