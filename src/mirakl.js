// Mirakl seller API client + promotion / discount sync
// PR01  GET /api/promotions      — promotions on the shop (needs the operator to enable seller promotions)
// OF21  GET /api/offers          — offers incl. discount price windows
// A01   GET /api/account         — shop info (used to test the key)
const { db } = require('./db');

const TZ = () => process.env.CALENDAR_TZ || 'America/New_York';
const sleep = ms => new Promise(r => setTimeout(r, ms));

class MiraklError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function miraklGet(channel, path, params = {}) {
  if (!channel.base_url || !channel.api_key) throw new MiraklError('Missing base URL or API key', 0);
  const url = new URL(channel.base_url.replace(/\/+$/, '') + path);
  if (channel.shop_id) url.searchParams.set('shop_id', channel.shop_id);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: channel.api_key, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    } catch (err) {
      throw new MiraklError(`Could not reach ${url.host}: ${err.message}`, 0);
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 2 ** attempt * 2;
      await sleep(wait * 1000);
      continue;
    }
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok) {
      const msg = (body && (body.message || body.error)) || String(text).slice(0, 200) || res.statusText;
      throw new MiraklError(`${res.status} ${msg}`, res.status, body);
    }
    return body;
  }
  throw new MiraklError('Rate limited by Mirakl (429) — try again in a few minutes', 429);
}

// ISO datetime -> calendar day in CALENDAR_TZ. For end dates, an end at exactly 00:00 local belongs to the day before.
function toDay(iso, isEnd = false) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).map(p => [p.type, p.value]));
  let day = `${parts.year}-${parts.month}-${parts.day}`;
  if (isEnd && parts.hour === '00' && parts.minute === '00') {
    const prev = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - 864e5);
    day = prev.toISOString().slice(0, 10);
  }
  return day;
}

function promoLabel(p) {
  switch (p.type) {
    case 'PERCENTAGE_OFF': return p.percentage_off != null ? `${p.percentage_off}% off` : 'Percentage off';
    case 'AMOUNT_OFF': return p.amount_off != null ? `$${p.amount_off} off` : 'Amount off';
    case 'FREE_ITEMS': return p.free_items_quantity ? `${p.free_items_quantity} free item(s)` : 'Free items';
    case 'REDUCED_UNIT_PRICE': return p.reduced_unit_price != null ? `Reduced to $${p.reduced_unit_price}` : 'Reduced price';
    default: return p.type || '';
  }
}

function triggerText(p) {
  return (p.triggers || []).map(t => {
    if (t.type === 'minimum_amount') return `spend $${t.amount_purchased}+`;
    if (t.type === 'every_amount') return `every $${t.amount_purchased}`;
    if (t.type === 'minimum_quantity') return `buy ${t.quantity_purchased}+`;
    if (t.type === 'every_quantity') return `every ${t.quantity_purchased} items`;
    return t.type;
  }).join(', ');
}

// ---------- connection test: answers "does this Mirakl account allow it?" ----------
async function testChannel(channel) {
  const report = { channel: channel.name, account: null, promotions: null, discounts: null };
  try {
    const acc = await miraklGet(channel, '/api/account');
    report.account = { ok: true, detail: `Connected as "${acc.shop_name || acc.shop_id || 'shop'}"${acc.shop_id ? ` (shop ${acc.shop_id})` : ''}` };
  } catch (e) {
    report.account = { ok: false, detail: e.message };
    return report;
  }
  try {
    const r = await miraklGet(channel, '/api/promotions', { states: 'ALL', max: 1 });
    report.promotions = { ok: true, detail: `Allowed — ${r.total_count ?? 0} promotion(s) on this account` };
  } catch (e) {
    const hint = e.status === 403 || e.status === 404
      ? 'Not available — this marketplace has not enabled seller promotions (PR01) for your shop, or your key lacks the promotions role'
      : e.message;
    report.promotions = { ok: false, detail: hint, status: e.status };
  }
  try {
    const r = await miraklGet(channel, '/api/offers', { max: 1 });
    report.discounts = { ok: true, detail: `Allowed — ${r.total_count ?? 0} offer(s) readable for discount windows` };
  } catch (e) {
    report.discounts = { ok: false, detail: e.message, status: e.status };
  }
  return report;
}

