// Flashcard parser — scans markdown text for Q/A pairs in three syntaxes.
// Parsing is pure (no DOM, no I/O); unit-tested in test/workspace.test.js.
// The bottom section adds an optional browser-only UI polish layer for the
// review panel (injected stylesheet + progress bar + cloze highlighting) —
// every function in it no-ops without a DOM, so tests are unaffected.
//
// Returns an array of { key, question, answer, line, syntax } where:
//   - key      = stable id (caller appends the source file path)
//   - line     = 1-indexed line number where the card starts
//   - syntax   = 'qa' | 'callout' | 'heading'
//
// Supported syntaxes (auto-detected):
//
//   1. Single-line  — `- Question :: Answer`  (also `*` and `+` bullets, or bare)
//     - What is 2+2? :: 4
//
//   2. Callout      — a `> [!qa]` GFM-style callout; first line is the question,
//                     following `>` lines are the answer until a blank/`>`-less line.
//     > [!qa] Capital of France
//     > Paris
//
//   3. Heading      — a `##`/`###` heading is the question; the next non-blank
//                     paragraph (until the next heading or blank line) is the answer.
//     ## What is the speed of light?
//     ~300,000 km/s

import { escapeHtml } from './escape.js';

const HEADING_RE = /^(#{2,3})\s+(.*)$/; // ## or ### (not # — too noisy as a question)
const CALLOUT_RE = /^>\s*\[!qa\]\s*(.*)$/i;
const BULLET_RE = /^(\s*)([-*+]\s+)?(.*)$/;
const FENCE_RE = /^(\s*)(```|~~~)/;

/**
 * Parse markdown text into flashcards.
 * @param {string} text  markdown source
 * @param {string} [sourceKey]  a prefix for the card key (e.g. the file path)
 * @returns {Array<{key:string, question:string, answer:string, line:number, syntax:string}>}
 */
export function parseFlashcards(text, sourceKey = '') {
  if (!text) return [];
  const lines = String(text).split('\n');
  const cards = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track fenced code blocks — skip card detection inside them.
    if (FENCE_RE.test(line)) inFence = !inFence;
    if (inFence) continue;

    // 1. Single-line Q :: A
    const qa = matchQa(line);
    if (qa) {
      cards.push(makeCard(sourceKey, i + 1, 'qa', qa.question, qa.answer));
      continue;
    }

    // 2. Callout > [!qa] ...
    const callout = CALLOUT_RE.exec(line);
    if (callout) {
      const question = callout[1].trim();
      const answerLines = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        const cm = /^>\s?(.*)$/.exec(next);
        if (cm && cm[1] !== undefined && next.trim() !== '') {
          answerLines.push(cm[1]);
          j++;
        } else {
          break;
        }
      }
      const answer = answerLines.join(' ').trim();
      if (question && answer) {
        cards.push(makeCard(sourceKey, i + 1, 'callout', question, answer));
      }
      i = j - 1; // skip consumed lines
      continue;
    }

    // 3. Heading + next paragraph
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const question = heading[2].trim();
      if (!looksLikeQuestion(question)) continue;
      // Collect the answer: the next non-blank line until a blank line or new heading/fence.
      const answerLines = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (next.trim() === '') break;
        if (HEADING_RE.test(next)) break;
        if (FENCE_RE.test(next)) break;
        answerLines.push(next.trim());
        if (answerLines.length >= 5) break; // cap answer length
      }
      const answer = answerLines.join(' ').trim();
      if (question && answer) {
        cards.push(makeCard(sourceKey, i + 1, 'heading', question, answer));
      }
    }
  }

  return cards;
}

/** A single-line Q::A parser, tolerant of bullets and inline formatting. */
function matchQa(line) {
  if (!line) return null;
  const b = BULLET_RE.exec(line);
  const body = b ? b[3] : line;
  // Split on the FIRST " :: " (with spaces around the colons) to avoid catching
  // URLs (http://) or code. Bare "::" without spaces is rejected for the same reason.
  const idx = body.indexOf('::');
  if (idx <= 0) return null;
  // Require spaces around the separator (or start/end of line).
  const before = body[idx - 1];
  const after = body[idx + 2];
  if (before && before !== ' ') return null;
  if (after && after !== ' ') return null;
  const question = body.slice(0, idx).trim();
  const answer = body.slice(idx + 2).trim();
  if (!question || !answer) return null;
  // Reject if the question looks like a code fence or URL.
  if (/^(https?:|\/\/)/.test(question)) return null;
  return { question, answer };
}

/** Heuristic: only treat a heading as a flashcard if it reads like a question.
 *  This avoids turning every ## section in every note into a card. Catches
 *  trailing "?" OR a question-word lead-in. */
function looksLikeQuestion(text) {
  if (/\?\s*$/.test(text)) return true;
  return /^(what|why|how|when|where|who|which|define|explain|describe|name|list|is|are|do|does|can|could|should|would)\b/i.test(text);
}

function makeCard(sourceKey, line, syntax, question, answer) {
  return {
    // v0.67.0: key on content, not line number — inserting a line above a card
    // used to orphan its SRS history (ease/interval/reps silently reset).
    key: `${sourceKey}:${question}`,
    question,
    answer,
    line,
    syntax,
  };
}

// ---- Review UI polish (presentation only) --------------------------------
// Everything below is look-and-feel for the review panel that main.js renders
// (.review-card / .review-rate / #review-summary …). It layers an id-guarded
// <style> over base.css's review rules using global theme tokens, so it follows
// whatever theme is active. No parsing or scheduling behavior is touched.
//
//   - 3D flip on --dur-3 with a reduced-motion instant-swap fallback
//   - Again/Hard/Good/Easy semantic tints + hover lift / press dip + kbd badges
//   - Due-cards progress bar and tabular-nums summary chip
//   - Styled "all caught up" well + guarded confetti-lite on deck completion
//   - Cloze deletions ([[..]], ==..==, {{c1::..}}) highlighted in card faces

const REVIEW_STYLE_ID = 'mdpeek-review-polish-css';
const PROGRESS_ID = 'mdpeek-review-progress';
const CLOZE_RE = /\[\[[^\][\n]+\]\]|==[^=\n]+==|\{\{c\d+::[^{}\n]*\}\}/g;

/** The injected stylesheet: global tokens only, no hardcoded colors/timings.
 *  Every rule is scoped under .review-shell (one extra class) so it wins over
 *  base.css's single-class rules no matter which stylesheet lands last. */
const REVIEW_POLISH_CSS = `
.review-shell .review-card { perspective: 1400px; }
.review-shell .review-card-inner { transition: transform var(--dur-3) var(--ease-spring); }

/* Card content typography: question leads, answer supports. */
.review-shell .review-q {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.review-shell .review-a {
  font-size: 16px;
  font-weight: 400;
  color: var(--fg-secondary);
  line-height: 1.6;
}

/* Cloze deletions get an accent-soft highlight + underline. */
.fc-cloze {
  background: var(--accent-soft);
  border-bottom: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  border-radius: 3px;
  padding: 0 3px;
  font-weight: 600;
}

/* Rate buttons: each maps to a semantic --tone; hover lifts, press dips. */
.review-shell .review-rate {
  --tone: var(--accent);
  position: relative;
  transition:
    transform var(--dur-1) var(--ease-spring),
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}
.review-shell .review-rate[data-rate="again"] { --tone: var(--danger); }
.review-shell .review-rate[data-rate="hard"]  { --tone: var(--warning); }
.review-shell .review-rate[data-rate="good"]  { --tone: var(--accent); }
.review-shell .review-rate[data-rate="easy"]  { --tone: var(--success); }
.review-shell .review-rate:hover {
  transform: translateY(-2px);
  background: color-mix(in srgb, var(--tone) 10%, transparent);
  border-color: color-mix(in srgb, var(--tone) 45%, transparent);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--tone) 18%, transparent);
}
.review-shell .review-rate:hover .review-rate-label { color: var(--tone); }
.review-shell .review-rate:active {
  transform: translateY(0) scale(0.97);
  box-shadow: none;
}
.review-shell .review-rate:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--tone) 70%, transparent);
  outline-offset: 2px;
}
/* Keyboard hint badge (main.js binds 1-4 → again/hard/good/easy). */
.review-shell .review-rate::after {
  content: "1";
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  display: grid;
  place-items: center;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--tone);
  background: var(--bg-elevated);
  border: 1px solid color-mix(in srgb, var(--tone) 45%, transparent);
  border-radius: 5px;
}
.review-shell .review-rate[data-rate="hard"]::after { content: "2"; }
.review-shell .review-rate[data-rate="good"]::after { content: "3"; }
.review-shell .review-rate[data-rate="easy"]::after { content: "4"; }

