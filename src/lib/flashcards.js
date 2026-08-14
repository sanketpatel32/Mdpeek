// Flashcard parser — scans markdown text for Q/A pairs in three syntaxes.
// Pure function — no DOM, no I/O. Unit-tested in test/workspace.test.js.
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
