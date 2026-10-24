/* Promo Calendar — front end (no framework) */
(() => {
  // ---------------- helpers ----------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pc.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('pc.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  };
  const isPhone = () => window.matchMedia('(max-width: 700px)').matches;

  // dates are 'YYYY-MM-DD' strings
  const pad = n => String(n).padStart(2, '0');
  const fromParts = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const toUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const fromUTC = t => new Date(t).toISOString().slice(0, 10);
  const addDays = (s, n) => fromUTC(toUTC(s) + n * 864e5);
  const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
  const dow = s => new Date(toUTC(s)).getUTCDay();
  const todayStr = () => { const d = new Date(); return fromParts(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON = MONTHS.map(m => m.slice(0, 3));
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmt = s => `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}`;
  const fmtRange = (a, b) => a === b ? `${DOW[dow(a)]}, ${fmt(a)}` : (a.slice(0, 7) === b.slice(0, 7) ? `${fmt(a)} – ${+b.slice(8, 10)}` : `${fmt(a)} – ${fmt(b)}`);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  const TYPES = {
    retailer_event: 'Retailer event',
    promotion: 'Mirakl promotion',
    discount: 'Price discount (Mirakl)',
    sale: 'Our sale / promo',
    newsletter: 'Newsletter',
    deadline: 'Deadline',
    note: 'Note'
  };
  const MANUAL_TYPES = ['retailer_event', 'sale', 'newsletter', 'deadline', 'note'];
  const PART = { invited: 'Invited', considering: 'Considering', joined: 'Joined', declined: 'Declined', not_joined: 'Not joined' };
  const NEWS = { idea: 'Idea', draft: 'Draft', scheduled: 'Scheduled', sent: 'Sent' };
  const STATE = { ACTIVE: 'Active', PENDING: 'Scheduled', PENDING_APPROVAL: 'Pending approval', UPCOMING: 'Upcoming', ONGOING: 'Ongoing', REJECTED: 'Rejected', EXPIRED: 'Expired' };
  const PAGES = ['promotions', 'calendar', 'channels', 'team'];

  // ---------------- state ----------------
  const S = {
    me: null, needsSetup: false, appUrl: '',
    page: 'promotions',
    view: store.get('view', 'month'),
    cursor: todayStr().slice(0, 7) + '-01',
    selDay: todayStr(),
    channels: [], events: [], holidays: [], upcoming: { events: [], holidays: [] },
    promo: { events: [], holidays: [] },
    pFilter: store.get('pFilter', 'active'),
    pChannel: store.get('pChannel', 'all'),
    pDiscounts: store.get('pDiscounts', true),
    showEnded: {},
    hiddenChannels: new Set(store.get('hiddenChannels', [])),
    hiddenTypes: new Set(store.get('hiddenTypes', [])),
    calAll: store.get('calAll', false),
    users: [], reports: {}, syncing: false
  };
  if (!store.get('calDefaults2', false)) { S.hiddenTypes.add('discount'); S.hiddenTypes.add('season'); store.set('hiddenTypes', [...S.hiddenTypes]); store.set('calDefaults2', true); }
  const RANK = { viewer: 1, editor: 2, admin: 3 };
  const can = role => S.me && RANK[S.me.role] >= RANK[role];
  const channelOf = id => S.channels.find(c => c.id === id);
  const colorOf = e => channelOf(e.channel_id)?.color || '#64748B';
  const chName = e => channelOf(e.channel_id)?.name || 'General';

  function statusOf(e) {
    const t = todayStr();
    if (e.start_date <= t && e.end_date >= t) return 'live';
    return e.start_date > t ? 'upcoming' : 'ended';
  }
  const isOut = e => e.participation === 'declined' || e.participation === 'not_joined' || e.external_state === 'REJECTED';
  const needsDecision = e => (e.participation === 'invited' || e.participation === 'considering') && e.end_date >= todayStr();
  function whenText(e) {
    const t = todayStr(), st = statusOf(e);
    if (st === 'live') { const n = diffDays(t, e.end_date); return n === 0 ? 'Ends today' : n === 1 ? 'Ends tomorrow' : `Ends in ${n} days`; }
    if (st === 'upcoming') { const n = diffDays(t, e.start_date); return n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`; }
    const n = diffDays(e.end_date, t); return n === 1 ? 'Ended yesterday' : `Ended ${n} days ago`;
  }
  const statusPill = e => { const st = statusOf(e); return `<span class="pill p-${st}">${st === 'live' ? 'Running' : st === 'upcoming' ? 'Upcoming' : 'Ended'}</span>`; };
  const partPill = e => e.participation ? `<span class="pill p-${e.participation}">${PART[e.participation]}</span>` : '';
  const statePill = e => ['PENDING_APPROVAL', 'REJECTED'].includes(e.external_state) ? `<span class="pill ${e.external_state === 'REJECTED' ? 'p-declined' : 'p-invited'}">${STATE[e.external_state]}</span>` : '';

  function visible(e) {
    if (S.hiddenTypes.has(e.type)) return false;
    if (!S.calAll && e.participation && e.participation !== 'joined') return false;
    return !S.hiddenChannels.has(e.channel_id || '_none');
  }
  const visibleHoliday = h => h.weight === 'season' ? !S.hiddenTypes.has('season') : !S.hiddenTypes.has('holiday');

  // ---------------- data ----------------
  function gridRange() {
    const start = addDays(S.cursor, -dow(S.cursor));
    return { from: start, to: addDays(start, 41) };
  }
  async function loadEvents() {
    const t = todayStr();
    const range = S.view === 'month' ? gridRange() : { from: addDays(t, -14), to: addDays(t, 180) };
    const [main, up] = await Promise.all([
      api('GET', `/api/events?from=${range.from}&to=${range.to}`),
      api('GET', `/api/events?from=${t}&to=${addDays(t, 45)}`)
    ]);
    S.events = dedupe(main.events); S.holidays = main.holidays; S.upcoming = { ...up, events: dedupe(up.events) };
  }
  function dedupe(list) {
    const best = new Map();
    const score = e => (e.participation === 'joined' ? 2 : 0) + (e.discount_label ? 1 : 0);
    for (const e of list) {
      const k = [e.channel_id, e.start_date, e.end_date, String(e.title || '').trim().toLowerCase()].join('|');
      const cur = best.get(k);
      if (!cur || score(e) > score(cur)) best.set(k, e);
    }
    return list.filter(e => best.get([e.channel_id, e.start_date, e.end_date, String(e.title || '').trim().toLowerCase()].join('|')) === e);
  }
  async function loadPromo() {
    const t = todayStr();
    S.promo = await api('GET', `/api/events?from=${addDays(t, -45)}&to=${addDays(t, 365)}`);
  }
  async function loadChannels() { S.channels = await api('GET', '/api/channels'); }
  async function refreshData() {
    if (S.page === 'promotions') await loadPromo();
    if (S.page === 'calendar') await loadEvents();
  }
  function refreshView() { renderPage(); }

  async function boot() {
    const me = await api('GET', '/api/me');
    S.me = me.user; S.needsSetup = me.needsSetup; S.appUrl = me.appUrl;
    if (!S.me) return renderAuth();
    S.page = pageFromHash();
    await loadChannels();
    await refreshData();
    render();
  }
  function pageFromHash() {
    const p = location.hash.replace('#', '');
    if (!PAGES.includes(p)) return 'promotions';
    if ((p === 'channels' || p === 'team') && !can('admin')) return 'promotions';
    return p;
  }
  window.addEventListener('hashchange', async () => {
    if (!S.me) return;
    const p = pageFromHash();
    if (p === S.page) return;
    S.page = p; closeDrawer();
    await refreshData(); render(); window.scrollTo(0, 0);
  });
  const go = p => { if (location.hash !== '#' + p) location.hash = p; };

  // ---------------- auth screens ----------------
  const brandHtml = `<div class="brand"><div class="brand-mark"><i></i><i></i><i></i><i></i></div><span class="brand-name">Promo Calendar</span></div>`;
  function renderAuth(error = '') {
    const setup = S.needsSetup;
    $('#app').innerHTML = `<div class="auth"><form class="auth-box" id="auth-form">
      ${brandHtml}
      <h1>${setup ? 'Create the admin account' : 'Sign in'}</h1>
      <p>${setup ? 'First time here. This account can add channels, API keys and teammates.' : 'Marketplace promotions, retail dates and newsletters in one place.'}</p>
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      ${setup ? `<label class="field"><span>Your name</span><input class="input" name="name" required></label>` : ''}
      <label class="field"><span>Email</span><input class="input" name="email" type="email" required autocomplete="username"></label>
      <label class="field"><span>Password${setup ? ' (8+ characters)' : ''}</span><input class="input" name="password" type="password" required minlength="${setup ? 8 : 1}" autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
      <button class="btn primary block">${setup ? 'Create account' : 'Sign in'}</button>
    </form></div>`;
    $('#auth-form').onsubmit = async ev => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      try { await api('POST', setup ? '/api/auth/setup' : '/api/auth/login', f); await boot(); }
      catch (e) { renderAuth(e.message); }
    };
  }

  // ---------------- icons (inline, simple strokes) ----------------
  const I = {
    promo: '<svg viewBox="0 0 24 24"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M18 6a8 8 0 0 1 0 12"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    chan: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    team: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    filter: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>'
  };

  // ---------------- shell ----------------
  function render() {
    const initials = S.me.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const tabs = [['promotions', 'Promotions', I.promo], ['calendar', 'Calendar', I.cal]];
    if (can('admin')) tabs.push(['channels', 'Channels', I.chan], ['team', 'Team', I.team]);
    $('#app').innerHTML = `
      <header class="topbar">
        ${brandHtml}
        <nav class="nav desk-only">${tabs.map(([k, l]) => `<a href="#${k}" class="${S.page === k ? 'active' : ''}">${l}</a>`).join('')}</nav>
        <div class="spacer"></div>
        ${can('editor') ? `<button class="btn wide-only" id="sync-btn" ${S.syncing ? 'disabled' : ''}>${S.syncing ? '<span class="spin"></span> Syncing…' : 'Sync Mirakl'}</button>
          <button class="btn wide-only" data-import>Import campaigns</button>` : ''}
        <button class="btn wide-only" id="gcal-btn">Google Calendar</button>
        ${can('editor') ? `<button class="btn primary" id="new-btn" aria-label="New entry">${I.plus}<span class="lbl-sm">New</span></button>` : ''}
        <div class="menu-wrap">
          <button class="btn icon" id="menu-btn" aria-label="More" aria-haspopup="true">${isPhone() ? I.more : `<span class="avatar">${esc(initials)}</span>`}</button>
          <div class="menu" id="menu" hidden>
            <div class="menu-head"><b>${esc(S.me.name)}</b><span>${esc(S.me.email)} · ${esc(S.me.role)}</span></div>
            ${can('editor') ? `<button data-m="sync">Sync Mirakl now</button><button data-m="import">Import campaigns</button>` : ''}
            ${can('editor') ? '<button data-m="ext">Chrome extension (auto-import)</button>' : ''}
            <button data-m="gcal">Add to Google Calendar</button>
            <button data-m="logout" class="danger">Sign out</button>
          </div>
        </div>
      </header>
      <main id="content" class="content"></main>
      <nav class="tabbar">${tabs.map(([k, l, ic]) => `<a href="#${k}" class="${S.page === k ? 'active' : ''}">${ic}<span>${l}</span></a>`).join('')}</nav>`;

    const menu = $('#menu');
    $('#menu-btn').onclick = ev => { ev.stopPropagation(); menu.hidden = !menu.hidden; };
    document.onclick = ev => { if (!ev.target.closest('.menu-wrap')) menu.hidden = true; };
    $$('[data-m]', menu).forEach(b => b.onclick = () => {
      menu.hidden = true;
      ({ sync: syncNow, import: () => openImport(), gcal: openSubscribe, ext: openExtension, logout: logout })[b.dataset.m]();
    });
    if ($('#gcal-btn')) $('#gcal-btn').onclick = openSubscribe;
    if ($('#new-btn')) $('#new-btn').onclick = () => openEditor({ start_date: todayStr() });
    if ($('#sync-btn')) $('#sync-btn').onclick = syncNow;
    $$('[data-import]').forEach(b => b.onclick = () => openImport());
    renderPage();
  }
  function renderPage() {
    if (S.page === 'promotions') renderPromotionsPage();
    if (S.page === 'calendar') renderCalendarPage();
    if (S.page === 'channels') renderChannelsPage();
    if (S.page === 'team') renderTeamPage();
  }
  async function logout() { await api('POST', '/api/auth/logout'); S.me = null; location.hash = ''; boot(); }

  async function syncNow() {
    S.syncing = true; render();
    try {
      const r = await api('POST', '/api/sync');
      const ids = Object.keys(r);
      if (!ids.length) toast('No Mirakl channel has an API key yet — add them under Channels.');
      else {
        const bad = ids.filter(id => r[id].status === 'error');
        toast(bad.length ? `Synced with issues on: ${bad.map(id => channelOf(id)?.name || id).join(', ')}` : `Synced ${plural(ids.length, 'Mirakl channel')}`);
      }
      await loadChannels(); await refreshData();
    } catch (e) { toast(e.message); }
    S.syncing = false; render();
  }

  let lastPhone = isPhone();
  let rT;
  window.addEventListener('resize', () => {
    clearTimeout(rT);
    rT = setTimeout(() => {
      if (!S.me) return;
      if (isPhone() !== lastPhone) { lastPhone = isPhone(); render(); return; }
      if (S.page === 'calendar' && S.view === 'month' && !isPhone()) layoutBars();
    }, 120);
  });

  // ================= PROMOTIONS PAGE =================
  function renderPromotionsPage() {
    const c = $('#content');
    const t = todayStr();
    const all = S.promo.events.filter(e => S.pDiscounts || e.type !== 'discount');
    const live = all.filter(e => statusOf(e) === 'live');
    const soon = all.filter(e => statusOf(e) === 'upcoming' && diffDays(t, e.start_date) <= 14);
    const decide = all.filter(needsDecision);
    const nextHols = S.promo.holidays.filter(h => h.weight === 'major' && h.start_date >= t).sort((a, b) => a.start_date.localeCompare(b.start_date));
    const nextHol = nextHols[0];

    const filters = [['active', 'Running & upcoming'], ['live', 'Running'], ['upcoming', 'Upcoming'], ['decide', 'Needs decision'], ['ended', 'Ended'], ['all', 'All']];
    const match = e => ({
      active: statusOf(e) !== 'ended', live: statusOf(e) === 'live', upcoming: statusOf(e) === 'upcoming',
      decide: needsDecision(e), ended: statusOf(e) === 'ended', all: true
    })[S.pFilter];
    const shownChannels = S.channels.filter(ch => S.pChannel === 'all' || S.pChannel === ch.id);

    c.innerHTML = `<div class="page">
      <div class="page-head">
        <div><h1>Promotions</h1><p class="sub">What's running, what's coming and what still needs a yes or no — by marketplace.</p></div>
        ${can('editor') ? `<div class="head-actions"><button class="btn" data-import>Import campaigns</button><button class="btn primary" data-new>+ Add promotion</button></div>` : ''}
      </div>

      <div class="stats">
        <button class="stat" data-f="live"><span class="stat-n">${live.length}</span><span class="stat-l">Running now</span></button>
        <button class="stat" data-f="upcoming"><span class="stat-n">${soon.length}</span><span class="stat-l">Starting in 14 days</span></button>
        <button class="stat ${decide.length ? 'warn' : ''}" data-f="decide"><span class="stat-n">${decide.length}</span><span class="stat-l">Need a decision</span></button>
        <div class="stat static"><span class="stat-n sm">${nextHol ? esc(nextHol.title) : '—'}</span><span class="stat-l">${nextHol ? `${fmt(nextHol.start_date)} · in ${plural(diffDays(t, nextHol.start_date), 'day')}` : 'Next retail date'}</span></div>
      </div>

      <div class="filterbar">
        <div class="chips" role="tablist">${filters.map(([k, l]) => `<button class="chip ${S.pFilter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
        <div class="filter-right">
          <select class="input sm" id="p-ch" aria-label="Marketplace">
            <option value="all">All marketplaces</option>
            ${S.channels.map(ch => `<option value="${ch.id}" ${S.pChannel === ch.id ? 'selected' : ''}>${esc(ch.name)}</option>`).join('')}
          </select>
          <label class="check"><input type="checkbox" id="p-disc" ${S.pDiscounts ? 'checked' : ''}>Price discounts</label>
        </div>
      </div>

      <div class="promo-layout">
        <div class="mkt-list">${shownChannels.map(ch => channelSection(ch, all.filter(e => e.channel_id === ch.id), match)).join('') || '<p class="empty">No channels.</p>'}
          ${(S.pChannel === 'all') ? channelSection({ id: '_none', name: 'All channels / general', color: '#64748B', kind: 'manual' }, all.filter(e => !e.channel_id), match, true) : ''}
        </div>
        <aside class="rail">
          <div class="card">
            <h3 class="card-title">Coming retail dates</h3>
            <div class="hol-list">${nextHols.slice(0, 8).map(h => `<div class="hol-row"><div class="hol-date"><b>${+h.start_date.slice(8, 10)}</b>${MON[+h.start_date.slice(5, 7) - 1]}</div>
              <div><div class="hol-name">${esc(h.title)}</div><div class="hol-meta">${h.region} · in ${plural(diffDays(t, h.start_date), 'day')}</div></div></div>`).join('') || '<p class="empty">None in the next year.</p>'}</div>
          </div>
          ${S.channels.some(c => c.kind === 'mirakl' && /not enabled/i.test(c.last_sync_message || '')) ? `<div class="card tip">
            <h3 class="card-title">Missing a marketplace's campaigns?</h3>
            <p>${S.channels.filter(c => c.kind === 'mirakl' && /not enabled/i.test(c.last_sync_message || '')).map(c => esc(c.name)).join(' and ')} don't share campaigns through Mirakl's API. Copy the table from <b>Price and stock → Promotions</b> in their portal and paste it here.</p>
            ${can('editor') ? '<button class="btn sm" data-import>Import campaigns</button>' : ''}
          </div>` : ''}
        </aside>
      </div>
    </div>`;

    $$('[data-f]', c).forEach(b => b.onclick = () => { S.pFilter = b.dataset.f; store.set('pFilter', S.pFilter); renderPromotionsPage(); });
    $('#p-ch', c).onchange = ev => { S.pChannel = ev.target.value; store.set('pChannel', S.pChannel); renderPromotionsPage(); };
    $('#p-disc', c).onchange = ev => { S.pDiscounts = ev.target.checked; store.set('pDiscounts', S.pDiscounts); renderPromotionsPage(); };
    $$('[data-import]', c).forEach(b => b.onclick = () => openImport(b.dataset.import || undefined));
    const nb = $('[data-new]', c); if (nb) nb.onclick = () => openEditor({ start_date: todayStr(), type: 'retailer_event' });
    $$('[data-ev]', c).forEach(r => r.onclick = ev => {
      if (ev.target.closest('[data-quick]')) return;
      const e = S.promo.events.find(x => String(x.id) === r.dataset.ev); if (e) openEvent(e);
    });
    $$('[data-quick]', c).forEach(b => b.onclick = async () => {
      try { await api('PUT', `/api/events/${b.dataset.id}`, { participation: b.dataset.quick }); toast(`Marked ${PART[b.dataset.quick]}`); await loadPromo(); renderPromotionsPage(); }
      catch (e) { toast(e.message); }
    });
    $$('[data-more-ended]', c).forEach(b => b.onclick = () => { S.showEnded[b.dataset.moreEnded] = true; renderPromotionsPage(); });
    $$('[data-add-ch]', c).forEach(b => b.onclick = () => openEditor({ start_date: todayStr(), type: 'retailer_event', channel_id: b.dataset.addCh }));
  }

  function channelSection(ch, events, match, hideIfEmpty) {
    const order = { live: 0, upcoming: 1, ended: 2 };
    const list = events.filter(match).sort((a, b) => {
      const sa = statusOf(a), sb = statusOf(b);
      if (sa !== sb) return order[sa] - order[sb];
      if (sa === 'live') return a.end_date.localeCompare(b.end_date);
      if (sa === 'upcoming') return a.start_date.localeCompare(b.start_date);
      return b.end_date.localeCompare(a.end_date);
    });
    if (hideIfEmpty && !list.length) return '';
    const liveN = events.filter(e => statusOf(e) === 'live').length;
    const upN = events.filter(e => statusOf(e) === 'upcoming').length;
    const decN = events.filter(needsDecision).length;

    const ended = list.filter(e => statusOf(e) === 'ended');
    const rest = list.filter(e => statusOf(e) !== 'ended');
    const endedShown = S.pFilter === 'ended' || S.pFilter === 'all' ? (S.showEnded[ch.id] ? ended : ended.slice(0, 5)) : [];
    const hiddenEnded = (S.pFilter === 'ended' || S.pFilter === 'all') ? ended.length - endedShown.length : 0;

    const noApi = ch.kind === 'mirakl' && /not enabled/i.test(ch.last_sync_message || '');
    const impLocal = ch.last_import_at ? new Date(ch.last_import_at.replace(' ', 'T') + 'Z') : null;
    const impDays = impLocal ? diffDays(fromParts(impLocal.getFullYear(), impLocal.getMonth() + 1, impLocal.getDate()), todayStr()) : null;
    const staleImport = ch.kind === 'mirakl' && (impDays === null || impDays > 7);
    const campaignNote = ch.kind !== 'mirakl' ? '' : impDays === null ? 'Campaigns never checked' : impDays === 0 ? 'Campaigns checked today' : `Campaigns checked ${plural(impDays, 'day')} ago`;
    const apiNote = ch.kind !== 'mirakl' ? '' : noApi ? '' : ch.last_sync_at ? `API sync ${new Date(ch.last_sync_at.replace(' ', 'T') + 'Z').toLocaleDateString([], { month: 'short', day: 'numeric' })}` : (ch.has_key ? 'Not synced yet' : 'No API key yet');
    const source = ch.kind === 'mirakl' ? [apiNote, campaignNote].filter(Boolean).join(' · ')
      : ch.id === '_none' ? 'Applies to every channel' : 'Added by hand';

    let empty = '';
    if (!rest.length && !endedShown.length) {
      const what = { active: 'Nothing running or coming up', live: 'Nothing running right now', upcoming: 'Nothing upcoming', decide: 'Nothing waiting on a decision', ended: 'Nothing ended recently', all: 'Nothing yet' }[S.pFilter];
      empty = `<div class="mkt-empty"><span>${what}.</span>
        ${can('editor') ? (ch.kind === 'mirakl' ? `<button class="btn sm" data-import="${ch.id}">Import ${esc(ch.name)} campaigns</button>`
          : `<button class="btn sm ghost-line" data-add-ch="${ch.id}">+ Add</button>`) : ''}</div>`;
    }

    return `<section class="mkt card" style="--c:${ch.color}">
      <header class="mkt-head">
        <span class="mkt-swatch"></span>
        <div class="mkt-title"><h2>${esc(ch.name)}</h2><span>${esc(source)}</span></div>
        <div class="mkt-counts">${liveN ? `<span class="pill p-live">${liveN} running</span>` : ''}${upN ? `<span class="pill p-upcoming">${upN} upcoming</span>` : ''}${decN ? `<span class="pill p-invited">${decN} to decide</span>` : ''}${staleImport && can('editor') ? `<button class="pill p-neutral pill-btn" data-import="${ch.id}">Check campaigns</button>` : ''}</div>
      </header>
      <div class="mkt-body">${[...rest, ...endedShown].map(promoRow).join('')}${empty}
        ${hiddenEnded > 0 ? `<button class="link-btn" data-more-ended="${ch.id}">Show ${hiddenEnded} more ended</button>` : ''}
      </div>
    </section>`;
  }

  function promoRow(e) {
    const st = statusOf(e);
    const quick = can('editor') && needsDecision(e)
      ? `<div class="quick"><button class="btn sm" data-quick="joined" data-id="${e.id}">Joined</button><button class="btn sm" data-quick="declined" data-id="${e.id}">Declined</button></div>` : '';
    return `<div class="prow ${st}${isOut(e) ? ' out' : ''}" data-ev="${e.id}" tabindex="0">
      <div class="prow-bar"></div>
      <div class="prow-main">
        <div class="prow-title">${esc(e.title)}</div>
        <div class="prow-meta"><span>${fmtRange(e.start_date, e.end_date)}</span><span class="sep">·</span><span class="${st === 'live' ? 'strong' : ''}">${whenText(e)}</span>${e.discount_label ? `<span class="sep">·</span><span>${esc(e.discount_label)}</span>` : ''}${e.promo_code ? `<span class="sep">·</span><span>Code ${esc(e.promo_code)}</span>` : ''}</div>
        <div class="prow-type">${esc(TYPES[e.type] || e.type)}${e.owner ? ' · ' + esc(e.owner) : ''}</div>
      </div>
      <div class="prow-side">${statusPill(e)}${statePill(e)}${partPill(e)}${e.newsletter_status ? `<span class="pill p-neutral">${NEWS[e.newsletter_status]}</span>` : ''}${quick}</div>
    </div>`;
  }

  // ================= CALENDAR PAGE =================
  function renderCalendarPage() {
    $('#content').innerHTML = `<div class="layout">
      <div class="drawer-backdrop" id="backdrop"></div>
      <aside class="sidebar" id="sidebar"></aside>
      <section class="main" id="main"></section></div>`;
    $('#backdrop').onclick = closeDrawer;
    renderSidebar();
    renderMain();
  }
  function openDrawer() { $('#sidebar')?.classList.add('open'); $('#backdrop')?.classList.add('open'); }
  function closeDrawer() { $('#sidebar')?.classList.remove('open'); $('#backdrop')?.classList.remove('open'); }

  function renderSidebar() {
    const sb = $('#sidebar');
    const counts = {};
    for (const e of S.events) counts[e.channel_id || '_none'] = (counts[e.channel_id || '_none'] || 0) + 1;
    const typeRows = [['holiday', 'US & UK retail dates'], ['season', 'Selling seasons'], ...Object.entries(TYPES)];
    const t = todayStr();
    const upEv = S.upcoming.events.filter(e => !S.hiddenChannels.has(e.channel_id || '_none'));
    const decide = upEv.filter(needsDecision).slice(0, 6);
    const upItem = (d, title, meta, attrs) => `<div class="up-item" ${attrs}>
        <div class="up-date">${MON[+d.slice(5, 7) - 1]}<b>${+d.slice(8, 10)}</b></div>
        <div><div class="up-title">${esc(title)}</div><div class="up-meta">${meta}</div></div></div>`;

    sb.innerHTML = `
      <div class="drawer-head"><b>Filters</b><button class="btn ghost icon" id="drawer-close" aria-label="Close">✕</button></div>
      <div class="side-section">
        <p class="side-title">Channels <button data-all="channels">${S.hiddenChannels.size ? 'Show all' : 'Hide all'}</button></p>
        ${S.channels.map(ch => `<label class="check"><input type="checkbox" data-ch="${ch.id}" ${S.hiddenChannels.has(ch.id) ? '' : 'checked'}>
          <span class="swatch" style="background:${ch.color}"></span>${esc(ch.name)}<span class="count">${counts[ch.id] || ''}</span></label>`).join('')}
        <label class="check"><input type="checkbox" data-ch="_none" ${S.hiddenChannels.has('_none') ? '' : 'checked'}>
          <span class="swatch" style="background:#64748B"></span>All channels / general<span class="count">${counts._none || ''}</span></label>
      </div>
      <div class="side-section">
        <p class="side-title">Show</p>
        <label class="check"><input type="checkbox" id="cal-all" ${S.calAll ? 'checked' : ''}>Also show campaigns we haven't joined</label>
        ${typeRows.map(([k, l]) => `<label class="check"><input type="checkbox" data-type="${k}" ${S.hiddenTypes.has(k) ? '' : 'checked'}>${esc(l)}</label>`).join('')}
      </div>
      <div class="side-section">
        <p class="side-title">How to read it</p>
        <div class="legend">
          <div><span class="lg live"></span>Running now</div>
          <div><span class="lg upcoming"></span>Upcoming</div>
          <div><span class="lg ended"></span>Ended</div>
          <div><span class="lg out"></span>Declined / not joined</div>
        </div>
      </div>
      ${decide.length ? `<div class="side-section"><p class="side-title">Needs a decision</p><div class="upnext">
        ${decide.map(e => upItem(e.start_date, e.title, `<span class="dot" style="background:${colorOf(e)}"></span>${esc(chName(e))}`, `data-open="${e.id}"`)).join('')}
      </div></div>` : ''}`;

    $('#drawer-close', sb).onclick = closeDrawer;
    $$('[data-ch]', sb).forEach(i => i.onchange = () => { i.checked ? S.hiddenChannels.delete(i.dataset.ch) : S.hiddenChannels.add(i.dataset.ch); saveFilters(); renderMain(); });
    $('#cal-all', sb).onchange = ev => { S.calAll = ev.target.checked; store.set('calAll', S.calAll); renderMain(); };
    $$('[data-type]', sb).forEach(i => i.onchange = () => { i.checked ? S.hiddenTypes.delete(i.dataset.type) : S.hiddenTypes.add(i.dataset.type); saveFilters(); renderMain(); });
    $('[data-all="channels"]', sb).onclick = () => {
      if (S.hiddenChannels.size) S.hiddenChannels.clear(); else { S.channels.forEach(c => S.hiddenChannels.add(c.id)); S.hiddenChannels.add('_none'); }
      saveFilters(); renderSidebar(); renderMain();
    };
    $$('[data-open]', sb).forEach(x => x.onclick = () => {
      const e = [...S.upcoming.events, ...S.events].find(ev => String(ev.id) === x.dataset.open);
      if (e) { closeDrawer(); openEvent(e); }
    });
  }
  function saveFilters() { store.set('hiddenChannels', [...S.hiddenChannels]); store.set('hiddenTypes', [...S.hiddenTypes]); }

  function lastSyncNote() {
    const synced = S.channels.filter(c => c.kind === 'mirakl' && c.last_sync_at).map(c => c.last_sync_at).sort().pop();
    if (!synced) return '';
    const d = new Date(synced.replace(' ', 'T') + 'Z');
    return `Mirakl synced ${d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  }

  function renderMain() {
    const m = $('#main');
    const y = +S.cursor.slice(0, 4), mo = +S.cursor.slice(5, 7);
    m.innerHTML = `
      <div class="cal-toolbar">
        <div class="tb-group">
          <button class="btn sm" id="today-btn">Today</button>
          <button class="btn icon sm" id="prev-btn" aria-label="Previous month">${I.left}</button>
          <button class="btn icon sm" id="next-btn" aria-label="Next month">${I.right}</button>
          <h2 class="cal-title">${S.view === 'month' ? `${isPhone() ? MON[mo - 1] : MONTHS[mo - 1]} ${y}` : 'Upcoming'}</h2>
        </div>
        <div class="tb-group">
          <div class="seg"><button data-view="month" class="${S.view === 'month' ? 'on' : ''}">Month</button><button data-view="agenda" class="${S.view === 'agenda' ? 'on' : ''}">List</button></div>
          <button class="btn sm filter-btn" id="filter-btn">${I.filter}<span>Filters</span></button>
          <span class="sync-note wide-only">${esc(lastSyncNote())}</span>
        </div>
      </div>
      <div id="view"></div>`;
    const shift = async n => {
      const d = new Date(Date.UTC(y, mo - 1 + n, 1));
      S.cursor = fromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      S.selDay = S.cursor.slice(0, 7) === todayStr().slice(0, 7) ? todayStr() : S.cursor;
      await loadEvents(); renderSidebar(); renderMain();
    };
    $('#prev-btn').onclick = () => shift(-1);
    $('#next-btn').onclick = () => shift(1);
    $('#prev-btn').hidden = $('#next-btn').hidden = S.view !== 'month';
    $('#filter-btn').onclick = openDrawer;
    $('#today-btn').onclick = async () => { S.cursor = todayStr().slice(0, 7) + '-01'; S.selDay = todayStr(); await loadEvents(); renderSidebar(); renderMain(); };
    $$('[data-view]', m).forEach(b => b.onclick = async () => { S.view = b.dataset.view; store.set('view', S.view); await loadEvents(); renderSidebar(); renderMain(); });
    if (S.view === 'agenda') renderAgenda();
    else if (isPhone()) renderMonthPhone();
    else renderMonth();
  }

  // ---------- desktop / tablet month ----------
  function dayHolidays() {
    const map = {};
    for (const h of S.holidays) if (h.weight !== 'season' && visibleHoliday(h)) (map[h.start_date] ||= []).push(h);
    for (const k in map) map[k].sort((a, b) => (a.weight === 'major' ? 0 : 1) - (b.weight === 'major' ? 0 : 1));
    return map;
  }
  function renderMonth() {
    const v = $('#view');
    const { from } = gridRange();
    const t = todayStr();
    const curMonth = S.cursor.slice(0, 7);
    const dayHol = dayHolidays();
    let weeks = '';
    for (let w = 0; w < 6; w++) {
      let cells = '';
      for (let d = 0; d < 7; d++) {
        const date = addDays(from, w * 7 + d);
        const hols = dayHol[date] || [];
        const cls = ['day', date.slice(0, 7) !== curMonth && 'other', date === t && 'today', (d === 0 || d === 6) && 'weekend'].filter(Boolean).join(' ');
        cells += `<div class="${cls}" data-date="${date}">
          <div class="dhead"><span class="dnum">${+date.slice(8, 10)}</span>
          ${hols.slice(0, 1).map(h => `<span class="hol ${h.weight === 'major' ? 'major' : ''} ${h.region === 'UK' ? 'uk' : ''}" title="${esc(hols.map(x => x.title).join(' · '))}">${esc(h.title)}</span>`).join('')}</div></div>`;
      }
      weeks += `<div class="week" data-week="${w}">${cells}</div>`;
    }
    v.className = 'month';
    v.innerHTML = `<div class="dow">${DOW.map(d => `<div>${d}</div>`).join('')}</div><div class="weeks">${weeks}</div>`;
    $$('.day', v).forEach(cell => cell.onclick = ev => {
      if (ev.target.closest('.bar, .more')) return;
      openDay(cell.dataset.date);
    });
    layoutBars();
  }

  function layoutBars() {
    const v = $('#view');
    if (!v || S.view !== 'month' || isPhone()) return;
    $$('.bar, .more', v).forEach(n => n.remove());
    const { from } = gridRange();
    const items = [
      ...S.holidays.filter(h => h.weight === 'season' && visibleHoliday(h)).map(h => ({ ...h, _season: true })),
      ...S.events.filter(visible)
    ];
    $$('.week', v).forEach(weekEl => {
      const w = +weekEl.dataset.week;
      const ws = addDays(from, w * 7), we = addDays(ws, 6);
      const segs = items.filter(e => e.end_date >= ws && e.start_date <= we).map(e => ({
        e, s: Math.max(0, diffDays(ws, e.start_date)), en: Math.min(6, diffDays(ws, e.end_date)),
        cl: e.start_date < ws, cr: e.end_date > we
      })).sort((a, b) => (a.e._season ? -1 : 0) - (b.e._season ? -1 : 0) || a.s - b.s || (b.en - b.s) - (a.en - a.s));
      const lanes = [];
      for (const sg of segs) {
        let lane = lanes.findIndex(end => end < sg.s);
        if (lane === -1) { lane = lanes.length; lanes.push(-1); }
        lanes[lane] = sg.en; sg.lane = lane;
      }
      const H = weekEl.clientHeight, TOP = 30, LH = 22;
      const fit = Math.max(1, Math.floor((H - TOP - 4) / LH));
      const maxLanes = lanes.length > fit ? fit - 1 : fit;
      const hidden = Array(7).fill(0);
      for (const sg of segs) {
        if (sg.lane >= maxLanes) { for (let d = sg.s; d <= sg.en; d++) hidden[d]++; continue; }
        const b = document.createElement('div');
        const e = sg.e;
        b.style.top = `${TOP + sg.lane * LH}px`;
        b.style.left = `calc(${(sg.s / 7) * 100}% + 4px)`;
        b.style.width = `calc(${((sg.en - sg.s + 1) / 7) * 100}% - 8px)`;
        if (e._season) {
          b.className = 'bar season'; b.textContent = e.title;
          b.title = `${e.title} · ${fmtRange(e.start_date, e.end_date)}`;
        } else {
          const st = statusOf(e), col = colorOf(e);
          b.className = `bar ${st}${isOut(e) ? ' out' : ''}${sg.cl ? ' cont-l' : ''}${sg.cr ? ' cont-r' : ''}`;
          if (st === 'live') b.style.background = col;
          if (st === 'upcoming') { b.style.background = col + '22'; b.style.borderLeftColor = col; b.style.color = shade(col); }
          if (isOut(e)) { b.style.borderColor = col; b.style.color = shade(col); }
          b.innerHTML = `${esc(e.title)}${e.discount_label ? `<span class="lbl">${esc(e.discount_label)}</span>` : ''}`;
          b.title = `${chName(e)} · ${e.title}\n${fmtRange(e.start_date, e.end_date)}${e.participation ? ' · ' + PART[e.participation] : ''}`;
          b.onclick = ev => { ev.stopPropagation(); openEvent(e); };
        }
        weekEl.appendChild(b);
      }
      hidden.forEach((n, d) => {
        if (!n) return;
        const m = document.createElement('div');
        m.className = 'more';
        m.style.top = `${TOP + maxLanes * LH}px`;
        m.style.left = `${(d / 7) * 100}%`;
        m.textContent = `+${n} more`;
        m.onclick = ev => { ev.stopPropagation(); openDay(addDays(ws, d)); };
        weekEl.appendChild(m);
      });
    });
  }
  function shade(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = c => Math.max(0, Math.round(c * 0.62));
    return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
  }

  // ---------- phone month: dots + selected-day list ----------
  function renderMonthPhone() {
    const v = $('#view');
    const { from } = gridRange();
    const t = todayStr();
    const curMonth = S.cursor.slice(0, 7);
    const dayHol = dayHolidays();
    const evs = S.events.filter(visible);
    if (S.selDay.slice(0, 7) !== curMonth) S.selDay = curMonth === t.slice(0, 7) ? t : S.cursor;
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const date = addDays(from, i);
      const on = evs.filter(e => e.start_date <= date && e.end_date >= date);
      const hol = (dayHol[date] || []).find(h => h.weight === 'major');
      const dots = [...new Set(on.map(colorOf))].slice(0, 4);
      cells += `<button class="pday ${date.slice(0, 7) !== curMonth ? 'other' : ''} ${date === t ? 'today' : ''} ${date === S.selDay ? 'sel' : ''} ${hol ? 'hol-day' : ''}" data-date="${date}">
        <span class="pnum">${+date.slice(8, 10)}</span><span class="pdots">${dots.map(c => `<i style="background:${c}"></i>`).join('')}</span></button>`;
    }
    const sel = S.selDay;
    const selEvs = evs.filter(e => e.start_date <= sel && e.end_date >= sel);
    const selHols = S.holidays.filter(h => visibleHoliday(h) && h.start_date <= sel && h.end_date >= sel);
    v.className = 'pmonth';
    v.innerHTML = `<div class="pgrid-wrap"><div class="pdow">${DOW.map(d => `<span>${d[0]}</span>`).join('')}</div><div class="pgrid">${cells}</div></div>
      <div class="pday-list">
        <div class="pday-head"><b>${DOW[dow(sel)]}, ${MONTHS[+sel.slice(5, 7) - 1]} ${+sel.slice(8, 10)}</b>${can('editor') ? '<button class="btn sm" id="add-sel">+ Add</button>' : ''}</div>
        ${selHols.map(h => `<div class="pday-hol">${esc(h.title)}</div>`).join('')}
        ${selEvs.length ? selEvs.map(e => `<div class="prow ${statusOf(e)}${isOut(e) ? ' out' : ''}" data-ev="${e.id}" style="--c:${colorOf(e)}"><div class="prow-bar"></div>
          <div class="prow-main"><div class="prow-title">${esc(e.title)}</div><div class="prow-meta"><span>${esc(chName(e))}</span><span class="sep">·</span><span>${fmtRange(e.start_date, e.end_date)}</span>${e.discount_label ? `<span class="sep">·</span><span>${esc(e.discount_label)}</span>` : ''}</div></div>
          <div class="prow-side">${statusPill(e)}${partPill(e)}</div></div>`).join('') : '<p class="empty">Nothing on this day.</p>'}
      </div>`;
    $$('.pday', v).forEach(b => b.onclick = () => { S.selDay = b.dataset.date; renderMonthPhone(); });
    $$('[data-ev]', v).forEach(r => r.onclick = () => openEvent(S.events.find(e => String(e.id) === r.dataset.ev)));
    const add = $('#add-sel', v); if (add) add.onclick = () => openEditor({ start_date: sel, end_date: sel });
  }

  // ---------- list view ----------
  function renderAgenda() {
    const v = $('#view');
    v.className = 'agenda';
    const t = todayStr();
    const evs = S.events.filter(visible).filter(e => e.end_date >= t).sort((a, b) => a.start_date.localeCompare(b.start_date));
    const hols = S.holidays.filter(h => h.weight === 'major' && visibleHoliday(h) && h.start_date >= t);
    const rows = [...evs.map(e => ({ d: e.start_date < t ? t : e.start_date, e })), ...hols.map(h => ({ d: h.start_date, h }))]
      .sort((a, b) => a.d.localeCompare(b.d) || (a.h ? -1 : 1));
    if (!rows.length) { v.innerHTML = '<p class="empty" style="padding:24px">Nothing upcoming with the current filters.</p>'; return; }
    const byMonth = {};
    for (const r of rows) (byMonth[r.d.slice(0, 7)] ||= []).push(r);
    v.innerHTML = Object.entries(byMonth).map(([ym, list]) => `
      <div class="ag-month">${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}</div>
      <div class="ag-list card">${list.map(r => r.h
        ? `<div class="ag-hol">${fmt(r.h.start_date)} · ${esc(r.h.title)}</div>`
        : `<div class="prow ${statusOf(r.e)}${isOut(r.e) ? ' out' : ''}" data-ev="${r.e.id}" style="--c:${colorOf(r.e)}" tabindex="0"><div class="prow-bar"></div>
            <div class="prow-main"><div class="prow-title">${esc(r.e.title)}</div>
              <div class="prow-meta"><span>${esc(chName(r.e))}</span><span class="sep">·</span><span>${fmtRange(r.e.start_date, r.e.end_date)}</span>${r.e.discount_label ? `<span class="sep">·</span><span>${esc(r.e.discount_label)}</span>` : ''}</div>
              <div class="prow-type">${esc(TYPES[r.e.type] || r.e.type)}${r.e.owner ? ' · ' + esc(r.e.owner) : ''}</div></div>
            <div class="prow-side">${statusPill(r.e)}${statePill(r.e)}${partPill(r.e)}${r.e.newsletter_status ? `<span class="pill p-neutral">${NEWS[r.e.newsletter_status]}</span>` : ''}</div></div>`).join('')}</div>`).join('');
    $$('[data-ev]', v).forEach(r => r.onclick = () => openEvent(S.events.find(e => String(e.id) === r.dataset.ev)));
  }

  // ================= MODALS =================
  function modal(title, body, foot = '', width) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="overlay"><div class="modal" role="dialog" aria-modal="true" ${width ? `style="width:${width}px"` : ''}>
      <div class="modal-head"><h2>${title}</h2><button class="btn ghost icon" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div></div>`;
    document.body.classList.add('no-scroll');
    const close = () => { root.innerHTML = ''; document.body.classList.remove('no-scroll'); };
    $$('[data-close]', root).forEach(b => b.onclick = close);
    $('.overlay', root).onmousedown = ev => { if (ev.target.classList.contains('overlay')) close(); };
    document.onkeydown = ev => { if (ev.key === 'Escape') close(); };
    return { root, close };
  }
  async function afterChange() { await refreshData(); refreshView(); }

  function openDay(date) {
    const evs = S.events.filter(visible).filter(e => e.start_date <= date && e.end_date >= date);
    const hols = S.holidays.filter(h => visibleHoliday(h) && h.start_date <= date && h.end_date >= date);
    const { root, close } = modal(`${DOW[dow(date)]}, ${MONTHS[+date.slice(5, 7) - 1]} ${+date.slice(8, 10)}`,
      `${hols.map(h => `<div class="pday-hol">${esc(h.title)}</div>`).join('')}
       <div>${evs.length ? evs.map(e => `<div class="prow ${statusOf(e)}${isOut(e) ? ' out' : ''}" data-id="${e.id}" style="--c:${colorOf(e)}"><div class="prow-bar"></div>
         <div class="prow-main"><div class="prow-title">${esc(e.title)}</div><div class="prow-meta"><span>${esc(chName(e))}</span><span class="sep">·</span><span>${fmtRange(e.start_date, e.end_date)}</span></div></div>
         <div class="prow-side">${partPill(e)}</div></div>`).join('') : '<p class="empty">No events this day.</p>'}</div>`,
      can('editor') ? `<div class="spacer"></div><button class="btn primary" data-add>+ Add on this day</button>` : '');
    $$('[data-id]', root).forEach(x => x.onclick = () => { close(); openEvent(S.events.find(e => String(e.id) === x.dataset.id)); });
    const add = $('[data-add]', root); if (add) add.onclick = () => { close(); openEditor({ start_date: date, end_date: date }); };
  }

  function openEvent(e) {
    if (!e) return;
    if (can('editor')) return openEditor(e);
    const st = statusOf(e);
    const rows = [
      ['Channel', chName(e)], ['Type', TYPES[e.type] || e.type], ['Dates', fmtRange(e.start_date, e.end_date)],
      ['Status', `${st === 'live' ? 'Running now' : st === 'upcoming' ? 'Upcoming' : 'Ended'} · ${whenText(e)}`],
      ['Participation', PART[e.participation]], ['Marketplace state', STATE[e.external_state] || e.external_state], ['Offer', e.discount_label], ['Promo code', e.promo_code],
      ['Newsletter', NEWS[e.newsletter_status]], ['Owner', e.owner], ['Notes', e.description]
    ].filter(r => r[1]);
    modal(esc(e.title), `<dl class="detail-grid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}
      ${e.link ? `<dt>Link</dt><dd><a href="${esc(e.link)}" target="_blank" rel="noopener">Open</a></dd>` : ''}</dl>`);
  }

  function openEditor(e) {
    const isNew = !e.id;
    const synced = e.source && e.source !== 'manual';
    const type = e.type || 'retailer_event';
    const chOpts = `<option value="">All channels / general</option>` + S.channels.map(c => `<option value="${c.id}" ${c.id === e.channel_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const opt = (map, val, blank) => (blank ? `<option value="">${blank}</option>` : '') + Object.entries(map).map(([k, l]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${l}</option>`).join('');
    const syncedInfo = synced ? `<div class="note">${e.source === 'campaign' ? 'Imported campaign from' : 'Synced from'} <b>${esc(chName(e))}</b>${e.external_state ? ` · state: <b>${STATE[e.external_state] || esc(e.external_state)}</b>` : ''}. Dates and terms update when you ${e.source === 'campaign' ? 'import again' : 'sync'}; you can set participation, owner and a link here.</div>
      <dl class="detail-grid"><dt>Dates</dt><dd>${fmtRange(e.start_date, e.end_date)} · ${whenText(e)}</dd>${e.discount_label ? `<dt>Offer</dt><dd>${esc(e.discount_label)}</dd>` : ''}${e.promo_code ? `<dt>Promo code</dt><dd>${esc(e.promo_code)}</dd>` : ''}${e.description ? `<dt>Details</dt><dd>${esc(e.description)}</dd>` : ''}</dl>` : '';

    const body = `<form id="ev-form">
      ${syncedInfo}
      ${synced ? '' : `
      <div class="row">
        <label class="field"><span>Type</span><select class="input" name="type">${MANUAL_TYPES.map(k => `<option value="${k}" ${k === type ? 'selected' : ''}>${TYPES[k]}</option>`).join('')}</select></label>
        <label class="field"><span>Channel</span><select class="input" name="channel_id">${chOpts}</select></label>
      </div>
      <label class="field"><span>Title</span><input class="input" name="title" required value="${esc(e.title || '')}" placeholder="e.g. Macy's Black Friday event"></label>
      <div class="row">
        <label class="field"><span>Starts</span><input class="input" type="date" name="start_date" required value="${esc(e.start_date || '')}"></label>
        <label class="field"><span>Ends</span><input class="input" type="date" name="end_date" value="${esc(e.end_date || e.start_date || '')}"></label>
      </div>`}
      <div class="row">
        <label class="field" data-show="participation"><span>Did we join?</span><select class="input" name="participation">${opt(PART, e.participation, '—')}</select></label>
        <label class="field" data-show="newsletter"><span>Newsletter status</span><select class="input" name="newsletter_status">${opt(NEWS, e.newsletter_status, '—')}</select></label>
        <label class="field"><span>Owner</span><input class="input" name="owner" value="${esc(e.owner || '')}" placeholder="Who's on it"></label>
      </div>
      ${synced ? '' : `<div class="row">
        <label class="field"><span>Offer</span><input class="input" name="discount_label" value="${esc(e.discount_label || '')}" placeholder="e.g. 25% off sitewide"></label>
        <label class="field"><span>Promo code</span><input class="input" name="promo_code" value="${esc(e.promo_code || '')}"></label>
      </div>`}
      <label class="field"><span>Link</span><input class="input" name="link" value="${esc(e.link || '')}" placeholder="Invite email, Klaviyo campaign, Mirakl page…"></label>
      ${synced ? '' : `<label class="field"><span>Notes</span><textarea class="input" name="description" placeholder="Submission deadline, SKUs included, margin notes…">${esc(e.description || '')}</textarea></label>`}
    </form>`;
    const foot = `${!isNew && (!synced || e.source === 'campaign') ? '<button class="btn danger" data-del>Delete</button>' : ''}<div class="spacer"></div>
      <button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${isNew ? 'Add' : 'Save'}</button>`;
    const { root, close } = modal(isNew ? 'New calendar entry' : esc(e.title), body, foot);
    const form = $('#ev-form', root);
    const toggleFields = () => {
      const t = synced ? e.type : form.elements.type.value;
      $('[data-show="newsletter"]', root).hidden = t !== 'newsletter';
      $('[data-show="participation"]', root).hidden = !['retailer_event', 'promotion', 'discount', 'sale'].includes(t);
    };
    if (!synced) form.elements.type.onchange = () => {
      toggleFields();
      if (form.elements.type.value === 'newsletter' && !form.elements.channel_id.value && channelOf('newsletter')) form.elements.channel_id.value = 'newsletter';
    };
    toggleFields();
    $('[data-save]', root).onclick = async () => {
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form));
      if (data.end_date && data.start_date && data.end_date < data.start_date) return toast('End date is before the start date.');
      try {
        if (isNew) await api('POST', '/api/events', data); else await api('PUT', `/api/events/${e.id}`, data);
        close(); toast(isNew ? 'Added' : 'Saved'); await afterChange();
      } catch (err) { toast(err.message); }
    };
    const del = $('[data-del]', root);
    if (del) del.onclick = async () => {
      if (!confirm(`Delete "${e.title}"?`)) return;
      try { await api('DELETE', `/api/events/${e.id}`); close(); toast('Deleted'); await afterChange(); }
      catch (err) { toast(err.message); }
    };
  }

  function openImport(channelId) {
    const pre = channelId || S.channels.find(c => c.kind === 'mirakl' && /not enabled/i.test(c.last_sync_message || ''))?.id || 'nordstrom';
    const opts = S.channels.map(c => `<option value="${c.id}" ${c.id === pre ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const body = `<ol class="steps tight">
        <li>In that marketplace's Mirakl portal open <b>Price and stock → Promotions</b> (Marketplace campaigns).</li>
        <li>Set <b>Results per page</b> to the maximum.</li>
        <li>Select from the first campaign name down to the last end date and copy (⌘C / Ctrl+C).</li>
        <li>Paste below. Pasting again later updates existing campaigns — no duplicates.</li></ol>
      <label class="field"><span>Marketplace</span><select class="input" id="imp-ch">${opts}</select></label>
      <label class="field"><span>Pasted table</span><textarea class="input" id="imp-text" rows="6" placeholder="Paste the copied campaigns table here"></textarea></label>
      <div id="imp-preview"></div>`;
    const { root, close } = modal('Import marketplace campaigns', body, `<div class="spacer"></div><button class="btn" data-close>Cancel</button><button class="btn" id="imp-check">Preview</button><button class="btn primary" id="imp-go" disabled>Import</button>`, 760);
    const payload = dry => ({ channel_id: $('#imp-ch', root).value, text: $('#imp-text', root).value, dry_run: dry });
    const preview = async () => {
      const pv = $('#imp-preview', root);
      if (!$('#imp-text', root).value.trim()) { pv.innerHTML = ''; $('#imp-go', root).disabled = true; return; }
      try {
        const r = await api('POST', '/api/import/campaigns', payload(true));
        if (!r.rows.length) { pv.innerHTML = '<p class="err">No campaigns found. Make sure the start and end dates were part of what you copied.</p>'; $('#imp-go', root).disabled = true; return; }
        pv.innerHTML = `<p class="muted-line">${plural(r.rows.length, 'campaign')} found for ${esc(r.channel)}</p>
          <div class="card flat">${r.rows.map(x => `<div class="prow ${x.end_date < todayStr() ? 'ended' : x.start_date > todayStr() ? 'upcoming' : 'live'}" style="--c:${channelOf($('#imp-ch', root).value)?.color || '#64748B'}"><div class="prow-bar"></div>
            <div class="prow-main"><div class="prow-title">${esc(x.name)}</div><div class="prow-meta"><span>${fmtRange(x.start_date, x.end_date)}</span>${x.name !== x.identifier ? `<span class="sep">·</span><span>${esc(x.identifier)}</span>` : ''}</div></div>
            <div class="prow-side"><span class="pill p-${x.participation}">${PART[x.participation]}</span><span class="pill p-neutral">${x.action === 'new' ? 'New' : 'Update'}</span></div></div>`).join('')}</div>`;
        $('#imp-go', root).disabled = false;
      } catch (e) { toast(e.message); }
    };
    $('#imp-check', root).onclick = preview;
    $('#imp-text', root).addEventListener('paste', () => setTimeout(preview, 50));
    $('#imp-ch', root).onchange = preview;
    $('#imp-go', root).onclick = async () => {
      try {
        const r = await api('POST', '/api/import/campaigns', payload(false));
        close(); toast(`${r.channel}: ${r.imported} new, ${r.updated} updated`);
        if (S.page !== 'promotions' && S.page !== 'calendar') go('promotions'); else await afterChange();
      } catch (e) { toast(e.message); }
    };
  }

  async function openExtension() {
    let key;
    try { key = (await api('GET', '/api/me/import-key')).key; } catch (e) { return toast(e.message); }
    const appUrl = S.appUrl.replace(/\/$/, '');
    const { root } = modal('Chrome extension — auto-import campaigns', `
      <p style="margin-top:0">Mirakl's API doesn't share Marketplace campaigns. With this extension, whenever you open a marketplace's <b>Price and stock → Promotions</b> page, its campaigns are sent to the calendar automatically.</p>
      <label class="field"><span>Calendar address</span><div class="copy-row"><input class="input" readonly value="${esc(appUrl)}" id="ext-url"><button class="btn" data-copy="ext-url">Copy</button></div></label>
      <label class="field"><span>Your import key (keep it private)</span><div class="copy-row"><input class="input" readonly value="${esc(key)}" id="ext-key"><button class="btn" data-copy="ext-key">Copy</button></div></label>
      <ol class="steps tight">
        <li>In Chrome open <b>chrome://extensions</b> and turn on <b>Developer mode</b> (top right).</li>
        <li>Click <b>Load unpacked</b> and choose the <b>extension</b> folder inside promo-calendar.</li>
        <li>Click the extension's icon, paste the address and key above, then <b>Save</b> and <b>Test connection</b>.</li>
        <li>Open each marketplace's Promotions page with <b>Results per page</b> at the maximum. A green note confirms the import.</li>
      </ol>
      <div class="note">Each marketplace card shows when its campaigns were last checked. If one goes over 7 days, just open that portal's Promotions page again.</div>`,
      '<button class="btn" id="ext-reset">New key</button><div class="spacer"></div><button class="btn primary" data-close>Done</button>');
    $$('[data-copy]', root).forEach(b => b.onclick = () => { const i = $('#' + b.dataset.copy, root); i.select(); navigator.clipboard?.writeText(i.value).then(() => toast('Copied'), () => document.execCommand('copy')); });
    $('#ext-reset', root).onclick = async () => {
      if (!confirm('The old key stops working in any browser that uses it. Continue?')) return;
      await api('POST', '/api/me/import-key/reset'); openExtension(); toast('New key created');
    };
  }

  function openSubscribe() {
    const url = `${S.appUrl.replace(/\/$/, '')}/ics/${S.me.ics_token}.ics`;
    const local = /localhost|127\.0\.0\.1/.test(url);
    const { root } = modal('Add to Google Calendar', `
      <p style="margin-top:0">Subscribe once and every promotion, retail date and newsletter shows up in Google Calendar (and Apple/Outlook). Google refreshes it every few hours.</p>
      <div class="copy-row"><input class="input" readonly value="${esc(url)}" id="ics-url"><button class="btn" id="copy-ics">Copy</button></div>
      <ol class="steps"><li>Open Google Calendar on a computer.</li><li>Next to <b>Other calendars</b>, click <b>+</b> → <b>From URL</b>.</li><li>Paste the link and click <b>Add calendar</b>.</li></ol>
      ${local ? `<div class="note" style="margin-top:14px">This link points to <b>localhost</b>, which Google can't reach. It will work once the app is deployed (e.g. Railway) and <code>APP_URL</code> in .env is set to that address.</div>` : ''}
      <div class="note" style="margin-top:14px">This link is personal — anyone with it can see the calendar. If it leaks, reset it.</div>`,
      `<button class="btn" id="reset-ics">Reset link</button><div class="spacer"></div>${local ? '' : `<a class="btn primary" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https?:/, 'webcal:'))}">Open Google Calendar</a>`}`);
    $('#copy-ics', root).onclick = () => { $('#ics-url', root).select(); navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => document.execCommand('copy')); };
    $('#reset-ics', root).onclick = async () => {
      if (!confirm('Old link stops working. Continue?')) return;
      await api('POST', '/api/me/ics-reset');
      const me = await api('GET', '/api/me'); S.me = me.user; openSubscribe(); toast('New link created');
    };
  }

  // ================= CHANNELS PAGE =================
  function renderChannelsPage() {
    const c = $('#content');
    c.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>Channels</h1>
      <p class="sub">Mirakl channels pull promotions (PR01) and offer price discounts (OF21) automatically. Marketplace campaigns that aren't in the API (e.g. Nordstrom) come in with Import campaigns. Target, Shopify, newsletter and store are added by hand.</p></div>
      <div class="head-actions"><button class="btn" data-ext>Chrome extension</button><button class="btn" data-import>Import campaigns</button></div></div>
      <div class="cards" id="ch-cards"></div>
      <div class="card add-card">
        <h3 class="card-title">Add a channel</h3>
        <form id="add-ch" class="add-row">
          <label class="field grow"><span>Name</span><input class="input" name="name" required placeholder="e.g. Solomon & Sage Shopify"></label>
          <label class="field"><span>Colour</span><input class="color-in" type="color" name="color" value="#475569"></label>
          <label class="field"><span>Type</span><select class="input" name="kind"><option value="manual">Manual</option><option value="mirakl">Mirakl</option></select></label>
          <button class="btn primary">Add</button>
        </form>
      </div></div>`;
    $$('[data-import]', c).forEach(b => b.onclick = () => openImport());
    $$('[data-ext]', c).forEach(b => b.onclick = openExtension);

    $('#ch-cards').innerHTML = S.channels.map(ch => {
      const rep = S.reports[ch.id];
      const line = (label, x) => x ? `<div><span class="${x.ok ? 'ok' : 'no'}">${x.ok ? '✓' : '✕'}</span><span><b>${label}:</b> ${esc(x.detail)}</span></div>` : '';
      return `<div class="card" data-card="${ch.id}">
        <div class="card-head">
          <input class="color-in" type="color" name="color" value="${ch.color}" title="Calendar colour" aria-label="Colour">
          <input class="input name-in" name="name" value="${esc(ch.name)}" aria-label="Name">
          <span class="tag ${ch.kind}">${ch.kind === 'mirakl' ? 'Mirakl' : 'Manual'}</span>
        </div>
        ${ch.kind === 'mirakl' ? `
          <label class="field"><span>Mirakl URL</span><input class="input" name="base_url" value="${esc(ch.base_url || '')}" placeholder="https://xxxx-prod.mirakl.net" inputmode="url"></label>
          <div class="row">
            <label class="field"><span>API key</span><input class="input" name="api_key" type="password" placeholder="${ch.has_key ? esc(ch.key_hint) + ' (saved)' : 'Paste shop API key'}" autocomplete="off"></label>
            <label class="field shop"><span>Shop ID</span><input class="input" name="shop_id" value="${esc(ch.shop_id || '')}" placeholder="optional" inputmode="numeric"></label>
          </div>
          <label class="check"><input type="checkbox" name="enabled" ${ch.enabled ? 'checked' : ''}>Include in automatic sync</label>
          <label class="check"><input type="checkbox" name="sync_promotions" ${ch.sync_promotions ? 'checked' : ''}>Pull promotions</label>
          <label class="check"><input type="checkbox" name="sync_discounts" ${ch.sync_discounts ? 'checked' : ''}>Pull offer price discounts</label>
          ${rep ? `<div class="report">${line('API key', rep.account)}${line('Promotions', rep.promotions)}${line('Discounts', rep.discounts)}</div>` : ''}
          <div class="card-actions">
            <button class="btn primary sm" data-act="save">Save</button>
            <button class="btn sm" data-act="test">Check access</button>
            <button class="btn sm" data-act="sync" ${ch.has_key ? '' : 'disabled'}>Sync now</button>
            <button class="btn sm" data-imp="${ch.id}">Import campaigns</button>
          </div>
          <div class="status-line ${ch.last_sync_status || ''}">${ch.last_sync_at ? `<b>${ch.last_sync_status === 'ok' ? 'Last sync OK' : ch.last_sync_status === 'partial' ? 'Last sync partly worked' : 'Last sync failed'}</b> · ${esc(new Date(ch.last_sync_at.replace(' ', 'T') + 'Z').toLocaleString())}<br>${esc(ch.last_sync_message || '')}` : 'Not synced yet'}</div>
        ` : `<div class="card-actions"><button class="btn primary sm" data-act="save">Save</button><button class="btn sm danger" data-act="delete">Remove</button></div>`}
      </div>`;
    }).join('');

    $$('[data-card]').forEach(card => {
      const id = card.dataset.card;
      const val = n => card.querySelector(`[name="${n}"]`);
      const collect = () => {
        const d = { name: val('name').value, color: val('color').value };
        if (val('base_url')) Object.assign(d, {
          base_url: val('base_url').value, shop_id: val('shop_id').value,
          enabled: val('enabled').checked, sync_promotions: val('sync_promotions').checked, sync_discounts: val('sync_discounts').checked
        });
        if (val('api_key') && val('api_key').value) d.api_key = val('api_key').value;
        return d;
      };
      const act = async (name, fn) => {
        const btn = card.querySelector(`[data-act="${name}"]`); btn.disabled = true; const label = btn.textContent; btn.innerHTML = '<span class="spin"></span>';
        try { await fn(); } catch (e) { toast(e.message); }
        btn.disabled = false; btn.textContent = label;
      };
      card.querySelector('[data-act="save"]').onclick = () => act('save', async () => {
        await api('PUT', `/api/channels/${id}`, collect()); await loadChannels(); toast('Saved'); renderChannelsPage();
      });
      const test = card.querySelector('[data-act="test"]');
      if (test) test.onclick = () => act('test', async () => {
        await api('PUT', `/api/channels/${id}`, collect());
        S.reports[id] = await api('POST', `/api/channels/${id}/test`); await loadChannels(); renderChannelsPage();
      });
      const sync = card.querySelector('[data-act="sync"]');
      if (sync) sync.onclick = () => act('sync', async () => {
        const r = await api('POST', `/api/channels/${id}/sync`); toast(r.message); await loadChannels(); renderChannelsPage();
      });
      const imp = card.querySelector('[data-imp]'); if (imp) imp.onclick = () => openImport(id);
      const del = card.querySelector('[data-act="delete"]');
      if (del) del.onclick = async () => {
        if (!confirm('Remove this channel? Its events stay on the calendar as "general".')) return;
        await api('DELETE', `/api/channels/${id}`); await loadChannels(); renderChannelsPage();
      };
    });
    $('#add-ch').onsubmit = async ev => {
      ev.preventDefault();
      try { await api('POST', '/api/channels', Object.fromEntries(new FormData(ev.target))); await loadChannels(); renderChannelsPage(); toast('Channel added'); }
      catch (e) { toast(e.message); }
    };
  }

  // ================= TEAM PAGE =================
  async function renderTeamPage() {
    const c = $('#content');
    try { S.users = await api('GET', '/api/users'); } catch (e) { c.innerHTML = `<div class="page"><p class="err">${esc(e.message)}</p></div>`; return; }
    const roleSel = u => `<select class="input sm" data-role="${u.id}" aria-label="Role">${['admin', 'editor', 'viewer'].map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
    c.innerHTML = `<div class="page">
      <h1>Team access</h1>
      <p class="sub"><b>Viewer</b> sees everything · <b>Editor</b> adds events, marks participation, imports and syncs · <b>Admin</b> also manages channels, API keys and people.</p>
      <div class="card flat people">${S.users.map(u => `<div class="person">
          <div class="avatar">${esc(u.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase())}</div>
          <div class="person-main"><b>${esc(u.name)}</b><span>${esc(u.email)} · added ${esc(u.created_at.slice(0, 10))}</span></div>
          <div class="person-actions">${roleSel(u)}<button class="btn sm" data-pw="${u.id}">Reset password</button>${u.id === S.me.id ? '' : `<button class="btn sm danger" data-rm="${u.id}">Remove</button>`}</div>
        </div>`).join('')}</div>
      <div class="card add-card">
        <h3 class="card-title">Give someone access</h3>
        <form id="add-user">
          <div class="row">
            <label class="field"><span>Name</span><input class="input" name="name" required></label>
            <label class="field"><span>Email</span><input class="input" name="email" type="email" required></label>
          </div>
          <div class="row">
            <label class="field"><span>Temporary password</span><input class="input" name="password" required minlength="8" placeholder="8+ characters — share it with them"></label>
            <label class="field"><span>Role</span><select class="input" name="role"><option>viewer</option><option selected>editor</option><option>admin</option></select></label>
          </div>
          <button class="btn primary">Add person</button>
        </form>
      </div></div>`;
    $$('[data-role]').forEach(s => s.onchange = async () => {
      try { await api('PUT', `/api/users/${s.dataset.role}`, { role: s.value }); toast('Role updated'); } catch (e) { toast(e.message); renderTeamPage(); }
    });
    $$('[data-pw]').forEach(b => b.onclick = async () => {
      const pw = prompt('New password (8+ characters):'); if (!pw) return;
      try { await api('PUT', `/api/users/${b.dataset.pw}`, { password: pw }); toast('Password changed'); } catch (e) { toast(e.message); }
    });
    $$('[data-rm]').forEach(b => b.onclick = async () => {
      if (!confirm('Remove this person\'s access?')) return;
      try { await api('DELETE', `/api/users/${b.dataset.rm}`); renderTeamPage(); } catch (e) { toast(e.message); }
    });
    $('#add-user').onsubmit = async ev => {
      ev.preventDefault();
      try { await api('POST', '/api/users', Object.fromEntries(new FormData(ev.target))); toast('Access added'); renderTeamPage(); }
      catch (e) { toast(e.message); }
    };
  }

  boot().catch(e => { $('#app').innerHTML = `<div class="auth"><div class="auth-box"><p class="err">${esc(e.message)}</p></div></div>`; });
})();
