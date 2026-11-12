/* Jìyì – Chinese flashcards (self-hosted version)
 * FSRS-5 scheduling, Azure neural voices with an on-device audio cache,
 * and optional sync through a private GitHub gist. */
(function () {
'use strict';

/* ---------- constants ---------- */
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const NEW = 0, LEARNING = 1, REVIEW = 2, RELEARNING = 3;
const LEARN_STEPS = [1, 10];      // minutes
const RELEARN_STEPS = [10];       // minutes
const MAX_IVL = 36500, DAY_START_HOUR = 4;
// FSRS-5 default parameters
const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5, FACTOR = 19 / 81;
const DEFAULTS = { rate: 0.9, autoplay: true, newPerDay: 15, retention: 0.9, toneColors: true, autoPinyin: true, speakCards: false, speakNewPerDay: 10, extra: { day: '', n: 0 }, mod: 0 };
const PREF_DEFAULTS = { voice: '', voiceName: '', azKey: '', azRegion: '', ghToken: '', gistId: '', scope: 'all' };
const AUTOPLAY_HINTS = {
  front: '<b>Better for listening and speaking.</b> You hear every word with its characters before you answer, so you can repeat it aloud. It no longer tests whether you remember the pronunciation yourself.',
  back: '<b>Tests your pronunciation.</b> Say the word aloud first, then flip to check yourself.',
  off: 'Play words yourself with the Listen buttons.'
};
const LS_DECK = 'jiyi-deck-v2', LS_PREFS = 'jiyi-prefs-v1';
const GIST_FILE = 'jiyi-deck.json';
const LOG_DAYS = 35;
const SLOW = 0.65;
const AZ_DEFAULT = 'zh-CN-XiaoxiaoNeural';
const AZ_VOICES = [
  ['zh-CN-XiaoxiaoNeural', 'Xiaoxiao (female, warm)'],
  ['zh-CN-XiaochenNeural', 'Xiaochen (female, casual)'],
  ['zh-CN-XiaoyiNeural', 'Xiaoyi (female, lively)'],
  ['zh-CN-YunyangNeural', 'Yunyang (male, newsreader)'],
  ['zh-CN-YunxiNeural', 'Yunxi (male, young)'],
  ['zh-CN-YunjianNeural', 'Yunjian (male, deep)'],
  ['zh-TW-HsiaoChenNeural', 'HsiaoChen (female, Taiwan)']
];
const AZ_REGIONS = ['eastasia', 'southeastasia', 'japaneast', 'koreacentral', 'centralindia', 'australiaeast', 'westeurope', 'northeurope', 'uksouth', 'francecentral', 'germanywestcentral', 'swedencentral', 'eastus', 'eastus2', 'westus', 'westus2', 'westus3', 'centralus', 'canadacentral', 'brazilsouth'];
const HAN = /\p{Script=Han}/u;
const SP_UNLOCK_S = 7;            // reading stability (days) a word needs before it joins speaking

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 5v14l11.5-7z" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>'
};
const GRID_SVG = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" fill="none" stroke="currentColor"><path d="M0 50H100M50 0V100" stroke-width="1" stroke-dasharray="4 3.5"/><path d="M0 0L100 100M100 0L0 100" stroke-width=".8" stroke-dasharray="2 4" opacity=".6"/></svg>';

/* ---------- state ---------- */
const state = { cards: new Map(), settings: { ...DEFAULTS }, logs: new Map(), days: new Map(), tomb: new Map(), undone: new Map(), folders: new Map(), ftomb: new Map() };
let prefs = { ...PREF_DEFAULTS };
let study = { id: null, dir: 'r', revealed: false, animate: false };   // also: fresh, heard, hinted
let lastUndo = null;
let currentView = 'study';
let addForm = null, editing = null;
let refreshTimer = null;
let cram = null;                                   // 'practice the whole folder' session
let words = { filter: 'practice', mode: 'list', tools: '', pickIn: 'all' };
let addMode = 'one';
const SAVE_BTN = '<button class="btn" data-act="save-new">Save card</button>';
const BULK_BTN = '<button class="btn" data-act="bulk-add">Add words</button>';

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const xmlEsc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const plural = (n, one, many) => n === 1 ? one : (many || one + 's');
const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function dayStart(ms) { const d = new Date(ms - DAY_START_HOUR * HOUR); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_START_HOUR).getTime(); }
function dayOffset(ms, n) { const d = new Date(ms - DAY_START_HOUR * HOUR); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, DAY_START_HOUR).getTime(); }
const nextDayStart = ms => dayOffset(ms, 1);
function dayKey(ms) { const d = new Date(ms - DAY_START_HOUR * HOUR); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);

function fmtDays(d) {
  if (d < 30) return d + 'd';
  if (d < 365) return (d / 30.44).toFixed(1).replace(/\.0$/, '') + 'mo';
  return (d / 365.25).toFixed(1).replace(/\.0$/, '') + 'y';
}
function fmtMins(ms) { const m = Math.max(1, Math.round(ms / MIN)); return m < 60 ? m + 'm' : Math.round(m / 60) + 'h'; }
function fmtAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return 'on ' + new Date(ms).toLocaleDateString();
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
}

/* ---------- extra scripts, loaded when first needed (the service worker keeps them for offline use) ---------- */
const scriptLoads = {};
function loadScript(src, ready) {
  if (ready()) return Promise.resolve();
  if (!scriptLoads[src]) {
    scriptLoads[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = () => ready() ? resolve() : reject(new Error(src + ' did not load'));
      el.onerror = () => { delete scriptLoads[src]; el.remove(); reject(new Error(src + ' did not load')); };
      document.head.appendChild(el);
    });
  }
  return scriptLoads[src];
}
function loadPinyin() {
  return loadScript('pinyin-pro.js', () => !!window.pinyinPro)
    .then(() => loadScript('pinyin-auto.js', () => !!window.JiyiPinyin))
    .then(() => { if (!window.JiyiPinyin.ready()) throw new Error('pinyin did not load'); return window.JiyiPinyin; });
}
let deckIdx = null;
function loadDecks() {
  return loadScript('decks.js', () => !!window.JIYI_DECKS).then(() => {
    if (!deckIdx) {
      deckIdx = new Map();
      for (const d of window.JIYI_DECKS.decks) for (const w of d.words) if (!deckIdx.has(w[0])) deckIdx.set(w[0], w);
    }
    return window.JIYI_DECKS;
  });
}
const deckWord = hanzi => (deckIdx && deckIdx.get(hanzi)) || null;
// Deck words use their checked pinyin; anything else is converted character by character.
function autoWordPinyin(JP, hanzi) { const w = deckWord(hanzi); return w ? w[1] : JP.word(hanzi); }
function stableId(text) {
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (Math.imul(h2, 33) + c) | 0; }
  return 'k' + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/* ---------- FSRS-5 ---------- */
const initS = g => Math.max(W[g - 1], 0.1);
const initD = g => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
const retr = (t, s) => Math.pow(1 + FACTOR * t / s, DECAY);
function nextD(d, g) {
  const dp = d + (-W[6] * (g - 3)) * (10 - d) / 9;          // linear damping
  return clamp(W[7] * initD(4) + (1 - W[7]) * dp, 1, 10);     // mean reversion
}
function recallS(d, s, r, g) {
  const hard = g === 2 ? W[15] : 1, easy = g === 4 ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * hard * easy);
}
function forgetS(d, s, r) {
  return Math.min(W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]), s);
}
const shortS = (s, g) => s * Math.exp(W[17] * (g - 3 + W[18]));
const clampS = s => clamp(s, 0.01, MAX_IVL);
function nextIvl(s) {
  const r = clamp(state.settings.retention || 0.9, 0.7, 0.99);
  return clamp(Math.round(s / FACTOR * (Math.pow(r, 1 / DECAY) - 1)), 1, MAX_IVL);
}
function fuzz(ivl) {
  if (ivl < 2.5) return ivl;
  const delta = 1 + 0.15 * Math.max(0, Math.min(ivl, 7) - 2.5) + 0.1 * Math.max(0, Math.min(ivl, 20) - 7) + 0.05 * Math.max(0, ivl - 20);
  const lo = Math.max(2, Math.round(ivl - delta)), hi = Math.round(ivl + delta);
  return clamp(lo + Math.floor(Math.random() * (hi - lo + 1)), 1, MAX_IVL);
}
function graduate(c, now) {
  c.state = REVIEW; c.step = 0;
  const ivl = nextIvl(c.stability);
  c.ivl = ivl; c.due = dayOffset(now, ivl);
  return { card: c, ivl, delay: null };
}
function stepLearning(c, g, now, steps) {
  c.step = clamp(c.step || 0, 0, steps.length - 1);
  let mins;
  if (g === 1) { c.step = 0; mins = steps[0]; }
  else if (g === 2) {
    if (steps.length === 1) mins = Math.min(steps[0] * 1.5, steps[0] + 1440);
    else if (c.step === 0) mins = (steps[0] + steps[1]) / 2;
    else mins = steps[c.step];
  } else if (g === 3) {
    if (c.step + 1 < steps.length) { c.step += 1; mins = steps[c.step]; }
    else return graduate(c, now);
  } else return graduate(c, now);
  c.due = now + Math.round(mins * MIN);
  return { card: c, ivl: null, delay: mins * MIN };
}
function schedule(card, g, now) {
  const c = { ...card };
  if (c.state === NEW) {
    c.stability = initS(g); c.difficulty = initD(g); c.step = 0; c.state = LEARNING;
    return stepLearning(c, g, now, LEARN_STEPS);
  }
  if (c.state === LEARNING || c.state === RELEARNING) {
    c.stability = clampS(shortS(c.stability || initS(3), g));
    c.difficulty = nextD(c.difficulty || initD(3), g);
    return stepLearning(c, g, now, c.state === LEARNING ? LEARN_STEPS : RELEARN_STEPS);
  }
  const elapsed = c.last ? daysBetween(c.last, now) : 0;
  let s;
  if (elapsed < 1) s = shortS(c.stability, g);
  else {
    const r = retr(elapsed, c.stability);
    s = g === 1 ? forgetS(c.difficulty, c.stability, r) : recallS(c.difficulty, c.stability, r, g);
  }
  c.difficulty = nextD(c.difficulty, g);
  c.stability = clampS(s);
  if (g === 1) {
    c.lapses = (c.lapses || 0) + 1; c.state = RELEARNING; c.step = 0; c.ivl = 0;
    c.due = now + RELEARN_STEPS[0] * MIN;
    return { card: c, ivl: null, delay: RELEARN_STEPS[0] * MIN };
  }
  const ivl = nextIvl(c.stability);
  c.ivl = ivl; c.due = dayOffset(now, ivl);
  return { card: c, ivl, delay: null };
}
function previewAll(card, now) {
  const res = [1, 2, 3, 4].map(g => schedule(card, g, now));
  const fix = (r, ivl) => { r.ivl = ivl; r.card.ivl = ivl; r.card.due = dayOffset(now, ivl); };
  const h = res[1], gd = res[2], e = res[3];
  if (card.state === REVIEW && h.ivl != null && gd.ivl != null) {
    if (h.ivl > gd.ivl) fix(h, gd.ivl);
    if (gd.ivl <= h.ivl) fix(gd, h.ivl + 1);
  }
  if (gd.ivl != null && e.ivl != null && e.ivl <= gd.ivl) fix(e, gd.ivl + 1);
  return res;
}
const ivlLabel = r => r.ivl != null ? fmtDays(r.ivl) : fmtMins(r.delay);

/* ---------- cards ---------- */
function normalizeCard(c) {
  const n = {
    id: String(c.id || newId()),
    hanzi: String(c.hanzi || '').trim(),
    pinyin: String(c.pinyin || '').trim(),
    english: String(c.english || '').trim(),
    notes: String(c.notes || '').trim(),
    sentences: Array.isArray(c.sentences) ? c.sentences.filter(s => s && s.zh).map(s => ({ zh: String(s.zh), py: String(s.py || ''), en: String(s.en || '') })) : [],
    created: Number(c.created) || Date.now(),
    updated: Number(c.updated) || Date.now(),
    state: [NEW, LEARNING, REVIEW, RELEARNING].includes(c.state) ? c.state : NEW,
    due: Number(c.due) || Date.now(),
    stability: Number(c.stability) || 0,
    difficulty: Number(c.difficulty) || 0,
    step: Number(c.step) || 0,
    ivl: Number(c.ivl) || 0,
    reps: Number(c.reps) || 0,
    lapses: Number(c.lapses) || 0,
    last: Number(c.last) || null,
    practice: c.practice !== false,
    folders: Array.isArray(c.folders) ? [...new Set(c.folders.map(String))].slice(0, 50) : [],
    sp: normSp(c.sp)
  };
  n.mod = Number(c.mod) || Math.max(n.updated, n.last || 0, n.created);
  if (n.state !== NEW && !(n.stability > 0)) n.state = NEW;
  if (n.state !== NEW && !(n.difficulty >= 1)) n.difficulty = initD(3);
  return n;
}
// The speaking side (English → say the Chinese) has its own schedule. null: never started.
// sp.mod is the time of its last change; only sync uses it.
function normSp(sp) {
  if (!sp || typeof sp !== 'object' || Array.isArray(sp)) return null;
  const n = {
    state: [NEW, LEARNING, REVIEW, RELEARNING].includes(sp.state) ? sp.state : NEW,
    due: Number(sp.due) || 0,
    stability: Number(sp.stability) || 0,
    difficulty: Number(sp.difficulty) || 0,
    step: Number(sp.step) || 0,
    ivl: Number(sp.ivl) || 0,
    reps: Number(sp.reps) || 0,
    lapses: Number(sp.lapses) || 0,
    last: Number(sp.last) || null,
    mod: Number(sp.mod) || 0
  };
  if (n.state !== NEW && !(n.stability > 0)) n.state = NEW;
  if (n.state !== NEW && !(n.difficulty >= 1)) n.difficulty = initD(3);
  return n;
}
// Older settings only have the autoplay switch: on meant 'play on flip'.
function autoplayMode() {
  const s = state.settings;
  if (['front', 'back', 'off'].includes(s.autoplayWhen)) return s.autoplayWhen;
  return s.autoplay === false ? 'off' : 'back';
}
function blankSchedule() { return { state: NEW, due: Date.now(), stability: 0, difficulty: 0, step: 0, ivl: 0, reps: 0, lapses: 0, last: null }; }
const blankSp = now => ({ ...blankSchedule(), due: 0, mod: now });
// A word joins speaking once its reading memory is stable: with FSRS-5 defaults, the first passed
// review after graduating, or graduating with Easy.
const spUnlocked = c => c.state === REVIEW && c.stability >= SP_UNLOCK_S;
// Once speaking has started, the word stays in it even if the reading side lapses later.
const spEligible = c => !!(state.settings.speakCards && c.practice && c.english && ((c.sp && c.sp.state !== NEW) || spUnlocked(c)));
const schedOf = (c, dir) => dir === 's' ? (c.sp || blankSp(0)) : c;
function addLog(day, entry) {
  state.logs.set(day, [...(state.logs.get(day) || []), entry]);
  state.days.set(day, (state.days.get(day) || 0) + 1);
}
// Log entries: { c, g, s, t } for reading; speaking entries also have d: 's'.
function introducedToday(day) { return new Set((state.logs.get(day) || []).filter(e => !e.d && e.s === NEW).map(e => e.c)).size; }
function spIntroducedToday(day) { return new Set((state.logs.get(day) || []).filter(e => e.d === 's' && e.s === NEW).map(e => e.c)).size; }
function newLimit(day) { const x = state.settings.extra || {}; return (state.settings.newPerDay | 0) + (x.day === day ? (x.n | 0) : 0); }
const cardTexts = c => [c.hanzi, ...(c.sentences || []).map(s => s.zh)].filter(Boolean);
const allTexts = () => { const out = []; for (const c of state.cards.values()) if (c.practice) out.push(...cardTexts(c)); return out; };
const sortedFolders = () => [...state.folders.values()].sort((a, b) => a.created - b.created);
const folderName = id => (state.folders.get(id) || {}).name || '';
const folderCount = id => { let n = 0; for (const c of state.cards.values()) if (c.folders.includes(id)) n++; return n; };
function scopeValid() { const s = prefs.scope || 'all'; return s === 'all' || state.folders.has(s) ? s : 'all'; }
function inScope(c, scoped) {
  if (!c.practice) return false;
  if (!scoped) return true;
  const s = scopeValid();
  return s === 'all' || c.folders.includes(s);
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function fselHTML(selected) {
  const fl = sortedFolders();
  if (!fl.length) return '<span class="hint" style="margin:0">Make folders in the Words tab to group words for a test or a topic.</span>';
  return fl.map(f => `<button type="button" class="fchip" data-act="fchip-toggle" data-fid="${esc(f.id)}" aria-pressed="${selected.has(f.id)}">${esc(f.name)}</button>`).join('');
}
function createFolder(name) {
  const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), now = Date.now();
  state.folders.set(id, { id, name, created: now, mod: now });
  saveLocal(); Sync.soon(3000);
  return id;
}
function renameFolder(id, name) {
  const f = state.folders.get(id);
  if (!f) return;
  state.folders.set(id, { ...f, name, mod: Date.now() });
  saveLocal(); Sync.soon(3000);
}
function deleteFolder(id) {
  state.folders.delete(id);
  state.ftomb.set(id, Date.now());
  if (prefs.scope === id) { prefs.scope = 'all'; savePrefs(); }
  if (cram && cram.fid === id) cram = null;
  saveLocal(); Sync.soon(3000);
}

// Queue items are { id, dir, due, c }: dir 'r' is reading (hanzi → meaning), 's' is speaking (English → say it).
function queues(now, scoped = true) {
  const nds = nextDayStart(now), day = dayKey(now), ds = dayStart(now);
  const learnNow = [], learnSoon = [], rev = [], fresh = [], spFresh = [];
  const speak = state.settings.speakCards && !(scoped && cram);
  for (const c of state.cards.values()) {
    if (!inScope(c, scoped)) continue;
    const it = { id: c.id, dir: 'r', due: c.due, c };
    if (c.state === NEW) fresh.push(it);
    else if (c.state === LEARNING || c.state === RELEARNING) (c.due <= now ? learnNow : learnSoon).push(it);
    else if (c.due < nds) rev.push(it);
    if (!speak || !spEligible(c)) continue;
    // Never both directions of a word on the same day: the speaking item waits for a later day.
    if ((c.last && c.last >= ds) || c.state === LEARNING || c.state === RELEARNING || c.due < nds) continue;
    const sp = c.sp;
    if (!sp || sp.state === NEW) spFresh.push({ id: c.id, dir: 's', due: 0, c });
    else if (sp.state === LEARNING || sp.state === RELEARNING) (sp.due <= now ? learnNow : learnSoon).push({ id: c.id, dir: 's', due: sp.due, c });
    else if (sp.due < nds) rev.push({ id: c.id, dir: 's', due: sp.due, c });
  }
  const byDue = (a, b) => a.due - b.due;
  learnNow.sort(byDue); learnSoon.sort(byDue); rev.sort(byDue); fresh.sort((a, b) => a.c.created - b.c.created);
  spFresh.sort((a, b) => b.c.stability - a.c.stability);          // the best-known words first
  const newLeft = Math.max(0, newLimit(day) - introducedToday(day));
  const spLeft = Math.max(0, (state.settings.speakNewPerDay | 0) - spIntroducedToday(day));
  return { learnNow, learnSoon, rev, fresh: fresh.slice(0, newLeft), freshTotal: fresh.length, newLeft, spFresh: spFresh.slice(0, spLeft), nds };
}
function pickNext(q) {
  return q.learnNow[0] || q.rev[0] || q.fresh[0] || q.spFresh[0] || null;
}

