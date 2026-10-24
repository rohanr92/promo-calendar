// Checks every Mirakl account: does the key work, is PR01 (promotions) allowed, can offers (discounts) be read?
// Run:  npm run check:mirakl
require('dotenv').config();
const { db, seedChannels } = require('../src/db');
const { testChannel } = require('../src/mirakl');

(async () => {
  seedChannels();
  const channels = db.prepare(`SELECT * FROM channels WHERE kind = 'mirakl' ORDER BY sort`).all();
  console.log('\nMirakl promotion access check\n' + '-'.repeat(60));
  for (const c of channels) {
    if (!c.base_url || !c.api_key) {
      console.log(`\n${c.name}\n  ⚪ skipped — add MIRAKL_${c.id.toUpperCase()}_URL and _KEY to .env (or set them in the app)`);
      continue;
    }
    const r = await testChannel(c);
    const line = (label, x) => x ? `  ${x.ok ? '✅' : '❌'} ${label}: ${x.detail}` : `  ⚪ ${label}: not checked`;
    console.log(`\n${c.name}  (${c.base_url})`);
    console.log(line('API key     ', r.account));
    console.log(line('Promotions  ', r.promotions));
    console.log(line('Discounts   ', r.discounts));
  }
  console.log('\nDone.\n');
})();
