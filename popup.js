// ── Site preference ───────────────────────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const url = tabs[0]?.url;
  if (!url) return;

  let hostname;
  try { hostname = new URL(url).hostname; }
  catch { return; }

  document.getElementById('hostname').textContent = hostname;

  const prefKey = `lang_pref_${hostname}`;
  chrome.storage.local.get(prefKey, result => {
    const lang = result[prefKey];
    const el   = document.getElementById('pref-value');
    el.textContent  = lang === 'he' ? 'Hebrew' : lang === 'en' ? 'English' : 'none';
    el.style.color  = lang ? '#1a73e8' : '#9aa0a6';
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    chrome.storage.local.remove(prefKey, () => {
      const el = document.getElementById('pref-value');
      el.textContent = 'none';
      el.style.color = '#9aa0a6';
    });
  });
});

// ── OS keyboard switch shortcut capture ───────────────────────────────────
const input        = document.getElementById('switch-shortcut');
const clearBtn     = document.getElementById('clear-shortcut');
const SHORTCUT_KEY = 'keyboard_switch_shortcut';

// Load saved shortcut on open
chrome.storage.local.get(SHORTCUT_KEY, r => {
  const sc = r[SHORTCUT_KEY];
  if (sc) input.value = sc.display;
});

function formatKey(e) {
  const parts = [];
  if (e.metaKey)  parts.push('⌘');
  if (e.ctrlKey)  parts.push('⌃');
  if (e.altKey)   parts.push('⌥');
  if (e.shiftKey) parts.push('⇧');
  const name = {
    ' ': 'Space', 'ArrowUp': '↑', 'ArrowDown': '↓',
    'ArrowLeft': '←', 'ArrowRight': '→', 'Escape': 'Esc',
    'Enter': '↵', 'Backspace': '⌫', 'Delete': '⌦', 'Tab': '⇥',
  }[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(name);
  return parts.join('');
}

input.addEventListener('keydown', e => {
  e.preventDefault();
  // Ignore bare modifier presses
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;

  const display  = formatKey(e);
  const shortcut = {
    key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
    altKey: e.altKey, shiftKey: e.shiftKey, display,
  };
  input.value = display;
  chrome.storage.local.set({ [SHORTCUT_KEY]: shortcut });
});

input.addEventListener('focus', () => {
  if (!input.value) input.placeholder = 'Press your shortcut…';
});

input.addEventListener('blur', () => {
  input.placeholder = 'Click here and press your shortcut';
});

clearBtn.addEventListener('click', () => {
  chrome.storage.local.remove(SHORTCUT_KEY, () => {
    input.value = '';
  });
});
