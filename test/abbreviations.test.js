import { describe, it, expect } from 'vitest';
import { extractAbbreviations, applyAbbreviations } from '../src/lib/abbreviations.js';

describe('extractAbbreviations (v0.46.0)', () => {
  it('collects and removes a definition line', () => {
    const md = 'Some intro.\n\n*[HTML]: HyperText Markup Language\n\nMore.';
    const { md: cleaned, abbrs } = extractAbbreviations(md);
    expect(abbrs.get('HTML')).toBe('HyperText Markup Language');
    expect(cleaned).not.toContain('*[HTML]');
    expect(cleaned).toContain('Some intro.');
    expect(cleaned).toContain('More.');
  });

  it('collects multiple definitions', () => {
    const md = '*[JS]: JavaScript\n*[CSS]: Cascading Style Sheets';
    const { abbrs } = extractAbbreviations(md);
    expect(abbrs.get('JS')).toBe('JavaScript');
    expect(abbrs.get('CSS')).toBe('Cascading Style Sheets');
  });

  it('passes through unchanged when no *[ marker present', () => {
    const md = 'Just some prose, no definitions here.';
    const { md: cleaned, abbrs } = extractAbbreviations(md);
    expect(cleaned).toBe(md);
    expect(abbrs.size).toBe(0);
  });

  it('ignores lines that merely contain *[ inline', () => {
    // Not a definition: text precedes the *[ on the line.
    const md = 'See the *[HTML] array.';
    const { md: cleaned, abbrs } = extractAbbreviations(md);
    expect(abbrs.size).toBe(0);
    expect(cleaned).toBe(md);
  });
});

describe('applyAbbreviations (v0.46.0)', () => {
  it('wraps a whole-word occurrence with the title', () => {
    const abbrs = new Map([['HTML', 'HyperText Markup Language']]);
    expect(applyAbbreviations('The HTML spec', abbrs)).toBe(
      'The <abbr title="HyperText Markup Language">HTML</abbr> spec',
    );
  });

  it('does not match inside a word (no partial matches)', () => {
    const abbrs = new Map([['HTML', 'HyperText Markup Language']]);
    // `dHTML` and `HTMLs` should NOT match.
    expect(applyAbbreviations('dHTML and HTMLs', abbrs)).toBe('dHTML and HTMLs');
  });

  it('wraps multiple occurrences', () => {
    const abbrs = new Map([['JS', 'JavaScript']]);
    expect(applyAbbreviations('JS is fun. I love JS.', abbrs)).toBe(
      '<abbr title="JavaScript">JS</abbr> is fun. I love <abbr title="JavaScript">JS</abbr>.',
    );
  });

  it('skips fenced code blocks', () => {
    const abbrs = new Map([['JS', 'JavaScript']]);
    const md = '```\nconst JS = 1\n```\nJS outside';
    const out = applyAbbreviations(md, abbrs);
    expect(out).toContain('const JS = 1'); // code untouched
    expect(out).toContain('<abbr title="JavaScript">JS</abbr> outside');
  });

  it('skips inline code spans', () => {
    const abbrs = new Map([['JS', 'JavaScript']]);
    expect(applyAbbreviations('call `JS()` to run JS', abbrs)).toBe(
      'call `JS()` to run <abbr title="JavaScript">JS</abbr>',
    );
  });

  it('skips link destinations', () => {
    const abbrs = new Map([['HTML', 'HyperText Markup Language']]);
    // The HTML inside the URL must NOT be wrapped; the one in the label is.
    expect(applyAbbreviations('[HTML page](https://HTML.example/x)', abbrs)).toBe(
      '[<abbr title="HyperText Markup Language">HTML</abbr> page](https://HTML.example/x)',
    );
  });

  it('matches longest key first when one key prefixes another', () => {
    const abbrs = new Map([
      ['AB', 'short'],
      ['ABC', 'longer'],
    ]);
    // `ABC` should match the longer key, `AB` the shorter.
    expect(applyAbbreviations('AB and ABC', abbrs)).toBe(
      '<abbr title="short">AB</abbr> and <abbr title="longer">ABC</abbr>',
    );
  });

  it('escapes the title for attribute safety', () => {
    const abbrs = new Map([['X', 'a "b" <c> & d']]);
    expect(applyAbbreviations('use X here', abbrs)).toBe(
      'use <abbr title="a &quot;b&quot; &lt;c&gt; &amp; d">X</abbr> here',
    );
  });

  it('no-op when abbrs is empty', () => {
    expect(applyAbbreviations('nothing to do', new Map())).toBe('nothing to do');
  });
});
