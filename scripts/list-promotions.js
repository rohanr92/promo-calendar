// Shows what Mirakl's API (PR01) returns per marketplace, and what's stored on the calendar.
// Run:  npm run list:promos            (all Mirakl channels)
//       npm run list:promos -- macys   (one channel)
require('dotenv').config();
const { db, seedChannels } = require('../src/db');
const { miraklGet } = require('../src/mirakl');

const only = process.argv[2];
const day = s => (s ? String(s).slice(0, 10) : '?');

(async () => {
  seedChannels();
  const now = new Date();
  const channels = db.prepare(`SELECT * FROM channels WHERE kind = 'mirakl' ORDER BY sort`).all()
    .filter(c => !only || c.id === only);

  for (const c of channels) {
    console.log(`\n${'='.repeat(70)}\n${c.name}`);
    if (!c.base_url || !c.api_key) { console.log('  no URL / API key — skipped'); continue; }

    let all = [];
    try {
      for (let offset = 0; ; offset += 100) {
        const r = await miraklGet(c, '/api/promotions', { states: 'ALL', max: 100, offset });
        all.push(...(r.promotions || []));
        if ((r.promotions || []).length < 100 || all.length >= (r.total_count ?? 0)) break;
      }
    } catch (e) {
      console.log(`  API: ${e.status === 403 || e.status === 404 ? 'promotions API not enabled for your shop' : e.message}`);
      all = null;
    }

    if (all) {
      const byState = all.reduce((m, p) => (m[p.state] = (m[p.state] || 0) + 1, m), {});
      const upcoming = all.filter(p => new Date(p.end_date) >= now).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
      console.log(`  API returns ${all.length} promotion(s): ${Object.entries(byState).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
      console.log(`  Not ended yet: ${upcoming.length}`);
      for (const p of upcoming) {
        console.log(`    • ${day(p.start_date)} → ${day(p.end_date)}  [${p.state}]  ${p.internal_description || (p.public_descriptions || [])[0]?.value || p.internal_id}`);
      }
    }

    const stored = db.prepare(`SELECT source, COUNT(*) n FROM events WHERE channel_id = ? AND end_date >= date('now') GROUP BY source`).all(c.id);
    const label = { mirakl: 'from API sync', campaign: 'imported campaigns', mirakl_discount: 'price-discount windows', manual: 'added by hand' };
    console.log(`  On the calendar (not ended): ${stored.map(s => `${s.n} ${label[s.source] || s.source}`).join(', ') || 'nothing'}`);
  }
  console.log(`\n${'='.repeat(70)}
If an upcoming promotion you see in the portal is NOT listed above, it's a
"Marketplace campaign" (created by the retailer, with a Join button).
Mirakl's API doesn't expose those — use "Import campaigns" in the app.\n`);
})();
