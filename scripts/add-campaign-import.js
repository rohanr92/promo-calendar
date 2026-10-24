// One-time patch: adds "Import campaigns" (paste the Mirakl Marketplace campaigns table) to server.js and app.js.
// Run once:  node scripts/add-campaign-import.js
const fs = require('fs');
const path = require('path');

function patch(file, edits) {
  const p = path.join(__dirname, '..', file);
  let src = fs.readFileSync(p, 'utf8');
  for (const [find, replace, marker] of edits) {
    if (src.includes(marker)) { console.log(`  · ${file}: already has "${marker.slice(0, 40)}" — skipped`); continue; }
    const n = src.split(find).length - 1;
    if (n !== 1) { console.error(`  ✕ ${file}: expected 1 match for "${find.slice(0, 60)}", found ${n}. Nothing written.`); process.exit(1); }
    src = src.replace(find, () => replace); // function form: keeps "$$" etc. literal
  }
  fs.writeFileSync(p, src);
  console.log(`  ✓ ${file} updated`);
}

// ---------- server ----------
const ROUTE = [
  "app.post('/api/import/campaigns', requireRole('editor'), (req, res) => {",
  "  try { res.json(importCampaigns(req.body?.channel_id, req.body?.text, !!req.body?.dry_run)); }",
  "  catch (e) { res.status(400).json({ error: e.message }); }",
  "});",
  "",
  "// ---------------- users (sharing) ----------------"
].join('\n');

patch('src/server.js', [
  ["const { buildIcs } = require('./ics');",
   "const { buildIcs } = require('./ics');\nconst { importCampaigns } = require('./campaigns');",
   "require('./campaigns')"],
  ["// ---------------- users (sharing) ----------------", ROUTE, "/api/import/campaigns"],
  ["if (existing.source !== 'manual') return res.status(400)",
   "if (existing.source !== 'manual' && existing.source !== 'campaign') return res.status(400)",
   "existing.source !== 'campaign'"]
]);

// ---------- front end ----------
const OPEN_IMPORT = [
  "  function openImport() {",
  "    var opts = S.channels.map(function (c) { return '<option value=\"' + c.id + '\"' + (c.id === 'nordstrom' ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');",
  "    var body = '<div class=\"note\">In the marketplace\\'s Mirakl back office open <b>Price and stock → Promotions</b> (Marketplace campaigns). Set results per page to the maximum, select the table from the first campaign name down to the last end date, copy (⌘C) and paste it below. Paste again whenever it changes — campaigns already on the calendar are updated, not duplicated.</div>' +",
  "      '<label class=\"field\"><span>Marketplace</span><select class=\"input\" id=\"imp-ch\">' + opts + '</select></label>' +",
  "      '<label class=\"field\"><span>Pasted table</span><textarea class=\"input\" id=\"imp-text\" style=\"min-height:150px\" placeholder=\"Paste the copied campaigns table here\"></textarea></label>' +",
  "      '<div id=\"imp-preview\"></div>';",
  "    var m = modal('Import marketplace campaigns', body, '<div class=\"spacer\"></div><button class=\"btn\" data-close>Cancel</button><button class=\"btn\" id=\"imp-check\">Preview</button><button class=\"btn primary\" id=\"imp-go\" disabled>Import</button>', 760);",
  "    var root = m.root;",
  "    $$('[data-close]', root).forEach(function (b) { b.onclick = m.close; });",
  "    var payload = function (dry) { return { channel_id: $('#imp-ch', root).value, text: $('#imp-text', root).value, dry_run: dry }; };",
  "    var P = { invited: 'Invited', joined: 'Joined', not_joined: 'Not joined', declined: 'Declined', considering: 'Considering' };",
  "    var preview = async function () {",
  "      var pv = $('#imp-preview', root);",
  "      if (!$('#imp-text', root).value.trim()) { pv.innerHTML = ''; $('#imp-go', root).disabled = true; return; }",
  "      try {",
  "        var r = await api('POST', '/api/import/campaigns', payload(true));",
  "        if (!r.rows.length) { pv.innerHTML = '<p class=\"err\">No campaigns found. Make sure the start and end dates were part of what you copied.</p>'; $('#imp-go', root).disabled = true; return; }",
  "        pv.innerHTML = '<p class=\"sub\" style=\"margin:4px 0 8px;color:var(--muted)\">' + r.rows.length + ' campaign(s) found for ' + esc(r.channel) + '</p><table class=\"list\"><thead><tr><th>Campaign</th><th>Dates</th><th>Participation</th><th></th></tr></thead><tbody>' +",
  "          r.rows.map(function (x) { return '<tr><td>' + esc(x.name) + (x.name !== x.identifier ? '<div style=\"color:var(--muted);font-size:12px\">' + esc(x.identifier) + '</div>' : '') + '</td><td style=\"white-space:nowrap\">' + fmtRange(x.start_date, x.end_date) + '</td><td><span class=\"pill p-' + x.participation + '\">' + P[x.participation] + '</span></td><td><span class=\"pill p-neutral\">' + (x.action === 'new' ? 'New' : 'Update') + '</span></td></tr>'; }).join('') + '</tbody></table>';",
  "        $('#imp-go', root).disabled = false;",
  "      } catch (e) { toast(e.message); }",
  "    };",
  "    $('#imp-check', root).onclick = preview;",
  "    $('#imp-text', root).addEventListener('paste', function () { setTimeout(preview, 50); });",
  "    $('#imp-ch', root).onchange = preview;",
  "    $('#imp-go', root).onclick = async function () {",
  "      try {",
  "        var r = await api('POST', '/api/import/campaigns', payload(false));",
  "        m.close(); toast(r.channel + ': ' + r.imported + ' new, ' + r.updated + ' updated');",
  "        await loadEvents(); renderSidebar(); renderMain();",
  "      } catch (e) { toast(e.message); }",
  "    };",
  "  }",
  "",
  "  // ---------------- channels page ----------------"
].join('\n');

patch('public/app.js', [
  ["PENDING_APPROVAL: 'Pending approval',",
   "PENDING_APPROVAL: 'Pending approval', UPCOMING: 'Upcoming', ONGOING: 'Ongoing',",
   "UPCOMING: 'Upcoming'"],
  ['<span class="sync-note hide-sm">${esc(lastSyncNote())}</span>',
   '<span class="sync-note hide-sm">${esc(lastSyncNote())}</span>\n        ${can(\'editor\') ? \'<button class="btn sm" id="import-btn">Import campaigns</button>\' : \'\'}',
   'id="import-btn"'],
  ["$('#today-btn').onclick =",
   "if ($('#import-btn')) $('#import-btn').onclick = openImport;\n    $('#today-btn').onclick =",
   "onclick = openImport"],
  ['<div class="note">Synced from <b>',
   '<div class="note">${e.source === \'campaign\' ? \'Imported campaign from\' : \'Synced from\'} <b>',
   "'Imported campaign from'"],
  ["${!isNew && !synced ? '<button class=\"btn danger\" data-del>Delete</button>' : ''}",
   "${!isNew && (!synced || e.source === 'campaign') ? '<button class=\"btn danger\" data-del>Delete</button>' : ''}",
   "(!synced || e.source === 'campaign')"],
  ["  // ---------------- channels page ----------------", OPEN_IMPORT, "function openImport()"]
]);

console.log('\nDone. Restart the app (Ctrl+C, then npm run dev).');