/* ---------- pinyin ---------- */
const TONE_MAP = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', 'ü': 'ǖǘǚǜ', A: 'ĀÁǍÀ', E: 'ĒÉĚÈ', I: 'ĪÍǏÌ', O: 'ŌÓǑÒ', U: 'ŪÚǓÙ', 'Ü': 'ǕǗǙǛ' };
const MARK_TONE = {};
for (const k in TONE_MAP) [...TONE_MAP[k]].forEach((ch, i) => { MARK_TONE[ch] = i + 1; });
function markSyllable(s, tone) {
  s = s.replace(/u:/g, 'ü').replace(/U:/g, 'Ü').replace(/v/g, 'ü').replace(/V/g, 'Ü');
  if (tone === 0 || tone === 5) return s;
  const low = s.toLowerCase();
  let i = low.indexOf('a');
  if (i < 0) i = low.indexOf('e');
  if (i < 0 && low.includes('ou')) i = low.indexOf('ou');
  if (i < 0) for (let k = low.length - 1; k >= 0; k--) if ('aeiouü'.includes(low[k])) { i = k; break; }
  if (i < 0) return null;
  const marks = TONE_MAP[s[i]];
  if (!marks) return null;
  return s.slice(0, i) + marks[tone - 1] + s.slice(i + 1);
}
function convertPinyin(text) {
  return text.replace(/([A-Za-züÜ]+:?)([0-5])/g, (m, letters, d) => {
    const r = markSyllable(letters, +d);
    return r == null ? m : r;
  });
}
function toneOf(syl) {
  let t = 0, n = 0;
  for (const ch of syl.normalize('NFC')) { const v = MARK_TONE[ch]; if (v) { t = v; n++; } }
  if (n > 1) return -1;
  return n ? t : 5;
}
function pinyinHTML(py) {
  if (!state.settings.toneColors) return esc(py);
  return py.split(/(\s+|['’\-])/).map(tok => {
    if (!tok || !/\p{L}/u.test(tok)) return esc(tok);
    const t = toneOf(tok);
    return t > 0 ? `<span class="t${t}">${esc(tok)}</span>` : esc(tok);
  }).join('');
}
function hanziTones(c) {
  if (!state.settings.toneColors || !c.pinyin) return null;
  const chars = Array.from(c.hanzi.replace(/\s+/g, ''));
  const toks = c.pinyin.split(/[\s'’\-]+/).map(t => t.replace(/[^\p{L}]/gu, '')).filter(Boolean);
  if (!chars.length || chars.length !== toks.length) return null;
  const tones = toks.map(toneOf);
  return tones.some(t => t < 0) ? null : tones;
}
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s'’\-0-9]/g, '');

/* ---------- device voices (Web Speech) ---------- */
const azureReady = () => !!(prefs.azKey && prefs.azRegion);
function currentVoice() {
  const v = prefs.voice || '';
  if (azureReady() && (!v || v.startsWith('azure:'))) return { kind: 'azure', name: v.startsWith('azure:') ? v.slice(6) : AZ_DEFAULT };
  return { kind: 'device', uri: v.startsWith('device:') ? v.slice(7) : '' };
}
function markPlaying(btn, on) {
  $$('.playing').forEach(b => b.classList.remove('playing'));
  if (on && btn && btn.isConnected) btn.classList.add('playing');
}
const TTS = {
  ok: typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined',
  voices: [],
  load() {
    if (!this.ok) return;
    let all = [];
    try { all = speechSynthesis.getVoices() || []; } catch (e) { all = []; }
    const zh = all.filter(v => /^(zh|cmn|yue)/i.test(String(v.lang || '').replace('_', '-')));
    zh.sort((a, b) => vScore(b) - vScore(a));
    const changed = zh.length !== this.voices.length;
    this.voices = zh;
    if (changed && currentView === 'options') renderVoiceControls();
  },
  pick() {
    const cur = currentVoice();
    if (cur.kind !== 'device' || !cur.uri) return null;
    let list = this.voices;
    try {
      const fresh = (speechSynthesis.getVoices() || []).filter(v => /^(zh|cmn|yue)/i.test(String(v.lang || '').replace('_', '-')));
      if (fresh.length) list = fresh;
    } catch (e) {}
    return list.find(v => v.voiceURI === cur.uri) || list.find(v => prefs.voiceName && v.name === prefs.voiceName) || null;
  },
  speak(text, slow, btn) {
    if (!this.ok) { toast('Audio isn’t available in this browser'); return; }
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pick();
    u.lang = v ? v.lang : 'zh-CN';   // lang before voice: iOS can reset the voice otherwise
    if (v) u.voice = v;
    const base = clamp(state.settings.rate || 0.9, 0.4, 1.6);
    u.rate = slow ? Math.max(0.4, base * SLOW) : base;
    u.onstart = () => markPlaying(btn, true);
    u.onend = u.onerror = () => markPlaying(null, false);
    try {
      if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); setTimeout(() => speechSynthesis.speak(u), 60); }
      else speechSynthesis.speak(u);
    } catch (e) { toast('Couldn’t play audio on this device'); }
  }
};
function vScore(v) {
  const l = String(v.lang || '').replace('_', '-').toLowerCase();
  let s = 0;
  if (l === 'zh-cn' || l.startsWith('cmn') || l === 'zh') s += 100;
  else if (l === 'zh-tw') s += 50;
  else if (l.startsWith('zh-hk') || l.startsWith('yue')) s -= 100;
  if (/premium/i.test(v.name)) s += 30; else if (/enhanced|neural|natural/i.test(v.name)) s += 20;
  return s;
}
function langLabel(lang) {
  const l = String(lang || '').replace('_', '-').toLowerCase();
  if (l.startsWith('zh-hk') || l.startsWith('yue')) return 'Cantonese';
  if (l === 'zh-tw') return 'Mandarin, Taiwan';
  return 'Mandarin';
}
if (TTS.ok) {
  TTS.load();
  try { speechSynthesis.addEventListener('voiceschanged', () => TTS.load()); } catch (e) { speechSynthesis.onvoiceschanged = () => TTS.load(); }
  [300, 1200, 3000].forEach(ms => setTimeout(() => TTS.load(), ms));
}

/* ---------- Azure neural voices ---------- */
let sdkPromise = null;
function loadSdk() {
  if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'speech-sdk.js';
      s.async = true;
      s.onload = () => window.SpeechSDK ? resolve(window.SpeechSDK) : reject(new Error('Speech SDK did not load'));
      s.onerror = () => { sdkPromise = null; reject(new Error('Speech SDK did not load')); };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}
let synthChain = Promise.resolve(), synthObj = null, synthSig = '';
function dropSynth() { if (synthObj) { try { synthObj.close(); } catch (e) {} } synthObj = null; }
function azureSynth(text, voice) {
  const run = async () => {
    const sdk = await loadSdk();
    const sig = prefs.azKey + '|' + prefs.azRegion;
    if (!synthObj || synthSig !== sig) {
      dropSynth();
      const cfg = sdk.SpeechConfig.fromSubscription(prefs.azKey, prefs.azRegion);
      cfg.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
      synthObj = new sdk.SpeechSynthesizer(cfg, null);   // null: return audio data, don't play it
      synthSig = sig;
    }
    const lang = voice.slice(0, 5);
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}">${xmlEsc(text)}</voice></speak>`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { dropSynth(); reject(new Error('timeout')); }, 20000);
      synthObj.speakSsmlAsync(ssml, r => {
        clearTimeout(timer);
        if (r.reason === sdk.ResultReason.SynthesizingAudioCompleted && r.audioData && r.audioData.byteLength > 0) resolve(r.audioData);
        else { dropSynth(); reject(new Error(r.errorDetails || 'Synthesis failed')); }
      }, err => { clearTimeout(timer); dropSynth(); reject(new Error(String(err))); });
    });
  };
  const p = synthChain.then(run, run);
  synthChain = p.catch(() => {});
  return p;
}
function azMessage(e) {
  const m = String((e && e.message) || e || '');
  if (m === 'offline') return 'You’re offline and this clip isn’t saved yet.';
  if (/429|too many|quota/i.test(m)) return 'Azure’s free quota is used up for now.';
  if (/sdk did not load/i.test(m)) return 'The speech library didn’t load. Check your connection.';
  if (m === 'timeout') return 'Azure took too long to answer.';
  return 'Couldn’t get Azure audio. Check the key, the region and your connection.';
}

/* ---------- audio cache (IndexedDB) ---------- */
const clipKey = (voice, text) => voice + '|' + text;
const AudioCache = {
  mem: new Map(), keys: new Set(), db: null, p: null,
  open() {
    if (this.p) return this.p;
    this.p = new Promise(res => {
      let req;
      try { req = indexedDB.open('jiyi-audio', 1); } catch (e) { res(null); return; }
      req.onupgradeneeded = () => { try { req.result.createObjectStore('clips'); } catch (e) {} };
      req.onerror = () => res(null);
      req.onsuccess = () => {
        this.db = req.result;
        try {
          const kr = this.db.transaction('clips').objectStore('clips').getAllKeys();
          kr.onsuccess = () => { (kr.result || []).forEach(k => this.keys.add(String(k))); res(this.db); };
          kr.onerror = () => res(this.db);
        } catch (e) { res(this.db); }
      };
    });
    return this.p;
  },
  has(k) { return this.keys.has(k) || this.mem.has(k); },
  async get(k) {
    if (this.mem.has(k)) return this.mem.get(k);
    const db = await this.open();
    if (!db || !this.keys.has(k)) return null;
    return new Promise(res => {
      try { const r = db.transaction('clips').objectStore('clips').get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }
      catch (e) { res(null); }
    });
  },
  async put(k, buf) {
    this.mem.set(k, buf);
    if (this.mem.size > 40) this.mem.delete(this.mem.keys().next().value);
    const db = await this.open();
    if (!db) return;
    await new Promise(res => {
      try {
        const tx = db.transaction('clips', 'readwrite');
        tx.objectStore('clips').put(buf, k);
        tx.oncomplete = () => { this.keys.add(k); res(); };
        tx.onerror = tx.onabort = () => res();
      } catch (e) { res(); }
    });
  },
  async clear() {
    this.mem.clear(); this.keys.clear();
    const db = await this.open();
    if (!db) return;
    await new Promise(res => {
      try { const tx = db.transaction('clips', 'readwrite'); tx.objectStore('clips').clear(); tx.oncomplete = tx.onerror = () => res(); }
      catch (e) { res(); }
    });
  }
};

/* ---------- playback ---------- */
const player = new Audio();
player.preload = 'auto';
player.setAttribute('playsinline', '');
const SILENT = (() => {
  const n = 160, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
})();
let playUrl = null, playBtn = null, playSeq = 0, unlocked = false;
function setAudioSession(type) {
  try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch (e) {}
}
// iOS only lets audio start after a network wait if the element was played during a tap first.
function unlockAudio() {
  // Switching to 'playback' ends an open microphone on iOS, so leave the session alone while the mic is held.
  if (!Mic.held()) setAudioSession('playback');
  if (unlocked) return;
  unlocked = true;
  try {
    player.src = SILENT;
    const p = player.play();
    if (p && p.catch) p.catch(err => { if (err && err.name === 'NotAllowedError') unlocked = false; });
  } catch (e) { unlocked = false; }
}
document.addEventListener('pointerdown', unlockAudio, true);
document.addEventListener('touchend', unlockAudio, true);
player.addEventListener('playing', () => { if (player.src !== SILENT) markPlaying(playBtn, true); });
player.addEventListener('ended', () => markPlaying(null, false));
player.addEventListener('pause', () => markPlaying(null, false));
player.addEventListener('loadedmetadata', () => { player.playbackRate = player.defaultPlaybackRate; });
function playBuffer(buf, slow, btn) {
  if (playUrl) { try { URL.revokeObjectURL(playUrl); } catch (e) {} }
  playUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
  playBtn = btn;
  const base = clamp(state.settings.rate || 0.9, 0.5, 1.3);
  const r = slow ? Math.max(0.5, base * SLOW) : base;
  player.src = playUrl;
  player.defaultPlaybackRate = r;
  player.playbackRate = r;
  try { player.preservesPitch = true; } catch (e) {}
  const p = player.play();
  if (p && p.catch) p.catch(err => { markPlaying(null, false); if (err && err.name === 'NotAllowedError') toast('Tap play again to hear it'); });
}
function stopAudio() {
  try { player.pause(); } catch (e) {}
  if (TTS.ok) { try { speechSynthesis.cancel(); } catch (e) {} }
}
let lastAzToast = 0;
async function speak(text, slow, btn) {
  text = String(text || '').trim();
  if (!text) return;
  if (paStop) paStop();
  unlockAudio();
  const seq = ++playSeq;
  stopAudio();
  const cur = currentVoice();
  if (cur.kind === 'azure') {
    const k = clipKey(cur.name, text);
    try {
      let buf = await AudioCache.get(k);
      if (!buf) {
        if (!navigator.onLine) throw new Error('offline');
        markPlaying(btn, true);
        buf = await azureSynth(text, cur.name);
        AudioCache.put(k, buf);
      }
      if (seq !== playSeq) return;
      playBuffer(buf, slow, btn);
      return;
    } catch (e) {
      if (seq !== playSeq) return;
      markPlaying(null, false);
      if (Date.now() - lastAzToast > 10000) { lastAzToast = Date.now(); toast(azMessage(e) + ' Using the device voice.'); }
    }
  }
  TTS.speak(text, slow, btn);
}

/* ---------- background audio generation ---------- */
const Prefetch = {
  q: [], queued: new Set(), running: false, total: 0, done: 0, fails: 0, lastError: '',
  add(texts) {
    const cur = currentVoice();
    if (cur.kind !== 'azure') return 0;
    let added = 0;
    for (const t0 of texts) {
      const t = String(t0 || '').trim();
      if (!t) continue;
      const k = clipKey(cur.name, t);
      if (AudioCache.has(k) || this.queued.has(k)) continue;
      this.queued.add(k); this.q.push({ t, v: cur.name, k }); this.total++; added++;
    }
    this.run();
    return added;
  },
  async run() {
    if (this.running || !this.q.length) return;
    this.running = true; this.fails = 0;
    await AudioCache.open();
    while (this.q.length && navigator.onLine && azureReady()) {
      const it = this.q.shift();
      this.queued.delete(it.k);
      if (!AudioCache.has(it.k)) {
        try { const buf = await azureSynth(it.t, it.v); await AudioCache.put(it.k, buf); this.fails = 0; this.lastError = ''; }
        catch (e) {
          this.fails++;
          if (this.fails >= 3) { this.lastError = azMessage(e); this.q.forEach(x => this.queued.delete(x.k)); this.q = []; break; }
        }
      }
      this.done++;
      renderAzureStatus();
    }
    this.running = false;
    if (!this.q.length) { this.total = 0; this.done = 0; }
    renderAzureStatus();
  }
};

/* ---------- local storage ---------- */
function pruneOld() {
  const now = Date.now(), cutoff = dayKey(now - LOG_DAYS * DAY);
  for (const [k, v] of state.logs) if (k < cutoff) { state.days.set(k, Math.max(state.days.get(k) || 0, v.length)); state.logs.delete(k); }
  for (const [k, t] of state.undone) if (t < now - 40 * DAY) state.undone.delete(k);
  for (const [k, t] of state.tomb) if (t < now - 120 * DAY) state.tomb.delete(k);
  for (const [k, t] of state.ftomb) if (t < now - 120 * DAY) state.ftomb.delete(k);
}
function snapshot() {
  pruneOld();
  const obj = m => Object.fromEntries(m);
  return { app: 'jiyi', v: 2, saved: Date.now(), cards: obj(state.cards), tomb: obj(state.tomb), settings: state.settings, logs: obj(state.logs), days: obj(state.days), undone: obj(state.undone), folders: obj(state.folders), ftomb: obj(state.ftomb) };
}
function applySnapshot(d) {
  if (!d || typeof d !== 'object') return;
  const cards = Array.isArray(d.cards) ? d.cards : Object.values(d.cards || {});
  cards.forEach(c => { if (c && c.hanzi) { const n = normalizeCard(c); state.cards.set(n.id, n); } });
  Object.entries(d.tomb || {}).forEach(([k, v]) => state.tomb.set(k, +v || 0));
  state.settings = { ...DEFAULTS, ...(d.settings || {}) };
  Object.entries(d.logs || {}).forEach(([k, v]) => { if (Array.isArray(v)) state.logs.set(k, v); });
  Object.entries(d.days || {}).forEach(([k, v]) => state.days.set(k, +v || 0));
  Object.entries(d.undone || {}).forEach(([k, v]) => state.undone.set(k, +v || 0));
  Object.values(d.folders || {}).forEach(f => { if (f && f.id && f.name) state.folders.set(String(f.id), { id: String(f.id), name: String(f.name), created: +f.created || 0, mod: +f.mod || 0 }); });
  Object.entries(d.ftomb || {}).forEach(([k, v]) => state.ftomb.set(k, +v || 0));
}
function loadLocal() {
  try { const raw = localStorage.getItem(LS_DECK); if (raw) applySnapshot(JSON.parse(raw)); } catch (e) {}
  try { prefs = { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(LS_PREFS) || '{}') }; } catch (e) {}
}
let localTimer = null, warnedStorage = false;
function saveLocal() { clearTimeout(localTimer); localTimer = setTimeout(saveLocalNow, 250); }
function saveLocalNow() {
  clearTimeout(localTimer);
  try { localStorage.setItem(LS_DECK, JSON.stringify(snapshot())); }
  catch (e) { if (!warnedStorage) { warnedStorage = true; toast('Couldn’t save on this device. Storage may be full.'); } }
}
function savePrefs() { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (e) {} }
function persistCard(id, deleted, delay) {
  const now = Date.now();
  if (deleted) state.tomb.set(id, now);
  else { const c = state.cards.get(id); if (c) c.mod = now; }
  saveLocal();
  Sync.soon(delay || (deleted ? 3000 : 15000));
}
function persistSettings() {
  state.settings.mod = Date.now();
  saveLocal();
  Sync.soon(3000);
}

