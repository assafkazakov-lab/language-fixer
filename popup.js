// Per-site on/off switch. The content script watches the same storage key and
// reacts live, so toggling takes effect without a reload.
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
  var url = tabs[0] && tabs[0].url;
  var hostEl = document.getElementById('hostname');
  var toggle = document.getElementById('enabled');

  var hostname;
  try { hostname = new URL(url).hostname; } catch (e) { hostname = null; }

  if (!hostname) {
    hostEl.textContent = 'Not available here';
    toggle.disabled = true;
    return;
  }

  hostEl.textContent = hostname;
  var key = 'lang_fixer_disabled_' + hostname;

  chrome.storage.local.get(key, function (r) {
    toggle.checked = !r[key];
  });

  toggle.addEventListener('change', function () {
    if (toggle.checked) chrome.storage.local.remove(key);
    else chrome.storage.local.set({ [key]: true });
  });
});

document.getElementById('rebind').addEventListener('click', function () {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
