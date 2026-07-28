import { describe, it, expect } from 'vitest';
import { smartPaste, looksLikeUrl, htmlToMarkdown } from '../src/lib/smart-paste.js';

describe('looksLikeUrl', () => {
  it('recognizes http(s) and www URLs', () => {
    expect(looksLikeUrl('https://example.com')).toBe(true);
    expect(looksLikeUrl('http://foo.bar/baz')).toBe(true);
    expect(looksLikeUrl('www.example.com')).toBe(true);
  });
  it('rejects multi-line or prose', () => {
    expect(looksLikeUrl('see https://x.com here')).toBe(false);
    expect(looksLikeUrl('line one\nhttps://x.com')).toBe(false);
    expect(looksLikeUrl('')).toBe(false);
  });
});

describe('smartPaste', () => {
  it('wraps a selection around a URL as a markdown link', () => {
    const r = smartPaste({ text: 'https://x.com', sel: { start: 5, end: 9, text: 'Google' } });
    expect(r.text).toBe('[Google](https://x.com)');
    expect(r.start).toBe(5);
  });

  it('pastes a URL verbatim when there is no selection', () => {
    const r = smartPaste({ text: 'https://x.com', sel: { start: 0, end: 0 } });
    expect(r.text).toBe('https://x.com');
  });

  it('converts an HTML table to a markdown table', () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
    const r = smartPaste({ text: 'A B 1 2', html, sel: { start: 0, end: 0 } });
    expect(r).not.toBeNull();
    expect(r.text).toContain('| A | B |');
    expect(r.text).toContain('| --- | --- |');
    expect(r.text).toContain('| 1 | 2 |');
  });

  it('converts an HTML bulleted list to markdown', () => {
    const html = '<ul><li>one</li><li>two</li></ul>';
    const r = smartPaste({ text: 'one two', html, sel: { start: 0, end: 0 } });
    expect(r.text).toContain('- one');
    expect(r.text).toContain('- two');
  });

  it('converts bold + link inline', () => {
    const html = '<p>Hi <strong>bold</strong> <a href="https://x.com">link</a></p>';
    const r = smartPaste({ text: 'Hi bold link', html, sel: { start: 0, end: 0 } });
    expect(r.text).toContain('**bold**');
    expect(r.text).toContain('[link](https://x.com)');
  });

  it('returns null for plain text with no structured HTML', () => {
    expect(smartPaste({ text: 'just some text', sel: { start: 0, end: 0 } })).toBeNull();
    expect(smartPaste({ text: 'prose', html: '<p>prose</p>', sel: { start: 0, end: 0 } })).toBeNull();
  });
});

describe('htmlToMarkdown', () => {
  it('converts headings', () => {
    const md = htmlToMarkdown('<h1>Title</h1><h2>Sub</h2>');
    expect(md).toContain('# Title');
    expect(md).toContain('## Sub');
  });

  it('converts a numbered list', () => {
    const md = htmlToMarkdown('<ol><li>a</li><li>b</li></ol>');
    expect(md).toContain('1. a');
    expect(md).toContain('2. b');
  });
});