/* ---------- sync (private GitHub gist) ---------- */
function mergeEntries(a, b) {
  const m = new Map();
  for (const e of [...(a || []), ...(b || [])]) {
    if (!e || !e.c) continue;
    const k = e.c + ':' + e.t;
    if (!state.undone.has(k)) m.set(k, e);
  }
  return [...m.values()].sort((x, y) => x.t - y.t);
}
const spMod = sp => (sp && sp.mod) || 0;
const spNewer = (a, b) => spMod(a) > spMod(b);       // on a tie, the existing side stays
function mergeRemote(R) {
  if (!R || typeof R !== 'object' || R.app !== 'jiyi') return { local: false, push: true };
  let local = false, push = false;
  const rt = R.tomb || {};
  for (const [id, t] of Object.entries(rt)) { if ((+t || 0) > (state.tomb.get(id) || 0)) state.tomb.set(id, +t); }
  for (const [id, t] of state.tomb) if (!((+rt[id] || 0) >= t)) push = true;

  const rc = R.cards || {};
  for (const id of new Set([...state.cards.keys(), ...Object.keys(rc)])) {
    const l = state.cards.get(id) || null;
    const r = rc[id] && rc[id].hanzi ? normalizeCard({ ...rc[id], id }) : null;
    let win = l;
    if (r && (!l || r.mod > l.mod)) win = r;
    if (win && (state.tomb.get(id) || 0) >= win.mod) win = null;
    let changed = win !== l;
    if (win && l && r) {
      // The speaking side merges on its own mod, so a review on either side survives an edit on the other
      // (and a device on an older version, which drops sp, can't wipe it).
      const sp = spNewer(r.sp, l.sp) ? r.sp : l.sp;
      if (win.sp !== sp) win = { ...win, sp };
      if (sp !== l.sp) changed = true;
      if (spMod(sp) !== spMod(r.sp)) push = true;
    }
    if (changed) { if (win) state.cards.set(id, win); else state.cards.delete(id); local = true; }
    if ((win && (!r || r.mod !== win.mod)) || (!win && r)) push = true;
  }

  const ru = R.undone || {};
  for (const [k, t] of Object.entries(ru)) if (!state.undone.has(k)) { state.undone.set(k, +t || Date.now()); local = true; }
  for (const k of state.undone.keys()) if (!(k in ru)) push = true;

  const cutoff = dayKey(Date.now() - LOG_DAYS * DAY), rl = R.logs || {};
  for (const day of new Set([...state.logs.keys(), ...Object.keys(rl)])) {
    if (day < cutoff) continue;
    const la = state.logs.get(day) || [], ra = Array.isArray(rl[day]) ? rl[day] : [];
    const m = mergeEntries(la, ra);
    if (m.length !== la.length) local = true;
    if (m.length !== ra.length) push = true;
    state.logs.set(day, m);
  }
  const rd = R.days || {};
  for (const [d, n] of Object.entries(rd)) if ((+n || 0) > (state.days.get(d) || 0)) { state.days.set(d, +n); local = true; }
  for (const [d, n] of state.days) if ((+rd[d] || 0) < n) push = true;

  const rft = R.ftomb || {};
  for (const [id, t] of Object.entries(rft)) if ((+t || 0) > (state.ftomb.get(id) || 0)) state.ftomb.set(id, +t);
  for (const [id, t] of state.ftomb) if (!((+rft[id] || 0) >= t)) push = true;
  const rf = R.folders || {};
  for (const id of new Set([...state.folders.keys(), ...Object.keys(rf)])) {
    const l = state.folders.get(id) || null;
    const r = rf[id] && rf[id].name ? { id, name: String(rf[id].name), created: +rf[id].created || 0, mod: +rf[id].mod || 0 } : null;
    let win = l;
    if (r && (!l || r.mod > l.mod)) win = r;
    if (win && (state.ftomb.get(id) || 0) >= win.mod) win = null;
    if (win !== l) { if (win) state.folders.set(id, win); else state.folders.delete(id); local = true; }
    if ((win && (!r || r.mod !== win.mod)) || (!win && r)) push = true;
  }

  const rs = R.settings;
  if (rs && (rs.mod || 0) > (state.settings.mod || 0)) { state.settings = { ...DEFAULTS, ...rs }; local = true; }
  else if (!rs || (rs.mod || 0) < (state.settings.mod || 0)) push = true;
  return { local, push };
}
function syncMessage(e) {
  if (e && e.kind === 'network') return 'Couldn’t reach GitHub. Check your connection or VPN.';
  const s = e && e.status;
  if (s === 401) return 'GitHub rejected the token. It may have expired: disconnect, create a new token and connect again.';
  if (s === 403 || s === 429) return 'GitHub refused the request. Check that the token has the gist permission, or wait a minute if you’ve hit the rate limit.';
  if (s === 422) return 'GitHub refused the update. The deck may be too large.';
  return 'Sync failed (' + (s || (e && e.message) || 'unknown error') + '). It will try again shortly.';
}
const Sync = {
  state: 'off', msg: '', last: 0, timer: null, due: 0, dirtySince: 0, running: false, again: false,
  enabled() { return !!prefs.ghToken; },
  soon(ms) {
    if (!this.enabled()) return;
    const now = Date.now();
    if (!this.dirtySince) this.dirtySince = now;
    const at = Math.min(now + ms, this.dirtySince + 60000);   // never wait more than a minute
    if (this.timer && this.due <= at) return;
    clearTimeout(this.timer);
    this.due = at;
    this.timer = setTimeout(() => { this.timer = null; this.run(); }, Math.max(0, at - now));
  },
  async api(path, opts) {
    opts = opts || {};
    const headers = { Authorization: 'Bearer ' + prefs.ghToken, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    let r;
    try { r = await fetch('https://api.github.com' + path, { method: opts.method || 'GET', body: opts.body, headers, cache: 'no-store' }); }
    catch (e) { throw Object.assign(new Error('network'), { kind: 'network' }); }
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return r;
  },
  async find() {
    for (let page = 1; page <= 3; page++) {
      const list = await (await this.api('/gists?per_page=100&page=' + page)).json();
      const hit = list.find(g => g.files && g.files[GIST_FILE]);
      if (hit) { prefs.gistId = hit.id; savePrefs(); return true; }
      if (list.length < 100) break;
    }
    return false;
  },
  async create() {
    const body = JSON.stringify({ description: 'Jìyì flashcards deck (written by the app)', public: false, files: { [GIST_FILE]: { content: JSON.stringify(snapshot()) } } });
    const g = await (await this.api('/gists', { method: 'POST', body })).json();
    prefs.gistId = g.id; savePrefs();
  },
  async pull() {
    const g = await (await this.api('/gists/' + prefs.gistId)).json();
    const f = g.files && g.files[GIST_FILE];
    if (!f) return null;
    let text = f.content;
    if (f.truncated || text == null) {
      let rr;
      try { rr = await fetch(f.raw_url, { cache: 'no-store' }); } catch (e) { throw Object.assign(new Error('network'), { kind: 'network' }); }
      if (!rr.ok) throw Object.assign(new Error('HTTP ' + rr.status), { status: rr.status });
      text = await rr.text();
    }
    try { return JSON.parse(text); } catch (e) { return null; }
  },
  async push() {
    const body = JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(snapshot()) } } });
    await this.api('/gists/' + prefs.gistId, { method: 'PATCH', body });
  },
  async run() {
    if (!this.enabled()) { this.set('off'); return; }
    if (this.running) { this.again = true; return; }
    clearTimeout(this.timer); this.timer = null; this.due = 0;
    if (!navigator.onLine) { this.set('error', 'Offline. Changes will sync when you’re back online.'); return; }
    this.running = true; this.dirtySince = 0;
    this.set('syncing');
    try {
      if (!prefs.gistId && !(await this.find())) { await this.create(); this.ok(); return; }
      let remote;
      try { remote = await this.pull(); }
      catch (e) {
        if (e.status === 404) { prefs.gistId = ''; savePrefs(); this.again = true; throw Object.assign(new Error('retry'), { quiet: true }); }
        throw e;
      }
      const res = mergeRemote(remote);
      if (res.local) { saveLocalNow(); dataChanged(); Prefetch.add(allTexts()); }
      if (res.push) await this.push();
      this.ok();
    } catch (e) {
      if (!e.quiet) this.set('error', syncMessage(e));
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.soon(1500); }
    }
  },
  ok() { this.last = Date.now(); this.set('idle'); },
  set(s, msg) { this.state = s; this.msg = msg || ''; renderSyncUI(); }
};
function syncStatusText() {
  if (!Sync.enabled()) return '';
  if (Sync.state === 'syncing') return 'Syncing…';
  if (Sync.state === 'error') return Sync.msg;
  return Sync.last ? `Synced ${fmtAgo(Sync.last)}.` : 'Connected.';
}
function renderSyncUI() {
  const b = $('#sync-btn');
  if (b) {
    b.hidden = !Sync.enabled();
    b.dataset.state = Sync.state;
    b.setAttribute('aria-label', Sync.state === 'error' ? 'Sync problem. Tap to retry' : Sync.state === 'syncing' ? 'Syncing' : 'Sync now');
  }
  const s = $('#sync-status');
  if (s && Sync.enabled()) { s.className = 'status' + (Sync.state === 'error' ? ' err' : ''); s.textContent = syncStatusText(); }
}

/* ---------- rendering: study ---------- */
function setActions(html) { const a = $('#actions'); if (a.innerHTML !== html) a.innerHTML = html; }

function hanziBlock(c, revealed) {
  const chars = Array.from((c.hanzi || '').replace(/\s+/g, ''));
  const tones = revealed ? hanziTones(c) : null;
  if (chars.length && chars.length <= 6 && chars.every(ch => HAN.test(ch))) {
    return `<div class="tzg" style="--n:${chars.length}" lang="zh-CN">${chars.map((ch, i) =>
      `<span class="cell${tones ? ' t' + tones[i] : ''}">${GRID_SVG}<span>${esc(ch)}</span></span>`).join('')}</div>`;
  }
  return `<p class="han-plain" lang="zh-CN">${esc(c.hanzi)}</p>`;
}
function highlight(zh, word) {
  if (!word || !zh.includes(word)) return esc(zh);
  return zh.split(word).map(esc).join(`<mark>${esc(word)}</mark>`);
}
function answerHTML(c, animate, extra) {
  const say = esc(c.hanzi);
  const speakOn = azureReady();
  const ex = (c.sentences || []).map(s => `
    <div class="ex-view">
      <div>
        <p class="ex-zh" lang="zh-CN">${highlight(s.zh, c.hanzi)}</p>
        ${s.py ? `<p class="ex-py">${esc(s.py)}</p>` : ''}
        ${s.en ? `<p class="ex-en">${esc(s.en)}</p>` : ''}
      </div>
      <div class="ex-btns">
        <button class="chip" data-act="say" data-say="${esc(s.zh)}" aria-label="Play sentence">${ICON.play}</button>
        <button class="chip" data-act="say" data-slow="1" data-say="${esc(s.zh)}" aria-label="Play sentence slowly">Slow</button>
        ${speakOn ? `<button class="chip" data-act="assess" data-ref="${esc(s.zh)}" aria-label="Say the sentence and get feedback">${ICON.mic}</button>` : ''}
      </div>
      ${speakOn ? '<div class="pa" data-pa hidden></div>' : ''}
    </div>`).join('');
  return `<div class="answer${animate ? ' rise' : ''}">
    ${c.pinyin ? `<p class="py">${pinyinHTML(c.pinyin)}</p>` : ''}
    <div class="audio-row">
      <button class="pill" data-act="say" data-say="${say}">${ICON.play}Listen</button>
      <button class="pill" data-act="say" data-slow="1" data-say="${say}">${ICON.play}Slow</button>
      ${speakOn ? `<button class="pill" data-act="assess" data-ref="${say}">${ICON.mic}Say it</button>` : ''}
    </div>
    ${c.english ? `<p class="en">${esc(c.english)}</p>` : ''}
    ${extra || ''}
    ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ''}
    ${speakOn ? '<div class="pa" data-pa hidden></div>' : ''}
    ${ex ? `<div class="ex-wrap"><h3 class="sub">Examples</h3>${ex}</div>` : ''}
  </div>`;
}
/* ---------- speaking cards ---------- */
// Empty 田字格 cells, one per character, so you know how long the word is.
function spCells(c) {
  const chars = Array.from((c.hanzi || '').replace(/\s+/g, ''));
  const n = chars.length, label = `${n} ${plural(n, 'character')}`;
  if (n && n <= 6 && chars.every(ch => HAN.test(ch))) {
    return `<div class="tzg sp-cells" style="--n:${n}" role="img" aria-label="${label}">${chars.map(() => `<span class="cell empty">${GRID_SVG}</span>`).join('')}</div>`;
  }
  return `<p class="sp-count">${label}</p>`;
}
// A hint from the example sentences: the sentence with the word blanked out, or else just an English translation.
function spHint(c) {
  const ss = c.sentences || [], w = (c.hanzi || '').trim();
  const hit = w && ss.find(x => x.zh.includes(w));
  if (hit) return { en: hit.en, zh: hit.zh.split(w).join('＿'.repeat(Array.from(w.replace(/\s+/g, '')).length)) };
  const en = ss.find(x => x.en);
  return en ? { en: en.en, zh: '' } : null;
}
function spHintHTML(h) {
  return `<div class="sp-hint">${h.zh ? `<p class="sp-hint-zh" lang="zh-CN">${esc(h.zh)}</p>` : ''}${h.en ? `<p class="sp-hint-en">${esc(h.en)}</p>` : ''}</div>`;
}
// Other words with the same English, so a different right answer isn't graded as wrong.
function sameMeaningHTML(c) {
  const key = (c.english || '').trim().toLowerCase();
  if (!key) return '';
  const same = [...state.cards.values()].filter(x => x.id !== c.id && (x.english || '').trim().toLowerCase() === key).slice(0, 6);
  if (!same.length) return '';
  return `<p class="sp-same">Same meaning: ${same.map(x => `<span lang="zh-CN">${esc(x.hanzi)}</span>${x.pinyin ? ' ' + esc(x.pinyin) : ''}`).join(', ')}</p>`;
}
function showHint() {
  if (!study.id || study.revealed || study.dir !== 's' || study.hinted) return;
  const c = state.cards.get(study.id);
  if (!c || !spHint(c)) return;
  study.hinted = true;
  renderStudy();
}

