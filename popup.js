// Show current site hostname and saved preference
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const url = tabs[0]?.url;
  if (!url) return;

  let hostname;
  try { hostname = new URL(url).hostname; }
  catch { return; }

  document.getElementById('hostname').textContent = hostname;

  const key = `lang_pref_${hostname}`;
  chrome.storage.local.get(key, result => {
    const lang = result[key];
    const el = document.getElementById('pref-value');
    el.textContent = lang === 'he' ? 'Hebrew' : lang === 'en' ? 'English' : 'none';
    el.style.color = lang ? '#1a73e8' : '#9aa0a6';

    document.getElementById('clear-btn').addEventListener('click', () => {
      chrome.storage.local.remove(key, () => {
        el.textContent = 'none';
        el.style.color = '#9aa0a6';
      });
    });
  });
});
