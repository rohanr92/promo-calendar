// Endpoints used by the "Promo Calendar Sync" Chrome extension.
// The extension reads the Marketplace campaigns table when someone opens it in a Mirakl portal
// and posts it here with the person's personal import key.
const { db } = require('./db');
const { newToken, requireRole } = require('./auth');
const { importCampaigns } = require('./campaigns');

const RANK = { viewer: 1, editor: 2, admin: 3 };
const hostOf = u => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };

module.exports = function registerExtensionApi(app) {
  // the extension calls from its own origin, so allow cross-origin requests on /api/ext only
  app.use('/api/ext', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Import-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // personal key shown in the app (Set up Chrome extension)
  app.get('/api/me/import-key', requireRole('editor'), (req, res) => {
    let row = db.prepare('SELECT import_key FROM users WHERE id = ?').get(req.user.id);
    if (!row.import_key) {
      const key = 'pck_' + newToken();
      db.prepare('UPDATE users SET import_key = ? WHERE id = ?').run(key, req.user.id);
      row = { import_key: key };
    }
    res.json({ key: row.import_key });
  });
  app.post('/api/me/import-key/reset', requireRole('editor'), (req, res) => {
    const key = 'pck_' + newToken();
    db.prepare('UPDATE users SET import_key = ? WHERE id = ?').run(key, req.user.id);
    res.json({ key });
  });

  const keyUser = req => {
    const key = req.get('X-Import-Key') || '';
    if (!key.startsWith('pck_')) return null;
    const u = db.prepare('SELECT id, name, role FROM users WHERE import_key = ?').get(key);
    return u && RANK[u.role] >= RANK.editor ? u : null;
  };
  const channelForUrl = url => {
    const host = hostOf(url);
    return db.prepare(`SELECT id, name, base_url FROM channels WHERE kind = 'mirakl'`).all()
      .find(c => c.base_url && hostOf(c.base_url) === host);
  };

  app.get('/api/ext/ping', (req, res) => {
    const u = keyUser(req);
    if (!u) return res.status(401).json({ error: 'Import key not recognised. Copy it again from the app.' });
    const channels = db.prepare(`SELECT name, base_url FROM channels WHERE kind = 'mirakl' AND base_url <> ''`).all();
    res.json({ ok: true, user: u.name, marketplaces: channels.map(c => `${c.name} (${hostOf(c.base_url)})`) });
  });

  app.post('/api/ext/import', (req, res) => {
    const u = keyUser(req);
    if (!u) return res.status(401).json({ error: 'Import key not recognised. Copy it again from the app.' });
    const { url, text } = req.body || {};
    const ch = channelForUrl(url);
    if (!ch) return res.status(400).json({ error: `No channel in the calendar uses ${hostOf(url) || 'this site'}. Add its Mirakl URL under Channels.` });
    try {
      const r = importCampaigns(ch.id, text, false);
      console.log(`[extension] ${u.name} imported ${ch.name}: ${r.imported} new, ${r.updated} updated`);
      res.json(r);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
};
