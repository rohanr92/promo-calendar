// One-time patch: the Calendar shows only joined promotions, your own entries and retail dates.
// Not-joined campaigns, price-discount bars and season stripes stay on the Promotions page.
// Exact duplicates (same marketplace, dates and name) are merged. Run once:
//   node scripts/calendar-joined-only.js
const fs = require('fs');
const path = require('path');

function patch(file, edits) {
  const p = path.join(__dirname, '..', file);
  let src = fs.readFileSync(p, 'utf8');
  for (const [find, replace, marker] of edits) {
    if (src.includes(marker)) { console.log(`  · ${file}: already patched (${marker.slice(0, 40)})`); continue; }
    const n = src.split(find).length - 1;
    if (n !== 1) { console.error(`  ✕ ${file}: expected 1 match for "${find.slice(0, 70)}", found ${n}. Nothing written.`); process.exit(1); }
    src = src.replace(find, () => replace);
  }
  fs.writeFileSync(p, src);
  console.log(`  ✓ ${file} updated`);
}

patch('public/app.js', [
  // calendar setting: show everything, or (default) joined only
  ["    hiddenTypes: new Set(store.get('hiddenTypes', [])),",
   "    hiddenTypes: new Set(store.get('hiddenTypes', [])),\n    calAll: store.get('calAll', false),",
   "calAll: store.get('calAll', false)"],

  // the calendar filter: hide anything with a participation that isn't "joined"
  ["  function visible(e) {\n    if (S.hiddenTypes.has(e.type)) return false;",
   "  function visible(e) {\n    if (S.hiddenTypes.has(e.type)) return false;\n    if (!S.calAll && e.participation && e.participation !== 'joined') return false;",
   "!S.calAll && e.participation"],

  // merge exact duplicates (same channel + dates + name), keeping the most complete one
  ["    S.events = main.events; S.holidays = main.holidays; S.upcoming = up;",
   `    S.events = dedupe(main.events); S.holidays = main.holidays; S.upcoming = { ...up, events: dedupe(up.events) };
  }
  function dedupe(list) {
    const best = new Map();
    const score = e => (e.participation === 'joined' ? 2 : 0) + (e.discount_label ? 1 : 0);
    for (const e of list) {
      const k = [e.channel_id, e.start_date, e.end_date, String(e.title || '').trim().toLowerCase()].join('|');
      const cur = best.get(k);
      if (!cur || score(e) > score(cur)) best.set(k, e);
    }
    return list.filter(e => best.get([e.channel_id, e.start_date, e.end_date, String(e.title || '').trim().toLowerCase()].join('|')) === e);`,
   "function dedupe(list)"],

  // "Needs a decision" in the sidebar still lists invites, whatever the calendar shows
  ["    const upEv = S.upcoming.events.filter(visible);",
   "    const upEv = S.upcoming.events.filter(e => !S.hiddenChannels.has(e.channel_id || '_none'));",
   "S.upcoming.events.filter(e => !S.hiddenChannels"],

  // sidebar toggle
  ['        <p class="side-title">Show</p>',
   '        <p class="side-title">Show</p>\n        <label class="check"><input type="checkbox" id="cal-all" ${S.calAll ? \'checked\' : \'\'}>Also show campaigns we haven\'t joined</label>',
   'id="cal-all"'],
  ["    $$('[data-type]', sb).forEach(i => i.onchange =",
   "    $('#cal-all', sb).onchange = ev => { S.calAll = ev.target.checked; store.set('calAll', S.calAll); renderMain(); };\n    $$('[data-type]', sb).forEach(i => i.onchange =",
   "$('#cal-all', sb)"],

  // first run: hide price-discount bars and season stripes on the calendar (can be re-ticked under Filters)
  ["  const RANK = { viewer: 1, editor: 2, admin: 3 };",
   "  if (!store.get('calDefaults2', false)) { S.hiddenTypes.add('discount'); S.hiddenTypes.add('season'); store.set('hiddenTypes', [...S.hiddenTypes]); store.set('calDefaults2', true); }\n  const RANK = { viewer: 1, editor: 2, admin: 3 };",
   "calDefaults2"]
]);

console.log('\nDone. Refresh the app in the browser (⌘ + Shift + R).');
