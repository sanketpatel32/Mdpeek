// v0.56.0: Password-protected PDF support — pure classification of pdf.js
// load errors. When getDocument() rejects on an encrypted PDF, pdf.js throws a
// PasswordException whose `code` distinguishes "needs a password" from "wrong
// password". The viewer (src/views/pdf-viewer.js) uses this to decide whether
// to show the unlock prompt vs. surfacing a real error.
//
// Pure + DOM-free so the branching is unit-testable without pdf.js. Mirrors
// the lib/ + view/ split used by the rest of the app.
//
// pdf.js PasswordResponses codes:
//   1 = NEED_PASSWORD      (no password tried yet / doc is encrypted)
//   2 = INCORRECT_PASSWORD (a password was supplied but wrong)

// Classify a pdf.js load error. Returns:
//   'need'       — the document requires a password (none supplied yet)
//   'incorrect'  — a password was supplied but rejected
//   null         — not a password error (caller surfaces it as a real failure)
// Never throws; a malformed error object returns null.
export function classifyPasswordError(e) {
  if (!e) return null;
  // pdf.js sets `name: 'PasswordException'` and a numeric `code`. Some bundlers
  // strip the name on minified builds, so accept the code alone as a fallback.
  const name = e && typeof e.name === 'string' ? e.name : '';
  const isPasswordException = name === 'PasswordException';
  if (!isPasswordException) return null;
  if (e.code === 1) return 'need';
  if (e.code === 2) return 'incorrect';
  // Unknown PasswordException code — treat as needing a password so the prompt
  // shows (the user can still cancel out of it).
  return 'need';
}
