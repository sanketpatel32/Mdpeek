import { describe, it, expect } from 'vitest';
import { sectionRanges, foldedLineSet, foldedLineCount } from '../src/lib/fold.js';

describe('sectionRanges', () => {
  it('returns [] for empty / whitespace / no-heading docs', () => {
    expect(sectionRanges('')).toEqual([]);
    expect(sectionRanges('just prose\nno headings')).toEqual([]);
    expect(sectionRanges('   ')).toEqual([]);
  });

  it('returns one range covering the whole doc for a single heading', () => {
    const md = '# Title\nbody line\nbody line 2';
    const ranges = sectionRanges(md);
    expect(ranges.length).toBe(1);
    expect(ranges[0]).toEqual({ level: 1, headingLine: 1, startLine: 1, endLine: 3 });
  });

  it('a heading at EOF has endLine === headingLine (empty body)', () => {
    const md = 'intro\n\n# Heading';
    const ranges = sectionRanges(md);
    expect(ranges[0]).toEqual({ level: 1, headingLine: 3, startLine: 3, endLine: 3 });
  });

  it('an h2 section ends at the line before the next h2 (same-or-higher)', () => {
    const md = [
      '# Top',       // 1
      '',            // 2
      '## A',        // 3
      'a body',      // 4
      '',            // 5
      '## B',        // 6
      'b body',      // 7
    ].join('\n');
    const ranges = sectionRanges(md);
    const a = ranges.find((r) => r.headingLine === 3);
    expect(a.endLine).toBe(5); // lines 3,4,5 — ends before ## B at line 6
    const b = ranges.find((r) => r.headingLine === 6);
    expect(b.endLine).toBe(7); // last section runs to EOF
  });

  it('an h3 section ends at the next h1, h2, OR h3 (same-or-higher)', () => {
    const md = [
      '## Parent',   // 1
      '### Child',   // 2
      'child body',  // 3
      '### Next',    // 4
      'next body',   // 5
    ].join('\n');
    const ranges = sectionRanges(md);
    const child = ranges.find((r) => r.headingLine === 2);
    expect(child.endLine).toBe(3); // ends before ### Next at line 4
  });

  it('nested h3/h4 are included inside a folded h2 section', () => {
    const md = [
      '## H2',       // 1
      'body',        // 2
      '### H3',      // 3
      'h3 body',     // 4
      '#### H4',     // 5
      'h4 body',     // 6
      '## Next H2',  // 7
    ].join('\n');
    const ranges = sectionRanges(md);
    const h2 = ranges.find((r) => r.headingLine === 1);
    expect(h2.endLine).toBe(6); // h2 swallows h3+h4, ends before next h2
  });

  it('includes h1 (top-level fold)', () => {
    const md = '# A\nx\n# B\ny';
    const ranges = sectionRanges(md);
    expect(ranges.find((r) => r.headingLine === 1).endLine).toBe(2);
    expect(ranges.find((r) => r.headingLine === 3).endLine).toBe(4);
  });

  it('is fence-safe (a # inside a code block is not a heading)', () => {
    const md = [
      '# Real',      // 1
      '',            // 2
      '```',         // 3
      '# not a h1',  // 4
      '## not a h2', // 5
      '```',         // 6
      '## Real H2',  // 7
    ].join('\n');
    const ranges = sectionRanges(md);
    // Only headings at lines 1 and 7 (the ones inside the fence are ignored).
    expect(ranges.map((r) => r.headingLine)).toEqual([1, 7]);
    // The h1 has no same-or-higher heading after it (nothing is above h1), so it
    // runs to EOF (line 7) — the h2 at line 7 is nested inside it, not a sibling.
    expect(ranges[0].endLine).toBe(7);
    expect(ranges[1].endLine).toBe(7);
  });

  it('handles tildes fences too', () => {
    const md = ['# H', '~~~', '# nope', '~~~', 'body'].join('\n');
    const ranges = sectionRanges(md);
    expect(ranges.map((r) => r.headingLine)).toEqual([1]);
  });

  it('endLine is never less than headingLine (single-line section at EOF)', () => {
    const md = '## last';
    const ranges = sectionRanges(md);
    expect(ranges[0]).toEqual({ level: 2, headingLine: 1, startLine: 1, endLine: 1 });
  });
});

