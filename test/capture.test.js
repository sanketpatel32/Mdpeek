import { describe, it, expect } from 'vitest';
import { formatEntry, injectInbox, INBOX_HEADING } from '../src/lib/capture.js';

// Deterministic timestamp: 2026-07-31T09:42:00 local.
const NOW = new Date(2026, 6, 31, 9, 42, 0).getTime();

describe('formatEntry', () => {
  it('returns "" for empty / whitespace input', () => {
    expect(formatEntry('', NOW)).toBe('');
    expect(formatEntry('   ', NOW)).toBe('');
    expect(formatEntry('\n\n', NOW)).toBe('');
    expect(formatEntry(null, NOW)).toBe('');
    expect(formatEntry(undefined, NOW)).toBe('');
  });

  it('formats plain text as a timestamped bullet', () => {
    expect(formatEntry('ship release notes', NOW)).toBe('- [09:42] ship release notes');
  });

  it('preserves task prefixes and inserts the timestamp after the box', () => {
    expect(formatEntry('- [ ] ship release notes', NOW)).toBe('- [ ] [09:42] ship release notes');
    expect(formatEntry('- [x] done thing', NOW)).toBe('- [x] [09:42] done thing');
    expect(formatEntry('* [ ] task', NOW)).toBe('* [ ] [09:42] task');
    expect(formatEntry('+ [X] task', NOW)).toBe('+ [X] [09:42] task');
  });

  it('preserves bare bullets and prepends the timestamp to the text', () => {
    expect(formatEntry('- plain bullet', NOW)).toBe('- [09:42] plain bullet');
    expect(formatEntry('* asterisk bullet', NOW)).toBe('* [09:42] asterisk bullet');
    expect(formatEntry('+ plus bullet', NOW)).toBe('+ [09:42] plus bullet');
  });

  it('multi-line: first line is the bullet, rest indented two spaces', () => {
    const out = formatEntry('idea\nwith detail\nand more', NOW);
    expect(out).toBe('- [09:42] idea\n  with detail\n  and more');
  });

  it('multi-line: task marker preserved on the first line', () => {
    const out = formatEntry('- [ ] multi\nline two', NOW);
    expect(out).toBe('- [ ] [09:42] multi\n  line two');
  });

  it('multi-line: trailing blank lines are dropped (no indent-only continuation)', () => {
    const out = formatEntry('idea\n\n\n', NOW);
    expect(out).toBe('- [09:42] idea');
  });

  it('timestamp is local HH:MM 24-hour zero-padded', () => {
    // Midnight -> 00:00; 18:05 -> 18:05.
    expect(formatEntry('x', new Date(2026, 0, 1, 0, 0).getTime())).toBe('- [00:00] x');
    expect(formatEntry('x', new Date(2026, 0, 1, 18, 5).getTime())).toBe('- [18:05] x');
  });

  it('trims trailing whitespace on each line', () => {
    expect(formatEntry('idea   ', NOW)).toBe('- [09:42] idea');
  });

  it('normalizes CRLF line endings', () => {
    expect(formatEntry('one\r\ntwo', NOW)).toBe('- [09:42] one\n  two');
  });

  it('treats a task-like marker mid-line as plain text (only line-start counts)', () => {
    // The task regex is anchored at line start; "note: - [ ] foo" is not a task.
    expect(formatEntry('note: - [ ] foo', NOW)).toBe('- [09:42] note: - [ ] foo');
  });
});

