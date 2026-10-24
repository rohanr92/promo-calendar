const $ = id => document.getElementById(id);
const status = (text, cls) => { $('status').textContent = text; $('status').className = cls || ''; };

chrome.storage.sync.get({ appUrl: 'http://localhost:4300', key: '', auto: true }, s => {
  $('appUrl').value = s.appUrl; $('key').value = s.key; $('auto').checked = s.auto;
});

$('save').onclick = () => {
  const appUrl = $('appUrl').value.trim().replace(/\/+$/, '') || 'http://localhost:4300';
  chrome.storage.sync.set({ appUrl, key: $('key').value.trim(), auto: $('auto').checked }, () => status('Saved.', 'ok'));
};

$('test').onclick = () => {
  $('save').click();
  status('Testing…');
  setTimeout(() => chrome.runtime.sendMessage({ type: 'ping' }, r => {
    if (!r || !r.ok) return status(r ? r.error : 'No answer from the extension.', 'err');
    status(`Connected as ${r.data.user}.\nMarketplaces it will recognise:\n• ${r.data.marketplaces.join('\n• ') || '(none — add Mirakl URLs under Channels)'}`, 'ok');
  }), 200);
};
