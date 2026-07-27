// Slideshow speaker-notes parser (v0.40.0). Pure function — no DOM.
//
// Strips speaker notes out of a slide's markdown source so they don't render
// on the visible slide, and returns them separately for the speaker-notes
// panel. Two syntaxes are supported (both case-insensitive):
//
//   note: remember to mention the deadline      ← bare line, anywhere
//   <!-- note: this stays hidden on the slide --> ← HTML comment form
//
// The `note:` line form anchors at the start of a line (after optional
// leading spaces/tabs), so a `note:` mid-paragraph or inside a code block
// (which is indented 4+ spaces or fenced) is NOT treated as a speaker note
// unless it happens to sit at column 0 of its own line — the same convention
// other note-aware tools (Marp, reveal.js) use.

const NOTE_LINE = /^[ \t]*note:[ \t]?(.*)$/gmi;
const NOTE_COMMENT = /<!--\s*note:[ \t]?(.*?)\s*-->/gsi;

export function extractSpeakerNotes(slideMd) {
  if (!slideMd) return { cleanMd: '', note: '' };
  const notes = [];

  // HTML comments first — `.` with the `s` flag spans newlines, so a comment
  // can wrap multiple lines. Collect the body, drop the whole comment.
  let clean = slideMd.replace(NOTE_COMMENT, (_whole, body) => {
    const text = body && body.trim();
    if (text) notes.push(text);
    return '';
  });

  // Then bare `note:` lines. The `m` flag makes `^` match every line start.
  clean = clean.replace(NOTE_LINE, (_whole, body) => {
    const text = body && body.trim();
    if (text) notes.push(text);
    return '';
  });

  // Collapse the runs of blank lines left behind by the removals so the slide
  // doesn't end up with awkward vertical gaps.
  clean = clean.replace(/\n{3,}/g, '\n\n').trim();

  return { cleanMd: clean, note: notes.join('\n') };
}
