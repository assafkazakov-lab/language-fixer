(function () {
  'use strict';

  if (window.__langFixerLoaded) return;
  window.__langFixerLoaded = true;

  var D = window.__langFixerDetect;
  if (!D) return;

  var DEBOUNCE_MS = 800;   // long enough that the chip never appears mid-thought

  // ── Site enable/disable ──────────────────────────────────────────────────
  var siteEnabled = true;
  var DISABLED_KEY = 'lang_fixer_disabled_' + location.hostname;

  try {
    chrome.storage.local.get(DISABLED_KEY, function (r) {
      siteEnabled = !r[DISABLED_KEY];
      if (!siteEnabled) hideChip();
    });
    chrome.storage.onChanged.addListener(function (changes) {
      if (changes[DISABLED_KEY]) {
        siteEnabled = !changes[DISABLED_KEY].newValue;
        if (!siteEnabled) hideChip();
      }
    });
  } catch (e) { /* storage unavailable; stay enabled */ }

  // ── Field helpers ────────────────────────────────────────────────────────
  var NON_TEXT = ['button','submit','reset','checkbox','radio','file','image','range','color','hidden'];

  function isPassword(el) {
    return el && el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'password';
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return NON_TEXT.indexOf((el.type || '').toLowerCase()) === -1;
    return false;
  }

  function getText(el) {
    return el.isContentEditable ? (el.innerText || '') : (el.value || '');
  }

  function getSelectionText(el) {
    if (el.isContentEditable) {
      var sel = window.getSelection();
      return sel ? sel.toString() : '';
    }
    var s = el.selectionStart, e = el.selectionEnd;
    return (s != null && s !== e) ? el.value.slice(s, e) : '';
  }

  // ── Writing back ─────────────────────────────────────────────────────────
  // For inputs and textareas we can replace the value wholesale and restore the
  // caret, since the layout map preserves length exactly.
  function writeInput(el, next) {
    var s = el.selectionStart, e = el.selectionEnd;
    el.focus();
    el.select();
    if (!document.execCommand('insertText', false, next)) {
      var proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, next);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    }
    if (s != null) try { el.setSelectionRange(s, e); } catch (err) { /* detached */ }
  }

  // For contentEditable we rewrite each text node's changed sub-range in place,
  // so surrounding formatting survives. Selecting the whole editor and
  // reinserting would flatten it.
  function writeEditable(el, transform) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);

    var sel = window.getSelection();
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i], text = node.data, next = transform(text);
      if (next === text) continue;

      var a = 0;
      while (a < text.length && text[a] === next[a]) a++;
      var b = text.length;
      while (b > a && text[b - 1] === next[b - 1]) b--;

      var range = document.createRange();
      range.setStart(node, a);
      range.setEnd(node, b);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, next.slice(a, b));
    }
  }

  function applyToField(el, transform) {
    if (el.isContentEditable) { writeEditable(el, transform); return; }
    var value = el.value;
    var s = el.selectionStart, e = el.selectionEnd;
    if (s != null && s !== e) {
      writeInput(el, value.slice(0, s) + transform(value.slice(s, e)) + value.slice(e));
    } else {
      writeInput(el, transform(value));
    }
  }

  // ── Hotkey: unconditional flip ───────────────────────────────────────────
  // No plausibility check — the user asked for it, and flipping is its own
  // inverse. With no selection we flip the word at the caret, which for a
  // password field (no spaces) is the whole value.
  var WORD_CHAR = /[א-תA-Za-z0-9_'/;,.@\\-]/;

  function flipAtCaret(el) {
    if (el.isContentEditable) {
      var sel = window.getSelection();
      if (sel && sel.toString()) { writeEditable(el, D.flip); return; }
      writeEditable(el, D.flip);
      return;
    }
    var value = el.value;
    if (!value) return;
    var s = el.selectionStart, e = el.selectionEnd;
    if (s != null && s !== e) {
      writeInput(el, value.slice(0, s) + D.flip(value.slice(s, e)) + value.slice(e));
      return;
    }
    var caret = s == null ? value.length : s;
    var start = caret, end = caret;
    while (start > 0 && WORD_CHAR.test(value[start - 1])) start--;
    while (end < value.length && WORD_CHAR.test(value[end])) end++;
    if (start === end) return;
    writeInput(el, value.slice(0, start) + D.flip(value.slice(start, end)) + value.slice(end));
  }

  function targetField() {
    var el = document.activeElement;
    return isEditable(el) ? el : (activeField && document.contains(activeField) ? activeField : null);
  }

  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'lang-fixer-flip') {
        var el = targetField();
        if (el) { flipAtCaret(el); hideChip(); }
      }
    });
  } catch (e) { /* no runtime in this context */ }

  // ── Chip ─────────────────────────────────────────────────────────────────
  var host = document.createElement('div');
  host.setAttribute('data-lang-fixer-host', '');
  host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;';

  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<style>',
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
    '.chip{display:inline-flex;align-items:stretch;background:#fff;border:1.5px solid #1a73e8;',
    'border-radius:24px;box-shadow:0 3px 12px rgba(26,115,232,.18),0 1px 4px rgba(0,0,0,.10);',
    'pointer-events:all;opacity:0;transform:translateY(5px) scale(.97);visibility:hidden;',
    'transition:opacity .15s ease,transform .15s ease,visibility .15s;',
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;",
    'font-size:13px;white-space:nowrap;user-select:none;overflow:hidden}',
    '.chip.visible{opacity:1;transform:translateY(0) scale(1);visibility:visible}',
    '.row{display:flex;align-items:center}',
    '.action{display:flex;align-items:center;gap:6px;border:none;background:none;',
    'padding:6px 4px 6px 14px;cursor:pointer;font-size:13px;font-family:inherit;color:#1a73e8;',
    'font-weight:500;line-height:1;transition:background .08s}',
    '.action:hover{background:#e8f0fe}.action:active{background:#d2e3fc}',
    '.label{color:#5f6368;font-weight:400}.target{color:#1a73e8;font-weight:600}',
    '.sep{width:1px;align-self:stretch;background:#dadce0;margin:5px 0;flex-shrink:0}',
    '.dismiss{display:flex;align-items:center;justify-content:center;border:none;background:none;',
    'padding:0 11px;cursor:pointer;color:#80868b;font-size:14px;line-height:1;',
    'transition:color .08s;align-self:stretch}',
    '.dismiss:hover{color:#3c4043}',
    '</style>',
    '<div class="chip" id="chip"><div class="row">',
    '<button class="action" id="action"><span class="label" id="label"></span>',
    '&thinsp;→&thinsp;<span class="target" id="target"></span></button>',
    '<div class="sep"></div>',
    '<button class="dismiss" id="dismiss" title="Dismiss (Esc)">✕</button>',
    '</div></div>',
  ].join('');

  var chip = shadow.getElementById('chip');
  var actionBtn = shadow.getElementById('action');
  var labelEl = shadow.getElementById('label');
  var targetEl = shadow.getElementById('target');
  var dismissBtn = shadow.getElementById('dismiss');

  var activeField = null;
  var pendingDir = null;
  var timer = null;
  // Text the user explicitly dismissed, and text we just produced — both keep
  // the chip from immediately coming back.
  var dismissedFor = new WeakMap();
  var convertedTo = new WeakMap();

  var GAP = 6, CHIP_H = 36;

  function placeChip(el) {
    var r = el.getBoundingClientRect();
    var w = chip.offsetWidth || 320;
    var top = r.bottom + GAP;
    if (top + CHIP_H > window.innerHeight - 8) top = r.top - CHIP_H - GAP;
    top = Math.max(8, top);
    var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    host.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
  }

  function showChip(el, dir) {
    pendingDir = dir;
    labelEl.textContent = dir === 'toEnglish' ? 'Typed in Hebrew?' : 'Typed in English?';
    targetEl.textContent = dir === 'toEnglish' ? 'Switch to English' : 'Switch to Hebrew';
    chip.classList.add('visible');
    placeChip(el);
  }

  function hideChip() {
    chip.classList.remove('visible');
    pendingDir = null;
  }

  actionBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
  dismissBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });

  actionBtn.addEventListener('click', function () {
    if (!activeField || !pendingDir) return;
    var dir = pendingDir;
    applyToField(activeField, function (t) { return D.convertSpan(t, dir); });
    convertedTo.set(activeField, getText(activeField));
    hideChip();
  });

  dismissBtn.addEventListener('click', function () {
    if (activeField) dismissedFor.set(activeField, getText(activeField));
    hideChip();
  });

  // ── Detection loop ───────────────────────────────────────────────────────
  function runDetection(el) {
    if (!siteEnabled || !el || !isEditable(el) || isPassword(el)) return;
    var text = getSelectionText(el) || getText(el);
    if (!text) { hideChip(); return; }
    if (dismissedFor.get(el) === text || convertedTo.get(el) === text) { hideChip(); return; }

    var dir = D.detectConversion(text);
    if (dir) showChip(el, dir); else hideChip();
  }

  function schedule(el) {
    clearTimeout(timer);
    timer = setTimeout(function () { runDetection(el); }, DEBOUNCE_MS);
  }

  document.addEventListener('focusin', function (e) {
    if (isEditable(e.target) && !e.target.hasAttribute('data-lang-fixer-host')) activeField = e.target;
  }, true);

  document.addEventListener('focusout', function (e) {
    if (e.target !== activeField) return;
    clearTimeout(timer);
    setTimeout(function () {
      if (document.activeElement !== activeField) { hideChip(); activeField = null; }
    }, 220);
  }, true);

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!isEditable(el) || el.hasAttribute('data-lang-fixer-host')) return;
    activeField = el;
    if (isPassword(el)) return;      // never auto-scan a password
    hideChip();                      // stale suggestion shouldn't linger while typing
    schedule(el);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && pendingDir) {
      if (activeField) dismissedFor.set(activeField, getText(activeField));
      hideChip();
    }
  }, true);

  document.addEventListener('scroll', function () {
    if (activeField && pendingDir) placeChip(activeField);
  }, { passive: true, capture: true });

  window.addEventListener('resize', function () {
    if (activeField && pendingDir) placeChip(activeField);
  }, { passive: true });

  (document.body || document.documentElement).appendChild(host);
})();
