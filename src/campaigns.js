// Import "Marketplace campaigns" (operator campaigns you join) by pasting the table from the Mirakl back office.
// Mirakl's seller API has no endpoint for these, so we parse the copied text.
const { db } = require('./db');

// columns added after the first release (safe to run every start)
for (const sql of ['ALTER TABLE channels ADD COLUMN last_import_at TEXT', 'ALTER TABLE users ADD COLUMN import_key TEXT']) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const M = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
// "18 November 2026 at 21:00 (GMT-7)"  or  "November 18, 2026 at 9:00 PM (GMT-7)"  or  "11/18/2026 21:00"
const DATE_RE = new RegExp(
  `(?:(\\d{1,2})\\s+${M}\\.?\\s+(\\d{4})|${M}\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})|(\\d{1,2})/(\\d{1,2})/(\\d{4}))` +
  `(?:\\s*(?:at|,)?\\s*(\\d{1,2}):(\\d{2})\\s*(AM|PM)?)?(?:\\s*\\((?:GMT|UTC)[^)]*\\))?`, 'gi');

const pad = n => String(n).padStart(2, '0');
const monthIndex = s => MONTHS.findIndex(m => m.startsWith(s.toLowerCase().slice(0, 3)));

function parseDate(m) {
  let y, mo, d;
  if (m[1]) { d = +m[1]; mo = monthIndex(m[2]) + 1; y = +m[3]; }
  else if (m[4]) { mo = monthIndex(m[4]) + 1; d = +m[5]; y = +m[6]; }
  else { mo = +m[7]; d = +m[8]; y = +m[9]; }
  let h = m[10] != null ? +m[10] : null; const min = m[11] != null ? +m[11] : 0;
  if (h != null && m[12]) { const pm = m[12].toUpperCase() === 'PM'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return { day: `${y}-${pad(mo)}-${pad(d)}`, midnight: h === 0 && min === 0 };
}
const prevDay = s => new Date(Date.parse(s + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);

const NOISE = /^(join|view|leave|edit|campaign identifier|participation|campaign status|start date|end date|marketplace campaigns|results per page|\d+ results?|\d+)$/i;
const PARTICIPATION = /\b(not joined|joined|pending|declined)\b/i;
const STATUS = /\b(upcoming|ongoing|in progress|active|running|expired|ended|finished|cancell?ed)\b/i;

function parseCampaigns(text) {
  const rows = [];
  const matches = [...String(text || '').matchAll(DATE_RE)];
  let cursor = 0;
  for (let i = 0; i + 1 < matches.length; i += 2) {
    const a = matches[i], b = matches[i + 1];
    const chunk = text.slice(cursor, a.index);
    cursor = b.index + b[0].length;

    let participation = null, status = null;
    const cells = chunk.split(/[\t\r\n]+/).map(s => s.trim()).filter(Boolean).filter(cell => {
      const p = cell.match(PARTICIPATION), st = cell.match(STATUS);
      if (p && cell.length <= 20) { participation = p[1].toLowerCase(); return false; }
      if (st && cell.length <= 20) { status = st[1].toLowerCase(); return false; }
      return !NOISE.test(cell);
    });
    if (!cells.length) continue;
    const identifier = cells[0];
    const name = cells.find((c, idx) => idx > 0 && c.toLowerCase() !== identifier.toLowerCase()) || identifier;

    const start = parseDate(a), end = parseDate(b);
    let endDay = end.midnight ? prevDay(end.day) : end.day;
    if (endDay < start.day) endDay = start.day;
    rows.push({ identifier, name, participation, status, start_date: start.day, end_date: endDay });
  }
  return rows;
}

// Portal state -> our participation value
function mapParticipation(row, today) {
  if (row.participation === 'joined') return 'joined';
  if (row.participation === 'declined') return 'declined';
  const over = row.end_date < today || /expired|ended|finished|cancel/.test(row.status || '');
  return over ? 'not_joined' : 'invited';
}

function importCampaigns(channelId, text, dryRun) {
  const channel = db.prepare('SELECT id, name FROM channels WHERE id = ?').get(channelId);
  if (!channel) throw new Error('Pick a channel first.');
  const rows = parseCampaigns(text);
  const today = new Date().toISOString().slice(0, 10);
  const find = db.prepare(`SELECT id, participation FROM events WHERE source = 'campaign' AND channel_id = ? AND external_id = ?`);
  // promotions the API sync already created for this campaign (you joined it)
  const findSynced = db.prepare(`SELECT id, discount_label, promo_code FROM events WHERE source = 'mirakl' AND channel_id = ? AND lower(external_id) = lower(?)`);
  const preview = rows.map(r => {
    const existing = find.get(channelId, r.identifier);
    const synced = findSynced.get(channelId, 'camp:' + r.identifier);
    let participation = synced ? 'joined' : mapParticipation(r, today);
    // keep the team's own decision unless the portal now says Joined
    if (existing && participation !== 'joined' && ['declined', 'considering'].includes(existing.participation)) participation = existing.participation;
    return { ...r, participation, action: existing ? 'update' : 'new', existing_id: existing?.id, synced };
  });
  if (dryRun) return { channel: channel.name, rows: preview };

  const insert = db.prepare(`INSERT INTO events (channel_id, type, title, description, start_date, end_date, participation, discount_label, promo_code, source, external_id, external_state)
    VALUES (@channel_id, 'retailer_event', @title, @description, @start_date, @end_date, @participation, @discount_label, @promo_code, 'campaign', @external_id, @external_state)`);
  const update = db.prepare(`UPDATE events SET title = @title, start_date = @start_date, end_date = @end_date, participation = @participation,
    discount_label = COALESCE(@discount_label, discount_label), promo_code = COALESCE(@promo_code, promo_code),
    external_state = @external_state, updated_at = datetime('now') WHERE id = @id`);
  const del = db.prepare('DELETE FROM events WHERE id = ?');
  db.transaction(() => {
    for (const r of preview) {
      const data = {
        channel_id: channelId, title: r.name, description: `Marketplace campaign: ${r.identifier}`,
        start_date: r.start_date, end_date: r.end_date, participation: r.participation,
        discount_label: r.synced?.discount_label || null, promo_code: r.synced?.promo_code || null,
        external_id: r.identifier, external_state: r.status ? r.status.toUpperCase() : null
      };
      if (r.existing_id) update.run({ ...data, id: r.existing_id }); else insert.run(data);
      if (r.synced) del.run(r.synced.id); // one entry per campaign: the imported one now carries the synced details
    }
    if (preview.length) db.prepare(`UPDATE channels SET last_import_at = datetime('now') WHERE id = ?`).run(channelId);
  })();
  return { channel: channel.name, imported: preview.filter(r => r.action === 'new').length, updated: preview.filter(r => r.action === 'update').length };
}

module.exports = { parseCampaigns, importCampaigns };