/* Summary chip: tabular numerals so the count doesn't wiggle as it ticks down */
.review-shell .review-summary {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  background: var(--accent-soft);
  color: var(--fg-secondary);
  border-radius: 999px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* Due-cards progress bar (element ensured by ensureReviewPolish below). */
.review-shell .review-progress {
  width: 100%;
  max-width: 420px;
  height: 6px;
  margin: 10px auto 18px;
  background: color-mix(in srgb, var(--fg-muted) 14%, transparent);
  border-radius: 999px;
  overflow: hidden;
}
.review-shell .review-progress-fill {
  height: 100%;
  width: 0%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--success) 55%, var(--accent)));
  transition: width var(--dur-3) var(--ease-out);
}

/* Empty/deck-complete state styled as a soft well; only the success path
   renders an <h3>, so the celebration marker never lands on error text. */
.review-shell .review-done {
  position: relative;
  border: 1px dashed color-mix(in srgb, var(--border-subtle) 80%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--accent-soft) 35%, transparent);
}
.review-shell .review-done h3::before { content: "\\1F389\\2009"; /* 🎉 */ }

/* Confetti-lite: a handful of CSS particles, spawned only when motion is OK. */
.fc-confetti {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  border-radius: inherit;
}
.fc-confetti i {
  position: absolute;
  top: -8px;
  width: 6px;
  height: 9px;
  border-radius: 1px;
  opacity: 0;
  animation: fc-confetti-fall 1400ms var(--ease-out) forwards;
}
@keyframes fc-confetti-fall {
  0% { transform: translate3d(0, -10px, 0) rotate(0deg); opacity: 1; }
  100% { transform: translate3d(var(--fc-dx, 0), 170px, 0) rotate(var(--fc-rot, 360deg)); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .review-shell .review-card-inner,
  .review-shell .review-progress-fill { transition: none !important; }
  .review-shell .review-rate:hover,
  .review-shell .review-rate:active { transform: none !important; }
  .fc-confetti { display: none !important; }
}
`;

/**
 * Idempotently apply the review UI polish layer: injects the stylesheet once,
 * ensures the progress bar exists, and wires observers that keep the bar,
 * cloze highlights, and deck-complete celebration in sync with main.js's
 * re-renders. Safe to call any number of times; no-op without a DOM.
 * @returns {void}
 */
export function ensureReviewPolish() {
  if (typeof document === 'undefined' || !document.head) return;
  if (!document.getElementById(REVIEW_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = REVIEW_STYLE_ID;
    style.textContent = REVIEW_POLISH_CSS;
    document.head.appendChild(style);
  }
  ensureProgressBar();
  wireReviewObserver();
}

/**
 * Wrap cloze deletions in a card string as escaped HTML with .fc-cloze spans.
 * Pure string in → HTML out; all non-cloze text is HTML-escaped.
 * @param {string} text raw card text (question or answer)
 * @returns {string} HTML safe to assign via innerHTML
 */
export function highlightCloze(text) {
  const raw = String(text ?? '');
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(CLOZE_RE)) {
    out += escapeHtml(raw.slice(last, m.index));
    out += `<span class="fc-cloze">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(raw.slice(last));
}

