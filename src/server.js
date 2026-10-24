require('dotenv').config();
const path = require('path');
const express = require('express');
const cron = require('node-cron');
const { db, seedChannels } = require('./db');
const { hashPassword, verifyPassword, newToken, createSession, destroySession, loadUser, requireRole } = require('./auth');
const { holidaysBetween } = require('./holidays');
const { testChannel, syncChannel, syncAll } = require('./mirakl');
const { buildIcs } = require('./ics');
const { importCampaigns } = require('./campaigns');

seedChannels();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(loadUser);
require('./extension-api')(app);
app.use(express.static(path.join(__dirname, '..', 'public')));

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// ---------------- auth ----------------
app.get('/api/me', (req, res) => {
  const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  res.json({ user: req.user, needsSetup: !hasUsers, appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 4300}` });
});

app.post('/api/auth/setup', (req, res) => {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return res.status(400).json({ error: 'Setup already done.' });
  const { email, name, password } = req.body || {};
  if (!email || !name || !password || password.length < 8) return res.status(400).json({ error: 'Name, email and a password of 8+ characters are required.' });
  const r = db.prepare('INSERT INTO users (email, name, password_hash, role, ics_token) VALUES (?, ?, ?, ?, ?)')
    .run(email.trim().toLowerCase(), name.trim(), hashPassword(password), 'admin', newToken());
  createSession(res, r.lastInsertRowid);
  res.json({ ok: true });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) return res.status(401).json({ error: 'Wrong email or password.' });
  createSession(res, user.id);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });

app.post('/api/me/password', requireRole('viewer'), (req, res) => {
  const { current, next } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(current || ''), user.password_hash)) return res.status(400).json({ error: 'Current password is wrong.' });
  if (!next || next.length < 8) return res.status(400).json({ error: 'New password must be 8+ characters.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  res.json({ ok: true });
});

// ---------------- channels ----------------
const publicChannel = c => ({
  ...c,
  api_key: undefined,
  has_key: !!c.api_key,
  key_hint: c.api_key ? `•••• ${c.api_key.slice(-4)}` : ''
});

app.get('/api/channels', requireRole('viewer'), (req, res) => {
  const rows = db.prepare('SELECT * FROM channels ORDER BY sort, name').all();
  res.json(rows.map(c => {
    const pc = publicChannel(c);
    if (req.user.role !== 'admin') { delete pc.base_url; delete pc.shop_id; }
    return pc;
  }));
});

app.post('/api/channels', requireRole('admin'), (req, res) => {
  const { name, color, kind } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'channel';
  while (db.prepare('SELECT 1 FROM channels WHERE id = ?').get(id)) id += '-2';
  db.prepare('INSERT INTO channels (id, name, kind, color, sort) VALUES (?, ?, ?, ?, 50)')
    .run(id, name.trim(), kind === 'mirakl' ? 'mirakl' : 'manual', color || '#475569');
  res.json(publicChannel(db.prepare('SELECT * FROM channels WHERE id = ?').get(id)));
});

app.put('/api/channels/:id', requireRole('admin'), (req, res) => {
  const c = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const next = {
    name: b.name ?? c.name,
    color: b.color ?? c.color,
    base_url: b.base_url !== undefined ? (b.base_url || '').trim() : c.base_url,
    api_key: b.api_key ? String(b.api_key).trim() : (b.clear_key ? null : c.api_key),
    shop_id: b.shop_id !== undefined ? (String(b.shop_id || '').trim() || null) : c.shop_id,
    enabled: b.enabled !== undefined ? (b.enabled ? 1 : 0) : c.enabled,
    sync_promotions: b.sync_promotions !== undefined ? (b.sync_promotions ? 1 : 0) : c.sync_promotions,
    sync_discounts: b.sync_discounts !== undefined ? (b.sync_discounts ? 1 : 0) : c.sync_discounts,
    id: c.id
  };
  db.prepare(`UPDATE channels SET name=@name, color=@color, base_url=@base_url, api_key=@api_key, shop_id=@shop_id,
    enabled=@enabled, sync_promotions=@sync_promotions, sync_discounts=@sync_discounts WHERE id=@id`).run(next);
  res.json(publicChannel(db.prepare('SELECT * FROM channels WHERE id = ?').get(c.id)));
});

app.delete('/api/channels/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM channels WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/channels/:id/test', requireRole('admin'), wrap(async (req, res) => {
  const c = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(await testChannel(c));
}));

app.post('/api/channels/:id/sync', requireRole('editor'), wrap(async (req, res) => {
  res.json(await syncChannel(req.params.id));
}));

app.post('/api/sync', requireRole('editor'), wrap(async (_req, res) => {
  res.json(await syncAll());
}));

// ---------------- events ----------------
const EVENT_FIELDS = ['channel_id', 'type', 'title', 'description', 'start_date', 'end_date', 'participation', 'discount_label',
  'promo_code', 'link', 'owner', 'newsletter_status'];
// Fields the team may change on events that came from Mirakl (dates/titles stay owned by Mirakl)
const SYNCED_EDITABLE = ['participation', 'owner', 'link', 'newsletter_status'];

app.get('/api/events', requireRole('viewer'), (req, res) => {
  const { from, to } = req.query;
  if (!isDay(from) || !isDay(to)) return res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required' });
  const events = db.prepare(`SELECT id, channel_id, type, title, description, start_date, end_date, participation, discount_label,
      promo_code, link, owner, newsletter_status, source, external_state, updated_at
    FROM events WHERE end_date >= ? AND start_date <= ? ORDER BY start_date, end_date DESC`).all(from, to);
  res.json({ events, holidays: holidaysBetween(from, to) });
});

function cleanEvent(body) {
  const e = {};
  for (const f of EVENT_FIELDS) if (body[f] !== undefined) e[f] = body[f] === '' ? null : body[f];
  return e;
}

app.post('/api/events', requireRole('editor'), (req, res) => {
  const e = cleanEvent(req.body || {});
  if (!e.title || !e.type || !isDay(e.start_date)) return res.status(400).json({ error: 'Title, type and start date are required.' });
  if (!isDay(e.end_date) || e.end_date < e.start_date) e.end_date = e.start_date;
  const cols = Object.keys(e);
  const r = db.prepare(`INSERT INTO events (${cols.join(',')}, created_by, source) VALUES (${cols.map(c => '@' + c).join(',')}, @created_by, 'manual')`)
    .run({ ...e, created_by: req.user.id });
  res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/events/:id', requireRole('editor'), (req, res) => {
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  let e = cleanEvent(req.body || {});
  if (existing.source !== 'manual') e = Object.fromEntries(Object.entries(e).filter(([k]) => SYNCED_EDITABLE.includes(k)));
  const merged = { ...existing, ...e };
  if (!isDay(merged.start_date)) return res.status(400).json({ error: 'Start date is invalid.' });
  if (!isDay(merged.end_date) || merged.end_date < merged.start_date) e.end_date = merged.start_date;
  const cols = Object.keys(e);
  if (cols.length) {
    db.prepare(`UPDATE events SET ${cols.map(c => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({ ...e, id: existing.id });
  }
  res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(existing.id));
});

app.delete('/api/events/:id', requireRole('editor'), (req, res) => {
  const existing = db.prepare('SELECT source FROM events WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.source !== 'manual' && existing.source !== 'campaign') return res.status(400).json({ error: 'This came from Mirakl and will come back on the next sync. Mark it "Not joined" instead.' });
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/import/campaigns', requireRole('editor'), (req, res) => {
  try { res.json(importCampaigns(req.body?.channel_id, req.body?.text, !!req.body?.dry_run)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------------- users (sharing) ----------------
app.get('/api/users', requireRole('admin'), (_req, res) => {
  res.json(db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY created_at').all());
});

app.post('/api/users', requireRole('admin'), (req, res) => {
  const { email, name, role, password } = req.body || {};
  if (!email || !name || !password || password.length < 8) return res.status(400).json({ error: 'Name, email and a temporary password (8+ characters) are required.' });
  if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Role must be admin, editor or viewer.' });
  try {
    db.prepare('INSERT INTO users (email, name, password_hash, role, ics_token) VALUES (?, ?, ?, ?, ?)')
      .run(email.trim().toLowerCase(), name.trim(), hashPassword(password), role, newToken());
  } catch (e) {
    return res.status(400).json({ error: 'That email already has access.' });
  }
  res.json({ ok: true });
});

app.put('/api/users/:id', requireRole('admin'), (req, res) => {
  const { role, password } = req.body || {};
  if (role) {
    if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Bad role' });
    if (Number(req.params.id) === req.user.id && role !== 'admin') return res.status(400).json({ error: "You can't remove your own admin access." });
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.params.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
  }
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireRole('admin'), (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "You can't remove yourself." });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/me/ics-reset', requireRole('viewer'), (req, res) => {
  db.prepare('UPDATE users SET ics_token = ? WHERE id = ?').run(newToken(), req.user.id);
  res.json({ ok: true });
});

// ---------------- Google Calendar feed ----------------
app.get('/ics/:token.ics', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE ics_token = ?').get(req.params.token);
  if (!user) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="menina-promo-calendar.ics"');
  res.send(buildIcs());
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---------------- scheduled sync ----------------
const hours = Number(process.env.SYNC_EVERY_HOURS ?? 6);
if (hours > 0) {
  cron.schedule(`7 */${Math.min(Math.max(1, hours), 23)} * * *`, () => {
    syncAll().then(r => console.log('[sync]', new Date().toISOString(), JSON.stringify(r))).catch(e => console.error('[sync]', e.message));
  });
}

const port = Number(process.env.PORT || 4300);
app.listen(port, () => console.log(`Promo Calendar running → http://localhost:${port}`));
