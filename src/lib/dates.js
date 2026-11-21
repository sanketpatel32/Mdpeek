// Date utilities. Pure functions — no DOM, no I/O.

/** Count words in a chunk of text. */
export function countWords(text) {
  if (!text) return 0;
  const m = String(text).trim().match(/\S+/g);
  return m ? m.length : 0;
}