/**
 * Set the due-cards progress bar. Creates nothing — call ensureReviewPolish
 * first (it runs automatically when this module is imported in a browser).
 * @param {number} answered cards completed this session
 * @param {number} total    cards due when the session started
 */
export function updateReviewProgress(answered, total) {
  const bar = typeof document === 'undefined' ? null : document.getElementById(PROGRESS_ID);
  if (!bar) return;
  const fill = bar.firstElementChild;
  if (!fill) return;
  const pct = total > 0 ? Math.max(0, Math.min(100, (answered / total) * 100)) : 100;
  fill.style.width = `${pct}%`;
  bar.setAttribute('aria-valuemax', String(Math.max(0, total)));
  bar.setAttribute('aria-valuenow', String(Math.max(0, Math.min(answered, total))));
}

// --- internals -------------------------------------------------------------

function ensureProgressBar() {
  if (document.getElementById(PROGRESS_ID)) return;
  const shell = document.querySelector('.review-shell');
  const header = shell ? shell.querySelector('.review-header') : null;
  if (!shell || !header) return;
  const bar = document.createElement('div');
  bar.id = PROGRESS_ID;
  bar.className = 'review-progress';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Cards reviewed this session');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuenow', '0');
  bar.setAttribute('aria-valuemax', '0');
  const fill = document.createElement('div');
  fill.className = 'review-progress-fill';
  bar.appendChild(fill);
  header.insertAdjacentElement('afterend', bar);
}

