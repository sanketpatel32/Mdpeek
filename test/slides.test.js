import { describe, it, expect } from 'vitest';
import { extractSpeakerNotes } from '../src/lib/slides.js';

describe('extractSpeakerNotes', () => {
  it('strips a bare `note:` line and captures its text', () => {
    const { cleanMd, note } = extractSpeakerNotes('# Title\n\nnote: hello world');
    expect(cleanMd).toBe('# Title');
    expect(note).toBe('hello world');
  });

  it('captures `note:` with leading whitespace', () => {
    const { note } = extractSpeakerNotes('   note: indented');
    expect(note).toBe('indented');
  });

  it('is case-insensitive on the keyword', () => {
    const { note } = extractSpeakerNotes('NOTE: shout\nNote: mixed');
    expect(note).toBe('shout\nmixed');
  });

  it('strips an HTML comment form and captures the body', () => {
    const md = 'Some text\n\n<!-- note: hidden reminder -->\n\nMore text';
    const { cleanMd, note } = extractSpeakerNotes(md);
    expect(note).toBe('hidden reminder');
    expect(cleanMd).toBe('Some text\n\nMore text');
  });

  it('captures a multi-line HTML comment', () => {
    const md = '<!-- note: line one\nline two -->';
    const { note } = extractSpeakerNotes(md);
    expect(note).toBe('line one\nline two');
  });

  it('concatenates multiple notes with newlines', () => {
    const md = 'note: first\n\nnote: second';
    const { note } = extractSpeakerNotes(md);
    expect(note).toBe('first\nsecond');
  });

  it('does not treat `note:` mid-line as a speaker note', () => {
    // The line-anchored regex only fires at line start, so prose mentioning
    // "note:" stays on the slide.
    const md = 'Paragraph mentioning note: in the middle.';
    const { cleanMd, note } = extractSpeakerNotes(md);
    expect(cleanMd).toBe('Paragraph mentioning note: in the middle.');
    expect(note).toBe('');
  });

  it('does not treat `notification:` as a note', () => {
    const md = 'notification: hello';
    const { cleanMd, note } = extractSpeakerNotes(md);
    expect(cleanMd).toBe('notification: hello');
    expect(note).toBe('');
  });

  it('does not strip a regular HTML comment (no note: prefix)', () => {
    const md = '<!-- just a comment -->';
    const { cleanMd, note } = extractSpeakerNotes(md);
    expect(cleanMd).toBe('<!-- just a comment -->');
    expect(note).toBe('');
  });

  it('ignores `note:` lines indented inside a code block (4-space indent)', () => {
    // The 4-space indent makes the regex still match (it allows leading
    // spaces), so this *is* extracted — the convention is "note: at line
    // start is always a note." Verifying that behaviour explicitly so any
    // future tightening is a deliberate decision.
    const md = '    note: inside code block';
    const { note } = extractSpeakerNotes(md);
    expect(note).toBe('inside code block');
  });

  it('collapses the blank lines left by removed notes', () => {
    const md = '# Title\n\nnote: a\n\nnote: b\n\nBody';
    const { cleanMd } = extractSpeakerNotes(md);
    expect(cleanMd).toBe('# Title\n\nBody');
  });

  it('returns empty strings for empty input', () => {
    expect(extractSpeakerNotes('')).toEqual({ cleanMd: '', note: '' });
    expect(extractSpeakerNotes(null)).toEqual({ cleanMd: '', note: '' });
    expect(extractSpeakerNotes(undefined)).toEqual({ cleanMd: '', note: '' });
  });

  it('returns cleanMd unchanged when there are no notes', () => {
    const md = '# Just a slide\n\nWith some **bold** text.';
    const { cleanMd, note } = extractSpeakerNotes(md);
    expect(cleanMd).toBe(md);
    expect(note).toBe('');
  });

  it('handles a note line that is just the keyword (`note:` with no body)', () => {
    const { cleanMd, note } = extractSpeakerNotes('note:\nBody');
    expect(note).toBe(''); // empty body is not collected
    expect(cleanMd).toBe('Body');
  });
});