function countsHTML(q) {
  return `<div class="counts">
    <span><b class="c-new">${q.fresh.length + q.spFresh.length}</b>new</span>
    <span><b class="c-learn">${q.learnNow.length}</b>learning</span>
    <span><b class="c-rev">${q.rev.length}</b>to review</span>
    ${lastUndo ? '<button class="link undo" data-act="undo">Undo</button>' : ''}
  </div>`;
}
function scopeHTML() {
  if (cram) {
    return `<div class="scope-row"><span class="scope-label">Whole folder: ${cram.order.length} of ${cram.total} left</span>
      <button class="link" data-act="cram-stop">Stop</button>${lastUndo ? '<button class="link undo" data-act="undo">Undo</button>' : ''}</div>`;
  }
  const fl = sortedFolders();
  if (!fl.length) return '';
  const s = scopeValid();
  return `<div class="scope-row"><select class="scope-sel" id="scope" aria-label="What to study">
      <option value="all"${s === 'all' ? ' selected' : ''}>All practice words</option>
      ${fl.map(f => `<option value="${esc(f.id)}"${f.id === s ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}
    </select>${s !== 'all' ? '<button class="link" data-act="cram-start">Practice all</button>' : ''}</div>`;
}
function startCram(fid) {
  if (!state.folders.has(fid)) return;
  const ids = shuffle([...state.cards.values()].filter(c => c.practice && c.folders.includes(fid)).map(c => c.id));
  if (!ids.length) { toast('This folder has no practice words yet.'); return; }
  cram = { fid, order: ids, total: ids.length };
  prefs.scope = fid; savePrefs();
  study = { id: null, dir: 'r', revealed: false, animate: false };
  if (currentView === 'study') renderStudy(); else showView('study');
}
function renderStudy() {
  const el = $('#view-study');
  const now = Date.now();
  const q = queues(now);
  clearTimeout(refreshTimer);
  if (study.id) {
    const sc = state.cards.get(study.id);
    if (!sc || (study.dir === 's' && (!state.settings.speakCards || !sc.english))) study = { id: null, dir: 'r', revealed: false, animate: false };
  }
  if (cram) {
    cram.order = cram.order.filter(id => { const c = state.cards.get(id); return c && c.practice; });
    if (!study.id) study = { id: cram.order[0] || null, dir: 'r', revealed: false, animate: false, fresh: true };
  } else if (!study.id) {
    const it = pickNext(q);
    study = { id: it ? it.id : null, dir: it ? it.dir : 'r', revealed: false, animate: false, fresh: true };
  }

  if (!state.cards.size) {
    el.innerHTML = `<div class="empty">
      <div class="tzg" style="--n:2" lang="zh-CN"><span class="cell faint">${GRID_SVG}<span>字</span></span><span class="cell faint">${GRID_SVG}<span>卡</span></span></div>
      <h1 class="h1">Start your deck</h1>
      <p>Pick a ready-made deck like HSK 1 or Survival phrases, or add your own words. Cards show up here when it’s time to review.</p>
      <button class="btn" data-act="go-decks">Choose a starter deck</button>
      <button class="btn secondary" data-act="tab" data-view="add">Add your own words</button>
      <button class="link" data-act="example-card">Or try it with an example card</button>
    </div>`;
    setActions('');
    return;
  }
  const head = scopeHTML() + (cram ? '' : countsHTML(q));
  if (!study.id) {
    setActions('');
    if (cram) {
      el.innerHTML = head + `<div class="empty">
        <div class="tzg" style="--n:1" lang="zh-CN"><span class="cell faint">${GRID_SVG}<span>完</span></span></div>
        <h1 class="h1">Folder done</h1>
        <p>You went through all ${cram.total} ${plural(cram.total, 'word')} in “${esc(folderName(cram.fid))}”.</p>
        <button class="btn secondary" data-act="cram-stop">Back to regular reviews</button>
      </div>`;
      return;
    }
    let inScopeN = 0;
    for (const c of state.cards.values()) if (inScope(c, true)) inScopeN++;
    if (!inScopeN) {
      const s = scopeValid();
      el.innerHTML = head + `<div class="empty">
        <h1 class="h1">Nothing to practice here</h1>
        <p>${s === 'all' ? 'None of your words have Practice turned on. Turn it on for a word to review it.' : `“${esc(folderName(s))}” has no practice words yet.`}</p>
        <button class="btn secondary" data-act="tab" data-view="cards">Go to Words</button>
      </div>`;
      return;
    }
    el.innerHTML = head + doneHTML(q, now, inScopeN);
    const soon = q.learnSoon[0];
    const wait = soon ? clamp(soon.due - now + 300, 1000, 30000) : 30 * MIN;
    refreshTimer = setTimeout(() => { if (currentView === 'study' && !study.id) renderStudy(); }, wait);
    return;
  }
  const c = state.cards.get(study.id);
  const speaking = study.dir === 's', sch = schedOf(c, study.dir);
  const badge = (sch.state === NEW ? '<span class="badge">New</span>' : sch.state === RELEARNING ? '<span class="badge relearn">Relearning</span>' : '') +
    (speaking ? '<span class="badge speak">Speak</span>' : '');
  if (!study.revealed && speaking) {
    // English on the front, no audio: you say the word yourself, then flip.
    const hint = spHint(c);
    el.innerHTML = head + `<div class="study-card sp-card" data-act="show" role="button" tabindex="0" aria-label="Show answer">${badge}
      <p class="sp-prompt">${esc(c.english)}</p>${spCells(c)}${study.hinted && hint ? spHintHTML(hint) : ''}<p class="tap-hint">Say it aloud, then tap</p></div>`;
    setActions(hint && !study.hinted
      ? '<div class="sp-acts"><button class="btn secondary" data-act="sp-hint">Hint</button><button class="btn" data-act="show">Show answer</button></div>'
      : '<button class="btn" data-act="show">Show answer</button>');
    study.fresh = false;
  } else if (!study.revealed) {
    const mode = autoplayMode(), say = esc(c.hanzi);
    const frontAudio = mode === 'front' ? `<div class="audio-row">
        <button class="pill" id="front-listen" data-act="say" data-say="${say}">${ICON.play}Listen</button>
        <button class="pill" data-act="say" data-slow="1" data-say="${say}">${ICON.play}Slow</button>
      </div>` : '';
    el.innerHTML = head + `<div class="study-card" data-act="show" role="button" tabindex="0" aria-label="Show answer">${badge}${hanziBlock(c, false)}${frontAudio}<p class="tap-hint">Tap to show the answer</p></div>`;
    setActions('<button class="btn" data-act="show">Show answer</button>');
    // Speak once when a card first appears. Before the first tap the phone blocks sound,
    // so then the word plays when the answer is shown instead.
    if (study.fresh) {
      study.fresh = false;
      if (mode === 'front' && unlocked) { study.heard = true; speak(c.hanzi, false, $('#front-listen')); }
    }
  } else {
    el.innerHTML = head + `<div class="study-card is-back${speaking ? ' sp-card' : ''}">${badge}${hanziBlock(c, true)}${answerHTML(c, study.animate, speaking ? sameMeaningHTML(c) : '')}</div>
      <div class="card-tools"><button class="link" data-act="edit-current">Edit card</button></div>`;
    const pv = previewAll(sch, now);
    const names = ['Again', 'Hard', 'Good', 'Easy'];
    const n = speaking && study.hinted ? 2 : 4;            // after a hint, Hard is the best grade
    setActions(`<div class="rates${n === 2 ? ' two' : ''}">${pv.slice(0, n).map((r, i) => `<button class="rate g${i + 1}" data-act="rate" data-g="${i + 1}"><small>${ivlLabel(r)}</small>${names[i]}</button>`).join('')}</div>`);
  }
  study.animate = false;
}
function doneHTML(q, now, inScopeN) {
  let next = '';
  const soon = q.learnSoon[0];
  if (soon) next = `Next card in ${Math.max(1, Math.round((soon.due - now) / MIN))} min.`;
  else {
    let tomorrow = 0, first = null;
    const count = due => { if (due < q.nds + DAY) tomorrow++; if (first == null || due < first) first = due; };
    for (const c of state.cards.values()) {
      if (c.state === REVIEW) count(c.due);
      if (c.sp && c.sp.state === REVIEW && spEligible(c)) count(c.sp.due);
    }
    if (tomorrow) next = `Tomorrow: ${tomorrow} ${plural(tomorrow, 'card')} to review.`;
    else if (first) { const d = daysBetween(now, first); next = `Next review in ${d} ${plural(d, 'day')}.`; }
  }
  const waiting = q.freshTotal - q.fresh.length;
  const limitHit = waiting > 0 && q.newLeft === 0;
  return `<div class="empty">
    <div class="tzg" style="--n:1" lang="zh-CN"><span class="cell faint">${GRID_SVG}<span>完</span></span></div>
    <h1 class="h1">All done for now</h1>
    ${next ? `<p>${esc(next)}</p>` : ''}
    ${soon ? '<button class="btn secondary" data-act="study-ahead">Review it now</button>' : ''}
    ${limitHit ? `<p>${waiting} new ${plural(waiting, 'card is', 'cards are')} waiting. Your limit is ${state.settings.newPerDay} a day.</p>
      <button class="btn secondary" data-act="more-new">Learn 5 more today</button>` : ''}
    ${scopeValid() !== 'all' ? `<button class="btn secondary" data-act="cram-start">Practice all ${inScopeN} ${plural(inScopeN, 'word')} in this folder</button>` : ''}
    <button class="link" data-act="tab" data-view="add">Add a card</button>
  </div>`;
}
function reveal() {
  if (!study.id || study.revealed) return;
  study.revealed = true; study.animate = true;
  renderStudy();
  const c = state.cards.get(study.id);
  const mode = autoplayMode();
  if (!c) return;
  // A speaking card plays the word on the back unless autoplay is off, since the front was silent.
  if (study.dir === 's' ? mode !== 'off' : (mode === 'back' || (mode === 'front' && !study.heard))) speak(c.hanzi, false, $('.audio-row .pill'));
}
function rate(g) {
  const c = state.cards.get(study.id);
  if (!c || !study.revealed) return;
  const dir = study.dir === 's' ? 's' : 'r';
  if (dir === 's' && study.hinted && g > 2) return;
  const now = Date.now();
  const sch = schedOf(c, dir);
  const r = previewAll(sch, now)[g - 1];
  const res = { ...r.card, last: now, reps: (sch.reps || 0) + 1 };
  if (res.state === REVIEW && r.ivl != null) { const f = fuzz(r.ivl); res.ivl = f; res.due = dayOffset(now, f); }
  // Speaking only changes sp; the reading schedule stays as it is.
  const next = dir === 's' ? { ...c, sp: {
    state: res.state, due: res.due, stability: res.stability, difficulty: res.difficulty, step: res.step,
    ivl: res.ivl, reps: res.reps, lapses: res.lapses, last: res.last, mod: now
  } } : res;
  const day = dayKey(now);
  lastUndo = { prev: JSON.parse(JSON.stringify(c)), day, key: c.id + ':' + now, g, cram: !!cram, dir };
  if (cram && cram.order[0] === c.id) { cram.order.shift(); if (g === 1) cram.order.push(c.id); }
  state.cards.set(c.id, next);
  addLog(day, dir === 's' ? { c: c.id, g, s: sch.state, t: now, d: 's' } : { c: c.id, g, s: c.state, t: now });
  persistCard(c.id);
  stopAudio();
  study = { id: null, dir: 'r', revealed: false, animate: false };
  renderStudy();
  $('#main').scrollTop = 0;
}
function undo() {
  if (!lastUndo) return;
  const { prev, day, key, g } = lastUndo;
  const wasCram = lastUndo.cram, dir = lastUndo.dir === 's' ? 's' : 'r';
  lastUndo = null;
  if (wasCram && cram) {
    if (g === 1) { const i = cram.order.lastIndexOf(prev.id); if (i >= 0) cram.order.splice(i, 1); }
    cram.order.unshift(prev.id);
  }
  const now = Date.now();
  const back = normalizeCard(prev);
  // The restored speaking side gets a new mod, so the undo wins the next sync merge.
  if (dir === 's') back.sp = back.sp ? { ...back.sp, mod: now } : blankSp(now);
  state.cards.set(prev.id, back);
  state.undone.set(key, now);
  state.logs.set(day, (state.logs.get(day) || []).filter(e => (e.c + ':' + e.t) !== key));
  state.days.set(day, Math.max(0, (state.days.get(day) || 0) - 1));
  persistCard(prev.id);
  study = { id: prev.id, dir, revealed: false, animate: false, fresh: true };
  renderStudy();
  toast('Last answer undone');
}
function moreNew() {
  const day = dayKey(Date.now());
  const x = state.settings.extra || {};
  state.settings = { ...state.settings, extra: { day, n: (x.day === day ? (x.n | 0) : 0) + 5 } };
  persistSettings();
  renderStudy();
}
function addExampleCard() {
  const now = Date.now();
  const c = normalizeCard({
    id: newId(), hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello',
    sentences: [{ zh: '你好，我叫小明。', py: 'nǐ hǎo, wǒ jiào Xiǎomíng.', en: 'Hi, my name is Xiaoming.' }],
    created: now, updated: now, ...blankSchedule()
  });
  state.cards.set(c.id, c);
  persistCard(c.id, false, 3000);
  Prefetch.add(cardTexts(c));
  study = { id: null, dir: 'r', revealed: false, animate: false };
  renderStudy();
}

/* ---------- card form ---------- */
let formSeq = 0;
function cardForm(card) {
  const f = 'f' + (++formSeq);
  const el = document.createElement('div');
  el.className = 'form';
  el.dataset.self = card ? card.id : '';
  el.innerHTML = `
    <div class="field">
      <label class="lbl" for="${f}-h">Hanzi</label>
      <div class="with-btn">
        <input id="${f}-h" class="in in-han" data-k="hanzi" lang="zh-CN" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="你好">
        <button type="button" class="square" data-act="say-input" aria-label="Play word">${ICON.play}</button>
      </div>
      <p class="field-msg" data-msg hidden></p>
    </div>
    <div class="field">
      <div class="lbl-row"><label class="lbl" for="${f}-p">Pinyin</label><button type="button" class="link mini" data-act="fill-py">Fill in from hanzi</button></div>
      <input id="${f}-p" class="in" data-k="pinyin" data-pinyin autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="ni3 hao3">
      <span class="hint">Type tone numbers and they turn into marks: ni3 hao3 becomes nǐ hǎo. Use v for ü. Pinyin filled in from the hanzi is a best guess: check characters with more than one reading.</span>
    </div>
    <div class="field">
      <label class="lbl" for="${f}-e">English</label>
      <input id="${f}-e" class="in" data-k="english" autocomplete="off" placeholder="hello">
    </div>
    <label class="switch field"><span>Practice this word<span class="hint">Off: it counts as a word you know but never comes up in reviews.</span></span><input type="checkbox" data-k="practice" checked></label>
    <div class="field"><span class="lbl">Folders</span><div class="fsel"></div></div>
    <div class="field">
      <span class="lbl">Example sentences</span>
      <div class="ex-list"></div>
      <button type="button" class="ghost" data-act="add-ex">${ICON.plus}Add example sentence</button>
    </div>
    <div class="field">
      <label class="lbl" for="${f}-n">Notes <span class="opt">optional</span></label>
      <textarea id="${f}-n" class="in" data-k="notes" rows="2" placeholder="Mnemonic, measure word, usage…"></textarea>
    </div>`;
  const get = k => el.querySelector(`[data-k="${k}"]`);
  const pressed = () => $$('.fsel .fchip[aria-pressed="true"]', el).map(b => b.dataset.fid);
  const renderFsel = sel => { el.querySelector('.fsel').innerHTML = fselHTML(new Set(sel || [])); };
  const fill = c => {
    ['pinyin', 'english'].forEach(k => { get(k).dataset.auto = ''; });
    get('hanzi').value = c ? c.hanzi : '';
    get('pinyin').value = c ? c.pinyin : '';
    get('english').value = c ? c.english : '';
    get('notes').value = c ? c.notes : '';
    get('practice').checked = c ? c.practice !== false : true;
    renderFsel(c ? c.folders : []);
    const list = el.querySelector('.ex-list');
    list.innerHTML = '';
    (c && c.sentences || []).forEach(s => addExBlock(list, s, false));
    el.querySelector('[data-msg]').hidden = true;
  };
  fill(card);
  return {
    el,
    read() {
      return {
        hanzi: get('hanzi').value.trim(),
        pinyin: convertPinyin(get('pinyin').value).trim().normalize('NFC'),
        english: get('english').value.trim(),
        notes: get('notes').value.trim(),
        practice: get('practice').checked,
        folders: pressed(),
        sentences: $$('.ex', el).map(b => ({
          zh: b.querySelector('[data-k="zh"]').value.trim(),
          py: convertPinyin(b.querySelector('[data-k="py"]').value).trim().normalize('NFC'),
          en: b.querySelector('[data-k="en"]').value.trim()
        })).filter(s => s.zh)
      };
    },
    reset() { fill(null); },
    refreshFolders() { renderFsel(pressed()); },
    setFolders(ids) { renderFsel(ids); },
    focus() { try { get('hanzi').focus(); } catch (e) {} },
    error(msg) { const m = el.querySelector('[data-msg]'); m.className = 'field-msg'; m.textContent = msg; m.hidden = false; }
  };
}
function addExBlock(list, s, focus) {
  const b = document.createElement('div');
  b.className = 'ex';
  b.innerHTML = `
    <div class="ex-row">
      <textarea class="in in-han-sm" data-k="zh" rows="2" lang="zh-CN" placeholder="Chinese sentence" aria-label="Chinese sentence"></textarea>
      <div class="ex-btns">
        <button type="button" class="chip" data-act="say-ex" aria-label="Play sentence">${ICON.play}</button>
        <button type="button" class="chip" data-act="say-ex" data-slow="1" aria-label="Play sentence slowly">Slow</button>
      </div>
    </div>
    <input class="in" data-k="py" data-pinyin autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Pinyin (optional)" aria-label="Sentence pinyin">
    <input class="in" data-k="en" autocomplete="off" placeholder="Translation (optional)" aria-label="Sentence translation">
    <button type="button" class="link danger" data-act="rm-ex">Remove sentence</button>`;
  if (s) {
    b.querySelector('[data-k="zh"]').value = s.zh || '';
    b.querySelector('[data-k="py"]').value = s.py || '';
    b.querySelector('[data-k="en"]').value = s.en || '';
  }
  list.appendChild(b);
  if (focus) { try { b.querySelector('textarea').focus(); } catch (e) {} }
}
/* ---------- automatic pinyin in forms ---------- */
const autoTimers = new WeakMap();
function scheduleAuto(el, fn) { clearTimeout(autoTimers.get(el)); autoTimers.set(el, setTimeout(fn, 220)); }
// Only replace a field that's empty or was filled in automatically, never something you typed.
function setAuto(input, value) {
  if (input.value.trim() && input.value !== input.dataset.auto) return;
  input.value = value; input.dataset.auto = value;
}
function clearAuto(input) { if (input.value && input.value === input.dataset.auto) { input.value = ''; input.dataset.auto = ''; } }
async function autoFillWord(form, force) {
  if (!form || (!state.settings.autoPinyin && !force)) return;
  const hIn = form.querySelector('[data-k="hanzi"]'), py = form.querySelector('[data-k="pinyin"]'), en = form.querySelector('[data-k="english"]');
  const h = hIn.value.trim();
  if (!h || !HAN.test(h)) { clearAuto(py); clearAuto(en); if (force && !h) hIn.focus(); return; }
  let JP;
  try { [JP] = await Promise.all([loadPinyin(), loadDecks().catch(() => null)]); }
  catch (e) { if (force) toast('Couldn’t load automatic pinyin. Check your connection.'); return; }
  if (hIn.value.trim() !== h) return;                      // you kept typing
  if (force) py.dataset.auto = py.value;
  setAuto(py, autoWordPinyin(JP, h));
  const w = deckWord(h);
  if (w && w[2]) setAuto(en, w[2]); else clearAuto(en);
}
async function autoFillSentence(block) {
  if (!block || !state.settings.autoPinyin) return;
  const zhIn = block.querySelector('[data-k="zh"]'), py = block.querySelector('[data-k="py"]');
  const zh = zhIn.value.trim();
  if (!zh || !HAN.test(zh)) { clearAuto(py); return; }
  let JP;
  try { JP = await loadPinyin(); } catch (e) { return; }
  if (zhIn.value.trim() !== zh) return;
  setAuto(py, JP.sentence(zh));
}
function checkDup(input) {
  const form = input.closest('.form');
  if (!form) return;
  const msg = form.querySelector('[data-msg]');
  const v = input.value.trim();
  const self = form.dataset.self;
  const dup = v && [...state.cards.values()].find(c => c.hanzi === v && c.id !== self);
  if (dup) {
    msg.className = 'field-msg note';
    msg.innerHTML = `You already have a card for ${esc(v)}. <button type="button" class="link" data-act="open-card" data-id="${esc(dup.id)}">Open it</button>`;
    msg.hidden = false;
  } else if (msg.classList.contains('note') || !v) msg.hidden = true;
}

/* ---------- add view ---------- */
function renderAdd() {
  const el = $('#view-add');
  if (el.dataset.ready) { addForm.refreshFolders(); renderBulkFolders(); if (addMode === 'decks') renderDecks(); return; }
  el.dataset.ready = '1';
  addForm = cardForm(null);
  el.innerHTML = `<h1 class="h1">Add words</h1>
    <div class="seg seg3" role="group" aria-label="How to add words">
      <button type="button" data-act="add-mode" data-mode="one" aria-pressed="true">One word</button>
      <button type="button" data-act="add-mode" data-mode="many" aria-pressed="false">Many words</button>
      <button type="button" data-act="add-mode" data-mode="decks" aria-pressed="false">Decks</button>
    </div>
    <div id="add-one"></div>
    <div id="add-many" hidden>
      <div class="field">
        <label class="lbl" for="bulk-text">Words</label>
        <textarea class="in in-han-sm" id="bulk-text" rows="7" lang="zh-CN" placeholder="我 你 他 好 是 不 很"></textarea>
        <span class="hint">Separate words with spaces or new lines. To add pinyin and English as well, put one word per line like this: 你好 | ni3 hao3 | hello</span>
      </div>
      <label class="switch field"><span>Practice these words<span class="hint">Off: they’re added as words you know, without reviews.</span></span><input type="checkbox" id="bulk-practice"></label>
      <div class="field"><span class="lbl">Folders</span><div class="fsel" id="bulk-folders"></div>
        <span class="hint">Words you already have keep their settings. If you pick a folder, they’re added to it too.</span></div>
    </div>
    <div id="add-decks" hidden></div>`;
  $('#add-one').appendChild(addForm.el);
  renderBulkFolders();
  setAddMode(addMode);
}
function renderBulkFolders() {
  const box = $('#bulk-folders');
  if (!box) return;
  box.innerHTML = fselHTML(new Set($$('#bulk-folders .fchip[aria-pressed="true"]').map(b => b.dataset.fid)));
}
function setAddMode(m) {
  addMode = m;
  $$('#view-add .seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $('#add-one').hidden = m !== 'one';
  $('#add-many').hidden = m !== 'many';
  $('#add-decks').hidden = m !== 'decks';
  if (m === 'decks') renderDecks();
  if (currentView === 'add') setActions(addActions());
}
const addActions = () => addMode === 'many' ? BULK_BTN : addMode === 'decks' ? '' : SAVE_BTN;
function saveNew() {
  const v = addForm.read();
  if (!v.hanzi) { addForm.error('Add the hanzi for this card.'); addForm.focus(); return; }
  const now = Date.now();
  const c = normalizeCard({ id: newId(), ...v, created: now, updated: now, ...blankSchedule() });
  state.cards.set(c.id, c);
  persistCard(c.id, false, 3000);
  if (c.practice) Prefetch.add(cardTexts(c));
  addForm.reset();
  addForm.setFolders(v.folders);          // keep the folder choice for the next word
  addForm.focus();
  toast(c.practice ? `Card added: ${c.hanzi}` : `Added ${c.hanzi} as a known word`);
  $('#main').scrollTop = 0;
}
function parseBulk(text) {
  const out = [], seen = new Set();
  const push = (hanzi, pinyin, english) => {
    hanzi = hanzi.trim();
    if (!hanzi || !HAN.test(hanzi) || seen.has(hanzi)) return;
    seen.add(hanzi);
    out.push({ hanzi, pinyin: convertPinyin(pinyin || '').trim().normalize('NFC'), english: (english || '').trim() });
  };
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    if (/[|\t]/.test(l)) { const [h, p, ...e] = l.split(/\s*[|\t]\s*/); push(h || '', p, e.join(', ')); }
    else l.split(/[\s,，、;；。.]+/).forEach(h => push(h, '', ''));
  }
  return out;
}
async function bulkAdd() {
  const items = parseBulk($('#bulk-text').value);
  if (!items.length) { toast('Type or paste some Chinese words first.'); return; }
  if (state.settings.autoPinyin) {
    try {
      const [JP] = await Promise.all([loadPinyin(), loadDecks().catch(() => null)]);
      for (const it of items) {
        const w = deckWord(it.hanzi);
        if (!it.pinyin) it.pinyin = autoWordPinyin(JP, it.hanzi);
        if (w) {                                         // words from the built-in decks come with the rest of the card
          if (!it.english) it.english = w[2];
          it.notes = w[3] || '';
          it.sentences = (w[4] || []).map(x => ({ zh: x[0], py: x[1], en: x[2] }));
        }
      }
    } catch (e) { toast('Couldn’t load automatic pinyin. The words are added without it.'); }
  }
  const practice = $('#bulk-practice').checked;
  const fids = $$('#bulk-folders .fchip[aria-pressed="true"]').map(b => b.dataset.fid);
  const byHanzi = new Map([...state.cards.values()].map(c => [c.hanzi, c]));
  const now = Date.now();
  let added = 0, had = 0;
  for (const it of items) {
    const ex = byHanzi.get(it.hanzi);
    if (ex) {
      had++;
      const missing = fids.filter(f => !ex.folders.includes(f));
      if (missing.length) { ex.folders = [...ex.folders, ...missing]; persistCard(ex.id, false, 3000); }
      continue;
    }
    const c = normalizeCard({ id: newId(), ...it, practice, folders: fids, created: now + added, updated: now, ...blankSchedule() });
    state.cards.set(c.id, c);
    byHanzi.set(c.hanzi, c);
    persistCard(c.id, false, 3000);
    if (practice) Prefetch.add(cardTexts(c));
    added++;
  }
  $('#bulk-text').value = '';
  toast(`Added ${added} new ${plural(added, 'word')}.` + (had ? ` ${had} you already had ${had === 1 ? 'was' : 'were'} ${fids.length ? 'put in the folder' : 'skipped'}.` : ''));
}

/* ---------- standard decks ---------- */
let deckPractice = true;
const deckFolderId = id => 'deck-' + id;
function renderDecks() {
  const box = $('#add-decks');
  if (!box) return;
  if (!window.JIYI_DECKS) {
    box.innerHTML = '<p class="list-note">Loading decks…</p>';
    loadDecks().then(() => { if (addMode === 'decks') renderDecks(); }).catch(() => {
      if (addMode === 'decks') box.innerHTML = '<p class="list-note">Couldn’t load the decks. Check your connection and try again.</p><button class="btn secondary" data-act="decks-retry">Try again</button>';
    });
    return;
  }
  const have = new Map();
  for (const c of state.cards.values()) have.set(c.hanzi, c);
  const groups = [];
  for (const d of window.JIYI_DECKS.decks) {
    let g = groups.find(x => x.name === d.group);
    if (!g) groups.push(g = { name: d.group, decks: [] });
    g.decks.push(d);
  }
  box.innerHTML = `<p class="deck-intro">Ready-made words with pinyin, meaning, an example sentence and notes on common traps. Each deck goes into its own folder, and words you already have keep their progress.</p>
    <label class="switch field"><span>Practice the words I add<span class="hint">New words come in at your limit of ${state.settings.newPerDay} a day. Off: they’re added without reviews, and you choose which to practice under Words → Practicing → Choose words.</span></span><input type="checkbox" id="deck-practice"${deckPractice ? ' checked' : ''}></label>` +
    groups.map(g => `<h2 class="h2 deck-group">${g.name === 'HSK' ? 'HSK, 2025 syllabus' : esc(g.name)}</h2>` + g.decks.map(d => {
      const n = d.words.length, fid = deckFolderId(d.id);
      let got = 0, inF = 0;
      for (const w of d.words) { const c = have.get(w[0]); if (c) { got++; if (c.folders.includes(fid)) inF++; } }
      const missing = n - got;
      let btn;
      if (missing) btn = `<button class="btn compact" data-act="deck-add" data-deck="${esc(d.id)}">${got ? `Add ${missing} more` : 'Add'}</button>`;
      else if (inF < n || !state.folders.has(fid)) btn = `<button class="btn compact secondary" data-act="deck-add" data-deck="${esc(d.id)}">Add to folder</button>`;
      else btn = `<button class="btn compact secondary" data-act="deck-open" data-deck="${esc(d.id)}">Open</button>`;
      return `<div class="deck">
        <div class="deck-main">
          <p class="deck-name">${esc(d.name)} <span class="deck-zh" lang="zh-CN">${esc(d.zh)}</span></p>
          <p class="deck-desc">${esc(d.desc)}</p>
          <p class="deck-meta">${n} ${plural(n, 'word')}${got ? ` · you have ${got === n ? 'all' : got}` : ''}</p>
          ${got ? `<div class="meter"><i style="width:${got / n * 100}%"></i></div>` : ''}
        </div>
        ${btn}
      </div>`;
    }).join('')).join('');
}
function addDeck(id) {
  const d = window.JIYI_DECKS && window.JIYI_DECKS.decks.find(x => x.id === id);
  if (!d) return;
  const practice = $('#deck-practice') ? $('#deck-practice').checked : deckPractice;
  const fid = deckFolderId(d.id), now = Date.now();
  if (!state.folders.has(fid)) { state.folders.set(fid, { id: fid, name: d.name, created: now, mod: now }); state.ftomb.delete(fid); }
  const byHanzi = new Map();
  for (const c of state.cards.values()) byHanzi.set(c.hanzi, c);
  let added = 0, had = 0;
  const texts = [];
  d.words.forEach((w, i) => {
    const [hanzi, pinyin, english, notes, ex] = w;
    const old = byHanzi.get(hanzi);
    if (old) {
      had++;
      if (!old.folders.includes(fid)) { old.folders = [...old.folders, fid]; old.mod = now; }
      return;
    }
    // The same id on every device, so adding a deck on two phones before they sync gives one card per word.
    let cid = stableId(hanzi);
    if (state.cards.has(cid)) cid = newId();
    state.tomb.delete(cid);
    const c = normalizeCard({
      id: cid, hanzi, pinyin, english, notes, practice, folders: [fid],
      sentences: (ex || []).map(x => ({ zh: x[0], py: x[1], en: x[2] })),
      created: now + i, updated: now, mod: now, ...blankSchedule()
    });
    state.cards.set(cid, c);
    byHanzi.set(hanzi, c);
    if (practice) texts.push(...cardTexts(c));
    added++;
  });
  saveLocal(); Sync.soon(2000);
  if (texts.length) Prefetch.add(texts);
  let msg = added ? `Added ${added} ${plural(added, 'word')} to “${d.name}”.` : `All ${had} words are in “${d.name}”.`;
  if (added && had) msg += ` ${had} you already had are in the folder too.`;
  if (added && practice) msg += ` New words come in at ${state.settings.newPerDay} a day.`;
  toast(msg);
  renderDecks();
}
function openDeck(id) {
  const fid = deckFolderId(id);
  if (!state.folders.has(fid)) return;
  words.filter = fid; words.mode = 'list'; words.tools = '';
  showView('cards');
}

/* ---------- editor sheet ---------- */
function openEditor(id) {
  const c = state.cards.get(id);
  if (!c) return;
  const sheet = $('#sheet');
  const form = cardForm(c);
  const now = Date.now();
  let info = 'Not studied yet.';
  if (c.state !== NEW) {
    const dd = daysBetween(now, c.due);
    const due = c.state === REVIEW ? (c.due < nextDayStart(now) ? 'due today' : `due in ${dd} ${plural(dd, 'day')}`) : 'in learning steps';
    const r = c.last ? Math.round(retr(Math.max(0, (now - c.last) / DAY), c.stability) * 100) : null;
    info = `This card is ${due}. Memory stability is ${c.stability < 1 ? c.stability.toFixed(2) : c.stability.toFixed(1)} days and difficulty ${c.difficulty.toFixed(1)} out of 10${r != null ? `; estimated recall right now ${r}%` : ''}. Reviewed ${c.reps} ${plural(c.reps, 'time')}, forgotten ${c.lapses} ${plural(c.lapses, 'time')}.`;
  }
  let spInfo = '';
  if (state.settings.speakCards) {
    const sp = c.sp;
    if (sp && sp.state === REVIEW) { const dd = daysBetween(now, sp.due); spInfo = sp.due < nextDayStart(now) ? 'due today' : `due in ${dd} ${plural(dd, 'day')}`; }
    else if (sp && sp.state !== NEW) spInfo = 'in learning steps';
    else if (!c.english) spInfo = 'needs an English meaning';
    else spInfo = spUnlocked(c) ? 'new' : 'not unlocked yet';
    spInfo = 'Speaking: ' + spInfo;
  }
  sheet.innerHTML = `<div class="sheet-head"><button class="link" data-act="sheet-close">Cancel</button><strong>Edit card</strong><button class="link strong" data-act="sheet-save">Save</button></div>
    <div class="sheet-body wrap"></div>`;
  const body = $('.sheet-body', sheet);
  body.insertAdjacentHTML('beforeend', `<p class="sched-info">${esc(info)}${spInfo ? `<br>${esc(spInfo)}` : ''}</p>`);
  body.appendChild(form.el);
  body.insertAdjacentHTML('beforeend', `<button class="btn" data-act="sheet-save">Save changes</button>
    <div class="danger-zone"><button class="link" data-act="reset-card">Reset progress</button><button class="link danger" data-act="delete-card">Delete card</button></div>`);
  editing = { id, form };
  sheet.hidden = false;
  sheet.scrollTop = 0;
  document.body.classList.add('sheet-open');
}
function closeEditor() {
  $('#sheet').hidden = true;
  $('#sheet').innerHTML = '';
  $('#sheet').setAttribute('aria-label', 'Edit card');
  editing = null;
  pendingImport = null;
  document.body.classList.remove('sheet-open');
}
function saveEditor() {
  if (!editing) return;
  const c = state.cards.get(editing.id);
  if (!c) { closeEditor(); return; }
  const v = editing.form.read();
  if (!v.hanzi) { editing.form.error('Add the hanzi for this card.'); return; }
  const n = normalizeCard({ ...c, ...v, updated: Date.now() });
  state.cards.set(c.id, n);
  persistCard(c.id, false, 3000);
  Prefetch.add(cardTexts(n));
  closeEditor();
  toast('Card saved');
  dataChanged();
}
function deleteCard(id) {
  state.cards.delete(id);
  persistCard(id, true);
  if (study.id === id) study = { id: null, dir: 'r', revealed: false, animate: false };
  if (lastUndo && lastUndo.prev.id === id) lastUndo = null;
  closeEditor();
  toast('Card deleted');
  dataChanged();
}
function resetCard(id) {
  const c = state.cards.get(id);
  if (!c) return;
  const now = Date.now();
  state.cards.set(id, normalizeCard({ ...c, ...blankSchedule(), sp: blankSp(now), updated: now }));
  persistCard(id, false, 3000);
  if (study.id === id) study = { id: null, dir: 'r', revealed: false, animate: false };
  closeEditor();
  toast('Progress reset. The card is new again.');
  dataChanged();
}
function armed(btn, text, fn) {
  if (btn.dataset.armed === '1') { fn(); return; }
  const orig = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = text;
  setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = orig; } }, 3500);
}

/* ---------- words view ---------- */
function renderCards() {
  const el = $('#view-cards');
  if (!el.dataset.ready) {
    el.dataset.ready = '1';
    el.innerHTML = `<h1 class="h1">Words <span class="muted" id="cards-count"></span></h1>
      <div class="chips" id="fchips" aria-label="Folders"></div>
      <div id="folder-tools"></div>
      <input class="in search" id="search" type="search" placeholder="Search hanzi, pinyin or English" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Search words">
      <div class="list" id="card-list"></div>`;
  }
  if (!['all', 'practice'].includes(words.filter) && !state.folders.has(words.filter)) { words.filter = 'practice'; words.mode = 'list'; }
  renderChips();
  renderFolderTools();
  renderCardList();
}
function renderChips() {
  const el = $('#fchips');
  if (!el) return;
  const x = el.scrollLeft;
  let prac = 0;
  for (const c of state.cards.values()) if (c.practice) prac++;
  const all = state.cards.size;
  const chip = (id, label, n) => `<button class="fchip" data-act="wfilter" data-f="${esc(id)}" aria-pressed="${words.filter === id}">${esc(label)}<b>${n}</b></button>`;
  el.innerHTML = chip('practice', 'Practicing', prac) + chip('all', 'All words', all) +
    sortedFolders().map(f => chip(f.id, f.name, folderCount(f.id))).join('') +
    `<button class="fchip add" data-act="new-folder">${ICON.plus}New folder</button>`;
  el.scrollLeft = x;
}
function renderFolderTools() {
  const el = $('#folder-tools');
  if (!el) return;
  const f = state.folders.get(words.filter);
  if (words.tools === 'new' || (words.tools === 'rename' && f)) {
    const isNew = words.tools === 'new';
    el.innerHTML = `<div class="inline-form"><input class="in" id="folder-name" maxlength="40" autocomplete="off" placeholder="Folder name, e.g. Midterm" aria-label="Folder name">
      <button class="btn secondary" data-act="${isNew ? 'folder-create' : 'folder-rename-save'}">${isNew ? 'Create' : 'Save'}</button></div>
      <button class="link" data-act="folder-tools-cancel">Cancel</button>`;
    const inp = $('#folder-name');
    if (!isNew) inp.value = f.name;
    try { inp.focus(); } catch (e) {}
    return;
  }
  if (words.filter === 'practice') {
    if (words.mode === 'pick') {
      const fl = sortedFolders();
      if (words.pickIn !== 'all' && !state.folders.has(words.pickIn)) words.pickIn = 'all';
      el.innerHTML = `<div class="pick-bar"><span>Tap words to practice them, or tap again to stop.</span><button class="btn compact" data-act="pick-done">Done</button></div>
        <div class="pick-tools">${fl.length ? `<select class="scope-sel" id="pick-in" aria-label="Show words from">
            <option value="all">All words</option>${fl.map(x => `<option value="${esc(x.id)}"${words.pickIn === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select>` : ''}
          <button class="link" data-act="pick-all">Practice all shown</button><button class="link" data-act="pick-none">Stop all shown</button></div>`;
      return;
    }
    el.innerHTML = '<div class="folder-tools"><button class="link" data-act="pick-start">Choose words</button></div>';
    return;
  }
  if (!f) {
    el.innerHTML = '';
    return;
  }
  if (words.mode === 'pick') {
    el.innerHTML = `<div class="pick-bar"><span>Tap words to add them to “${esc(f.name)}” or take them out.</span><button class="btn compact" data-act="pick-done">Done</button></div>`;
    return;
  }
  el.innerHTML = `<div class="folder-tools">
    <button class="link strong" data-act="folder-study">Study this folder</button>
    <button class="link" data-act="pick-start">Choose words</button>
    <button class="link" data-act="folder-rename">Rename</button>
    <button class="link danger" data-act="folder-delete">Delete folder</button>
  </div>`;
}
function cardStatus(c, now, nds) {
  if (!c.practice) return ['Known', ''];
  if (c.state === NEW) return ['New', ''];
  if (c.state !== REVIEW) return ['Learning', 'due'];
  if (c.due < nds) return ['Due', 'due'];
  return ['in ' + fmtDays(daysBetween(now, c.due)), ''];
}
// The words the list shows right now (folder, picker filter and search applied).
function listedCards() {
  const raw = ($('#search') ? $('#search').value : '').trim();
  const q = fold(raw);
  const fid = words.filter, picking = words.mode === 'pick' && state.folders.has(fid), pickPrac = words.mode === 'pick' && fid === 'practice';
  let arr = [...state.cards.values()];
  if (pickPrac) { if (words.pickIn !== 'all' && state.folders.has(words.pickIn)) arr = arr.filter(c => c.folders.includes(words.pickIn)); }
  else if (!picking) {
    if (fid === 'practice') arr = arr.filter(c => c.practice);
    else if (state.folders.has(fid)) arr = arr.filter(c => c.folders.includes(fid));
  }
  if (raw) arr = arr.filter(c => c.hanzi.includes(raw) || (q && (fold(c.pinyin).includes(q) || fold(c.english).includes(q))));
  // Deck folders keep the deck's order (most common words first); everything else shows the newest first.
  const shownFolder = pickPrac ? words.pickIn : fid;
  if (String(shownFolder).startsWith('deck-')) arr.sort((a, b) => a.created - b.created);
  else arr.sort((a, b) => b.created - a.created);
  return { arr, raw, picking, pickPrac };
}
function renderCardList() {
  const list = $('#card-list');
  if (!list) return;
  const now = Date.now(), nds = nextDayStart(now);
  const fid = words.filter;
  const { arr, raw, picking, pickPrac } = listedCards();
  $('#cards-count').textContent = state.cards.size ? String(state.cards.size) : '';
  if (!state.cards.size) { list.innerHTML = '<p class="list-note">No words yet. Add some from the Add tab.</p>'; return; }
  if (!arr.length) {
    list.innerHTML = `<p class="list-note">${raw ? `Nothing matches “${esc(raw)}”.` : pickPrac ? 'No words in this folder.' : state.folders.has(fid) ? 'No words in this folder yet. Tap Choose words to add some.' : fid === 'practice' ? 'You’re not practicing any words. Tap Choose words to pick some.' : 'Nothing here yet.'}</p>`;
    return;
  }
  const shown = arr.slice(0, 400);
  list.innerHTML = shown.map(c => {
    const top = `<span class="rh" lang="zh-CN">${esc(c.hanzi)}</span>
      <span class="rm"><span class="rp">${c.pinyin ? pinyinHTML(c.pinyin) : '&nbsp;'}</span><span class="re">${esc(c.english) || '&nbsp;'}</span></span>`;
    if (picking || pickPrac) {
      const on = pickPrac ? c.practice : c.folders.includes(fid);
      return `<button class="row${on ? ' on' : ''}" data-act="${pickPrac ? 'pick-practice' : 'pick-toggle'}" data-id="${esc(c.id)}" aria-pressed="${on}">${top}<span class="check">${ICON.check}</span></button>`;
    }
    const [st, cls] = cardStatus(c, now, nds);
    return `<button class="row" data-act="open-card" data-id="${esc(c.id)}">${top}<span class="rs ${cls}">${esc(st)}</span></button>`;
  }).join('') + (arr.length > shown.length ? `<p class="list-note">Showing ${shown.length} of ${arr.length}. Search to narrow it down.</p>` : '');
}
function togglePick(btn) {
  const c = state.cards.get(btn.dataset.id), fid = words.filter;
  if (!c || !state.folders.has(fid)) return;
  const on = !c.folders.includes(fid);
  c.folders = on ? [...c.folders, fid] : c.folders.filter(x => x !== fid);
  persistCard(c.id, false, 5000);
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  renderChips();
}

