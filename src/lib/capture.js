// v0.55.0: Quick-capture inbox — pure formatting + injection helpers for the
// Ctrl+Shift+I capture HUD. formatEntry turns typed text into a timestamped
// bullet; injectInbox appends that bullet under a `## Inbox` heading in today's
// daily note. Both are pure (text in → text out), so the HUD orchestration in
// main.js and the tests share the exact same rules.
//
// Capture format:
//   - plain text      → `- [HH:MM] text`
//   - task prefix     → marker preserved, timestamp after  (`- [ ] [HH:MM] …`)
//   - bare bullet     → bullet preserved, timestamp prepended to text
//   - multi-line      → first line is the bullet, rest indented two spaces
//
// Inject rules (checked in order; first match wins, all idempotent):
//   1. `## Inbox` heading exists → append the bullet as the next bullet under it
//   2. note ends with an empty `## ` heading → replace it with `## Inbox` + bullet
//   3. heading missing → add a new `## Inbox` section at the end of the doc
//   4. empty/whitespace note → seed `# <stamp>\n\n## Inbox\n\n<bullet>`

export const INBOX_HEADING = '## Inbox';

// Format `now` as a zero-padded local-time HH:MM (24-hour).
function hhmm(now) {
  const d = now instanceof Date ? now : new Date(now);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// Recognized task-list markers (GFM allows -, *, + prefixes).
const TASK_RE = /^(\s*)([-*+])\s+\[( |x|X)\]\s+/;
// Bare bullet markers (no task box).
const BULLET_RE = /^(\s*)([-*+])\s+/;

// Turn raw user input into a single capture entry (one or more lines). Returns
// '' for empty/whitespace input (no empty bullets). `now` defaults to now but
// is injectable for deterministic tests.
export function formatEntry(rawText, now = Date.now()) {
  const text = String(rawText ?? '');
  if (!text.trim()) return '';
  const stamp = hhmm(now);
  // Normalize: split into logical lines, trim trailing whitespace per line,
  // drop trailing empties (so a trailing newline doesn't produce an indent-only
  // continuation line).
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 1 && lines[lines.length - 1].trim() === '') lines.pop();
  const first = lines[0];
  const rest = lines.slice(1);

  let prefix; // the bullet/marker text up to and including the trailing space
  let body;   // the first line's text content (after any marker)
  const task = first.match(TASK_RE);
  const bullet = !task && first.match(BULLET_RE);
  if (task) {
    // Preserve `- [ ]` / `* [x]` etc., timestamp after the box.
    prefix = `${task[1]}${task[2]} [${task[3]}] `;
    body = first.slice(task[0].length);
    return compose(prefix, `[${stamp}] ${body}`, rest);
  }
  if (bullet) {
    prefix = `${bullet[1]}${bullet[2]} `;
    body = first.slice(bullet[0].length);
    return compose(prefix, `[${stamp}] ${body}`, rest);
  }
  // Plain text → a fresh bullet with the timestamp.
  return compose('- ', `[${stamp}] ${first.trim()}`, rest);
}

// Compose the final entry: the marker line + any continuation lines indented
// two spaces (valid nested markdown under the bullet). Continuation lines keep
// their relative indentation but are shifted right by 2.
function compose(prefix, firstBodyLine, rest) {
  const firstTrim = firstBodyLine.replace(/\s+$/, '');
  let out = `${prefix}${firstTrim}`;
  if (rest.length > 0) {
    const continued = rest
      .map((ln) => (ln.trim() === '' ? '' : `  ${ln.replace(/\s+$/, '')}`))
      .join('\n');
    if (continued.trim()) out += `\n${continued}`;
  }
  return out;
}

// Append `entry` (one or more lines, as produced by formatEntry) under a
// `## Inbox` heading in `rawNote`. Pure: returns the new note text. See the
// rules enumerated at the top of the file. Idempotent across repeated injects.
export function injectInbox(rawNote, entry) {
  const note = String(rawNote ?? '');
  const line = String(entry ?? '');
  // No entry → return note unchanged.
  if (!line.trim()) return note;

  // Rule 4: empty / whitespace-only note → seed a fresh document.
  if (!note.trim()) {
    return `## Inbox\n\n${line}\n`;
  }

  const lines = note.split('\n');

  // Rule 1: an existing `## Inbox` heading. Append after the last bullet that
  // belongs to it (before the next `## ` section or end of doc).
  const inboxIdx = lines.findIndex((l) => l.trim() === INBOX_HEADING);
  if (inboxIdx >= 0) {
    // Walk past the heading + the blank line(s) immediately after it, then
    // continue while lines look like inbox bullets (list markers, blank lines,
    // or continuation-indented lines). Stop at the next heading.
    let i = inboxIdx + 1;
    // Skip the blank line that conventionally follows the heading.
    while (i < lines.length && lines[i].trim() === '') i++;
    // Walk over the existing bullet block.
    let lastBulletEnd = i;
    while (i < lines.length) {
      const l = lines[i];
      if (/^#{1,6}\s/.test(l.trim())) break; // next heading ends the block
      if (l.trim() === '') { i++; continue; }
      // A line that is a list item or a continuation indent belongs to inbox.
      if (/^\s*([-*+]\s|\d+\.\s)/.test(l)) { lastBulletEnd = i + 1; i++; continue; }
      // Continuation lines (indented ≥2 and not a heading) belong to the prior
      // bullet — extend the block.
      if (/^\s{2,}\S/.test(l)) { lastBulletEnd = i + 1; i++; continue; }
      // Anything else ends the block.
      break;
    }
    // Insert the entry right after the last bullet (with a surrounding blank
    // line so it reads as its own bullet, matching the heading's first bullet).
    const insertAt = lastBulletEnd;
    const before = lines.slice(0, insertAt);
    const after = lines.slice(insertAt);
    const beforeOk = before.length === 0 || before[before.length - 1].trim() === '';
    const afterOk = after.length === 0 || after[0].trim() === '';
    const rebuilt = [
      ...before,
      ...(beforeOk ? [] : ['']),
      line,
      ...(afterOk ? [] : ['']),
      ...after,
    ];
    let result = rebuilt.join('\n');
    // If the entry became the last content of the note (nothing meaningful
    // follows it), make sure the note ends with a newline — markdown files
    // should be newline-terminated, and we just wrote the final line.
    const afterAllBlank = after.every((l) => l.trim() === '');
    if (afterAllBlank && !result.endsWith('\n')) result += '\n';
    return result;
  }

  // Rule 2: trailing empty `## ` heading (the daily-note starter ends with
  // `…\n\n## \n\n`). Replace the empty heading with `## Inbox` + the bullet.
  // Find the last non-blank line.
  let lastNonBlank = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '') { lastNonBlank = i; break; }
  }
  if (lastNonBlank >= 0) {
    const last = lines[lastNonBlank].trim();
    if (last === '##' || last === '## ') {
      // Replace that line with the inbox heading + bullet. Preserve trailing
      // blank lines after.
      const rebuilt = [
        ...lines.slice(0, lastNonBlank),
        INBOX_HEADING,
        '',
        line,
        ...lines.slice(lastNonBlank + 1),
      ];
      return rebuilt.join('\n');
    }
  }

  // Rule 3: heading missing, note has content → append a new section at the end.
  const trimmed = note.replace(/\s+$/, '');
  return `${trimmed}\n\n${INBOX_HEADING}\n\n${line}\n`;
}
