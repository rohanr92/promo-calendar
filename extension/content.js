// Runs on *.mirakl.net. When the Marketplace campaigns list is on screen, sends it to the Promo Calendar.
(() => {
  const DATE = /\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}/i;
  let lastSent = '';
  let timer = null;
  let badge, button;

  // find the campaigns list: the block under the "Marketplace campaigns" heading
  function findCampaignBlock() {
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
      .find(h => /marketplace campaigns/i.test(h.textContent || ''));
    if (!heading) return null;
    let box = heading.parentElement;
    for (let i = 0; i < 6 && box; i++, box = box.parentElement) {
      const table = box.querySelector('table, [role="table"], [role="grid"]');
      if (table && DATE.test(table.innerText)) return table;
    }
    return null;
  }

  function show(text, kind = 'info') {
    if (!badge) {
      badge = document.createElement('div');
      Object.assign(badge.style, {
        position: 'fixed', left: '16px', bottom: '16px', zIndex: 2147483647, maxWidth: '360px',
        font: '13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '10px 14px',
        borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,.18)', color: '#fff', cursor: 'pointer'
      });
      badge.title = 'Click to hide';
      badge.onclick = () => (badge.style.display = 'none');
      document.body.appendChild(badge);
    }
    badge.style.display = 'block';
    badge.style.background = kind === 'error' ? '#B42318' : kind === 'ok' ? '#166534' : '#16191F';
    badge.textContent = text;
  }

  function addButton() {
    if (button && document.body.contains(button)) return;
    button = document.createElement('button');
    button.textContent = 'Send to Promo Calendar';
    Object.assign(button.style, {
      position: 'fixed', right: '16px', bottom: '88px', zIndex: 2147483647, padding: '9px 14px',
      font: '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#fff',
      background: '#1A56DB', border: '0', borderRadius: '8px', cursor: 'pointer', boxShadow: '0 6px 18px rgba(26,86,219,.35)'
    });
    button.onclick = () => send(true);
    document.body.appendChild(button);
  }
  function removeButton() { if (button) button.remove(); button = null; }

  function send(manual) {
    const block = findCampaignBlock();
    if (!block) { if (manual) show('No campaigns table found on this page.', 'error'); return; }
    const text = block.innerText;
    if (!manual && text === lastSent) return;
    lastSent = text;
    show('Sending campaigns to Promo Calendar…');
    chrome.runtime.sendMessage({ type: 'import', url: location.href, text }, r => {
      if (chrome.runtime.lastError) return show('Extension error — reload the page.', 'error');
      if (!r || !r.ok) return show(`Promo Calendar: ${r ? r.error : 'no answer'}`, 'error');
      const d = r.data;
      const total = d.imported + d.updated;
      show(total ? `Promo Calendar · ${d.channel}: ${d.imported} new, ${d.updated} updated` : `Promo Calendar: no campaigns found in the table`, total ? 'ok' : 'error');
      setTimeout(() => { if (badge) badge.style.display = 'none'; }, 6000);
    });
  }

  // the portal is a single-page app — watch for the table appearing or changing (page switch, filters)
  function check() {
    const block = findCampaignBlock();
    if (!block) { removeButton(); return; }
    addButton();
    chrome.runtime.sendMessage({ type: 'settings' }, r => {
      if (chrome.runtime.lastError || !r || !r.ok) return;
      if (r.settings.auto && r.settings.key) send(false);
    });
  }
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(check, 1500); })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(check, 1500);
})();