describe('injectInbox', () => {
  it('rule 4: empty/whitespace note seeds a fresh heading + bullet', () => {
    expect(injectInbox('', '- [09:42] idea')).toBe('## Inbox\n\n- [09:42] idea\n');
    expect(injectInbox('   \n\n', '- [09:42] idea')).toBe('## Inbox\n\n- [09:42] idea\n');
  });

  it('rule 4: no-op on an empty entry (returns note unchanged)', () => {
    expect(injectInbox('existing', '')).toBe('existing');
    expect(injectInbox('existing', '   ')).toBe('existing');
  });

  it('rule 1: appends a bullet under an existing ## Inbox heading', () => {
    const note = '# 2026-07-31\n\n## Inbox\n\n- [08:00] first\n\n## Notes\n\nbody';
    const out = injectInbox(note, '- [09:42] second');
    expect(out).toBe(
      '# 2026-07-31\n\n## Inbox\n\n- [08:00] first\n\n- [09:42] second\n\n## Notes\n\nbody'
    );
  });

  it('rule 1: never duplicates the heading', () => {
    const note = '## Inbox\n\n- [08:00] first';
    const out = injectInbox(note, '- [09:42] second');
    const headings = out.match(/## Inbox/g) || [];
    expect(headings.length).toBe(1);
  });

  it('rule 1: handles an inbox with no bullets yet (just the heading)', () => {
    const note = '## Inbox\n\n## Notes\n\nbody';
    const out = injectInbox(note, '- [09:42] first');
    expect(out).toBe('## Inbox\n\n- [09:42] first\n\n## Notes\n\nbody');
  });

  it('rule 1: appends at end of doc when inbox is the last section', () => {
    const note = '## Inbox\n\n- [08:00] first';
    const out = injectInbox(note, '- [09:42] second');
    expect(out).toBe('## Inbox\n\n- [08:00] first\n\n- [09:42] second\n');
  });

  it('rule 1: keeps continuation lines with the prior bullet', () => {
    // The first inbox bullet has a 2-space continuation; the new bullet must
    // land AFTER the continuation, not between it and its parent.
    const note = '## Inbox\n\n- [08:00] first\n  continuation';
    const out = injectInbox(note, '- [09:42] second');
    expect(out).toBe('## Inbox\n\n- [08:00] first\n  continuation\n\n- [09:42] second\n');
  });

  it('rule 2: replaces a trailing empty ## heading with ## Inbox + bullet', () => {
    const note = '# 2026-07-31\n\n*Friday, July 31, 2026*\n\n## \n\n';
    const out = injectInbox(note, '- [09:42] idea');
    expect(out).toBe('# 2026-07-31\n\n*Friday, July 31, 2026*\n\n## Inbox\n\n- [09:42] idea\n\n');
  });

  it('rule 2: matches the exact daily-note starter', () => {
    const starter = '# 2026-07-31\n\n*pretty*\n\n## \n\n';
    const out = injectInbox(starter, '- [09:42] first');
    // The empty heading is replaced, not duplicated.
    expect(out).toContain('## Inbox');
    expect(out).not.toContain('## \n');
    expect(out).toContain('- [09:42] first');
  });

  it('rule 3: appends a new ## Inbox section at the end when no heading exists', () => {
    const note = '# Title\n\nsome prose\n\nmore prose';
    const out = injectInbox(note, '- [09:42] idea');
    expect(out).toBe('# Title\n\nsome prose\n\nmore prose\n\n## Inbox\n\n- [09:42] idea\n');
  });

  it('rule 3: trailing whitespace is trimmed before the new section', () => {
    const note = 'prose\n\n\n';
    const out = injectInbox(note, '- [09:42] idea');
    expect(out).toBe('prose\n\n## Inbox\n\n- [09:42] idea\n');
  });

  it('round-trip invariant: inject twice → both bullets, in order, single heading', () => {
    let note = injectInbox('# 2026-07-31\n\n*date*\n\n## \n\n', '- [08:00] first');
    note = injectInbox(note, '- [09:42] second');
    const headings = note.match(/## Inbox/g) || [];
    expect(headings.length).toBe(1);
    expect(note).toContain('- [08:00] first');
    expect(note).toContain('- [09:42] second');
    // First appears before second.
    expect(note.indexOf('- [08:00] first')).toBeLessThan(note.indexOf('- [09:42] second'));
  });

  it('does not treat a # h1 as the inbox heading', () => {
    const note = '# Inbox\n\nsome prose';
    const out = injectInbox(note, '- [09:42] idea');
    // No `## Inbox` existed, so a new one is appended.
    expect(out).toContain('## Inbox');
    expect(out).toContain('- [09:42] idea');
  });

  it('is idempotent in the sense of producing valid single-heading output', () => {
    const note = '## Inbox\n\n- [08:00] first';
    const a = injectInbox(note, '- [09:42] second');
    const b = injectInbox(a, '- [10:00] third');
    expect((b.match(/## Inbox/g) || []).length).toBe(1);
    expect((b.match(/- \[/g) || []).length).toBe(3);
  });
});

describe('INBOX_HEADING', () => {
  it('is "## Inbox"', () => {
    expect(INBOX_HEADING).toBe('## Inbox');
  });
});