function togglePractice(btn) {
  const c = state.cards.get(btn.dataset.id);
  if (!c) return;
  c.practice = !c.practice;
  persistCard(c.id, false, 5000);
  if (c.practice) Prefetch.add(cardTexts(c));
  btn.classList.toggle('on', c.practice);
  btn.setAttribute('aria-pressed', String(c.practice));
  renderChips();
}
function pickAll(on) {
  const { arr } = listedCards();
  const now = Date.now(), texts = [];
  let n = 0;
  for (const c of arr) {
    if (c.practice === on) continue;
    c.practice = on; c.mod = now; n++;
    if (on) texts.push(...cardTexts(c));
  }
  if (!n) { toast(on ? 'All of these are already in practice.' : 'None of these are in practice.'); return; }
  saveLocal(); Sync.soon(3000);
  if (texts.length) Prefetch.add(texts);
  toast(on ? `Practicing ${n} more ${plural(n, 'word')}. New ones come in at ${state.settings.newPerDay} a day.` : `Stopped practicing ${n} ${plural(n, 'word')}. Their progress is kept.`);
  renderChips(); renderCardList();
}

/* ---------- stats ---------- */
function renderStats() {
  const el = $('#view-stats');
  const now = Date.now(), today = dayKey(now), ds0 = dayStart(now);
  const q = queues(now, false);
  let nNew = 0, nLearn = 0, nYoung = 0, nMature = 0, nKnown = 0, rSum = 0, rN = 0;
  const fc = new Array(14).fill(0);
  for (const c of state.cards.values()) {
    if (!c.practice) { nKnown++; continue; }
    if (c.state === NEW) { nNew++; continue; }
    if (c.state === REVIEW) { if ((c.ivl || 0) >= 21) nMature++; else nYoung++; } else nLearn++;
    if (c.last && c.stability > 0) { rSum += retr(Math.max(0, (now - c.last) / DAY), c.stability); rN++; }
    const idx = c.due < q.nds ? 0 : Math.round((dayStart(c.due) - ds0) / DAY);
    if (idx >= 0 && idx < 14) fc[idx]++;
  }
  // speaking: forecast, and words you can say
  let spAny = false, canSay = 0;
  for (const c of state.cards.values()) {
    if (c.sp) spAny = true;
    if (c.practice && c.sp && c.sp.state === REVIEW) canSay++;
    if (!c.sp || c.sp.state === NEW || !spEligible(c)) continue;
    const idx = c.sp.due < q.nds ? 0 : Math.round((dayStart(c.sp.due) - ds0) / DAY);
    if (idx >= 0 && idx < 14) fc[idx]++;
  }
  fc[0] += q.fresh.length + q.spFresh.length;
  const dueToday = q.rev.length + q.learnNow.length + q.fresh.length + q.spFresh.length;
  const reviewedToday = (state.logs.get(today) || []).length;
  let pass = 0, tot = 0, spPass = 0, spTot = 0;
  const cutoff = dayKey(now - 30 * DAY);
  for (const [k, arr] of state.logs) if (k > cutoff) for (const e of arr) {
    if (e.s !== REVIEW) continue;
    if (e.d === 's') { spTot++; if (e.g > 1) spPass++; } else if (!e.d) { tot++; if (e.g > 1) pass++; }
  }
  const showSpeak = state.settings.speakCards || spAny;
  const studied = k => (state.logs.get(k) || []).length > 0 || (state.days.get(k) || 0) > 0;
  let streak = 0;
  for (let i = studied(today) ? 0 : 1; i < 3650; i++) {
    if (studied(dayKey(ds0 + 12 * HOUR - i * DAY))) streak++; else break;
  }
  const total = (state.cards.size - nKnown) || 1;
  const maxFc = Math.max(1, ...fc);
  const wd = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const recall = rN ? Math.round(rSum / rN * 100) : null;
  // vocabulary
  const allN = state.cards.size, practN = allN - nKnown;
  const wk0 = dayOffset(now, -((new Date(ds0).getDay() + 6) % 7));          // this week's Monday
  const d0 = new Date(ds0), mo0 = new Date(d0.getFullYear(), d0.getMonth(), 1, DAY_START_HOUR).getTime();
  let addedWeek = 0, addedMonth = 0;
  const weeks = [];
  for (let i = 11; i >= 0; i--) { const start = dayOffset(wk0, -7 * i); weeks.push({ start, end: dayOffset(start, 7), n: 0 }); }
  for (const c of state.cards.values()) {
    if (c.created >= wk0) addedWeek++;
    if (c.created >= mo0) addedMonth++;
    for (const w of weeks) if (c.created < w.end) w.n++;
  }
  const maxW = Math.max(1, ...weeks.map(w => w.n));
  const short = n => n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  const md = ms => { const d = new Date(ms); return d.getDate() + '/' + (d.getMonth() + 1); };
  const folderRows = sortedFolders().map(f => {
    let n = 0, learned = 0;
    for (const c of state.cards.values()) if (c.folders.includes(f.id)) { n++; if (!c.practice || c.state === REVIEW) learned++; }
    return { f, n, learned };
  });
  el.innerHTML = `<h1 class="h1">Stats</h1>
    <div class="kv">
      <div><b>${dueToday}</b><span>Due today</span></div>
      <div><b>${reviewedToday}</b><span>Answered today</span></div>
      <div><b>${streak}</b><span>Day streak</span></div>
      <div><b>${state.cards.size}</b><span>Words</span></div>
    </div>
    <section class="stat-sec">
      <h2 class="h2">Your vocabulary</h2>
      <p class="vocab-num">${allN}<span>${plural(allN, 'word')}</span></p>
      <p class="muted" style="font-size:14px">${practN} in your reviews and ${nKnown} without practice. Added ${addedWeek} this week and ${addedMonth} this month.</p>
      <div class="fc fc12" role="img" aria-label="Total words at the end of each of the last 12 weeks: ${weeks.map(w => w.n).join(', ')}">
        ${weeks.map((w, i) => `<div class="col"><span class="n">${i % 3 === 2 || i === 11 ? short(w.n) : ''}</span><i class="bar${w.n ? '' : ' zero'}${i === 11 ? '' : ' past'}" style="height:${w.n ? Math.max(4, w.n / maxW * 100) : 2}%"></i></div>`).join('')}
      </div>
      <div class="fc-days fc12" aria-hidden="true">${weeks.map((w, i) => `<span>${i % 3 === 0 ? md(w.start) : ''}</span>`).join('')}</div>
      <p class="muted" style="font-size:13px;margin-top:6px">Total words, week by week.</p>
      ${folderRows.length ? `<div class="folder-stats">${folderRows.map(r => `
        <div class="fs-row">
          <div class="fs-top"><span>${esc(r.f.name)}</span><span class="muted">${r.learned} of ${r.n} learned</span></div>
          <div class="meter"><i style="width:${r.n ? r.learned / r.n * 100 : 0}%"></i></div>
        </div>`).join('')}
        <p class="muted" style="font-size:13px">Learned means past the learning steps, or a word you don’t practice.</p></div>` : ''}
    </section>
    <section class="stat-sec">
      <h2 class="h2">Estimated recall right now</h2>
      ${recall != null ? `<p class="big">${recall}%</p><div class="meter"><i style="width:${recall}%"></i></div>
        <p class="muted" style="font-size:14px">The average chance you’d remember a studied card if it came up now, from the scheduler’s memory model.</p>`
        : '<p class="muted">Study a few cards to see this.</p>'}
    </section>
    <section class="stat-sec">
      <h2 class="h2">Retention, last 30 days</h2>
      ${tot >= 10 ? `<p class="big">${Math.round(pass / tot * 100)}%</p><p class="muted" style="font-size:14px">Share of reviews you didn’t answer Again, across ${tot} ${plural(tot, 'review')}. Your target is ${Math.round(state.settings.retention * 100)}%.</p>`
        : `<p class="muted">Shows up after 10 reviews of graduated cards${tot ? ` (${tot} so far)` : ''}.</p>`}
    </section>
    ${showSpeak ? `<section class="stat-sec">
      <h2 class="h2">Speaking</h2>
      <p class="big">Can say ${canSay} <span class="muted" style="font-size:16px;font-weight:500">of ${practN} practice ${plural(practN, 'word')}</span></p>
      <div class="meter"><i style="width:${practN ? canSay / practN * 100 : 0}%"></i></div>
      <p class="muted" style="font-size:14px">Words past the speaking learning steps: you see the English and say the Chinese.</p>
      ${spTot >= 10 ? `<p class="big" style="margin-top:14px">${Math.round(spPass / spTot * 100)}%</p><p class="muted" style="font-size:14px">Speaking retention over the last 30 days, across ${spTot} ${plural(spTot, 'review')}.</p>`
        : `<p class="muted" style="font-size:14px;margin-top:10px">Speaking retention shows up after 10 speaking reviews${spTot ? ` (${spTot} so far)` : ''}.</p>`}
      ${state.settings.speakCards ? '' : '<p class="muted" style="font-size:14px;margin-top:6px">Speaking cards are off. Turn them on in Options.</p>'}
    </section>` : ''}
    <section class="stat-sec">
      <h2 class="h2">Next 14 days</h2>
      <div class="fc" role="img" aria-label="Cards due per day for the next 14 days: ${fc.join(', ')}">
        ${fc.map(n => `<div class="col"><span class="n">${n || ''}</span><i class="bar${n ? '' : ' zero'}" style="height:${n ? Math.max(4, n / maxFc * 100) : 2}%"></i></div>`).join('')}
      </div>
      <div class="fc-days" aria-hidden="true">${fc.map((_, i) => `<span>${i === 0 ? 'Now' : wd[new Date(ds0 + 12 * HOUR + i * DAY).getDay()]}</span>`).join('')}</div>
    </section>
    <section class="stat-sec">
      <h2 class="h2">Practice cards</h2>
      <div class="stack" aria-hidden="true">
        <i class="k-mature" style="width:${nMature / total * 100}%"></i><i class="k-young" style="width:${nYoung / total * 100}%"></i><i class="k-learn" style="width:${nLearn / total * 100}%"></i><i class="k-new" style="width:${nNew / total * 100}%"></i>
      </div>
      <div class="legend">
        <span><i class="k-mature"></i>Mature<b>${nMature}</b></span>
        <span><i class="k-young"></i>Young<b>${nYoung}</b></span>
        <span><i class="k-learn"></i>Learning<b>${nLearn}</b></span>
        <span><i class="k-new"></i>New<b>${nNew}</b></span>
      </div>
      <p class="muted" style="font-size:14px;margin-top:10px">Mature cards have an interval of 21 days or more.</p>
    </section>`;
}

