// Talks to the Promo Calendar app (the page itself can't, because of the portal's security rules).
const getSettings = () => chrome.storage.sync.get({ appUrl: 'http://localhost:4300', key: '', auto: true });

async function call(path, body) {
  const { appUrl, key } = await getSettings();
  if (!key) throw new Error('Add your import key in the extension settings.');
  const res = await fetch(appUrl.replace(/\/+$/, '') + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Import-Key': key },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Calendar answered ${res.status}`);
  return data;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      if (msg.type === 'settings') return reply({ ok: true, settings: await getSettings() });
      if (msg.type === 'ping') return reply({ ok: true, data: await call('/api/ext/ping') });
      if (msg.type === 'import') return reply({ ok: true, data: await call('/api/ext/import', { url: msg.url, text: msg.text }) });
      reply({ ok: false, error: 'Unknown request' });
    } catch (e) {
      reply({ ok: false, error: e.message.includes('Failed to fetch') ? 'Calendar app not reachable — is it running, and is the address right?' : e.message });
    }
  })();
  return true; // keep the channel open for the async reply
});
