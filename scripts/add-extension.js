// One-time patch: wires the Chrome extension endpoints into server.js and adds
// "Chrome extension" setup + "campaigns last checked" to the app. Run once:
//   node scripts/add-extension.js
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

// ---------- server ----------
patch('src/server.js', [
  ['app.use(loadUser);', "app.use(loadUser);\nrequire('./extension-api')(app);", "require('./extension-api')"]
]);

// ---------- front end ----------
const SOURCE_OLD = `    const source = ch.kind === 'mirakl'
      ? (noApi ? 'Campaigns: import from portal' : ch.last_sync_at ? \`Mirakl sync · \${new Date(ch.last_sync_at.replace(' ', 'T') + 'Z').toLocaleDateString([], { month: 'short', day: 'numeric' })}\` : (ch.has_key ? 'Not synced yet' : 'No API key yet'))
      : ch.id === '_none' ? 'Applies to every channel' : 'Added by hand';`;
const SOURCE_NEW = `    const impLocal = ch.last_import_at ? new Date(ch.last_import_at.replace(' ', 'T') + 'Z') : null;
    const impDays = impLocal ? diffDays(fromParts(impLocal.getFullYear(), impLocal.getMonth() + 1, impLocal.getDate()), todayStr()) : null;
    const staleImport = ch.kind === 'mirakl' && (impDays === null || impDays > 7);
    const campaignNote = ch.kind !== 'mirakl' ? '' : impDays === null ? 'Campaigns never checked' : impDays === 0 ? 'Campaigns checked today' : \`Campaigns checked \${plural(impDays, 'day')} ago\`;
    const apiNote = ch.kind !== 'mirakl' ? '' : noApi ? '' : ch.last_sync_at ? \`API sync \${new Date(ch.last_sync_at.replace(' ', 'T') + 'Z').toLocaleDateString([], { month: 'short', day: 'numeric' })}\` : (ch.has_key ? 'Not synced yet' : 'No API key yet');
    const source = ch.kind === 'mirakl' ? [apiNote, campaignNote].filter(Boolean).join(' · ')
      : ch.id === '_none' ? 'Applies to every channel' : 'Added by hand';`;

const OPEN_EXT = `  async function openExtension() {
    let key;
    try { key = (await api('GET', '/api/me/import-key')).key; } catch (e) { return toast(e.message); }
    const appUrl = S.appUrl.replace(/\\/$/, '');
    const { root } = modal('Chrome extension — auto-import campaigns', \`
      <p style="margin-top:0">Mirakl's API doesn't share Marketplace campaigns. With this extension, whenever you open a marketplace's <b>Price and stock → Promotions</b> page, its campaigns are sent to the calendar automatically.</p>
      <label class="field"><span>Calendar address</span><div class="copy-row"><input class="input" readonly value="\${esc(appUrl)}" id="ext-url"><button class="btn" data-copy="ext-url">Copy</button></div></label>
      <label class="field"><span>Your import key (keep it private)</span><div class="copy-row"><input class="input" readonly value="\${esc(key)}" id="ext-key"><button class="btn" data-copy="ext-key">Copy</button></div></label>
      <ol class="steps tight">
        <li>In Chrome open <b>chrome://extensions</b> and turn on <b>Developer mode</b> (top right).</li>
        <li>Click <b>Load unpacked</b> and choose the <b>extension</b> folder inside promo-calendar.</li>
        <li>Click the extension's icon, paste the address and key above, then <b>Save</b> and <b>Test connection</b>.</li>
        <li>Open each marketplace's Promotions page with <b>Results per page</b> at the maximum. A green note confirms the import.</li>
      </ol>
      <div class="note">Each marketplace card shows when its campaigns were last checked. If one goes over 7 days, just open that portal's Promotions page again.</div>\`,
      '<button class="btn" id="ext-reset">New key</button><div class="spacer"></div><button class="btn primary" data-close>Done</button>');
    $$('[data-copy]', root).forEach(b => b.onclick = () => { const i = $('#' + b.dataset.copy, root); i.select(); navigator.clipboard?.writeText(i.value).then(() => toast('Copied'), () => document.execCommand('copy')); });
    $('#ext-reset', root).onclick = async () => {
      if (!confirm('The old key stops working in any browser that uses it. Continue?')) return;
      await api('POST', '/api/me/import-key/reset'); openExtension(); toast('New key created');
    };
  }

  function openSubscribe() {`;

patch('public/app.js', [
  [SOURCE_OLD, SOURCE_NEW, 'const staleImport'],
  ['<span class="pill p-invited">${decN} to decide</span>` : \'\'}</div>',
   '<span class="pill p-invited">${decN} to decide</span>` : \'\'}${staleImport && can(\'editor\') ? `<button class="pill p-neutral pill-btn" data-import="${ch.id}">Check campaigns</button>` : \'\'}</div>',
   'pill-btn'],
  ['${can(\'editor\') ? (noApi ? `<button class="btn sm" data-import="${ch.id}">',
   '${can(\'editor\') ? (ch.kind === \'mirakl\' ? `<button class="btn sm" data-import="${ch.id}">',
   "(ch.kind === 'mirakl' ? `<button class=\"btn sm\" data-import"],
  ['<button data-m="gcal">Add to Google Calendar</button>',
   '${can(\'editor\') ? \'<button data-m="ext">Chrome extension (auto-import)</button>\' : \'\'}\n            <button data-m="gcal">Add to Google Calendar</button>',
   'data-m="ext"'],
  ['gcal: openSubscribe, logout: logout }', 'gcal: openSubscribe, ext: openExtension, logout: logout }', 'ext: openExtension'],
  ['  function openSubscribe() {', OPEN_EXT, 'async function openExtension()'],
  ["$$('[data-import]', c).forEach(b => b.onclick = () => openImport());",
   "$$('[data-import]', c).forEach(b => b.onclick = () => openImport());\n    $$('[data-ext]', c).forEach(b => b.onclick = openExtension);",
   "$$('[data-ext]', c)"],
  ['<div class="head-actions"><button class="btn" data-import>Import campaigns</button></div></div>',
   '<div class="head-actions"><button class="btn" data-ext>Chrome extension</button><button class="btn" data-import>Import campaigns</button></div></div>',
   'data-ext>Chrome extension']
]);

patch('public/styles.css', [
  ['.btn.ghost-line { border-style: dashed; }',
   '.btn.ghost-line { border-style: dashed; }\n.pill-btn { border: 1px dashed #98A2B3; cursor: pointer; font-family: inherit; }\n.pill-btn:hover { background: #E4E7EC; }',
   '.pill-btn']
]);

console.log('\nDone. Restart the app (Ctrl+C, then npm run dev).');
