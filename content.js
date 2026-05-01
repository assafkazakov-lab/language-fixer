(function () {
  'use strict';

  if (window.__langFixerLoaded) return;
  window.__langFixerLoaded = true;

  // ── Keyboard layout map ──────────────────────────────────────────────────
  // Standard Israeli QWERTY: which Hebrew character each English key produces
  // when the OS keyboard is switched to Hebrew.
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

  // ── High-confidence auto-detection ──────────────────────────────────────
  // Common English words: if any appear as isolated tokens the input is almost
  // certainly real English. Hebrew keyboard typing of common Hebrew words
  // never produces these as complete tokens.
  const EN_STOP = new Set([
    // Articles / conjunctions / prepositions / pronouns
    'the','a','an','and','or','but','nor','so','yet','for','of','in',
    'on','at','to','by','up','as','if','it','he','she','we','they',
    'me','my','his','her','its','our','their','this','that','these',
    'those','who','what','which','where','when','why','how',
    // Auxiliary / linking verbs
    'be','am','is','are','was','were','been','being','have','has','had',
    'do','does','did','will','would','shall','should','may','might',
    'must','can','could',
    // Most frequent content words
    'not','with','from','into','about','than','then','now','only','over',
    'also','back','just','more','out','all','well','even','get','him',
    'them','some','other','any','each','both','you','your','say',
    'said','go','come','take','make','see','know','think','look','want',
    'give','use','find','tell','ask','work','seem','feel','try','leave',
    'call','keep','let','put','need','become','show','hear','play','run',
    'move','live','stand','lose','pay','meet','set','learn','change',
    'lead','write','read','spend','grow','open','walk','win','follow',
    'stop','build','send','help','start','add','turn','love',
    // Common everyday words that would never come from Hebrew keyboard typing
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

  // Returns 'toEnglish' | 'toHebrew' | null (null = not confident enough)
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

    // Mostly Hebrew → check if converted English would have a plausible vowel ratio
    if (heRatio >= 0.85) {
      const converted = toEnglish(text);
      const letters   = converted.replace(/[^a-zA-Z]/g, '');
      const vowels    = (letters.match(/[aeiou]/gi) || []).length;
      const vr        = letters.length ? vowels / letters.length : 0;
      // Natural prose: ~15–65% vowels. Outside this range → likely real Hebrew.
      return (vr >= 0.15 && vr <= 0.65) ? 'toEnglish' : null;
    }

    // Mostly Latin → check that it's not real English
    if (enRatio >= 0.85) {
      if (enUpper > 0) return null; // uppercase = intentional English capitalisation
      const words = text.toLowerCase().match(/[a-z]+/g) || [];
      if (words.some(w => EN_STOP.has(w))) return null;
      return 'toHebrew';
    }

    return null; // mixed scripts — don't guess
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

  // Sets full field value, compatible with React/Vue controlled inputs
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

  // ── Shadow-DOM suggestion chip ───────────────────────────────────────────
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
        align-items: center;
        gap: 0;
        background: #fff;
        border: 1.5px solid #1a73e8;
        border-radius: 24px;
        box-shadow: 0 3px 12px rgba(26,115,232,0.18), 0 1px 4px rgba(0,0,0,0.10);
        pointer-events: all;
        opacity: 0;
        transform: translateY(5px) scale(0.97);
        transition: opacity 0.15s ease, transform 0.15s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 13px;
        white-space: nowrap;
        user-select: none;
        overflow: hidden;
      }
      .chip.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      /* Main action button — takes up most of the chip */
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

      .action-icon { font-size: 15px; line-height: 1; }

      .action-label { color: #5f6368; font-weight: 400; }
      .action-target { color: #1a73e8; font-weight: 600; }

      /* Separator */
      .sep {
        width: 1px;
        align-self: stretch;
        background: #c5d8fd;
        margin: 5px 0;
      }

      /* Dismiss button */
      .dismiss {
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: none;
        padding: 0 10px 0 8px;
        cursor: pointer;
        color: #80868b;
        font-size: 14px;
        line-height: 1;
        transition: color 0.08s;
        height: 100%;
      }
      .dismiss:hover { color: #3c4043; }

      /* After-fix toast */
      .toast {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        background: #3c4043;
        color: #fff;
        font-size: 11.5px;
        padding: 5px 11px;
        border-radius: 8px;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transform: translateY(-3px);
        transition: opacity 0.15s, transform 0.15s;
      }
      .toast.show { opacity: 1; transform: translateY(0); }
    </style>

    <div class="chip" id="chip">
      <button class="action" id="action-btn">
        <span class="action-icon" id="action-icon">⌨️</span>
        <span class="action-label" id="action-label">Typed in Hebrew?</span>
        &nbsp;→&nbsp;
        <span class="action-target" id="action-target">Switch to English</span>
      </button>
      <div class="sep"></div>
      <button class="dismiss" id="dismiss-btn" title="Dismiss">✕</button>
      <div class="toast" id="toast"></div>
    </div>
  `;

  const chip       = shadow.getElementById('chip');
  const actionBtn  = shadow.getElementById('action-btn');
  const actionIcon = shadow.getElementById('action-icon');
  const actionLbl  = shadow.getElementById('action-label');
  const actionTgt  = shadow.getElementById('action-target');
  const dismissBtn = shadow.getElementById('dismiss-btn');
  const toast      = shadow.getElementById('toast');

  let activeField    = null;
  let pendingDir     = null; // 'toEnglish' | 'toHebrew'
  let detectionTimer = null;
  let toastTimer     = null;

  // ── Chip positioning ──────────────────────────────────────────────────────
  const GAP    = 6;
  const CHIP_H = 36;
  const CHIP_W = 280;

  function placeChip(el) {
    const r    = el.getBoundingClientRect();
    let top  = r.bottom + GAP;
    let left = r.left;
    if (top + CHIP_H > window.innerHeight - 8) top = r.top - CHIP_H - GAP;
    top  = Math.max(8, top);
    left = Math.max(8, Math.min(left, window.innerWidth - CHIP_W - 8));
    host.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
  }

  function showChip(el, direction) {
    pendingDir = direction;
    placeChip(el);
    if (direction === 'toEnglish') {
      actionIcon.textContent = '🔤';
      actionLbl.textContent  = 'Typed in Hebrew?';
      actionTgt.textContent  = 'Switch to English';
    } else {
      actionIcon.textContent = '🔤';
      actionLbl.textContent  = 'Typed in English?';
      actionTgt.textContent  = 'Switch to Hebrew';
    }
    chip.classList.add('visible');
  }

  function hideChip() {
    chip.classList.remove('visible');
    pendingDir = null;
  }

  function showToast(msg) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // ── Detection loop ────────────────────────────────────────────────────────
  function runDetection(el) {
    if (!el || !isEditable(el)) return;
    const target = getSelection(el) || getText(el);
    const dir    = detectConversion(target);
    if (dir) showChip(el, dir);
    else hideChip();
  }

  function scheduleDetection(el) {
    clearTimeout(detectionTimer);
    // Small delay so we don't fire mid-word while the user is still typing
    detectionTimer = setTimeout(() => runDetection(el), 700);
  }

  // ── Chip actions ──────────────────────────────────────────────────────────
  actionBtn.addEventListener('mousedown', e => e.preventDefault()); // keep field focus
  dismissBtn.addEventListener('mousedown', e => e.preventDefault());

  actionBtn.addEventListener('click', () => {
    if (!activeField || !pendingDir) return;
    const fn     = pendingDir === 'toEnglish' ? toEnglish : toHebrew;
    const lang   = pendingDir === 'toEnglish' ? 'en' : 'he';
    const label  = pendingDir === 'toEnglish' ? 'English' : 'Hebrew';
    applyConvert(activeField, fn);
    savePref(lang);
    hideChip();
    // Brief reminder — extension can't switch OS keyboard, so nudge the user
    showToast(`Text converted. Switch your keyboard to ${label} to continue.`);
    activeField.focus();
  });

  dismissBtn.addEventListener('click', () => hideChip());

  // ── Field & input tracking ────────────────────────────────────────────────
  document.addEventListener('focusin', e => {
    if (isEditable(e.target) && !e.target.hasAttribute('data-lang-fixer-host')) {
      activeField = e.target;
    }
  }, true);

  document.addEventListener('focusout', e => {
    if (e.target === activeField) {
      clearTimeout(detectionTimer);
      // Small delay to allow chip button click to fire before hiding
      setTimeout(() => {
        if (document.activeElement !== activeField) {
          hideChip();
          activeField = null;
        }
      }, 220);
    }
  }, true);

  document.addEventListener('input', e => {
    if (isEditable(e.target) && !e.target.hasAttribute('data-lang-fixer-host')) {
      activeField = e.target;
      scheduleDetection(e.target);
    }
  }, true);

  document.addEventListener('scroll', () => {
    if (activeField && chip.classList.contains('visible')) placeChip(activeField);
  }, { passive: true, capture: true });

  // ── Keyboard shortcut: Alt+Shift+F ───────────────────────────────────────
  // If the chip is visible, execute its suggestion. Otherwise run detection
  // on demand and apply if confident.
  document.addEventListener('keydown', e => {
    if (!e.altKey || !e.shiftKey || e.key !== 'F' || !activeField) return;
    e.preventDefault();
    e.stopPropagation();

    const dir = pendingDir ?? detectConversion(getSelection(activeField) || getText(activeField));
    if (!dir) return;
    const fn    = dir === 'toEnglish' ? toEnglish : toHebrew;
    const lang  = dir === 'toEnglish' ? 'en' : 'he';
    const label = dir === 'toEnglish' ? 'English' : 'Hebrew';
    applyConvert(activeField, fn);
    savePref(lang);
    hideChip();
    showToast(`Text converted. Switch your keyboard to ${label} to continue.`);
  }, true);

  // Attach host once
  (document.body ?? document.documentElement).appendChild(host);
})();
