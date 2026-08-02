// v0.55.0: Editor region folding — pure line-math for "which lines belong to
// this heading's section?" and "which lines should be hidden given the set of
// collapsed headings?" The view (editor.js) consumes these to mask folded
// regions; folding is purely visual and never mutates textarea.value.
//
// Reuses extractHeadings from editor-logic.js so "is the caret in a table?"
// (and the jump-to-heading picker) agree with "where does this section end?"
// extractHeadings tracks level + fence state, so a `# comment` inside a fenced
// block isn't mistaken for an h1.
//
// Line numbers are 1-indexed throughout (matching the gutter + extractHeadings).

import { extractHeadings } from './editor-logic.js';

// Compute the inclusive section range for every heading in `text`. Each entry is
// { level, headingLine, startLine, endLine } where:
//   - headingLine: the heading's own line (1-indexed)
//   - startLine: headingLine (the section includes its heading)
//   - endLine:   the last line of the section (inclusive, 1-indexed). It ends at
//                the line BEFORE the next heading of the same-or-higher level,
//                or at the document's last line if none follows.
// Folding an h2 hides everything until the next h1 or h2, including nested h3+,
// matching the rendered-view folding semantics. h1 is included (the editor
// benefits from top-level fold; the rendered view skips it).
export function sectionRanges(text) {
  if (!text) return [];
  const headings = extractHeadings(text);
  if (headings.length === 0) return [];
  const totalLines = text.split('\n').length;
  const out = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    // Find the next heading of the same-or-higher level.
    let endLine = totalLines;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        endLine = headings[j].line - 1; // section ends the line before it
        break;
      }
    }
    out.push({
      level: h.level,
      headingLine: h.line,
      startLine: h.line,
      endLine: Math.max(h.line, endLine),
    });
  }
  return out;
}

// Given the source text + a Set of heading-line numbers that are currently
// collapsed, return the Set of line numbers (1-indexed) that should be hidden.
// A collapsed heading hides its section body — the lines AFTER the heading up to
// and including endLine — but keeps the heading line itself visible (the gutter
// caret sits on the heading). Returns an empty Set when nothing is collapsed.
export function foldedLineSet(text, collapsedHeadings) {
  const out = new Set();
  if (!text) return out;
  const collapsed = collapsedHeadings instanceof Set ? collapsedHeadings : new Set();
  if (collapsed.size === 0) return out;
  const ranges = sectionRanges(text);
  for (const r of ranges) {
    if (collapsed.has(r.headingLine)) {
      // Hide [headingLine+1, endLine] inclusive. The heading stays visible.
      for (let ln = r.headingLine + 1; ln <= r.endLine; ln++) out.add(ln);
    }
  }
  return out;
}

// Count how many lines a single collapsed heading would hide. Used by the view
// to label the fold chip ("⌄ N lines folded"). Pure; reads from sectionRanges.
export function foldedLineCount(text, headingLine) {
  if (!text || !headingLine) return 0;
  const r = sectionRanges(text).find((s) => s.headingLine === headingLine);
  if (!r) return 0;
  return Math.max(0, r.endLine - r.headingLine);
}