// ---------- PR01 promotions ----------
async function syncPromotions(channel) {
  const since = new Date(Date.now() - 365 * 864e5).toISOString();
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const r = await miraklGet(channel, '/api/promotions', { states: 'ALL', ending_after: since, max: 100, offset, sort: 'startDate' });
    const page = r.promotions || [];
    all.push(...page);
    if (page.length < 100 || all.length >= (r.total_count ?? 0)) break;
    await sleep(300);
  }

  // One calendar entry per campaign: joining a marketplace campaign often creates several promotions
  // (one per offer group), all carrying the same campaign identifier.
  const groups = new Map();
  for (const p of all) {
    const start = toDay(p.start_date);
    if (!start) continue;
    let end = toDay(p.end_date, true) || start;
    if (end < start) end = start;
    const camp = p.campaign?.identifier || null;
    const key = camp ? `camp:${camp}` : String(p.internal_id);
    const g = groups.get(key) || { key, camp, list: [], start, end };
    g.list.push(p);
    if (start < g.start) g.start = start;
    if (end > g.end) g.end = end;
    groups.set(key, g);
  }
  const RANK = ['ACTIVE', 'PENDING', 'PENDING_APPROVAL', 'EXPIRED', 'REJECTED'];
  const groupState = list => list.map(p => p.state).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0];

  const upsert = db.prepare(`INSERT INTO events
    (channel_id, type, title, description, start_date, end_date, participation, discount_label, promo_code, source, external_id, external_state, raw, updated_at)
    VALUES (@channel_id, 'promotion', @title, @description, @start_date, @end_date, @participation, @discount_label, @promo_code, 'mirakl', @external_id, @external_state, @raw, datetime('now'))
    ON CONFLICT(source, channel_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
      title = excluded.title, description = excluded.description, start_date = excluded.start_date, end_date = excluded.end_date,
      discount_label = excluded.discount_label, promo_code = excluded.promo_code,
      external_state = excluded.external_state, raw = excluded.raw,
      participation = CASE WHEN excluded.external_state = 'REJECTED' THEN 'not_joined' ELSE events.participation END,
      updated_at = datetime('now')`);
  // a campaign imported from the portal (extension / paste) with the same identifier
  const findImported = db.prepare(`SELECT id FROM events WHERE source = 'campaign' AND channel_id = ? AND lower(external_id) = lower(?)`);
  const markImported = db.prepare(`UPDATE events SET participation = @participation, discount_label = COALESCE(@discount_label, discount_label),
    promo_code = COALESCE(@promo_code, promo_code), updated_at = datetime('now') WHERE id = @id`);

  const kept = new Set();
  db.transaction(() => {
    for (const g of groups.values()) {
      const p = g.list[0];
      const state = groupState(g.list);
      const labels = [...new Set(g.list.map(promoLabel).filter(Boolean))];
      const label = labels.length > 3 ? `${labels.slice(0, 3).join(', ')} +${labels.length - 3}` : labels.join(', ');
      const codes = [...new Set(g.list.flatMap(x => (x.application_to_cart || []).map(a => a.promo_code)).filter(Boolean))].join(', ') || null;
      const participation = state === 'REJECTED' ? 'not_joined' : 'joined';

      const imported = g.camp && findImported.get(channel.id, g.camp);
      if (imported) { // already on the calendar as an imported campaign: mark it joined, don't add a second entry
        markImported.run({ id: imported.id, participation, discount_label: label || null, promo_code: codes });
        continue;
      }
      const publicDesc = (p.public_descriptions || []).map(d => d.value).filter(Boolean)[0];
      const bits = [publicDesc, triggerText(p) && `Trigger: ${triggerText(p)}`, g.camp && `Campaign: ${g.camp}`,
        g.list.length > 1 && `${g.list.length} promotions on this campaign`,
        (p.channels || []).length ? `Channels: ${p.channels.map(c => c.label || c.code).join(', ')}` : null].filter(Boolean);
      upsert.run({
        channel_id: channel.id,
        title: p.internal_description || publicDesc || `${promoLabel(p)} promotion`,
        description: bits.join('\n'),
        start_date: g.start, end_date: g.end,
        participation,
        discount_label: label || null,
        promo_code: codes,
        external_id: g.key,
        external_state: state,
        raw: JSON.stringify(g.list.length === 1 ? p : g.list.slice(0, 20))
      });
      kept.add(g.key);
    }
    // remove old per-promotion entries (and anything Mirakl no longer returns) inside the synced window
    const sinceDay = since.slice(0, 10);
    const old = db.prepare(`SELECT id, external_id FROM events WHERE source = 'mirakl' AND channel_id = ? AND end_date >= ?`).all(channel.id, sinceDay);
    const del = db.prepare('DELETE FROM events WHERE id = ?');
    for (const e of old) if (!kept.has(e.external_id)) del.run(e.id);
  })();
  return groups.size;
}

// ---------- OF21 offer discount windows (grouped by date range) ----------
function discountWindows(offer) {
  const out = [];
  const d = offer.discount;
  if (d && d.start_date && d.end_date && d.discount_price != null) {
    out.push({ start: d.start_date, end: d.end_date, price: Number(d.discount_price), origin: Number(d.origin_price ?? offer.price), channel: null });
  }
  for (const ap of offer.all_prices || []) {
    if (ap.discount_start_date && ap.discount_end_date && ap.unit_discount_price != null) {
      out.push({ start: ap.discount_start_date, end: ap.discount_end_date, price: Number(ap.unit_discount_price), origin: Number(ap.unit_origin_price ?? offer.price), channel: ap.channel_code || null });
    }
  }
  return out;
}

