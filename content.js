(function () {
  'use strict';

  if (window.__langFixerLoaded) return;
  window.__langFixerLoaded = true;

  // ── Keyboard layout map ──────────────────────────────────────────────────
  const EN_TO_HE = {
    e:'ק', r:'ר', t:'א', y:'ט', u:'ו', i:'ן', o:'ם', p:'פ',
    a:'ש', s:'ד', d:'ג', f:'כ', g:'ע', h:'י', j:'ח', k:'ל', l:'ך',
    z:'ז', x:'ס', c:'ב', v:'ה', b:'נ', n:'מ', m:'צ',
    ';':'ף', ',':'ת', '.':'ץ',
  };

  const HE_TO_EN = Object.fromEntries(Object.entries(EN_TO_HE).map(([e, h]) => [h, e]));

  // ── Conversion functions ─────────────────────────────────────────────────
  function toHebrew(text) {
    return [...text].map(ch => EN_TO_HE[ch.toLowerCase()] ?? ch).join('');
  }

  function toEnglish(text) {
    return [...text].map(ch => HE_TO_EN[ch] ?? ch).join('');
  }

  // ── High-confidence detection ────────────────────────────────────────────
  const EN_STOP = new Set([
    'the','a','an','and','or','but','nor','so','yet','for','of','in',
    'on','at','to','by','up','as','if','it','he','she','we','they',
    'me','my','his','her','its','our','their','this','that','these',
    'those','who','what','which','where','when','why','how',
    'be','am','is','are','was','were','been','being','have','has','had',
    'do','does','did','will','would','shall','should','may','might',
    'must','can','could',
    'not','with','from','into','about','than','then','now','only','over',
    'also','back','just','more','out','all','well','even','get','him',
    'them','some','other','any','each','both','you','your','say',
    'said','go','come','take','make','see','know','think','look','want',
    'give','use','find','tell','ask','work','seem','feel','try','leave',
    'call','keep','let','put','need','become','show','hear','play','run',
    'move','live','stand','lose','pay','meet','set','learn','change',
    'lead','write','read','spend','grow','open','walk','win','follow',
    'stop','build','send','help','start','add','turn','love',
    'hello','hi','hey','okay','ok','yes','no','please','thanks','thank',
    'sorry','sure','right','wrong','good','bad','great','nice','new',
    'old','big','small','long','short','true','false','real','test',
    'name','word','line','point','number','place','time','day','week',
    'year','life','man','woman','people','world','way','thing','part',
    'case','side','hand','end','home','water','room','door','car','food',
    'here','there','very','still','never','always','often',
    'already','every','much','many','few','own','next','after','before',
    'through','between','without','because','though','while','since',
  ]);

  // Returns 'toEnglish' | 'toHebrew' | null
  function detectConversion(text) {
    let heCount = 0, enLower = 0, enUpper = 0;
    for (const ch of text) {
      if (/[א-׿]/.test(ch)) heCount++;
      else if (/[a-z]/.test(ch)) enLower++;
      else if (/[A-Z]/.test(ch)) enUpper++;
    }
    const enCount = enLower + enUpper;
    const total   = heCount + enCount;
    if (total < 3) return null;

    const heRatio = heCount / total;
    const enRatio = enCount / total;

    if (heRatio >= 0.85) {
      const converted = toEnglish(text);
      const letters   = converted.replace(/[^a-zA-Z]/g, '');
      const vowels    = (letters.match(/[aeiou]/gi) || []).length;
      const vr        = letters.length ? vowels / letters.length : 0;
      return (vr >= 0.15 && vr <= 0.65) ? 'toEnglish' : null;
    }

    if (enRatio >= 0.85) {
      if (enUpper > 0) return null;
      const words = text.toLowerCase().match(/[a-z]+/g) || [];
      if (words.some(w => EN_STOP.has(w))) return null;
      return 'toHebrew';
    }

    return null;
  }

  // ── Field helpers ────────────────────────────────────────────────────────
  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') {
      const t = (el.type || '').toLowerCase();
      return !['button','submit','reset','checkbox','radio','file','image','range','color','hidden'].includes(t);
    }
    return false;
  }

  function getText(el) {
    return el.isContentEditable ? (el.innerText ?? '') : (el.value ?? '');
  }

  function getSelection(el) {
    if (el.isContentEditable) {
      const sel = window.getSelection();
      return sel?.toString() || '';
    }
    const { selectionStart: s, selectionEnd: e } = el;
    return (s != null && s !== e) ? el.value.slice(s, e) : '';
  }

  function setFullText(el, text) {
    if (el.isContentEditable) {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      return;
    }
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function replaceSelection(el, newText) {
    if (el.isContentEditable) {
      el.focus();
      document.execCommand('insertText', false, newText);
      return;
    }
    const { selectionStart: s, selectionEnd: e, value } = el;
    setFullText(el, value.slice(0, s) + newText + value.slice(e));
    el.setSelectionRange(s, s + newText.length);
  }

  function applyConvert(el, fn) {
    const sel = getSelection(el);
    if (sel) replaceSelection(el, fn(sel));
    else { const t = getText(el); if (t) setFullText(el, fn(t)); }
  }

  // ── Per-site language preference ─────────────────────────────────────────
  const PREF_KEY = `lang_pref_${location.hostname}`;

  function savePref(lang) {
    try { chrome.storage.local.set({ [PREF_KEY]: lang }); } catch {}
  }

  // ── OS keyboard switch shortcut ───────────────────────────────────────────
  // Loaded once at startup; refreshed before showing the confirm phase.
  let kbShortcut = null; // { key, ctrlKey, metaKey, altKey, shiftKey, display }

  function loadKbShortcut(cb) {
    try {
      chrome.storage.local.get('keyboard_switch_shortcut', r => {
        kbShortcut = r.keyboard_switch_shortcut || null;
        cb && cb(kbShortcut);
      });
    } catch { cb && cb(null); }
  }

  function matchesShortcut(e, sc) {
    return sc &&
      e.key       === sc.key &&
      e.ctrlKey   === sc.ctrlKey &&
      e.metaKey   === sc.metaKey &&
      e.altKey    === sc.altKey &&
      e.shiftKey  === sc.shiftKey;
  }

  loadKbShortcut();

  // ── Shadow-DOM chip ───────────────────────────────────────────────────────
  const host = document.createElement('div');
  host.setAttribute('data-lang-fixer-host', '');
  Object.assign(host.style, {
    position: 'fixed', top: '0', left: '0',
    zIndex: '2147483647', pointerEvents: 'none',
  });

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      .chip {
        display: inline-flex;
        align-items: stretch;
        background: #fff;
        border: 1.5px solid #1a73e8;
        border-radius: 24px;
        box-shadow: 0 3px 12px rgba(26,115,232,0.18), 0 1px 4px rgba(0,0,0,0.10);
        pointer-events: all;
        opacity: 0;
        transform: translateY(5px) scale(0.97);
        transition: opacity 0.15s ease, transform 0.15s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 13px;
        white-space: nowrap;
        user-select: none;
        overflow: hidden;
      }
      .chip.visible { opacity: 1; transform: translateY(0) scale(1); }
      .chip.confirmed {
        border-color: #188038;
        box-shadow: 0 3px 12px rgba(24,128,56,0.18), 0 1px 4px rgba(0,0,0,0.08);
      }

      /* ── Suggest phase ── */
      #phase-suggest {
        display: flex;
        align-items: center;
      }
      .action {
        display: flex;
        align-items: center;
        gap: 6px;
        border: none;
        background: none;
        padding: 6px 4px 6px 14px;
        cursor: pointer;
        font-size: 13px;
        font-family: inherit;
        color: #1a73e8;
        font-weight: 500;
        line-height: 1;
        transition: background 0.08s;
      }
      .action:hover { background: #e8f0fe; }
      .action:active { background: #d2e3fc; }
      .action-label { color: #5f6368; font-weight: 400; }
      .action-target { color: #1a73e8; font-weight: 600; }

      /* ── Confirm phase ── */
      #phase-confirm {
        display: none;
        align-items: center;
        gap: 8px;
        padding: 0 8px 0 14px;
      }
      #phase-confirm.active { display: flex; }
      .check { color: #188038; font-size: 15px; font-weight: 700; line-height: 1; }
      .confirm-text { font-size: 12.5px; color: #3c4043; line-height: 1; }
      .kbd-pill {
        display: none;
        background: #f1f3f4;
        border: 1px solid #dadce0;
        border-bottom-width: 2px;
        border-radius: 4px;
        padding: 2px 7px;
        font-size: 11px;
        font-family: monospace;
        color: #3c4043;
        line-height: 1.5;
      }
      .kbd-pill.visible { display: inline-block; }

      /* ── Shared ── */
      .sep {
        width: 1px;
        align-self: stretch;
        background: #dadce0;
        margin: 5px 0;
        flex-shrink: 0;
        transition: background 0.2s;
      }
      .chip.confirmed .sep { background: #ceead6; }
      .dismiss {
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: none;
        padding: 0 11px;
        cursor: pointer;
        color: #80868b;
        font-size: 14px;
        line-height: 1;
        transition: color 0.08s;
        align-self: stretch;
      }
      .dismiss:hover { color: #3c4043; }
    </style>

    <div class="chip" id="chip">

      <!-- Phase 1: wrong-language suggestion -->
      <div id="phase-suggest">
        <button class="action" id="action-btn">
          <span class="action-label" id="action-label">Typed in Hebrew?</span>
          &thinsp;→&thinsp;
          <span class="action-target" id="action-target">Switch to English</span>
        </button>
        <div class="sep"></div>
        <button class="dismiss" id="suggest-dismiss" title="Dismiss">✕</button>
      </div>

      <!-- Phase 2: fix confirmed, keyboard switch reminder -->
      <div id="phase-confirm">
        <span class="check">✓</span>
        <span class="confirm-text" id="confirm-text">Converted — switch keyboard to English</span>
        <kbd class="kbd-pill" id="kbd-pill"></kbd>
        <div class="sep"></div>
        <button class="dismiss" id="confirm-dismiss" title="Dismiss">✕</button>
      </div>

    </div>
  `;

  const chip          = shadow.getElementById('chip');
  const phaseSuggest  = shadow.getElementById('phase-suggest');
  const phaseConfirm  = shadow.getElementById('phase-confirm');
  const actionBtn     = shadow.getElementById('action-btn');
  const actionLabel   = shadow.getElementById('action-label');
  const actionTarget  = shadow.getElementById('action-target');
  const suggestDismiss = shadow.getElementById('suggest-dismiss');
  const confirmText   = shadow.getElementById('confirm-text');
  const kbdPill       = shadow.getElementById('kbd-pill');
  const confirmDismiss = shadow.getElementById('confirm-dismiss');

  let activeField    = null;
  let pendingDir     = null;
  let detectionTimer = null;
  let confirmTimer   = null;

  // ── Positioning ───────────────────────────────────────────────────────────
  const GAP    = 6;
  const CHIP_H = 36;
  const CHIP_W = 320;

  function placeChip(el) {
    const r    = el.getBoundingClientRect();
    let top  = r.bottom + GAP;
    let left = r.left;
    if (top + CHIP_H > window.innerHeight - 8) top = r.top - CHIP_H - GAP;
    top  = Math.max(8, top);
    left = Math.max(8, Math.min(left, window.innerWidth - CHIP_W - 8));
    host.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
  }

  // ── Chip phase helpers ────────────────────────────────────────────────────
  function enterSuggestPhase(direction) {
    pendingDir = direction;
    if (direction === 'toEnglish') {
      actionLabel.textContent  = 'Typed in Hebrew?';
      actionTarget.textContent = 'Switch to English';
    } else {
      actionLabel.textContent  = 'Typed in English?';
      actionTarget.textContent = 'Switch to Hebrew';
    }
    phaseSuggest.style.display = '';
    phaseConfirm.classList.remove('active');
    chip.classList.remove('confirmed');
  }

  function enterConfirmPhase(targetLang) {
    const langLabel = targetLang === 'en' ? 'English' : 'Hebrew';

    // Reload shortcut in case user just configured it in the popup
    loadKbShortcut(sc => {
      confirmText.textContent = `Converted — switch keyboard to ${langLabel}`;

      if (sc) {
        kbdPill.textContent = sc.display;
        kbdPill.classList.add('visible');
      } else {
        kbdPill.classList.remove('visible');
      }

      phaseSuggest.style.display = 'none';
      phaseConfirm.classList.add('active');
      chip.classList.add('confirmed');

      // Auto-dismiss after 8 s if the user doesn't interact
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(hideChip, 8000);
    });
  }

  function showChip(el, direction) {
    placeChip(el);
    enterSuggestPhase(direction);
    chip.classList.add('visible');
  }

  function hideChip() {
    clearTimeout(confirmTimer);
    chip.classList.remove('visible');
    pendingDir = null;
    // Reset to suggest phase after the fade-out completes
    setTimeout(() => {
      phaseSuggest.style.display = '';
      phaseConfirm.classList.remove('active');
      chip.classList.remove('confirmed');
    }, 160);
  }

  // ── Suggest phase actions ─────────────────────────────────────────────────
  actionBtn.addEventListener('mousedown',     e => e.preventDefault());
  suggestDismiss.addEventListener('mousedown', e => e.preventDefault());
  confirmDismiss.addEventListener('mousedown', e => e.preventDefault());

  actionBtn.addEventListener('click', () => {
    if (!activeField || !pendingDir) return;
    const fn   = pendingDir === 'toEnglish' ? toEnglish : toHebrew;
    const lang = pendingDir === 'toEnglish' ? 'en' : 'he';
    applyConvert(activeField, fn);
    savePref(lang);
    enterConfirmPhase(lang);
    activeField.focus();
  });

  suggestDismiss.addEventListener('click', hideChip);
  confirmDismiss.addEventListener('click', hideChip);

  // ── Detection loop ────────────────────────────────────────────────────────
  function runDetection(el) {
    if (!el || !isEditable(el)) return;
    // Don't overwrite the confirm phase with a new suggestion
    if (phaseConfirm.classList.contains('active')) return;
    const target = getSelection(el) || getText(el);
    const dir    = detectConversion(target);
    if (dir) showChip(el, dir);
    else hideChip();
  }

  function scheduleDetection(el) {
    clearTimeout(detectionTimer);
    detectionTimer = setTimeout(() => runDetection(el), 700);
  }

  // ── Field & input tracking ────────────────────────────────────────────────
  document.addEventListener('focusin', e => {
    if (isEditable(e.target) && !e.target.hasAttribute('data-lang-fixer-host')) {
      activeField = e.target;
    }
  }, true);

  document.addEventListener('focusout', e => {
    if (e.target === activeField) {
      clearTimeout(detectionTimer);
      setTimeout(() => {
        if (document.activeElement !== activeField) {
          hideChip();
          activeField = null;
        }
      }, 220);
    }
  }, true);

  document.addEventListener('input', e => {
    if (!isEditable(e.target) || e.target.hasAttribute('data-lang-fixer-host')) return;
    activeField = e.target;
    scheduleDetection(e.target);
  }, true);

  document.addEventListener('scroll', () => {
    if (activeField && chip.classList.contains('visible')) placeChip(activeField);
  }, { passive: true, capture: true });

  // ── Keyboard listeners ────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    // Dismiss confirm phase when the user presses their OS keyboard switch shortcut.
    // The OS will also switch the keyboard at the same moment — no need to preventDefault.
    if (phaseConfirm.classList.contains('active') && matchesShortcut(e, kbShortcut)) {
      hideChip();
      return;
    }

    // Alt+Shift+F — apply suggestion if chip is in suggest phase, else detect on demand
    if (e.altKey && e.shiftKey && e.key === 'F' && activeField) {
      e.preventDefault();
      e.stopPropagation();
      if (pendingDir) {
        actionBtn.click();
      } else {
        const dir = detectConversion(getSelection(activeField) || getText(activeField));
        if (dir) { showChip(activeField, dir); }
      }
    }
  }, true);

  (document.body ?? document.documentElement).appendChild(host);
})();
