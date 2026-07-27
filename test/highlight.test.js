import { describe, it, expect } from 'vitest';
import { replaceHighlights, markedHighlightExt } from '../src/lib/highlight.js';

describe('replaceHighlights', () => {
  it('wraps ==text== in <mark>', () => {
    expect(replaceHighlights('a ==foo== b')).toBe('a <mark>foo</mark> b');
  });

  it('handles multiple highlights on one line', () => {
    expect(replaceHighlights('==a== ==b==')).toBe('<mark>a</mark> <mark>b</mark>');
  });

  it('leaves text without == untouched', () => {
    expect(replaceHighlights('no markers here')).toBe('no markers here');
  });

  it('does not match === (heading underline)', () => {
    expect(replaceHighlights('Heading\n===')).toBe('Heading\n===');
  });

  it('does not match ==== (four equals)', () => {
    expect(replaceHighlights('====')).toBe('====');
  });

  it('does not match across newlines', () => {
    expect(replaceHighlights('==line one\nline two==')).toBe('==line one\nline two==');
  });

  it('handles empty body gracefully (== == with space)', () => {
    // `== ==` has a space, which is a valid body — should highlight the space.
    expect(replaceHighlights('== ==')).toBe('<mark> </mark>');
  });

  it('early-exits unchanged when there is no ==', () => {
    expect(replaceHighlights('totally plain text')).toBe('totally plain text');
    expect(replaceHighlights('')).toBe('');
    expect(replaceHighlights(null)).toBe(null);
  });

  it('preserves surrounding text exactly', () => {
    expect(replaceHighlights('before ==mid== after')).toBe('before <mark>mid</mark> after');
  });
});

describe('markedHighlightExt', () => {
  it('returns an extensions array with one inline extension', () => {
    const ext = markedHighlightExt();
    expect(Array.isArray(ext.extensions)).toBe(true);
    expect(ext.extensions).toHaveLength(1);
    const rule = ext.extensions[0];
    expect(rule.name).toBe('highlight');
    expect(rule.level).toBe('inline');
    expect(typeof rule.tokenizer).toBe('function');
    expect(typeof rule.renderer).toBe('function');
  });

  it('start() returns the index of the first ==', () => {
    const rule = markedHighlightExt().extensions[0];
    expect(rule.start('abc ==x==')).toBe(4);
    expect(rule.start('no match')).toBe(-1);
  });

  it('tokenizer matches ==text== at the start of src', () => {
    const rule = markedHighlightExt().extensions[0];
    // Fake a minimal lexer with inlineTokens so the renderer test below works.
    const fakeLexer = { inlineTokens: (s) => [{ type: 'text', raw: s, text: s }] };
    const token = rule.tokenizer.call({ lexer: fakeLexer }, '==hello== rest');
    expect(token).toBeTruthy();
    expect(token.type).toBe('highlight');
    expect(token.text).toBe('hello');
    expect(token.raw).toBe('==hello==');
  });

  it('tokenizer returns undefined when src does not start with a match', () => {
    const rule = markedHighlightExt().extensions[0];
    expect(rule.tokenizer('no match here')).toBeUndefined();
    expect(rule.tokenizer('===')).toBeUndefined();
  });

  it('renderer emits <mark> wrapping the parsed inner content', () => {
    const rule = markedHighlightExt().extensions[0];
    const token = { text: 'foo', tokens: [{ type: 'text', raw: 'foo', text: 'foo' }] };
    const fakeParser = { parseInline: (toks) => toks.map((t) => t.text).join('') };
    const out = rule.renderer.call({ parser: fakeParser }, token);
    expect(out).toBe('<mark>foo</mark>');
  });
});
