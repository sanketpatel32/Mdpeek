// v0.45.0: Document statistics for the stats side panel.
//
// Extends wordCount (which only does words/chars/read-time) with paragraphs,
// sentences, average sentence length, estimated speaking time, and a count of
// "long" words (6+ chars — a rough proxy for reading difficulty). Pure +
// DOM-free so it's unit-testable. Reuses stripMarkdown so the same regex
// pipeline backs wordCount, copy-as-plain-text, and this panel.
//
// v0.72.0 UI-polish iteration adds a presentation layer ON TOP of the math
// (nothing above changes): number parsing/formatting helpers, a count-up
// animator, skeleton markup, and initStatsPolish() — an idempotent enhancer
// for #doc-stats that layers open-animation polish over whatever main.js
// renders. It injects one id-guarded <style> and is a silent no-op where the
// anchors are missing (e.g. the jsdom unit tests).
import { stripMarkdown } from './strip.js';

// Reading rate (words per minute) for silent reading. Matches the 200 wpm
// used by wordCount so the status-bar chip and this panel agree.
const READ_WPM = 200;
// Speaking rate is slower than reading — presentations, narration, audiobook
// pacing. 130 wpm is the commonly cited average for English aloud.
const SPEAK_WPM = 130;

export function computeStats(text) {
  const src = text || '';
  const stripped = stripMarkdown(src);
  // Latin words = runs of word chars (incl. accented + apostrophes/hyphens).
  // Exclude CJK ranges so each CJK ideograph is counted once (by the cjk
  // branch below), not bundled into a latin word.
  const latin = (stripped.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [])
    .filter((w) => !/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(w));
  const cjk = (stripped.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []);
  const words = latin.length + cjk.length;
  const chars = src.replace(/\s/g, '').length;
  // Paragraphs: non-empty blocks separated by a blank line. Empty input → 0.
  const paragraphs = src.split(/\n\s*\n/).filter((b) => b.trim().length > 0).length;
  // Sentences: count terminal-punctuation runs. Crude but fine for a stat
  // panel (abbreviations like "Dr." will over-count slightly).
  const sentencePunct = (stripped.match(/[.!?]+/g) || []).length;
  const sentences = sentencePunct > 0 ? sentencePunct : (words > 0 ? 1 : 0);
  const avgWordsPerSentence = sentences > 0 ? Math.round((words / sentences) * 10) / 10 : 0;
  // Long words: 6+ chars in the latin word list (CJK ideographs don't apply).
  const longWords = latin.filter((w) => w.length >= 6).length;
  const readMins = words > 0 ? Math.max(1, Math.round(words / READ_WPM)) : 0;
  const speakMins = words > 0 ? Math.max(1, Math.round(words / SPEAK_WPM)) : 0;
  return { words, chars, paragraphs, sentences, avgWordsPerSentence, longWords, readMins, speakMins };
}

// v0.46.0: Deeper document insights for the stats panel — word frequency,
// lexical diversity, and the longest sentence. Reuses stripMarkdown + the same
// CJK-aware word extraction as computeStats. Carries a small built-in English
// stopword set so the "top words" list surfaces meaningful terms, not "the".
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'to', 'in',
  'on', 'at', 'by', 'for', 'with', 'about', 'as', 'into', 'like', 'through',
  'after', 'over', 'between', 'out', 'against', 'during', 'without', 'before',
  'under', 'around', 'among', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could',
  'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'it', 'we', 'they', 'them', 'his', 'her', 'its', 'our', 'their',
  'my', 'your', 'what', 'which', 'who', 'whom', 'where', 'when', 'why', 'how',
  'all', 'each', 'every', 'some', 'any', 'no', 'not', 'so', 'than', 'too', 'very',
  'just', 'also', 'from', 'up', 'down', 'off', 'here', 'there', 'your', 'yours',
]);

export function computeInsights(text, { topN = 10 } = {}) {
  const src = text || '';
  const stripped = stripMarkdown(src);
  // Same word extraction as computeStats (latin runs, CJK filtered out so the
  // frequency map isn't dominated by single ideographs — those already get
  // their own word count).
  const latin = (stripped.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [])
    .filter((w) => !/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(w))
    .map((w) => w.toLowerCase());
  const totalWords = latin.length;
  // Frequency map over non-stopwords (≥3 chars so fluff like "ok" is excluded).
  const freq = new Map();
  for (const w of latin) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([word, n]) => ({ word, n }));
  // Lexical diversity: unique words / total words. 0–1; higher = more varied.
  const uniqueWords = new Set(latin).size;
  const lexicalDiversity = totalWords > 0 ? Math.round((uniqueWords / totalWords) * 100) / 100 : 0;
  // Longest sentence (by word count). Splits the stripped text on terminal
  // punctuation, then counts words per chunk.
  const chunks = stripped.split(/[.!?]+/).map((c) => c.trim()).filter(Boolean);
  let longestSentence = 0;
  for (const c of chunks) {
    const n = (c.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || []).length;
    if (n > longestSentence) longestSentence = n;
  }
  return { topWords, uniqueWords, totalWords, lexicalDiversity, longestSentence };
}

