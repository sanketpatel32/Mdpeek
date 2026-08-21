// v0.45.0: Strip markdown syntax to plain text.
//
// Factored out of wordCount() in main.js so the same regex pipeline is reused
// by "Copy as plain text" and "Export to .txt" (and, indirectly, by the doc
// stats panel). Pure + DOM-free → unit-testable in isolation.
//
// What gets stripped (in order):
//   - fenced code blocks ```...```
//   - inline code `...`
//   - images ![alt](src)
//   - links: label kept, URL discarded → [text](url) becomes `text`
//   - ATX heading markers (# ...)
//   - unordered list markers (- * +)
//   - ordered list markers (1. )
//   - emphasis/strong/strikethrough (* _ ~)
//   - HTML comments <!-- ... -->
//   - raw HTML tags (<...>)
//
// Non-markdown prose, punctuation, and CJK pass through untouched. Returns
// the stripped text with markdown syntax removed but whitespace roughly
// preserved (so paragraph breaks still read as breaks).
export function stripMarkdown(text) {
  return (text || '')
    .replace(/```[\s\S]*?```/g, ' ')        // fenced code blocks
    .replace(/`[^`]*`/g, ' ')                // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')   // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → keep label text
    .replace(/^#{1,6}\s+/gm, ' ')            // headings
    .replace(/^\s*[-*+]\s+/gm, ' ')          // list markers
    .replace(/^\s*\d+\.\s+/gm, ' ')          // numbered lists
    .replace(/[*_~]+/g, ' ')                 // emphasis / strikethrough
    .replace(/<!--[\s\S]*?-->/g, ' ')        // HTML comments (body discarded)
    .replace(/<(?:\/|!)?[A-Za-z][^>]*>/g, ' '); // raw HTML tags (tag-shaped only,
                                                // so prose like "5 < 6 ... 7 > 3" survives)
}