describe('foldedLineSet', () => {
  it('returns an empty set for empty text or empty collapsed set', () => {
    expect(foldedLineSet('', new Set([1])).size).toBe(0);
    expect(foldedLineSet('# H\nbody', new Set()).size).toBe(0);
    expect(foldedLineSet('# H\nbody', null).size).toBe(0);
  });

  it('hides the body lines of a single collapsed heading (heading stays visible)', () => {
    const md = '# Title\nbody1\nbody2\nbody3';
    // Heading is line 1; folding it hides lines 2,3,4 but NOT line 1.
    const hidden = foldedLineSet(md, new Set([1]));
    expect([...hidden].sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  it('does NOT hide the heading line itself', () => {
    const md = '## Section\na\nb';
    const hidden = foldedLineSet(md, new Set([1]));
    expect(hidden.has(1)).toBe(false);
  });

  it('respects section boundaries (a next-sibling heading ends the fold)', () => {
    const md = [
      '## A',  // 1
      'a1',    // 2
      '## B',  // 3
      'b1',    // 4
    ].join('\n');
    // Fold ## A only → hides line 2, not line 3 (## B is a sibling heading).
    const hidden = foldedLineSet(md, new Set([1]));
    expect([...hidden].sort((a, b) => a - b)).toEqual([2]);
  });

  it('nested headings: folding an h2 hides nested h3 bodies inside it', () => {
    const md = [
      '## H2',   // 1
      'h2 body', // 2
      '### H3',  // 3
      'h3 body', // 4
      '## Next', // 5
    ].join('\n');
    // Fold ## H2 → hides lines 2,3,4 (the h3 is INSIDE h2's section).
    const hidden = foldedLineSet(md, new Set([1]));
    expect([...hidden].sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  it('folding a nested h3 only hides its own body, not the parent h2 siblings', () => {
    const md = [
      '## H2',   // 1
      '### H3',  // 2
      'h3 body', // 3
      '## Next', // 4
    ].join('\n');
    // Fold ### H3 → hides line 3 only.
    const hidden = foldedLineSet(md, new Set([2]));
    expect([...hidden].sort((a, b) => a - b)).toEqual([3]);
  });

  it('multiple collapsed headings union their hidden lines', () => {
    const md = [
      '## A', // 1
      'a',    // 2
      '## B', // 3
      'b',    // 4
    ].join('\n');
    const hidden = foldedLineSet(md, new Set([1, 3]));
    expect([...hidden].sort((a, b) => a - b)).toEqual([2, 4]);
  });

  it('collapsing a heading that has no body hides nothing extra', () => {
    const md = '## Empty\n## Next';
    // ## Empty at line 1, endLine = 1 (next heading at line 2). Body = [] .
    const hidden = foldedLineSet(md, new Set([1]));
    expect(hidden.size).toBe(0);
  });

  it('ignores collapsed entries that are not heading lines (no-op)', () => {
    const md = '# H\nbody';
    // Line 2 is not a heading; collapsing it hides nothing.
    expect(foldedLineSet(md, new Set([2])).size).toBe(0);
  });
});

describe('foldedLineCount', () => {
  it('returns the body line count for a heading', () => {
    const md = '# H\na\nb\nc';
    expect(foldedLineCount(md, 1)).toBe(3);
  });

  it('returns 0 for a heading with no body', () => {
    const md = '## Empty\n## Next';
    expect(foldedLineCount(md, 1)).toBe(0);
  });

  it('respects section boundaries', () => {
    const md = ['## A', 'a', '## B', 'b', 'c'].join('\n');
    expect(foldedLineCount(md, 1)).toBe(1); // ## A: only line 2
    expect(foldedLineCount(md, 3)).toBe(2); // ## B: lines 4,5
  });

  it('returns 0 for an invalid heading line', () => {
    expect(foldedLineCount('# H\nbody', 999)).toBe(0);
    expect(foldedLineCount('', 1)).toBe(0);
    expect(foldedLineCount('# H\nbody', 0)).toBe(0);
  });
});