// ===================== v0.72.0: presentation layer ==========================
// Parsing/formatting + DOM polish for #doc-stats. The computations above are
// untouched — everything here only re-presents values that already rendered.

// Parse a rendered stat value into an animatable number: "1,234" →
// { value: 1234, decimals: 0, prefix: '', suffix: '' }; "12 min" keeps its
// suffix; "85 (Easy)" keeps its suffix too; "—" → null (nothing to animate).
// Pure → unit-tested.
export function parseStatNumber(text) {
  const s = String(text ?? '').trim();
  const m = s.match(/^([^\d,-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const value = parseFloat(m[2].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const decimalPart = m[2].split('.')[1];
  return {
    value,
    decimals: decimalPart ? decimalPart.length : 0,
    prefix: m[1],
    suffix: m[3],
  };
}

// Inverse of parseStatNumber's numeric core: locale grouping + fixed decimals,
// with the original prefix/suffix wrapped back around it.
export function formatStatNumber(value, decimals = 0, prefix = '', suffix = '') {
  const n = Number(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${prefix}${n}${suffix}`;
}

// Skeleton markup matching the panel's two-column label/value grid. Shipped as
// infrastructure: computeStats renders synchronously today, but if stats ever
// move off-thread (huge docs) this is the ready-made loading state.
export function statSkeletonHtml(rows = 6) {
  let html = '<div class="sp-skel-title"></div>';
  for (let i = 0; i < rows; i++) {
    const w1 = 44 + ((i * 17) % 26); // deterministic pseudo-varied widths
    const w2 = 18 + ((i * 29) % 22);
    html +=
      `<div class="sp-skel sp-skel-label" style="width:${w1}%"></div>` +
      `<div class="sp-skel sp-skel-value" style="width:${w2}%"></div>`;
  }
  return html;
}

// Count one stat value up from 0 (or near-0) to `target` with an ease-out
// cubic, preserving prefix/suffix and decimal precision. Cancels any prior
// animation on the element; under prefers-reduced-motion it snaps instantly.
export function animateStatValue(el, target, { duration = 550 } = {}) {
  if (!el) return;
  const parsed = typeof target === 'string' ? parseStatNumber(target) : target;
  if (!parsed) return;
  const { value, decimals, prefix, suffix } = parsed;
  const reduced =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  const write = (v) => { el.textContent = formatStatNumber(v, decimals, prefix, suffix); };
  if (reduced || duration <= 0 || value === 0) { write(value); return; }

  const prior = _statAnims.get(el);
  if (prior) cancelAnimationFrame(prior.raf);
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    write(value * eased);
    if (t < 1) entry.raf = requestAnimationFrame(tick);
    else _statAnims.delete(el);
  };
  const entry = { raf: requestAnimationFrame(tick) };
  _statAnims.set(el, entry);
}
const _statAnims = new WeakMap();

let _statsPolishInstalled = false;
const STATS_POLISH_STYLE_ID = 'mdpeek-stats-polish-css';

// One injected stylesheet, scoped under .sp-on on #doc-stats so base.css rules
// keep working untouched. Tokens carry fallbacks everywhere.
function injectStatsPolishCss() {
  if (document.getElementById(STATS_POLISH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STATS_POLISH_STYLE_ID;
  style.textContent = `
/* Gap rhythm on the global spacing scale. */
.sp-on .doc-stats-body {
  gap: var(--sp-1,4px) var(--sp-4,12px);
  padding: var(--sp-3,8px) var(--sp-4,12px);
}
.sp-on .doc-stats-body .stat-section-title {
  margin-top: var(--sp-2,6px);
  padding-top: var(--sp-2,6px);
}
.sp-on .doc-stats-body .stat-chips { gap: var(--sp-1,4px); }
/* Tabular numerals everywhere a number can render. */
.sp-on .doc-stats-body .stat-value,
.sp-on .doc-stats-body .stat-chip em {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}
/* Top-word chips double as a tiny bar chart: --sp-bar (set by JS from the
   count distribution) paints an accent tint behind each chip. */
.sp-on .doc-stats-body .stat-chip {
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--accent,#0071e3) 16%, transparent) var(--sp-bar,0%),
    var(--surface-hover,#e8eaf0) var(--sp-bar,0%));
  transition: background var(--dur-3,240ms) var(--ease-out,ease-out);
}
/* Fresh-open stagger: rows rise in sequence (index via --sp-i). */
@media (prefers-reduced-motion: no-preference) {
  .sp-on .doc-stats-body.sp-enter > * {
    animation: sp-row-in var(--dur-3,240ms) var(--ease-out,cubic-bezier(.16,1,.3,1)) both;
    animation-delay: calc(var(--sp-i,0) * 18ms);
  }
  @keyframes sp-row-in {
    from { opacity: 0; transform: translateY(3px); }
  }
}
/* Skeleton primitives (see statSkeletonHtml). */
.sp-skel {
  height: 10px;
  border-radius: var(--radius-sm,5px);
  background: var(--surface-hover,#e8eaf0);
  opacity: 0.7;
}
.sp-skel-value { justify-self: end; }
.sp-skel-title {
  grid-column: 1 / -1;
  height: 9px;
  width: 40%;
  margin-top: var(--sp-2,6px);
  border-radius: var(--radius-sm,5px);
  background: var(--surface-hover,#e8eaf0);
}
@media (prefers-reduced-motion: no-preference) {
  .sp-skel, .sp-skel-title { animation: sp-skel-pulse 1.3s ease-in-out infinite; }
  @keyframes sp-skel-pulse { 0%,100% { opacity: 0.45; } 50% { opacity: 0.9; } }
}
`;
  document.head.appendChild(style);
}

// Paint the top-word chips as mini bars scaled to the largest count. Runs on
// every rebuild (typing included) — ≤8 chips, trivial cost, no animation loop.
function paintChipBars(body) {
  const counts = body.querySelectorAll('.stat-chip em');
  let max = 0;
  const nums = [];
  for (const em of counts) {
    const n = parseInt(String(em.textContent).replace(/,/g, ''), 10);
    nums.push(Number.isFinite(n) ? n : 0);
    if (nums[nums.length - 1] > max) max = nums[nums.length - 1];
  }
  counts.forEach((em, i) => {
    const chip = em.closest('.stat-chip');
    if (!chip) return;
    const pct = max > 0 ? Math.max(6, Math.round((nums[i] / max) * 100)) : 0;
    chip.style.setProperty('--sp-bar', `${pct}%`);
  });
}

// Animate the freshly built panel: staggered row entrance + number count-up.
// Only pure-text values animate ("1,234", "12 min"); compound values like
// "85 <em>(Easy)</em>" keep their markup untouched.
function playFreshOpen(body) {
  const rows = [...body.children];
  rows.forEach((row, i) => row.style.setProperty('--sp-i', String(i)));
  body.classList.remove('sp-enter');
  void body.offsetWidth; // restart the staggered animation
  body.classList.add('sp-enter');
  clearTimeout(_spEnterReset);
  _spEnterReset = setTimeout(() => body.classList.remove('sp-enter'), 900);

  for (const el of body.querySelectorAll('.stat-value')) {
    if (el.children.length > 0) continue; // compound value → leave markup alone
    animateStatValue(el, el.textContent);
  }
}
let _spEnterReset = 0;

// Install once. Returns true when installed. See initGraphPolish in graph.js
// for the idempotency/no-op contract (same pattern, stats-side).
export function initStatsPolish() {
  if (_statsPolishInstalled) return false;
  if (typeof document === 'undefined') return false;
  const panel = document.getElementById('doc-stats');
  const body = document.getElementById('doc-stats-body');
  if (!panel || !body) return false;

  _statsPolishInstalled = true;
  try {
    injectStatsPolishCss();
  } catch {
    _statsPolishInstalled = false;
    return false;
  }
  panel.classList.add('sp-on');

  // Panel-open detection must be observed BEFORE the body observer: main.js
  // toggles .hidden and rebuilds the body in the same task, and observers are
  // notified in creation order — so `freshOpen` is already set when the body
  // mutation is processed.
  let freshOpen = !panel.classList.contains('hidden');
  try {
    new MutationObserver(() => {
      freshOpen = !panel.classList.contains('hidden');
      if (!freshOpen) paintChipBars(body); // closing → nothing else to do
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });

    let passRaf = 0;
    const pass = () => {
      passRaf = 0;
      paintChipBars(body);
      if (freshOpen) {
        freshOpen = false;
        playFreshOpen(body);
      }
    };
    new MutationObserver(() => {
      if (!passRaf) passRaf = requestAnimationFrame(pass);
    }).observe(body, { childList: true, subtree: true });
  } catch { /* MutationObserver unavailable — static panel still fine */ }

  // First paint: the body is usually empty at install time (main.js fills it
  // on the next editor-status tick, which the observer catches), but paint
  // chip bars anyway in case a build raced us.
  paintChipBars(body);

  return true;
}

// Self-install in the live app (module scripts run post-parse, anchors exist).
// Guarded no-op under jsdom tests, same as graph.js.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  try {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => initStatsPolish(), { once: true });
    } else {
      initStatsPolish();
    }
  } catch { /* presentation-only: never block startup */ }
}