/* ---------- options ---------- */
function voiceHint(cur) {
  if (cur.kind === 'azure') return 'Each clip is saved on this device after it’s generated, so it plays instantly and offline from then on.';
  if (!azureReady()) return 'Add an Azure key below for natural neural voices.' + (isIOS ? ' Device voices on iPhone are limited to the built-in ones.' : '');
  return 'Device voices work offline but sound flatter than Azure.';
}
function renderVoiceControls() {
  const sel = $('#opt-voice');
  if (!sel) return;
  const cur = currentVoice();
  const val = cur.kind === 'azure' ? 'azure:' + cur.name : 'device:' + (cur.uri || '');
  let html = '';
  if (azureReady()) html += `<optgroup label="Azure neural">${AZ_VOICES.map(([n, l]) => `<option value="azure:${n}">${esc(l)}</option>`).join('')}</optgroup>`;
  html += `<optgroup label="This device"><option value="device:">Device default</option>${TTS.voices.map(v => `<option value="device:${esc(v.voiceURI)}">${esc(v.name)} (${langLabel(v.lang)})</option>`).join('')}</optgroup>`;
  sel.innerHTML = html;
  sel.value = val;
  if (sel.value !== val) sel.value = 'device:';
  $('#voice-hint').textContent = voiceHint(cur);
}
function renderAzureStatus(msg, cls) {
  const el = $('#az-status');
  if (!el) return;
  if (msg) { el.className = 'status' + (cls ? ' ' + cls : ''); el.textContent = msg; return; }
  if (Prefetch.running && Prefetch.total) { el.className = 'status'; el.textContent = `Generating audio: ${Prefetch.done} of ${Prefetch.total}…`; return; }
  if (!azureReady()) { el.className = 'status'; el.textContent = 'Not set up.'; return; }
  if (Prefetch.lastError) { el.className = 'status err'; el.textContent = Prefetch.lastError; return; }
  const n = AudioCache.keys.size;
  el.className = 'status ok';
  el.textContent = `Ready. ${n} ${plural(n, 'clip')} saved on this device.`;
}
function renderOptions() {
  const s = state.settings;
  $('#view-options').innerHTML = `<h1 class="h1">Options</h1>
    <section class="opt-sec">
      <h2 class="h2">Voice</h2>
      <div class="field">
        <label class="lbl" for="opt-voice">Voice</label>
        <select class="in" id="opt-voice" data-pref="voice"></select>
        <span class="hint" id="voice-hint"></span>
      </div>
      <div class="field">
        <label class="lbl" for="opt-rate">Speaking speed <span class="opt" id="rate-val">${s.rate.toFixed(2)}×</span></label>
        <input type="range" id="opt-rate" min="0.5" max="1.3" step="0.05" value="${s.rate}" data-set="rate">
        <span class="hint">The Slow buttons play at 65% of this speed.</span>
      </div>
      <button class="pill" data-act="say" data-say="你好，很高兴认识你。">${ICON.play}Test voice</button>
      <div class="field" style="margin-top:16px">
        <label class="lbl" for="opt-autoplay">Play the word automatically</label>
        <select class="in" id="opt-autoplay" data-set="autoplayWhen">
          ${[['front', 'When the card appears'], ['back', 'When you flip the card'], ['off', 'Off']]
            .map(([v, l]) => `<option value="${v}"${autoplayMode() === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <span class="hint" id="autoplay-hint">${AUTOPLAY_HINTS[autoplayMode()]}</span>
      </div>
    </section>
    <section class="opt-sec">
      <h2 class="h2">Azure neural voices</h2>
      <p>Natural Mandarin voices from Microsoft. The free tier covers 500,000 characters a month, far more than flashcards use. The key is stored only on this device.</p>
      <p>With a key, the back of each card also gets a <b>Say it</b> button: say the word or sentence and Azure scores your pronunciation character by character. This uses speech recognition on the same Azure resource, which has its own free monthly allowance.</p>
      <div class="field">
        <label class="lbl" for="az-key">Key</label>
        <input class="in" id="az-key" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste KEY 1 from the Azure portal">
      </div>
      <div class="field">
        <label class="lbl" for="az-region">Region</label>
        <input class="in" id="az-region" list="az-regions" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="eastasia">
        <datalist id="az-regions">${AZ_REGIONS.map(r => `<option value="${r}"></option>`).join('')}</datalist>
        <span class="hint">Shown as Location/Region next to the key, for example eastasia.</span>
      </div>
      <p class="status" id="az-status"></p>
      <div class="btn-row">
        <button class="btn secondary" data-act="az-save">Save and test</button>
        ${azureReady() ? '<button class="btn secondary" data-act="az-all">Generate audio for all cards</button>' : ''}
      </div>
      ${azureReady() ? '<div class="btn-row" style="margin-top:6px"><button class="link danger" data-act="az-remove">Remove key</button><button class="link" data-act="az-clear">Clear saved audio</button></div>' : ''}
    </section>
    <section class="opt-sec">
      <h2 class="h2">Study</h2>
      <div class="field">
        <label class="lbl" for="opt-new">New cards per day</label>
        <div class="stepper">
          <button type="button" data-act="num" data-d="-5" aria-label="Five fewer">−</button>
          <input class="in" id="opt-new" type="number" inputmode="numeric" min="0" max="999" value="${s.newPerDay}" data-set="newPerDay">
          <button type="button" data-act="num" data-d="5" aria-label="Five more">+</button>
        </div>
      </div>
      <div class="field">
        <label class="lbl" for="opt-ret">Target retention <span class="opt" id="ret-val">${Math.round(s.retention * 100)}%</span></label>
        <input type="range" id="opt-ret" min="0.8" max="0.97" step="0.01" value="${s.retention}" data-set="retention">
        <span class="hint">The chance of remembering a card when it comes due. Higher means shorter intervals and more reviews. 90% is a good balance. Changes apply from each card’s next review.</span>
      </div>
      <label class="switch field"><span>Speaking cards<span class="hint">Some reviews show the English. Say the Chinese word aloud, then flip. A word joins after you’ve passed its first review a few days after learning it. Speaking has its own schedule and doesn’t change your reading progress.</span></span><input type="checkbox" data-set="speakCards"${s.speakCards ? ' checked' : ''}></label>
      <div class="field" id="sp-new-field" style="margin-top:12px"${s.speakCards ? '' : ' hidden'}>
        <label class="lbl" for="opt-spnew">New speaking cards per day</label>
        <div class="stepper">
          <button type="button" data-act="num" data-d="-5" aria-label="Five fewer">−</button>
          <input class="in" id="opt-spnew" type="number" inputmode="numeric" min="0" max="999" value="${s.speakNewPerDay}" data-set="speakNewPerDay">
          <button type="button" data-act="num" data-d="5" aria-label="Five more">+</button>
        </div>
      </div>
    </section>
    <section class="opt-sec">
      <h2 class="h2">Adding words</h2>
      <label class="switch"><span>Fill in pinyin automatically<span class="hint">Pinyin appears as you type hanzi, for words and example sentences. Words from the built-in decks also get their meaning. It’s a best guess: check characters with more than one reading, like 行 or 长.</span></span><input type="checkbox" data-set="autoPinyin"${s.autoPinyin ? ' checked' : ''}></label>
      ${missingPinyin() ? `<button class="btn secondary" data-act="fill-missing" style="margin-top:8px">Add pinyin where it’s missing (${missingPinyin()} ${plural(missingPinyin(), 'card')})</button>` : ''}
    </section>
    <section class="opt-sec">
      <h2 class="h2">Display</h2>
      <label class="switch"><span>Color pinyin and hanzi by tone</span><input type="checkbox" data-set="toneColors"${s.toneColors ? ' checked' : ''}></label>
      <p class="tone-sample"><span class="t1">mā</span> <span class="t2">má</span> <span class="t3">mǎ</span> <span class="t4">mà</span> <span class="t5">ma</span></p>
      <p>Hanzi get colored when the pinyin has one syllable per character, separated by spaces.</p>
    </section>
    <section class="opt-sec">
      <h2 class="h2">Sync</h2>
      ${Sync.enabled() ? `
        <p>Cards and progress sync through a private gist on your GitHub account: a few seconds after changes, every minute while the app is open, and when you switch away.</p>
        <p class="status" id="sync-status"></p>
        <div class="btn-row"><button class="btn secondary" data-act="sync-now">Sync now</button><button class="btn secondary" data-act="gh-disconnect">Disconnect</button></div>`
      : `
        <p>Sync cards and progress between devices through a private gist on your GitHub account.</p>
        <div class="field">
          <label class="lbl" for="gh-token">GitHub token</label>
          <input class="in" id="gh-token" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="ghp_…">
          <span class="hint">Create one at github.com/settings/tokens with only the gist permission. Use the same token on every device; it finds your deck automatically.</span>
        </div>
        <p class="status" id="gh-status" hidden></p>
        <button class="btn secondary" data-act="gh-save">Connect</button>`}
    </section>
    <section class="opt-sec">
      <h2 class="h2">Backup</h2>
      <p>A file with all your cards and progress. Use it to keep a copy or to move to another device without sync.</p>
      <div class="btn-row">
        <button class="btn secondary" data-act="export">Export backup</button>
        <button class="btn secondary" data-act="import">Import backup</button>
      </div>
      <div id="backup-box"></div>
    </section>
    <section class="opt-sec">
      <h2 class="h2">Import words</h2>
      <p>Bring in a word list from Anki, Pleco or a spreadsheet. Words you already have keep their progress.</p>
      <ul class="steps">
        <li><b>Anki:</b> File → Export, then choose Notes in Plain Text.</li>
        <li><b>Pleco:</b> Flashcards → Import/Export → Export Cards, as a text file.</li>
        <li><b>Spreadsheet:</b> save as CSV with columns for hanzi, pinyin and meaning.</li>
      </ul>
      <button class="btn secondary" data-act="import-words">Choose a file</button>
    </section>
    <section class="opt-sec">
      <h2 class="h2">How scheduling works</h2>
      <p>Cards are scheduled with FSRS-5, the memory model built into Anki. Each card tracks how stable your memory of it is and how hard the word is for you, and comes back when your chance of recalling it drops to your target retention.</p>
      <p>New cards go through two short steps, 1 and 10 minutes, before their first interval of a few days. A card you forget gets a 10-minute relearning step. Grade honestly: Hard means you recalled it with real effort, Again means you didn’t.</p>
      <p>Speaking cards show the English. Say the word out loud before you flip. A wrong tone counts as wrong, so grade Again. After using a hint, Hard is the best grade.</p>
    </section>
    <section class="opt-sec">
      <h2 class="h2">About</h2>
      <p>Jìyì is free and works offline. Scheduling uses FSRS-5. Automatic pinyin uses pinyin-pro (MIT). The HSK lists come from complete-hsk-vocabulary (MIT), with readings checked against CC-CEDICT (CC BY-SA 4.0); glosses, example sentences and notes were written for Jìyì. Neural voices and speaking practice use Microsoft Azure Speech.</p>
    </section>`;
  $('#az-key').value = prefs.azKey;
  $('#az-region').value = prefs.azRegion;
  renderVoiceControls();
  renderAzureStatus();
  renderSyncUI();
}
async function azureSave() {
  const key = $('#az-key').value.trim();
  const region = $('#az-region').value.trim().toLowerCase().replace(/[\s_\-]/g, '');
  if (!key || !region) { renderAzureStatus('Enter both the key and the region.', 'err'); return; }
  unlockAudio();
  prefs.azKey = key; prefs.azRegion = region;
  if (!String(prefs.voice).startsWith('azure:')) prefs.voice = 'azure:' + AZ_DEFAULT;
  savePrefs();
  dropSynth();
  Prefetch.lastError = '';
  renderAzureStatus('Testing…');
  try {
    const buf = await azureSynth('你好，很高兴认识你。', currentVoice().name);
    playBuffer(buf, false, null);
    renderOptions();
    renderAzureStatus('Working. Audio for your cards is being generated in the background.', 'ok');
    Prefetch.add(allTexts());
  } catch (e) {
    renderAzureStatus(azMessage(e) + ' Details: ' + String((e && e.message) || e).slice(0, 160), 'err');
  }
}
async function githubConnect() {
  const t = $('#gh-token').value.trim();
  const st = $('#gh-status');
  if (!t) { st.hidden = false; st.className = 'status err'; st.textContent = 'Paste a token first.'; return; }
  prefs.ghToken = t; prefs.gistId = '';
  savePrefs();
  renderOptions();
  await Sync.run();
  if (Sync.state === 'idle') toast('Sync connected');
}

/* ---------- backup ---------- */
async function exportData() {
  const data = JSON.stringify(snapshot(), null, 1);
  const filename = `jiyi-cards-${dayKey(Date.now())}.json`;
  try {
    const file = new File([data], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Jìyì backup' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Backup downloaded');
    return;
  } catch (e) {}
  const box = $('#backup-box');
  if (!box) return;
  box.innerHTML = '<div class="backup-box field"><label class="lbl" for="backup-text">Copy this text and keep it somewhere safe</label><textarea class="in" id="backup-text" readonly></textarea></div>';
  const ta = $('#backup-text'); ta.value = data; ta.focus(); ta.select();
}
async function handleImport(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (e) { toast('That file isn’t a valid backup.'); return; }
  const list = Array.isArray(obj) ? obj : obj && Array.isArray(obj.cards) ? obj.cards : obj && obj.cards && typeof obj.cards === 'object' ? Object.values(obj.cards) : null;
  if (!list) { toast('No cards found in that file.'); return; }
  let n = 0;
  for (const raw of list) {
    if (!raw || typeof raw.hanzi !== 'string' || !raw.hanzi.trim()) continue;
    if (raw.id && !/^[A-Za-z0-9_\-.~:@+]{1,120}$/.test(String(raw.id))) raw.id = newId();
    const c = normalizeCard(raw);
    if (state.tomb.has(c.id)) { c.mod = Date.now(); state.tomb.delete(c.id); }
    const l = state.cards.get(c.id);
    if (!l || c.mod >= l.mod) {
      if (l && !spNewer(c.sp, l.sp)) c.sp = l.sp;
      state.cards.set(c.id, c);
    }
    n++;
  }
  if (obj && obj.logs && typeof obj.logs === 'object' && !Array.isArray(obj.logs)) {
    for (const [d, arr] of Object.entries(obj.logs)) if (Array.isArray(arr)) state.logs.set(d, mergeEntries(state.logs.get(d), arr));
  }
  if (obj && obj.days && typeof obj.days === 'object') {
    for (const [d, v] of Object.entries(obj.days)) state.days.set(d, Math.max(state.days.get(d) || 0, +v || 0));
  }
  if (obj && obj.folders && typeof obj.folders === 'object') {
    Object.values(obj.folders).forEach(f => {
      const id = f && f.id && String(f.id);
      if (id && f.name && !state.folders.has(id) && !state.ftomb.has(id)) state.folders.set(id, { id, name: String(f.name), created: +f.created || Date.now(), mod: Date.now() });
    });
  }
  saveLocalNow();
  Sync.soon(2000);
  Prefetch.add(allTexts());
  toast(n ? `Imported ${n} ${plural(n, 'card')}` : 'No cards found in that file.');
  dataChanged();
}

/* ---------- add pinyin to existing cards ---------- */
function missingPinyin() {
  let n = 0;
  for (const c of state.cards.values()) if ((!c.pinyin && HAN.test(c.hanzi)) || c.sentences.some(x => !x.py && HAN.test(x.zh))) n++;
  return n;
}
async function fillMissing(btn) {
  let JP;
  try { [JP] = await Promise.all([loadPinyin(), loadDecks().catch(() => null)]); }
  catch (e) { toast('Couldn’t load automatic pinyin. Check your connection.'); return; }
  const now = Date.now();
  let n = 0;
  for (const c of state.cards.values()) {
    let ch = false;
    if (!c.pinyin && HAN.test(c.hanzi)) { c.pinyin = autoWordPinyin(JP, c.hanzi); ch = true; }
    c.sentences.forEach(x => { if (!x.py && HAN.test(x.zh)) { x.py = JP.sentence(x.zh); ch = true; } });
    if (ch) { c.mod = now; c.updated = now; n++; }
  }
  saveLocal(); Sync.soon(3000);
  toast(n ? `Added pinyin to ${n} ${plural(n, 'card')}. Check words with more than one reading.` : 'Every card already has pinyin.');
  if (currentView === 'options') renderOptions();
}

/* ---------- import word lists (Anki, Pleco, CSV) ---------- */
let pendingImport = null;
const PY_ONLY = /^[a-zA-ZüÜ:āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ0-5\s'’·,.\-]+$/;
const PY_TONE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ]|[a-zü:][1-5]/i;
function cleanField(v, html) {
  v = String(v || '').replace(/\[sound:[^\]]*\]/g, '');
  if (html || /<[a-z!\/][^>]*>/i.test(v)) {
    v = v.replace(/<br\s*\/?>|<\/div>|<\/p>|<\/li>/gi, ' ').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch (e) { return ''; } }).replace(/&amp;/g, '&');
  }
  return v.replace(/[\uE000-\uF8FF]/g, ' ').replace(/\s+/g, ' ').trim();     // Pleco formatting marks
}
function splitLine(line, sep) {
  if (sep === '\t') return line.split('\t');
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"' && !cur.trim()) { q = true; cur = ''; }
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function normPinyin(p) {
  p = String(p || '').trim();
  if (!p) return '';
  if (/[1-5]/.test(p)) p = p.replace(/([a-zA-ZüÜ:]+?[1-5])(?=[a-zA-ZüÜ])/g, '$1 ');   // Pleco: ni3hao3
  return convertPinyin(p).replace(/\s+/g, ' ').trim().normalize('NFC');
}
function parseWordFile(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  let sep = null, html = false, anki = false, pleco = false, category = '';
  const skip = new Set(), body = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const m = !body.length && line.match(/^#([a-z ]+):(.*)$/i);
    if (m) {                                           // Anki header lines
      anki = true;
      const k = m[1].trim().toLowerCase(), v = m[2].trim();
      if (k === 'separator') sep = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ' }[v.toLowerCase()] || v || null;
      else if (k === 'html') html = v === 'true';
      else if (/column$/.test(k)) { const n = parseInt(v, 10); if (n > 0) skip.add(n - 1); }
      continue;
    }
    if (/^\/\//.test(line)) { pleco = true; category = line.replace(/^\/\/\s*/, '').trim(); continue; }   // Pleco category
    body.push({ line, category });
  }
  if (!body.length) return null;
  if (!sep) {
    const sample = body.slice(0, 60).map(b => b.line), has = ch => sample.filter(l => l.includes(ch)).length;
    sep = has('\t') ? '\t' : has(';') > has(',') ? ';' : has(',') ? ',' : has('|') ? '|' : '\t';
  }
  const rows = body.map(b => ({ cells: splitLine(b.line, sep).map((c, i) => skip.has(i) ? '' : cleanField(c, html)), category: b.category }));
  const ncol = Math.max(...rows.map(r => r.cells.length));
  const stats = [];
  for (let i = 0; i < ncol; i++) {
    let n = 0, han = 0, py = 0, lat = 0, len = 0;
    for (const r of rows.slice(0, 400)) {
      const v = r.cells[i] || '';
      if (!v) continue;
      n++;
      if (HAN.test(v)) { han++; len += Array.from(v.replace(/\[.*?\]/g, '')).length; }
      else if (PY_ONLY.test(v) && PY_TONE.test(v)) py++;
      else if (/[A-Za-z]/.test(v)) lat++;
    }
    stats.push({ i, han: n ? han / n : 0, py: n ? py / n : 0, lat: n ? lat / n : 0, len: han ? len / han : 0 });
  }
  const hanCols = stats.filter(x => x.han >= 0.6).sort((a, b) => a.len - b.len || a.i - b.i);
  if (!hanCols.length) return null;
  const hz = hanCols[0].i;
  const sent = hanCols.find(x => x.i !== hz && x.len >= hanCols[0].len + 3);
  const pyCols = stats.filter(x => x.i !== hz && x.py >= 0.5).sort((a, b) => a.i - b.i);
  const latCols = stats.filter(x => x.i !== hz && x.lat >= 0.5 && !pyCols.includes(x)).sort((a, b) => a.i - b.i);
  const map = {
    hanzi: hz,
    pinyin: (sent ? pyCols.find(x => x.i < sent.i) : null) || pyCols[0] || null,
    english: (sent ? latCols.find(x => x.i < sent.i) : null) || latCols[0] || null,
    sentence: sent || null
  };
  map.sentPy = sent ? pyCols.find(x => x.i > sent.i && x !== map.pinyin) || null : null;
  map.sentEn = sent ? latCols.find(x => x.i > sent.i && x !== map.english) || null : null;
  const get = (r, col) => col ? (r.cells[col.i] || '') : '';
  const out = [], seen = new Set();
  for (const r of rows) {
    let h = (r.cells[hz] || '').replace(/\[.*?\]/g, '').replace(/[（(][^)）]*[)）]/g, '').replace(/\s+/g, '');
    h = Array.from(h).slice(0, 40).join('');
    if (!h || !HAN.test(h) || seen.has(h)) continue;
    seen.add(h);
    const zh = get(r, map.sentence);
    out.push({
      hanzi: h,
      pinyin: normPinyin(get(r, map.pinyin)),
      english: get(r, map.english).slice(0, 300),
      sentences: zh && HAN.test(zh) ? [{ zh, py: normPinyin(get(r, map.sentPy)), en: get(r, map.sentEn) }] : [],
      category: pleco ? r.category : ''
    });
  }
  const cats = [...new Set(out.map(r => r.category).filter(Boolean))];
  return { rows: out, map, format: pleco ? 'Pleco' : anki ? 'Anki' : sep === ',' || sep === ';' ? 'CSV' : 'text', cats };
}
async function handleWordImport(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  let parsed = null;
  try { parsed = parseWordFile(await file.text()); } catch (e) { parsed = null; }
  if (!parsed || !parsed.rows.length) { toast('No Chinese words found in that file.'); return; }
  pendingImport = { ...parsed, name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) };
  openImportSheet();
}
function openImportSheet() {
  const p = pendingImport;
  if (!p) return;
  const have = new Set();
  for (const c of state.cards.values()) have.add(c.hanzi);
  const fresh = p.rows.filter(r => !have.has(r.hanzi)).length, old = p.rows.length - fresh;
  const noPy = p.rows.filter(r => !r.pinyin).length;
  const col = c => c == null ? '<i>not found</i>' : 'column ' + (c.i + 1);
  const sheet = $('#sheet');
  sheet.setAttribute('aria-label', 'Import words');
  sheet.innerHTML = `<div class="sheet-head"><button class="link" data-act="sheet-close">Cancel</button><strong>Import words</strong><button class="link strong" data-act="import-apply">Import</button></div>
    <div class="sheet-body wrap">
      <p class="sched-info">Found ${p.rows.length} ${plural(p.rows.length, 'word')} in “${esc(p.name)}” (${esc(p.format)}). ${fresh} ${plural(fresh, 'is', 'are')} new${old ? `, and ${old} you already have keep their progress` : ''}.</p>
      <p class="muted imp-map">Hanzi: ${col({ i: p.map.hanzi })} · Pinyin: ${col(p.map.pinyin)} · Meaning: ${col(p.map.english)}${p.map.sentence ? ' · Example: ' + col(p.map.sentence) : ''}</p>
      <div class="list imp-preview">${p.rows.slice(0, 5).map(r => `<div class="row"><span class="rh" lang="zh-CN">${esc(r.hanzi)}</span>
        <span class="rm"><span class="rp">${r.pinyin ? pinyinHTML(r.pinyin) : '&nbsp;'}</span><span class="re">${esc(r.english) || '&nbsp;'}</span></span><span></span></div>`).join('')}</div>
      ${noPy && state.settings.autoPinyin ? `<p class="hint">${noPy} ${plural(noPy, 'word has', 'words have')} no pinyin. It’s filled in automatically.</p>` : ''}
      <label class="switch field"><span>Practice the new words<span class="hint">New words come in at your limit of ${state.settings.newPerDay} a day.</span></span><input type="checkbox" id="imp-practice" checked></label>
      ${p.cats.length ? `<label class="switch field"><span>Keep Pleco categories as folders<span class="hint">${p.cats.length} ${plural(p.cats.length, 'category', 'categories')}: ${esc(p.cats.slice(0, 4).join(', '))}${p.cats.length > 4 ? '…' : ''}</span></span><input type="checkbox" id="imp-cats" checked></label>` : ''}
      <div class="field">
        <label class="lbl" for="imp-folder">Put them in a folder <span class="opt">optional</span></label>
        <input class="in" id="imp-folder" maxlength="40" autocomplete="off" value="${esc(p.name)}">
        <span class="hint">Leave it empty to add the words without a folder.</span>
      </div>
      <button class="btn" data-act="import-apply">Import ${p.rows.length} ${plural(p.rows.length, 'word')}</button>
    </div>`;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  document.body.classList.add('sheet-open');
}
async function applyImport() {
  const p = pendingImport;
  if (!p) return;
  const practice = $('#imp-practice').checked, keepCats = $('#imp-cats') ? $('#imp-cats').checked : false;
  const fname = ($('#imp-folder').value || '').trim();
  if (state.settings.autoPinyin && p.rows.some(r => !r.pinyin || r.sentences.some(x => !x.py))) {
    try {
      const [JP] = await Promise.all([loadPinyin(), loadDecks().catch(() => null)]);
      for (const r of p.rows) {
        if (!r.pinyin) r.pinyin = autoWordPinyin(JP, r.hanzi);
        r.sentences.forEach(x => { if (!x.py) x.py = JP.sentence(x.zh); });
      }
    } catch (e) {}
  }
  const byName = new Map(sortedFolders().map(f => [f.name, f.id]));
  const folderFor = name => byName.get(name) || (byName.set(name, createFolder(name)), byName.get(name));
  const byHanzi = new Map();
  for (const c of state.cards.values()) byHanzi.set(c.hanzi, c);
  const now = Date.now(), texts = [];
  let added = 0, had = 0;
  p.rows.forEach((r, i) => {
    const fids = [];
    if (fname) fids.push(folderFor(fname.slice(0, 40)));
    if (keepCats && r.category) fids.push(folderFor(r.category.slice(0, 40)));
    const old = byHanzi.get(r.hanzi);
    if (old) {
      had++;
      const miss = fids.filter(f => !old.folders.includes(f));
      if (miss.length) { old.folders = [...old.folders, ...miss]; old.mod = now; }
      return;
    }
    const c = normalizeCard({ id: newId(), hanzi: r.hanzi, pinyin: r.pinyin, english: r.english, sentences: r.sentences, practice, folders: fids, created: now + i, updated: now, mod: now, ...blankSchedule() });
    state.cards.set(c.id, c);
    byHanzi.set(c.hanzi, c);
    if (practice) texts.push(...cardTexts(c));
    added++;
  });
  saveLocalNow(); Sync.soon(2000);
  if (texts.length) Prefetch.add(texts);
  closeEditor();
  toast(`Imported ${added} new ${plural(added, 'word')}.` + (had ? ` ${had} you already had kept their progress.` : ''));
  dataChanged();
}

/* ---------- microphone (speaking practice) ---------- */
// The app opens the microphone itself and keeps it open between words, so iOS asks for permission
// once per study session instead of on every tap. Audio is captured at the device's own sample rate
// and converted to 16 kHz 16-bit mono here, then pushed to Azure.
const MIC_IDLE_MS = 60000;   // close the mic after this long without speaking practice
const MIC_CHUNK = 640;       // 40 ms at 16 kHz
const MIC_WORKLET = `class JiyiMic extends AudioWorkletProcessor {
  constructor() { super(); this.r = sampleRate / 16000; this.t = 1; this.last = 0; this.buf = new Int16Array(${MIC_CHUNK}); this.n = 0; this.peak = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      while (this.t <= 1) {
        let y = this.last + (x - this.last) * this.t;
        if (y > 1) y = 1; else if (y < -1) y = -1;
        const a = y < 0 ? -y : y;
        if (a > this.peak) this.peak = a;
        this.buf[this.n++] = y < 0 ? y * 32768 : y * 32767;
        if (this.n === this.buf.length) {
          this.port.postMessage({ pcm: this.buf.buffer, peak: this.peak }, [this.buf.buffer]);
          this.buf = new Int16Array(${MIC_CHUNK}); this.n = 0; this.peak = 0;
        }
        this.t += this.r;
      }
      this.t -= 1; this.last = x;
    }
    return true;
  }
}
registerProcessor('jiyi-mic', JiyiMic);`;
// Same conversion on the main thread, for browsers without AudioWorklet.
function micResampler(rate, emit) {
  const r = rate / 16000;
  let t = 1, last = 0, buf = new Int16Array(MIC_CHUNK), n = 0, peak = 0;
  return ch => {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      while (t <= 1) {
        let y = last + (x - last) * t;
        if (y > 1) y = 1; else if (y < -1) y = -1;
        const a = y < 0 ? -y : y;
        if (a > peak) peak = a;
        buf[n++] = y < 0 ? y * 32768 : y * 32767;
        if (n === buf.length) { emit(buf.buffer, peak); buf = new Int16Array(MIC_CHUNK); n = 0; peak = 0; }
        t += r;
      }
      t -= 1; last = x;
    }
  };
}
const Mic = {
  ctx: null, stream: null, src: null, lp: null, node: null, gum: null, mod: null, worklet: false,
  url: null, idle: null, gen: 0,
  held() { return !!(this.stream || this.gum); },
  live() { return !!this.stream && this.stream.getAudioTracks().some(t => t.readyState === 'live'); },
  // Must be called straight from the tap, before any await: iOS only starts audio inside a tap.
  prepare() {
    clearTimeout(this.idle); this.idle = null;
    const AC = window.AudioContext || window.webkitAudioContext;
    const md = navigator.mediaDevices;
    if (!AC || !md || !md.getUserMedia) return Promise.reject(new Error('microphone unsupported'));
    setAudioSession('play-and-record');
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AC();
      this.src = this.lp = null; this.mod = null; this.worklet = false;
    }
    const ctx = this.ctx, gen = this.gen;
    if (ctx.state !== 'running') { try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    if (!this.mod) {
      if (ctx.audioWorklet && window.AudioWorkletNode) {
        if (!this.url) this.url = URL.createObjectURL(new Blob([MIC_WORKLET], { type: 'application/javascript' }));
        this.mod = ctx.audioWorklet.addModule(this.url).then(() => { if (ctx === this.ctx) this.worklet = true; }, () => {});
      } else this.mod = Promise.resolve();
    }
    if (!this.live() && !this.gum) {
      const g = md.getUserMedia({ audio: { echoCancellation: false }, video: false }).then(s => {
        if (gen !== this.gen) { s.getTracks().forEach(t => t.stop()); throw new Error('stopped'); }
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        this.stream = s; this.src = this.lp = null;
        s.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (this.stream === s) this.release(); }));
        return s;
      });
      this.gum = g;
      g.then(() => { if (this.gum === g) this.gum = null; }, () => { if (this.gum === g) this.gum = null; });
    }
    return Promise.all([this.gum, this.mod]).then(() => {
      if (ctx !== this.ctx || !this.live()) throw new Error('stopped');
      if (ctx.state === 'running') return;
      // Now that the mic is capturing, iOS lets the audio context start even outside the tap.
      return Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 3000))]).then(() => {
        if (ctx.state !== 'running') throw new Error('microphone not running');
      });
    });
  },
  start(onChunk) {
    clearTimeout(this.idle); this.idle = null;
    const ctx = this.ctx;
    if (!ctx || !this.live()) throw new Error('microphone not running');
    if (!this.src) {
      this.src = ctx.createMediaStreamSource(this.stream);
      this.lp = ctx.createBiquadFilter();   // removes what 16 kHz can't hold before converting
      this.lp.type = 'lowpass';
      this.lp.frequency.value = Math.min(7000, ctx.sampleRate * 0.45);
      this.lp.Q.value = 0.707;
      this.src.connect(this.lp);
    }
    this.detach();
    let node;
    if (this.worklet) {
      node = new AudioWorkletNode(ctx, 'jiyi-mic', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = e => onChunk(e.data.pcm, e.data.peak);
    } else {
      node = ctx.createScriptProcessor(4096, 1, 1);
      const feed = micResampler(ctx.sampleRate, onChunk);
      node.onaudioprocess = e => feed(e.inputBuffer.getChannelData(0));
    }
    this.lp.connect(node);
    node.connect(ctx.destination);   // outputs silence; keeps the node running
    this.node = node;
  },
  detach() {
    const n = this.node;
    this.node = null;
    if (!n) return;
    try { this.lp.disconnect(n); } catch (e) {}
    try { n.disconnect(); } catch (e) {}
    if (n.port) n.port.onmessage = null; else n.onaudioprocess = null;
  },
  // Stop listening but keep the mic open for the next word.
  stop() {
    this.detach();
    clearTimeout(this.idle);
    this.idle = this.held() ? setTimeout(() => this.release(), MIC_IDLE_MS) : null;
  },
  release() {
    this.gen++;
    clearTimeout(this.idle); this.idle = null;
    this.detach();
    if (this.stream) this.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
    this.stream = this.src = this.lp = null; this.gum = null;
    if (this.ctx) { try { const p = this.ctx.close(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    this.ctx = null; this.mod = null; this.worklet = false;
    setAudioSession('playback');
  }
};

/* ---------- speaking practice (Azure pronunciation assessment) ---------- */
let paBusy = false, paStop = null;
function paBox(btn) {
  const ex = btn.closest('.ex-view');
  if (ex) return ex.querySelector('[data-pa]');
  const ans = btn.closest('.answer');
  return ans ? ans.querySelector(':scope > [data-pa]') : null;
}
const paClass = v => v >= 80 ? 'ok' : v >= 60 ? 'mid' : 'bad';
const paNum = v => v == null || isNaN(v) ? '–' : String(Math.round(v));
function paHTML(par, heard) {
  const score = par.pronunciationScore != null ? par.pronunciationScore : par.accuracyScore;
  const det = par.detailResult || {};
  const ws = Array.isArray(det.Words) ? det.Words : [];
  const chips = ws.map(w => {
    const a = w.PronunciationAssessment || {}, err = a.ErrorType && a.ErrorType !== 'None' ? a.ErrorType : '';
    const v = a.AccuracyScore;
    const cls = err === 'Omission' ? 'bad' : err === 'Insertion' ? 'mid' : paClass(v || 0);
    const label = err === 'Omission' ? 'missed' : err === 'Insertion' ? 'extra' : paNum(v);
    return `<span class="pa-w ${cls}"><b lang="zh-CN">${esc(w.Word)}</b><small>${label}</small></span>`;
  }).join('');
  const weak = ws.filter(w => { const a = w.PronunciationAssessment || {}; return (a.ErrorType && a.ErrorType !== 'None') || (a.AccuracyScore || 0) < 80; });
  return `<div class="pa-top"><span class="pa-score ${paClass(score || 0)}">${paNum(score)}</span>
      <span class="pa-sub">Accuracy ${paNum(par.accuracyScore)} · Fluency ${paNum(par.fluencyScore)} · Completeness ${paNum(par.completenessScore)}</span></div>
    ${chips ? `<div class="pa-words">${chips}</div>` : ''}
    ${heard ? `<p class="pa-heard">Heard: <span lang="zh-CN">${esc(heard)}</span></p>` : ''}
    <p class="pa-tip">${(score || 0) >= 85 && !weak.length ? 'Sounds good.' : weak.length ? `Work on ${weak.slice(0, 3).map(w => esc(w.Word)).join(', ')}: listen again, copy the tones, then try once more.` : 'Listen again, copy the tones, then try once more.'}</p>`;
}
function paError(e) {
  const m = String((e && (e.message || e.name)) || e || '');
  if (/notallowed|permission|denied/i.test(m)) return 'Allow microphone access for this app, then try again.';
  if (/1006|unable to contact|connection/i.test(m)) return 'Couldn’t reach Azure. Check your connection and try again.';
  if (/401|403|auth|subscription|key/i.test(m)) return 'Azure didn’t accept the key. Check it in Options.';
  if (/microphone|audio source|getusermedia|notfound|notreadable|device/i.test(m)) return 'Couldn’t use the microphone. Check that no other app is using it.';
  if (m === 'timeout') return 'Azure took too long to answer. Try again.';
  if (/sdk did not load/i.test(m)) return 'The speech library didn’t load. Check your connection.';
  return 'Couldn’t check your pronunciation. Check your connection and try again.';
}
const paLevel = (el, peak) => { if (el) el.style.transform = `scaleX(${Math.min(1, Math.sqrt(peak) * 1.3).toFixed(3)})`; };
async function assess(ref, btn) {
  ref = String(ref || '').trim();
  if (paBusy) { if (paStop) paStop(); return; }   // a second tap stops listening
  if (!ref) return;
  if (!azureReady()) { toast('Add an Azure key in Options to use speaking practice.'); return; }
  if (!navigator.onLine) { toast('Speaking practice needs a connection.'); return; }
  let micReady;
  try { micReady = Mic.prepare(); } catch (e) { micReady = Promise.reject(e); }   // still inside the tap
  micReady.catch(() => {});
  const box = paBox(btn);
  paBusy = true;
  stopAudio();
  const orig = btn.innerHTML;
  btn.classList.add('rec');
  if (btn.classList.contains('pill')) btn.innerHTML = ICON.mic + 'Stop';
  if (box) { box.hidden = false; box.innerHTML = '<p class="pa-wait">Starting the microphone…</p>'; }
  let rec = null, push = null, ended = false, cap = null;
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimeout(cap);
    Mic.stop();
    if (push) { try { push.close(); } catch (e) {} }
  };
  paStop = finish;
  try {
    const [sdk] = await Promise.all([loadSdk(), micReady]);
    if (ended) throw new Error('stopped');
    const cfg = sdk.SpeechConfig.fromSubscription(prefs.azKey, prefs.azRegion);
    cfg.speechRecognitionLanguage = 'zh-CN';
    push = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1));
    rec = new sdk.SpeechRecognizer(cfg, sdk.AudioConfig.fromStreamInput(push));
    const pa = new sdk.PronunciationAssessmentConfig(ref, sdk.PronunciationAssessmentGradingSystem.HundredMark, sdk.PronunciationAssessmentGranularity.Phoneme, true);
    pa.applyTo(rec);
    if (box) box.innerHTML = '<p class="pa-wait">Listening… say it now.</p><div class="pa-lvl" aria-hidden="true"><i></i></div>';
    const lvl = box ? box.querySelector('.pa-lvl i') : null;
    Mic.start((pcm, peak) => {
      if (ended) return;
      try { push.write(pcm); } catch (e) {}
      paLevel(lvl, peak);
    });
    cap = setTimeout(finish, 12000);   // stop listening after 12 s; Azure then scores what it heard
    const r = await new Promise((resolve, reject) => {
      const guard = setTimeout(() => reject(new Error('timeout')), 25000);
      rec.recognizeOnceAsync(x => { clearTimeout(guard); resolve(x); }, err => { clearTimeout(guard); reject(new Error(String(err))); });
    });
    finish();
    if (r.reason === sdk.ResultReason.RecognizedSpeech) {
      const par = sdk.PronunciationAssessmentResult.fromResult(r);
      if (box) box.innerHTML = paHTML(par, r.text);
    } else if (r.reason === sdk.ResultReason.NoMatch) {
      if (box) box.innerHTML = '<p class="pa-wait">Didn’t catch that. Tap Say it and try again.</p>';
    } else {
      let detail = '';
      try { const cd = sdk.CancellationDetails.fromResult(r); detail = (cd.errorDetails || '') + ' ' + (cd.errorCode != null ? cd.errorCode : ''); } catch (e) {}
      throw new Error(detail || 'canceled');
    }
  } catch (e) {
    const m = String((e && e.message) || '');
    if (box) {
      if (m === 'stopped') { box.innerHTML = ''; box.hidden = true; }
      else box.innerHTML = `<p class="pa-wait err">${esc(paError(e))}</p>`;
    }
    // A failed or denied microphone shouldn't stay half-open.
    if (m !== 'stopped' && !Mic.live()) Mic.release();
  } finally {
    finish();
    if (rec) { try { rec.close(); } catch (e) {} }
    paStop = null;
    paBusy = false;
    btn.classList.remove('rec');
    btn.innerHTML = orig;
  }
}

/* ---------- views ---------- */
const VIEWS = ['study', 'add', 'cards', 'stats', 'options'];
function showView(name) {
  if (!VIEWS.includes(name)) name = 'study';
  if (name !== 'study') { if (paStop) paStop(); Mic.release(); }
  currentView = name;
  VIEWS.forEach(v => { $('#view-' + v).hidden = v !== name; });
  $$('.tab').forEach(t => { if (t.dataset.view === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  if (name === 'options') $('#opt-btn').setAttribute('aria-current', 'page'); else $('#opt-btn').removeAttribute('aria-current');
  if (name !== 'study') setActions(name === 'add' ? addActions() : '');
  if (name === 'study') renderStudy();
  else if (name === 'add') renderAdd();
  else if (name === 'cards') renderCards();
  else if (name === 'stats') renderStats();
  else renderOptions();
  $('#main').scrollTop = 0;
}
function dataChanged() {
  if (currentView === 'study') renderStudy();
  else if (currentView === 'cards') { renderChips(); renderCardList(); }
  else if (currentView === 'add' && addMode === 'decks') renderDecks();
  else if (currentView === 'stats') renderStats();
  else if (currentView === 'options') { renderSyncUI(); renderAzureStatus(); }
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  switch (t.dataset.act) {
    case 'show': reveal(); break;
    case 'sp-hint': showHint(); break;
    case 'rate': rate(+t.dataset.g); break;
    case 'undo': undo(); break;
    case 'say': if (t.id === 'front-listen') study.heard = true; speak(t.dataset.say, t.dataset.slow === '1', t); break;
    case 'say-input': speak(t.closest('.with-btn').querySelector('input').value, false, t); break;
    case 'say-ex': speak(t.closest('.ex').querySelector('[data-k="zh"]').value, t.dataset.slow === '1', t); break;
    case 'add-ex': addExBlock(t.closest('.form').querySelector('.ex-list'), null, true); break;
    case 'rm-ex': t.closest('.ex').remove(); break;
    case 'tab': if (editing) closeEditor(); showView(t.dataset.view); break;
    case 'save-new': saveNew(); break;
    case 'open-card': openEditor(t.dataset.id); break;
    case 'edit-current': if (study.id) openEditor(study.id); break;
    case 'sheet-close': closeEditor(); break;
    case 'sheet-save': saveEditor(); break;
    case 'delete-card': if (editing) { const id = editing.id; armed(t, 'Tap again to delete', () => deleteCard(id)); } break;
    case 'reset-card': if (editing) { const id = editing.id; armed(t, 'Tap again to reset', () => resetCard(id)); } break;
    case 'example-card': addExampleCard(); break;
    case 'wfilter': words.filter = t.dataset.f; words.mode = 'list'; words.tools = ''; renderCards(); break;
    case 'new-folder': words.tools = 'new'; words.mode = 'list'; renderFolderTools(); break;
    case 'folder-create': {
      const name = ($('#folder-name').value || '').trim();
      if (!name) { $('#folder-name').focus(); break; }
      words.filter = createFolder(name); words.tools = ''; words.mode = 'pick';
      renderCards();
      toast(`Folder “${name}” created. Tap words to add them.`);
      break;
    }
    case 'folder-rename': words.tools = 'rename'; renderFolderTools(); break;
    case 'folder-rename-save': { const name = ($('#folder-name').value || '').trim(); if (name) renameFolder(words.filter, name); words.tools = ''; renderCards(); break; }
    case 'folder-tools-cancel': words.tools = ''; renderFolderTools(); break;
    case 'folder-delete': { const id = words.filter; armed(t, 'Tap again to delete', () => { deleteFolder(id); words.filter = 'practice'; words.mode = 'list'; renderCards(); toast('Folder deleted. Its words are still in All words.'); }); break; }
    case 'folder-study': prefs.scope = words.filter; savePrefs(); cram = null; study = { id: null, dir: 'r', revealed: false, animate: false }; showView('study'); break;
    case 'pick-start': words.mode = 'pick'; renderFolderTools(); renderCardList(); break;
    case 'pick-done': words.mode = 'list'; renderCards(); break;
    case 'pick-toggle': togglePick(t); break;
    case 'fchip-toggle': t.setAttribute('aria-pressed', String(t.getAttribute('aria-pressed') !== 'true')); break;
    case 'add-mode': setAddMode(t.dataset.mode); break;
    case 'go-decks': addMode = 'decks'; showView('add'); setAddMode('decks'); break;
    case 'deck-add': addDeck(t.dataset.deck); break;
    case 'deck-open': openDeck(t.dataset.deck); break;
    case 'decks-retry': renderDecks(); break;
    case 'fill-py': autoFillWord(t.closest('.form'), true); break;
    case 'fill-missing': fillMissing(t); break;
    case 'pick-practice': togglePractice(t); break;
    case 'pick-all': pickAll(true); break;
    case 'pick-none': armed(t, 'Tap again to stop', () => pickAll(false)); break;
    case 'import-words': $('#import-words-file').click(); break;
    case 'import-apply': applyImport(); break;
    case 'assess': assess(t.dataset.ref, t); break;
    case 'bulk-add': bulkAdd(); break;
    case 'cram-start': startCram(scopeValid()); break;
    case 'cram-stop': cram = null; study = { id: null, dir: 'r', revealed: false, animate: false }; renderStudy(); break;
    case 'more-new': moreNew(); break;
    case 'study-ahead': { const it = queues(Date.now()).learnSoon[0]; if (it) { study = { id: it.id, dir: it.dir, revealed: false, animate: false, fresh: true }; renderStudy(); } break; }
    case 'export': exportData(); break;
    case 'import': $('#import-file').click(); break;
    case 'az-save': azureSave(); break;
    case 'az-all': { const n = Prefetch.add(allTexts()); if (!n && !Prefetch.running) renderAzureStatus('Every card already has audio for this voice.', 'ok'); break; }
    case 'az-remove': armed(t, 'Tap again to remove', () => {
      prefs.azKey = ''; prefs.azRegion = ''; if (String(prefs.voice).startsWith('azure:')) prefs.voice = '';
      savePrefs(); dropSynth(); renderOptions(); toast('Azure key removed');
    }); break;
    case 'az-clear': armed(t, 'Tap again to clear', async () => { await AudioCache.clear(); renderAzureStatus(); toast('Saved audio cleared'); }); break;
    case 'gh-save': githubConnect(); break;
    case 'gh-disconnect': armed(t, 'Tap again to disconnect', () => {
      prefs.ghToken = ''; prefs.gistId = ''; savePrefs(); Sync.set('off'); renderOptions();
      toast('Sync disconnected. Your cards stay on this device.');
    }); break;
    case 'sync-now': if (Sync.state === 'error') toast(Sync.msg); Sync.run(); break;
    case 'num': {
      const inp = t.closest('.stepper').querySelector('input');
      inp.value = clamp((parseInt(inp.value, 10) || 0) + (+t.dataset.d), 0, 999);
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      break;
    }
  }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.matches('[data-pinyin]') && !e.isComposing) {
    const v = t.value;
    if (/[0-5]/.test(v)) {
      const pos = t.selectionStart == null ? v.length : t.selectionStart;
      const before = convertPinyin(v.slice(0, pos)), after = convertPinyin(v.slice(pos));
      if (before + after !== v) { t.value = before + after; try { t.setSelectionRange(before.length, before.length); } catch (err) {} }
    }
  } else if (t.matches('[data-k="hanzi"]')) {
    checkDup(t);
    if (!e.isComposing) { const form = t.closest('.form'); scheduleAuto(t, () => autoFillWord(form, false)); }
  } else if (t.matches('.ex [data-k="zh"]')) {
    if (!e.isComposing) { const block = t.closest('.ex'); scheduleAuto(t, () => autoFillSentence(block)); }
  }
  else if (t.id === 'search') renderCardList();
  else if (t.id === 'opt-rate') $('#rate-val').textContent = parseFloat(t.value).toFixed(2) + '×';
  else if (t.id === 'opt-ret') $('#ret-val').textContent = Math.round(parseFloat(t.value) * 100) + '%';
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'import-file') { handleImport(t); return; }
  if (t.id === 'import-words-file') { handleWordImport(t); return; }
  if (t.id === 'pick-in') { words.pickIn = t.value; renderCardList(); return; }
  if (t.id === 'deck-practice') { deckPractice = t.checked; return; }
  if (t.id === 'scope') { prefs.scope = t.value; savePrefs(); cram = null; study = { id: null, dir: 'r', revealed: false, animate: false }; renderStudy(); return; }
  if (t.dataset && t.dataset.pref === 'voice') {
    prefs.voice = t.value;
    const v = t.value.startsWith('device:') ? TTS.voices.find(x => x.voiceURI === t.value.slice(7)) : null;
    prefs.voiceName = v ? v.name : '';
    savePrefs();
    $('#voice-hint').textContent = voiceHint(currentVoice());
    speak('你好，很高兴认识你。', false, null);
    Prefetch.add(allTexts());
    return;
  }
  const k = t.dataset && t.dataset.set;
  if (!k) return;
  const s = { ...state.settings };
  if (k === 'autoplayWhen') {
    s.autoplayWhen = ['front', 'back', 'off'].includes(t.value) ? t.value : 'back';
    s.autoplay = s.autoplayWhen !== 'off';          // keeps older versions of the app consistent
    const h = $('#autoplay-hint'); if (h) h.innerHTML = AUTOPLAY_HINTS[s.autoplayWhen];
  }
  else if (k === 'autoplay' || k === 'toneColors' || k === 'autoPinyin') s[k] = t.checked;
  else if (k === 'speakCards') { s.speakCards = t.checked; const f = $('#sp-new-field'); if (f) f.hidden = !t.checked; }
  else if (k === 'speakNewPerDay') { s.speakNewPerDay = clamp(parseInt(t.value, 10) || 0, 0, 999); t.value = s.speakNewPerDay; }
  else if (k === 'rate') s.rate = clamp(parseFloat(t.value) || 0.9, 0.5, 1.3);
  else if (k === 'retention') s.retention = clamp(parseFloat(t.value) || 0.9, 0.8, 0.97);
  else if (k === 'newPerDay') { s.newPerDay = clamp(parseInt(t.value, 10) || 0, 0, 999); t.value = s.newPerDay; }
  state.settings = s;
  persistSettings();
});
document.addEventListener('compositionend', e => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.matches('[data-k="hanzi"]')) { const form = t.closest('.form'); scheduleAuto(t, () => autoFillWord(form, false)); }
  else if (t.matches('.ex [data-k="zh"]')) { const block = t.closest('.ex'); scheduleAuto(t, () => autoFillSentence(block)); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target && e.target.id === 'folder-name') { e.preventDefault(); const b = $('#folder-tools .btn'); if (b) b.click(); return; }
  if (currentView !== 'study' || editing) return;
  if (e.target.closest && e.target.closest('input,textarea,select')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!study.id) return;
  if (!study.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
  else if (!study.revealed && (e.key === 'h' || e.key === 'H') && study.dir === 's') { e.preventDefault(); showHint(); }
  else if (study.revealed && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); rate(+e.key); }
  else if (study.revealed && (e.key === ' ' || e.key === 'Enter') && !e.target.closest('button')) { e.preventDefault(); rate(3); }
  else if (e.key === 'z' && lastUndo) undo();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (paStop) paStop();
    Mic.release();
    saveLocalNow();
    if (Sync.enabled() && Sync.dirtySince) Sync.run();
  } else {
    if (currentView === 'study' && !study.revealed) renderStudy();
    if (Sync.enabled()) Sync.run();
  }
});
window.addEventListener('pagehide', saveLocalNow);
window.addEventListener('online', () => { if (Sync.enabled()) Sync.run(); Prefetch.run(); });
setInterval(() => {
  if (document.visibilityState === 'visible' && Sync.enabled() && !Sync.running) Sync.run();
  else if (currentView === 'options') renderSyncUI();
}, 60000);

const dock = $('#dock');
const setDockH = () => document.documentElement.style.setProperty('--dock-h', dock.offsetHeight + 'px');
if ('ResizeObserver' in window) new ResizeObserver(setDockH).observe(dock);
setDockH();

/* ---------- boot ---------- */
loadLocal();
const startView = (location.hash || '').slice(1);
showView(VIEWS.includes(startView) ? startView : 'study');
renderSyncUI();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
AudioCache.open().then(() => { if (currentView === 'options') renderAzureStatus(); });
if (Sync.enabled()) Sync.run();
setTimeout(() => Prefetch.add(allTexts()), 3000);
})();