let _reviewObserved = false;
let _progressTotal = 0;
let _summaryHadDigits = false;
let _celebrated = false;

/**
 * One delegated observer keeps the polish in sync with main.js's innerHTML
 * re-renders: progress from #review-summary text, cloze spans in fresh faces,
 * confetti when the summary flips to "Session complete.".
 */
function wireReviewObserver() {
  if (_reviewObserved || typeof MutationObserver === 'undefined') return;
  const summary = document.getElementById('review-summary');
  const stage = document.getElementById('review-stage');
  if (!summary && !stage) return;

  _reviewObserved = true;
  syncProgressFromSummary(summary);

  const obs = new MutationObserver(() => {
    syncProgressFromSummary(summary);
    enhanceCardFaces(stage);
    maybeCelebrate(stage, summary);
  });
  if (summary) obs.observe(summary, { childList: true, characterData: true });
  if (stage) obs.observe(stage, { childList: true });

  // First paint may already show a card (panel reopened).
  enhanceCardFaces(stage);
}

function syncProgressFromSummary(summary) {
  if (!summary) return;
  const text = summary.textContent || '';
  const m = /(\d+)/.exec(text);
  if (!m) {
    // Placeholder ("—") or "Session complete." — no numbers to track.
    _summaryHadDigits = false;
    if (_celebrated || /complete/i.test(text)) updateReviewProgress(1, 1);
    return;
  }
  const due = Number(m[1]);
  if (!_summaryHadDigits) {
    // First numeric reading after an empty/complete state → a fresh session.
    _progressTotal = due;
    _celebrated = false;
  } else if (due > _progressTotal) {
    // Queue grew beyond anything seen this session (re-scan added cards).
    _progressTotal = due;
  }
  _summaryHadDigits = true;
  updateReviewProgress(_progressTotal - due, _progressTotal);
}

function maybeCelebrate(stage, summary) {
  const doneTitle = stage && stage.querySelector('.review-done h3');
  const complete = doneTitle || (summary && /session complete/i.test(summary.textContent || ''));
  if (!complete || _celebrated || prefersReducedMotion()) return;
  _celebrated = true;
  spawnConfetti(doneTitle ? doneTitle.closest('.review-done') : stage.querySelector('.review-done'));
}

function spawnConfetti(container) {
  if (!container || container.querySelector('.fc-confetti')) return;
  const field = document.createElement('div');
  field.className = 'fc-confetti';
  field.setAttribute('aria-hidden', 'true');
  const tones = ['var(--danger)', 'var(--warning)', 'var(--accent)', 'var(--success)'];
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('i');
    p.style.left = `${5 + Math.random() * 90}%`;
    p.style.background = tones[i % tones.length];
    p.style.animationDelay = `${Math.round(Math.random() * 250)}ms`;
    p.style.setProperty('--fc-dx', `${Math.round((Math.random() - 0.5) * 90)}px`);
    p.style.setProperty('--fc-rot', `${Math.round(180 + Math.random() * 540)}deg`);
    field.appendChild(p);
  }
  container.appendChild(field);
  // Self-clean so repeat sessions can celebrate again.
  setTimeout(() => field.remove(), 2200);
}

/** Wrap cloze tokens inside freshly rendered .review-q/.review-a text nodes. */
function enhanceCardFaces(stage) {
  if (!stage) return;
  for (const face of stage.querySelectorAll('.review-q, .review-a')) {
    if (face.dataset.clozeDone === '1') continue;
    face.dataset.clozeDone = '1';
    // matchAll on a /g regex never mutates its lastIndex, so CLOZE_RE stays
    // safe to share; avoid .test()/.exec() on it for exactly that reason.
    const walker = document.createTreeWalker(face, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue;
      if (!value) continue;
      const matches = [...value.matchAll(CLOZE_RE)];
      if (matches.length) targets.push([walker.currentNode, matches]);
    }
    for (const [node, matches] of targets) {
      const frag = document.createDocumentFragment();
      let last = 0;
      const value = node.nodeValue;
      for (const m of matches) {
        if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)));
        const span = document.createElement('span');
        span.className = 'fc-cloze';
        span.textContent = m[0];
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }
}

function prefersReducedMotion() {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// Browser-only: apply the polish as soon as this module loads (main.js imports
// it at startup). Skipped under Node/vitest — no document, nothing happens.
if (typeof document !== 'undefined') ensureReviewPolish();