async function syncDiscounts(channel) {
  const groups = new Map();
  const cutoff = new Date(Date.now() - 60 * 864e5);
  let scanned = 0;
  for (let offset = 0; ; offset += 100) {
    const r = await miraklGet(channel, '/api/offers', { max: 100, offset });
    const page = r.offers || [];
    for (const offer of page) {
      scanned++;
      const seen = new Set();
      for (const w of discountWindows(offer)) {
        if (new Date(w.end) < cutoff) continue;
        const start = toDay(w.start), end = toDay(w.end, true) || start;
        const key = `${start}|${end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const g = groups.get(key) || { start, end, skus: [], pcts: [] };
        g.skus.push(offer.shop_sku || offer.product_sku || offer.offer_id);
        if (w.origin > 0 && w.price < w.origin) g.pcts.push(Math.round((1 - w.price / w.origin) * 100));
        groups.set(key, g);
      }
    }
    if (page.length < 100 || scanned >= (r.total_count ?? 0)) break;
    await sleep(300);
  }

  const upsert = db.prepare(`INSERT INTO events
    (channel_id, type, title, description, start_date, end_date, participation, discount_label, source, external_id, external_state, updated_at)
    VALUES (@channel_id, 'discount', @title, @description, @start_date, @end_date, 'joined', @discount_label, 'mirakl_discount', @external_id, 'ACTIVE', datetime('now'))
    ON CONFLICT(source, channel_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
      title = excluded.title, description = excluded.description, discount_label = excluded.discount_label, updated_at = datetime('now')`);
  const keys = [];
  db.transaction(() => {
    for (const [key, g] of groups) {
      if (!g.start) continue;
      const lo = g.pcts.length ? Math.min(...g.pcts) : null, hi = g.pcts.length ? Math.max(...g.pcts) : null;
      const label = lo == null ? 'Price discount' : lo === hi ? `${lo}% off` : `${lo}–${hi}% off`;
      upsert.run({
        channel_id: channel.id,
        title: `Price discount · ${g.skus.length} offer${g.skus.length === 1 ? '' : 's'}`,
        description: `SKUs: ${g.skus.slice(0, 40).join(', ')}${g.skus.length > 40 ? ` … +${g.skus.length - 40} more` : ''}`,
        start_date: g.start, end_date: g.end < g.start ? g.start : g.end,
        discount_label: label, external_id: key
      });
      keys.push(key);
    }
    // remove windows that no longer exist on Mirakl
    const existing = db.prepare(`SELECT id, external_id FROM events WHERE source = 'mirakl_discount' AND channel_id = ?`).all(channel.id);
    const del = db.prepare('DELETE FROM events WHERE id = ?');
    for (const e of existing) if (!keys.includes(e.external_id)) del.run(e.id);
  })();
  return { windows: keys.length, offers: scanned };
}

async function syncChannel(channelId) {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
  if (!channel) throw new Error('Unknown channel');
  if (channel.kind !== 'mirakl') throw new Error(`${channel.name} is a manual channel`);
  const msgs = [];
  let errors = 0;
  if (channel.sync_promotions) {
    try { msgs.push(`${await syncPromotions(channel)} promotions`); }
    catch (e) { errors++; msgs.push(`Promotions: ${e.status === 403 || e.status === 404 ? 'not enabled on this marketplace' : e.message}`); }
  }
  if (channel.sync_discounts) {
    try { const r = await syncDiscounts(channel); msgs.push(`${r.windows} discount windows from ${r.offers} offers`); }
    catch (e) { errors++; msgs.push(`Discounts: ${e.message}`); }
  }
  const jobs = channel.sync_promotions + channel.sync_discounts;
  const status = errors === 0 ? 'ok' : errors < jobs ? 'partial' : 'error';
  const message = msgs.join(' · ') || 'Nothing selected to sync';
  db.prepare(`UPDATE channels SET last_sync_at = datetime('now'), last_sync_status = ?, last_sync_message = ? WHERE id = ?`).run(status, message, channel.id);
  db.prepare('INSERT INTO sync_log (channel_id, status, message) VALUES (?, ?, ?)').run(channel.id, status, message);
  return { status, message };
}

async function syncAll() {
  const rows = db.prepare(`SELECT id FROM channels WHERE kind = 'mirakl' AND enabled = 1 AND api_key IS NOT NULL AND api_key <> '' AND base_url IS NOT NULL AND base_url <> ''`).all();
  const results = {};
  for (const r of rows) {
    try { results[r.id] = await syncChannel(r.id); }
    catch (e) { results[r.id] = { status: 'error', message: e.message }; }
  }
  return results;
}

module.exports = { miraklGet, testChannel, syncChannel, syncAll, toDay };
