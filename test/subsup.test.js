import { describe, it, expect } from 'vitest';
import { replaceSubSup, expandSuperscript } from '../src/lib/subsup.js';
import { renderMarkdown } from '../src/lib/renderer.js';

describe('replaceSubSup — pure helper', () => {
  it('passes through text with no delimiters', () => {
    expect(replaceSubSup('hello world')).toBe('hello world');
    expect(replaceSubSup('')).toBe('');
  });

  it('renders subscript H~2~O', () => {
    expect(replaceSubSup('H~2~O')).toBe('H<sub>2</sub>O');
  });

  it('renders superscript x^2^', () => {
    expect(replaceSubSup('x^2^')).toBe('x<sup>2</sup>');
  });

  it('renders adjacent pairs without merging', () => {
    expect(replaceSubSup('a~1~ b~2~')).toBe('a<sub>1</sub> b<sub>2</sub>');
    expect(replaceSubSup('n^2^ + m^3^')).toBe('n<sup>2</sup> + m<sup>3</sup>');
  });

  it('does not treat ~~ strikethrough as subscript', () => {
    expect(replaceSubSup('~~deleted~~')).toBe('~~deleted~~');
  });

  it('requires a non-space prefix char', () => {
    // ` ~ b~` — leading `~` follows a space, so no match; only `b~` would be
    // a candidate but it has no closer. Stays literal.
    expect(replaceSubSup(' ~ b~')).toBe(' ~ b~');
  });

  it('does not match across newlines', () => {
    expect(replaceSubSup('a~b\n~c')).toBe('a~b\n~c');
  });

  it('skips superscript when body looks like math ($)', () => {
    // `a^$x$^` — body contains `$`, left alone (KaTeX owns it).
    expect(replaceSubSup('a^$x$^')).toBe('a^$x$^');
  });
});

describe('markedSubSup — end-to-end via renderMarkdown', () => {
  it('renders subscript through the full pipeline', () => {
    expect(renderMarkdown('Water H~2~O')).toContain('H<sub>2</sub>O');
  });
  it('renders superscript through the full pipeline', () => {
    expect(renderMarkdown('E=mc^2^ yes')).toContain('mc<sup>2</sup>');
  });
  it('leaves ~~strikethrough~~ alone', () => {
    expect(renderMarkdown('~~deleted~~')).toContain('<del>');
    expect(renderMarkdown('~~deleted~~')).not.toContain('<sub>');
  });
});

describe('expandSuperscript — preprocessor', () => {
  it('expands x^2^ to <sup>', () => {
    expect(expandSuperscript('E=mc^2^')).toBe('E=mc<sup>2</sup>');
  });
  it('passes through text with no ^', () => {
    expect(expandSuperscript('plain text')).toBe('plain text');
  });
  it('skips superscript inside fenced code', () => {
    const md = 'before\n```\nx^2^ y^3^\n```\nafter';
    expect(expandSuperscript(md)).toBe(md);
  });
  it('skips superscript inside inline code', () => {
    expect(expandSuperscript('see `a^2^` ok')).toBe('see `a^2^` ok');
  });
  it('renders superscript outside code while leaving code intact', () => {
    const md = 'x^2^ and `y^3^`';
    expect(expandSuperscript(md)).toBe('x<sup>2</sup> and `y^3^`');
  });
  it('skips superscript when body looks like math ($)', () => {
    expect(expandSuperscript('a^$x$^')).toBe('a^$x$^');
  });
});
