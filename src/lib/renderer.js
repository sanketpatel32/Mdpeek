import { convertFileSrc } from '@tauri-apps/api/core';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
// Import the curated "common" subset (~36 languages: js, ts, python, rust, go,
// bash, json, yaml, sql, html, css, etc.) instead of the full 190+ language
// build. This cuts the entry chunk by ~700KB without affecting the vast
// majority of real-world docs. Unknown languages gracefully fall back to
// plaintext (handled below).
import hljs from 'highlight.js/lib/common';
import markedKatex from 'marked-katex-extension';
import markedFootnote from 'marked-footnote';
import { markedEmojiExt } from './emoji.js';
import { markedHighlightExt } from './highlight.js';
import { markedDefinitionLists } from './definition-lists.js';
import { markedSubSup, expandSuperscript, expandSpoilers } from './subsup.js';
import { parseImageSize } from './image-size.js';
import { escapeHtml } from './escape.js';
import { extractAbbreviations, applyAbbreviations } from './abbreviations.js';
import { findComplexWords, isDenseParagraph } from './prose.js';
import { overusedWords, findWordsInText } from './wordfreq.js';
import { extractFrontMatter, renderFrontMatterTable } from './frontmatter.js';

// Local escapeText — escapes only & < > (NOT quotes). Used for TEXT CONTENT
// (code block bodies, mermaid source). Deliberately different from the shared
// src/lib/escape.js `escapeHtml` (which also escapes " '): renderer text
// content is always passed through DOMPurify, and using the quote-escaping
// variant inside code blocks would double-escape. For ATTRIBUTE values we use
// the shared escapeHtml (imported above) which correctly escapes quotes.
function escapeText(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ----------------------------- wiki-links ---------------------------------
// Convert Obsidian-style [[Target]] and [[Target|Display]] into standard
// markdown links before marked sees them. Target gets a .md extension if it
// has none. Skips fenced code blocks (``` ... ```) and inline code (`...`)
// so code containing [[ stays literal.
//
// Examples:
//   [[README]]              → [README](README.md)
//   [[notes/jan|January]]   → [January](notes/jan.md)
//   [[2026-07-19]]          → [2026-07-19](2026-07-19.md)
function preprocessWikiLinks(md) {
  if (!md || !md.includes('[[')) return md;
  // Split out fenced blocks so we don't touch their contents.
  const fenceRe = /```[\s\S]*?```|`[^`\n]*`/g;
  const out = [];
  let last = 0;
  let m;
  // Walk the string, transforming wiki-links only in the non-code spans.
  while ((m = fenceRe.exec(md)) !== null) {
    out.push(transformWikiLinks(md.slice(last, m.index)));
    out.push(m[0]); // preserve code verbatim
    last = m.index + m[0].length;
  }
  out.push(transformWikiLinks(md.slice(last)));
  return out.join('');
}
function transformWikiLinks(s) {
  // [[target]] or [[target|display]]. Target may contain slashes for paths.
  return s.replace(/\[\[([^[\]]+?)\]\]/g, (whole, body) => {
    const [rawTarget, ...rest] = body.split('|');
    const target = rawTarget.trim();
    if (!target) return whole;
    const display = (rest.length ? rest.join('|') : target).trim();
    const href = /\.(md|markdown|mdx|txt|pdf)$/i.test(target) ? target : `${target}.md`;
    // Angle-bracket wrap so paths with spaces don't break the markdown link.
    return `[${display}](${href.includes(' ') ? `<${href}>` : href})`;
  });
}

// Expand a standalone `[[toc]]` marker into a markdown bullet list of the
// document's headings, so a generated table of contents can be placed inline
// anywhere in the body. Runs BEFORE preprocessWikiLinks (so the marker isn't
// turned into a wiki-link) and skips fenced/inline code.
//
//   [[toc]]  →  "- [# H1](#h1)\n- [## H2](#h2)\n..."
//
// The anchor slugs match what slugify() (used by the heading-id hook) emits,
// so the links resolve. Headings inside fenced code are skipped, matching
// extractHeadings. If no marker is present, returns `md` unchanged.
export function expandTocMarker(md) {
  if (!md || !md.includes('[[toc]]')) return md;
  const fenceRe = /```[\s\S]*?```|`[^`\n]*`/g;
  const headings = [];
  // First pass: collect headings from non-code spans.
  let last = 0;
  let m;
  const spans = [];
  while ((m = fenceRe.exec(md)) !== null) {
    spans.push({ code: false, text: md.slice(last, m.index) });
    spans.push({ code: true, text: m[0] });
    last = m.index + m[0].length;
  }
  spans.push({ code: false, text: md.slice(last) });

  const headingRe = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  const slugCounts = new Map();
  for (const span of spans) {
    if (span.code) continue;
    for (const line of span.text.split('\n')) {
      const hm = line.match(headingRe);
      if (!hm) continue;
      const level = hm[1].length;
      const text = hm[2];
      let slug = slugify(text);
      if (!slug) continue;
      // Dedupe slugs the same way the heading-id hook does (suffix -1, -2...).
     const seen = slugCounts.get(slug) || 0;
      const n = seen + 1;
      slugCounts.set(slug, n);
      if (n > 1) slug = `${slug}-${n}`;
      headings.push({ level, text, slug });
    }
  }

  // Second pass: replace `[[toc]]` lines with the generated list. Only a
  // marker alone on its line (allowing leading whitespace) is expanded — an
  // inline `text [[toc]]` is left alone so we don't surprise the user.
  const tocMd = headings
    .map((h) => `${'  '.repeat(h.level - 1)}- [${h.text}](#${h.slug})`)
    .join('\n');
  // Build the output by walking spans again; replace in non-code spans only.
  let out = '';
  for (const span of spans) {
    if (span.code) { out += span.text; continue; }
    out += span.text.replace(/^(\s*)\[\[toc\]\]\s*$/gm, (_whole, indent) => {
      // Re-indent each generated line to match the marker's indent so the
      // TOC nests correctly under a list item if the user indented it.
      if (!indent) return tocMd;
      return tocMd
        .split('\n')
        .map((l) => (l ? indent + l : l))
        .join('\n');
    });
  }
  return out;
}

// ----------------------------- admonitions --------------------------------
// Rewrite mkDocs/Material/Obsidian `!!! type` admonition blocks into the
// GFM alert syntax (`> [!TYPE]`) that the blockquote renderer already themes
// (see detectAlert + .markdown-alert-* CSS). Runs as a pre-pass so users with
// existing `!!!` docs get the same themed callouts for free, with zero new
// CSS or renderer code.
//
// Grammar (Python-Markdown admonition convention):
//   !!! type "Optional title"
//       indented body line 1
//       indented body line 2
//
//   →  > [!TYPE] Optional title
//      > indented body line 1
//      > indented body line 2
//
// The body must be indented (≥4 spaces / 1 tab) under the `!!!` line; a line
// with less indentation ends the block. Body indentation is stripped by one
// level when re-emitted as blockquoted content. Recognized types cover the
// full mkDocs set; unknown types map to NOTE for the icon but keep their
// keyword in the rendered title (so `!!! weather` still renders, just with
// the info icon). Passes through unchanged if no `!!!` line is present.
const ADMONITION_TYPES = new Set([
  'note', 'abstract', 'info', 'tip', 'success', 'question', 'warning',
  'failure', 'danger', 'bug', 'example', 'quote', 'done', 'info',
]);
// Map arbitrary mkDocs types to one of the 5 GFM alert types the renderer
// recognizes (NOTE/TIP/IMPORTANT/WARNING/CAUTION). Anything unmapped → NOTE.
function alertTypeFor(kind) {
  const k = kind.toLowerCase();
  if (k === 'tip') return 'TIP';
  if (k === 'warning') return 'WARNING';
  if (k === 'danger' || k === 'caution' || k === 'failure' || k === 'bug' || k === 'error') return 'CAUTION';
  if (k === 'success' || k === 'done' || k === 'check' || k === 'example' || k === 'abstract' || k === 'question' || k === 'important') return 'IMPORTANT';
  return 'NOTE'; // note, info, quote, summary, etc.
}

export function expandAdmonitions(md) {
  if (!md || md.indexOf('!!!') === -1) return md;
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^!!!\s+([A-Za-z][\w-]*)(?:\s+"([^"]*)")?\s*$/);
    if (!m) { out.push(lines[i]); i++; continue; }
    const kind = m[1];
    const title = m[2] || '';
    const alertType = alertTypeFor(kind);
    // Header line: `> [!TYPE]` + optional title (title shown after the marker
    // so detectAlert still strips the `[!TYPE]` prefix correctly).
    const header = title
      ? `> [!${alertType}] ${title}`
      : `> [!${alertType}]`;
    out.push(header);
    i++;
    // Consume the indented body. mkDocs uses 4-space indent; we accept any
    // leading whitespace (≥1 space or a tab). Stop at the first non-blank
    // line with no indent, but keep blank lines that separate body paragraphs
    // (a blank line followed by a non-indented line ends the block).
    let blanks = [];
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { blanks.push(line); i++; continue; }
      const bodyM = line.match(/^( {1,8}|\t)(.*)$/);
      if (!bodyM) break; // non-indented non-blank line ends the block
      // Flush any pending blank lines (now that we know the block continues).
      for (const b of blanks) out.push('>');
      blanks = [];
      out.push(`> ${bodyM[2]}`);
      i++;
    }
    // Trailing blank lines belong to the surrounding doc, not the block.
    for (const b of blanks) out.push(b);
  }
  return out.join('\n');
}

// v0.46.0: mkDocs/Material collapsible admonitions.
//
//   ??? note "Click me"      → collapsed by default
//   ???+ note "Click me"     → open by default
//
// followed by an indented body, become a native <details>/<summary> pair with
// the body rendered as normal markdown. The summary carries the mapped GFM
// alert icon (same icon set as `!!!` admonitions). The body markdown is
// rendered inline by marked because we emit it inside the <details> wrapper
// as a raw HTML block (marked passes raw HTML through).
//
// This is a sibling of `!!!` (non-collapsible). The syntaxes don't collide:
// `!!!` is always-on, `???` is collapsible.
//
// Gated on `???` so zero cost otherwise. Mirrors expandAdmonitions exactly:
// optional `"title"` (defaults to the type keyword), indented body, trailing
// blank lines left for the surrounding doc.
export function expandCollapsible(md) {
  if (!md || md.indexOf('???') === -1) return md;
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    // `???` (collapsed) or `???+` (open), then a type keyword, then optional
    // quoted title.
    const m = lines[i].match(/^(\?\?\?)(\+)?\s+([A-Za-z][\w-]*)(?:\s+"([^"]*)")?\s*$/);
    if (!m) { out.push(lines[i]); i++; continue; }
    const open = m[2] === '+';
    const kind = m[3];
    const title = m[4] || kind;
    const alertType = alertTypeFor(kind);
    const icon = ALERT_TYPES[alertType] || '';
    // Collect the indented body (same rule as expandAdmonitions).
    i++;
    const body = [];
    let blanks = [];
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { blanks.push(line); i++; continue; }
      const bodyM = line.match(/^( {1,8}|\t)(.*)$/);
      if (!bodyM) break;
      for (const b of blanks) body.push('');
      blanks = [];
      body.push(bodyM[2]);
      i++;
    }
    for (const b of blanks) out.push(b);
    // Emit the raw HTML block. marked passes well-formed raw HTML through, and
    // the body lines (now dedented) re-parse as markdown inside the block.
    const openAttr = open ? ' open' : '';
    const bodyHtml = body.join('\n');
    out.push(`<details class="mdpeek-collapsible"${openAttr}><summary>${icon}${title}</summary>`);
    out.push('');
    out.push(bodyHtml);
    out.push('');
    out.push('</details>');
  }
  return out.join('\n');
}

// GitHub-compatible slug: lowercase, spaces→hyphens, strip everything that
// isn't alphanumeric or hyphen. Empty result → null (caller falls back).
function slugify(text) {
  const slug = String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')   // strip punctuation (keep word chars, spaces, hyphens)
    .replace(/[\s_]+/g, '-')     // spaces / underscores → single hyphen
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || null;
}

// Per-render slug dedupe map. Reset at the start of each renderMarkdown() call
// so two docs rendered in the same session don't collide. Keys = slug,
// values = count seen so far.
let _slugCounts = new Map();
function uniqueSlug(base) {
  if (!base) return null;
  const n = (_slugCounts.get(base) || 0) + 1;
  _slugCounts.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

// --------------------- dynamic highlight.js languages --------------------
// Languages beyond the "common" subset that we register on first use. Each is
// a dynamic import — zero cost to the entry chunk until a doc actually uses it.
const EXTRA_LANGS = [
  'dockerfile', 'ini', 'properties', 'toml', 'makefile',
  'latex', 'nginx', 'diff', 'protobuf', 'groovy',
];
const _registered = new Set();

// Returns true if `lang` is or could be registered. Kicks off the dynamic
// import for extras on first sighting (async, fire-and-forget — the current
// render falls back to plaintext, the next render gets the real thing).
async function ensureLang(lang) {
  if (!lang || _registered.has(lang)) return _registered.has(lang);
  const alias = hljs.getLanguage(lang); // already registered under an alias?
  if (alias) {
    _registered.add(lang);
    return true;
  }
  const name = EXTRA_LANGS.includes(lang) ? lang : null;
  if (!name) return false;
  try {
    const mod = await import(/* @vite-ignore */ `highlight.js/lib/languages/${name}.js`);
    hljs.registerLanguage(name, mod.default);
    _registered.add(name);
    // Registered languages change code-fence output, and cached renders may
    // hold plaintext fallbacks for these fences. Drop the cache so the
    // event-triggered re-render actually picks up the highlighting.
    _cache.clear();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hljs-language-registered', { detail: { lang: name } }));
    }
    return true;
  } catch {
    return false; // import failed (offline / typo) — fall back to plaintext
  }
}

// v0.62.0: Parse a fenced-code info string into parts. marked hands the whole
// post-fence string to the code renderer as `lang`, so we split it here:
//
//   parseFenceInfo('js title="app.js" {1,3-5}')
//     → { lang: 'js', title: 'app.js', lines: Set{1,3,4,5} }
//   parseFenceInfo('js app.js')        → { lang: 'js', title: 'app.js', lines: null }
//   parseFenceInfo('python')           → { lang: 'python', title: null, lines: null }
//
// `title="…"` / `title='…'` (Nextra/Docusaurus convention) or a bare trailing
// token containing a dot (filename shorthand) set the title. `{1,3-5}` sets
// the highlighted-line set (1-indexed, ranges inclusive). Exported for tests.
export function parseFenceInfo(info) {
  const raw = String(info || '').trim();
  if (!raw) return { lang: null, title: null, lines: null };
  const parts = raw.split(/\s+/);
  const lang = parts[0] || null;
  let title = null;
  let lineSpec = null;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const t = p.match(/^title=("([^"]*)"|'([^']*)')$/);
    if (t) { title = t[2] ?? t[3] ?? ''; continue; }
    // Bare quoted filename: ```js 'main.py'
    const q = p.match(/^("([^"]*)"|'([^']*)')$/);
    if (q) { title = q[2] ?? q[3] ?? ''; continue; }
    const l = p.match(/^\{([\d,\s-]+)\}$/);
    if (l) { lineSpec = l[1]; continue; }
    // Bare filename: contains a dot, isn't a flag-ish token.
    if (!title && /\./.test(p) && !/[{}'"]/.test(p)) title = p;
  }
  return { lang, title, lines: lineSpec ? parseLineSpec(lineSpec) : null };
}

// Parse "1, 3-5" into a Set of 1-indexed line numbers. Exported for tests.
export function parseLineSpec(spec) {
  const lines = new Set();
  for (const part of String(spec).split(',')) {
    const range = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!range) continue;
    const a = parseInt(range[1], 10);
    const b = range[2] ? parseInt(range[2], 10) : a;
    // Guard against pathological ranges (e.g. 1-99999999) by capping span.
    const lo = Math.min(a, b);
    const hi = Math.min(Math.max(a, b), lo + 5000);
    for (let n = lo; n <= hi; n++) lines.add(n);
  }
  return lines;
}

// Wrap each line of already-highlighted HTML in a block-level span so CSS can
// target individual lines, adding `highlighted` to the lines in `lines`
// (1-indexed). Splitting on '\n' is safe with hljs output — its spans never
// cross newlines (newlines are emitted as plain text between tags). Empty
// trailing line (from the fence's final newline) is left unwrapped.
function wrapHighlightedLines(html, lines) {
  const all = html.split('\n');
  const out = all.map((line, i) => {
    if (i === all.length - 1 && line === '') return '';
    const cls = lines.has(i + 1) ? 'code-line highlighted' : 'code-line';
    return `<span class="${cls}">${line}</span>`;
  });
  return out.join('\n');
}

function buildMarked() {
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  marked.use(markedFootnote());
  marked.use(markedEmojiExt());
  marked.use(markedDefinitionLists());
  marked.use(markedSubSup());
  marked.use(markedHighlightExt());
  marked.use({
    // breaks:true makes a single newline render as a <br>, matching how every
    // modern note app behaves (Obsidian default, Notion, Discord, Typora). The
    // editor is a textarea where users press Enter expecting a visual line
    // break — without this, a single Enter is invisible in the preview and you
    // must end the line with two spaces (CommonMark/GitHub strict mode), which
    // no one does. Two newlines still make a new paragraph as usual.
    breaks: true,
    renderer: {
      // Override heading to inject slug-based ids. The token carries `text`
      // (plain) and `tokens` (for inline rendering); we slugify the plain text
      // and render the tokens for the inner HTML.
      image({ href, title, text }) {
        // v0.45.0: parse image-size syntax (GitHub "=WxH" in title, Obsidian
        // "|W" in alt) and strip the size tokens from the displayed attrs.
        const { alt, title: cleanTitle, width, height } = parseImageSize({ href, title, text });
        let src = href || '';
        if (src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
          if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
            try {
              const rawPath = decodeURI(src).replace(/^file:\/\/\/?/, '');
              src = convertFileSrc(rawPath);
            } catch (e) {
              // fallback
            }
          }
        }
        // escapeHtml here is the shared src/lib/escape.js variant (escapes
        // & < > " ') — correct for attribute values. (v0.45.0 fix: previously
        // this called an undefined `escapeAttr`, which threw on every image
        // with an alt/title and crashed the render.)
        const titleAttr = cleanTitle ? ` title="${escapeHtml(cleanTitle)}"` : '';
        const altAttr = alt ? ` alt="${escapeHtml(alt)}"` : ' alt=""';
        const wAttr = width ? ` width="${width}"` : '';
        const hAttr = height ? ` height="${height}"` : '';
        // loading="lazy" defers offscreen image decode until it nears the
        // viewport, so long image-heavy docs scroll smoothly instead of
        // decoding every image upfront. The browser handles the intersection
        // observation natively; no JS cost.
        return `<img src="${escapeHtml(src)}"${altAttr}${titleAttr}${wAttr}${hAttr} loading="lazy" decoding="async" />`;
      },
      heading({ tokens, depth, text }) {
        let inner = this.parser.parseInline(tokens);
        // v0.62.0: Pandoc/Obsidian custom heading ids — `## Heading {#my-id}`.
        // The trailing `{#id}` (if present) becomes the anchor id and is
        // stripped from the rendered text. Strip from the rendered HTML (not
        // the token) so it also works when the id text sits inside inline
        // formatting; if it can't be stripped, fall through to the auto-slug.
        let id = null;
        const custom = String(text).match(/\s*\{#([A-Za-z][\w-]*)\}\s*$/);
        if (custom) {
          const stripped = inner.replace(/\s*\{#[A-Za-z][\w-]*\}\s*$/, '');
          if (stripped !== inner) {
            inner = stripped;
            id = uniqueSlug(custom[1]);
          }
        }
        if (!id) id = uniqueSlug(slugify(text));
        const tag = `h${depth}`;
        return id
          ? `<${tag} id="${id}">${inner}</${tag}>`
          : `<${tag}>${inner}</${tag}>`;
      },
      // GFM alert callouts: a blockquote whose first line is [!NOTE], [!TIP],
      // [!IMPORTANT], [!WARNING], or [!CAUTION]. marked v18 doesn't ship alerts
      // built-in, so we detect the marker in the first paragraph token, strip
      // it, and render a themed callout instead of a plain blockquote.
      blockquote({ tokens }) {
        const alert = detectAlert(tokens);
        if (!alert) {
          return `<blockquote>\n${this.parser.parse(tokens)}</blockquote>`;
        }
        // Strip the consumed marker text from the first paragraph's leading
        // text token so it doesn't appear in the rendered body. Any text left
        // on the marker line is a custom title (e.g. `> [!TIP] Pro tip`) —
        // shown in the header instead of the body. The `br` that follows
        // (breaks:true splits the marker line from the body) is dropped too,
        // otherwise every callout body starts with a stray blank line.
        const firstPara = tokens.find((t) => t.type === 'paragraph');
        if (firstPara && firstPara.tokens && firstPara.tokens[0]) {
          const t0 = firstPara.tokens[0];
          const lead = t0.text || t0.raw || '';
          const m = lead.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(.*)$/i);
          if (m) {
            if (m[2].trim()) alert.title = m[2].trim();
            t0.text = '';
            const idx = firstPara.tokens.indexOf(t0);
            if (idx !== -1 && firstPara.tokens[idx + 1] && firstPara.tokens[idx + 1].type === 'br') {
              firstPara.tokens.splice(idx + 1, 1);
            }
          }
        }
        const body = this.parser.parse(tokens);
        const title = escapeHtml(alert.title || alert.type);
        return (
          `<blockquote class="markdown-alert markdown-alert-${alert.type}">` +
          `<p class="markdown-alert-title">${alert.icon}${title}</p>` +
          `${body}</blockquote>`
        );
      },
      code({ text, lang }) {
        // v0.62.0: fence info strings — ```js title="app.js" {1,3-5} — carry a
        // filename header and/or a line-highlight spec alongside the language.
        // marked puts the whole info string in `lang`; parse it apart.
        const { lang: language0, title, lines } = parseFenceInfo(lang);
        if (language0 === 'mermaid') {
          // Escape so a fence containing `</div>` can't break out of the wrapper.
          return `<div class="mermaid">${escapeText(text)}</div>`;
        }
        const language = language0 && hljs.getLanguage(language0) ? language0 : 'plaintext';
        let highlighted;
        try {
          highlighted = language === 'plaintext'
            ? escapeText(text)
            : hljs.highlight(text, { language }).value;
        } catch {
          highlighted = escapeText(text);
        }
        if (lines) {
          highlighted = wrapHighlightedLines(highlighted, lines);
        }
        const codeHtml = `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
        if (!title) return codeHtml;
        // Filename header bar above the block. The title is attribute-escaped;
        // data-title lets CSS/tests find it without trusting the inner text.
        return (
          `<div class="code-block" data-title="${escapeHtml(title)}">` +
          `<div class="code-title">${escapeHtml(title)}</div>` +
          codeHtml +
          `</div>`
        );
      },
    },
  });
  return marked;
}

// Inspect the first paragraph inside a blockquote for a GFM alert marker
// like `[!NOTE]`. Returns { type, icon } or null. The marker comes through as
// a paragraph token whose text starts with the bracketed keyword.
const ALERT_TYPES = {
  NOTE: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  TIP: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.546.896.546 1.595a.75.75 0 0 1-1.5 0c0-.372-.111-.61-.328-.926-.165-.242-.34-.464-.565-.7l-.214-.253C3.285 8.835 2.5 7.893 2.5 5.25 2.5 2.694 4.861.5 8 .5s5.5 2.194 5.5 4.75c0 3.643-1.785 4.585-2.71 5.7l-.214.253c-.217.265-.328.503-.328.926a.75.75 0 0 1-1.5 0c0-.699.262-1.184.546-1.595.203-.292.45-.584.673-.848l.214-.253c.56-.679.984-1.32.984-2.304 0-2.06-1.637-3.75-4-3.75ZM6.016 13.75a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>',
  IMPORTANT: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.189l2.72-2.72a.749.749 0 0 1 .53-.219h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  WARNING: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  CAUTION: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
};
function detectAlert(tokens) {
  // The first child token is typically a paragraph whose text begins with the
  // alert marker, e.g. "[!NOTE]". It may be split into text + the rest.
  const first = tokens.find((t) => t.type === 'paragraph');
  if (!first || !first.tokens) return null;
  // Reconstruct the leading text from the paragraph's inline tokens.
  let lead = '';
  for (const t of first.tokens) {
    if (t.type === 'text') lead += t.text || t.raw || '';
    else break;
    if (lead.length > 32) break; // marker is short; stop early
  }
  const m = lead.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
  if (!m) return null;
  const type = m[1].toUpperCase();
  return { type, icon: ALERT_TYPES[type] || '' };
}

const marked = buildMarked();

// ----------------------------- render cache --------------------------------
// LRU-ish cache of raw-md → sanitized HTML. Capped at 64 entries; the oldest
// is evicted on overflow. Keyed by content, so edits produce fresh keys and
// stale entries naturally age out. Big win for tab-switch re-renders.
const CACHE_MAX = 64;
const _cache = new Map();
function cacheGet(key) {
  if (!_cache.has(key)) return undefined;
  // Refresh recency: delete + re-set so the key moves to the end (newest).
  const val = _cache.get(key);
  _cache.delete(key);
  _cache.set(key, val);
  return val;
}
function cacheSet(key, val) {
  if (_cache.size >= CACHE_MAX) {
    // Map iterates in insertion order; first entry is oldest.
    _cache.delete(_cache.keys().next().value);
  }
  _cache.set(key, val);
}

// --------------------------- DOMPurify hardening --------------------------
// One-time hook: force every link to open safely (target=_blank + noopener).
// Belt-and-suspenders alongside the opener-plugin click handler that already
// routes external URLs to the system browser.
let _purifyHookAdded = false;
function ensurePurifyHook() {
  if (_purifyHookAdded || typeof window === 'undefined') return;
  _purifyHookAdded = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

// Note: DOMPurify requires a DOM `window`. It resolves automatically under
// jsdom (tests) and inside the WebView2 (production), but cannot be called
// from plain Node without one.
export function renderMarkdown(md) {
  ensurePurifyHook();
  const input = md ?? '';
  const cached = cacheGet(input);
  if (cached !== undefined) return cached;

  // Reset slug dedupe so each render is self-contained.
  _slugCounts = new Map();
  // v0.62.0: pull a leading YAML front-matter block out of the source before
  // any other preprocessing (its `---` fences would otherwise confuse the
  // admonition/wiki-link passes and render as a broken <hr> + raw text).
  const { md: fmStripped, meta } = extractFrontMatter(input);
  // v0.46.0: Markdown Extra abbreviation references. Pull the `*[KEY]: exp`
  // definitions out first (they're removed from the source), then wrap whole-
  // word occurrences of each key. Gated on `*[` so zero cost otherwise.
  const { md: abbrCleaned, abbrs } = extractAbbreviations(fmStripped);
  // Rewrite mkDocs `!!! type` admonitions into GFM `> [!TYPE]` alerts so the
  // existing blockquote callout renderer themes them. Must run BEFORE the
  // other pre-passes (the `>` prefix we emit could confuse them otherwise).
  const admExpanded = expandAdmonitions(abbrCleaned);
  // v0.46.0: Expand mkDocs collapsible `???` admonitions into <details> raw
  // HTML blocks. Runs after `!!!` (non-collapsible) so the two don't interact.
  const collExpanded = expandCollapsible(admExpanded);
  // Expand any [[toc]] markers into an inline heading list BEFORE wiki-link
  // preprocessing (otherwise [[toc]] would be rewritten as a wiki-link).
  const tocExpanded = expandTocMarker(collExpanded);
  // Expand Pandoc-style superscript `x^2^` → `x<sup>2</sup>` BEFORE marked.
  // Necessary because marked's GFM inline text tokenizer eats `^` as a plain
  // char (it's not in the text stop-set), so a tokenizer extension never
  // gets a chance. Subscript `~` is handled by a marked extension instead
  // (marked stops at `~`). Skips fenced/inline code.
  const supExpanded = expandSuperscript(tocExpanded);
  // v0.46.0: Expand Discord-style spoilers `||secret||` → <span class="spoiler">.
  // Runs after superscript (same fence-split reason); gated on `||`.
  const spoilerExpanded = expandSpoilers(supExpanded);
  // Preprocess Obsidian-style wiki-links: [[Target]] → [Target](Target.md)
  // and [[Target|Display]] → [Display](Target.md). Done before marked so the
  // result is a standard markdown link rendered like any other. Code blocks
  // and inline code are skipped to avoid mangling code that contains [[ ]].
  const processed = preprocessWikiLinks(spoilerExpanded);
  // v0.46.0: Apply abbreviation wrapping AFTER all preprocessing (so the
  // definition-removal and other transforms have run) but BEFORE marked.parse
  // (so marked sees the <abbr> tags as raw HTML and passes them through). The
  // wrapper skips fenced/inline code and link destinations.
  const abbrApplied = abbrs.size > 0 ? applyAbbreviations(processed, abbrs) : processed;
  const raw = marked.parse(abbrApplied, { async: false });
  // The front-matter table is fully HTML-escaped by renderFrontMatterTable, so
  // it's prepended after sanitize rather than routed through DOMPurify.
  const html = renderFrontMatterTable(meta) + DOMPurify.sanitize(raw);
  cacheSet(input, html);
  return html;
}

// Highlight a whole text/code document with highlight.js. Used by the code-file
// viewer (non-markdown source files opened in mdpeek). Returns sanitized HTML
// wrapped in a <pre><code> pair, styled by the existing hljs theme stylesheets.
//
// `lang` is the hljs language id from langFromPath() (e.g. 'javascript'). If
// the language isn't loaded yet (an EXTRA_LANGS entry), this renders plaintext
// immediately and triggers async registration — the caller re-renders after
// registration completes (see prepareCodeLang()).
export function renderCode(text, lang) {
  const input = text ?? '';
  const language = lang && hljs.getLanguage(lang) ? lang : null;
  let highlighted;
  try {
    highlighted = language
      ? hljs.highlight(input, { language }).value
      : escapeText(input);
  } catch {
    highlighted = escapeText(input);
  }
  // v0.61.4: linkify bare http(s):// URLs in the highlighted output so code
  // files (Python, shell, config, etc.) get clickable links — matching what
  // GitHub does on code file views. Runs on the already-escaped HTML, skipping
  // tag interiors (<...>) so it only touches text nodes. The URLs in hljs
  // spans are already HTML-escaped (e.g. &amp;), so we match on the escaped
  // form and re-escape inside the href.
  highlighted = linkifyCodeUrls(highlighted);
  // Build a line-number gutter matching the source's line count. The gutter
  // and <pre> share line-height so they stay aligned row-for-row; both live
  // inside a flex wrapper that the outer .code-viewer (set on el.document by
  // main.js) scrolls.
  const lineCount = input.split('\n').length;
  const gutter = Array.from({ length: lineCount }, (_, i) => `<div>${i + 1}</div>`).join('');
  ensurePurifyHook();
  const raw =
    `<div class="code-viewer-inner">` +
    `<div class="code-gutter" aria-hidden="true">${gutter}</div>` +
    `<pre class="code-pre"><code class="hljs language-${language || 'plaintext'}">${highlighted}</code></pre>` +
    `</div>`;
  return DOMPurify.sanitize(raw);
}

// v0.61.4: Linkify bare http(s):// URLs inside highlighted code HTML. Walks
// the string skipping tag interiors (<...>) so we only touch text nodes,
// never attributes (where a URL might already be an href). Each matched URL
// is wrapped in an <a target="_blank" rel="noopener noreferrer">. The href is
// HTML-escaped (the matched text is already-escaped source, so &amp; etc. are
// present and preserved). Pure, no DOM.
const CODE_URL_RE = /https?:\/\/[^\s<>"'`)|\]]+/ig;
export function linkifyCodeUrls(html) {
  if (!html) return html;
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      // Tail segment — pure text, safe to linkify.
      out += html.slice(i).replace(CODE_URL_RE, (url) => {
        // Strip trailing punctuation that's unlikely part of the URL but
        // commonly sits right after it in prose/comments.
        const cleaned = url.replace(/[.,;:!)]+$/, '');
        const href = escapeHtml(cleaned);
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
      });
      break;
    }
    // Text run before the tag — linkify it.
    if (lt > i) {
      out += html.slice(i, lt).replace(CODE_URL_RE, (url) => {
        const cleaned = url.replace(/[.,;:!)]+$/, '');
        const href = escapeHtml(cleaned);
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
      });
    }
    // Copy the tag verbatim (find the closing >).
    const gt = html.indexOf('>', lt);
    if (gt === -1) { out += html.slice(lt); break; }
    out += html.slice(lt, gt + 1);
    i = gt + 1;
  }
  return out;
}

// Parse CSV/TSV text into a 2D array of strings. Pure RFC-4180-ish state
// machine: respects double-quoted fields, embedded delimiters/newlines inside
// quotes, and `""` as an escaped quote. Exported for unit testing.
//
//   parseCsv('a,b\nc,d')              → [['a','b'],['c','d']]
//   parseCsv('"a,b",c')               → [['a,b','c']]
//   parseCsv('he said ""hi""', true)  → [['he said "hi"']]   (tsv→tab)
export function parseCsv(text, tsv = false) {
  const src = text ?? '';
  if (src === '') return [];
  const delim = tsv ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (ch === '\r') {
        // Swallow — handled by the following \n (or end of string).
      } else {
        field += ch;
      }
    }
  }
  // Flush the last field/row. A trailing newline already pushed the final
  // row; only push here if there's pending content. Also keep a single
  // empty line at EOF as an empty row only when it's not the only content.
  if (field !== '' || row.length > 0 || rows.length === 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Decide whether a column should sort numerically. Heuristic: at least 80% of
// its non-empty values parse as finite numbers.
function isNumericColumn(rows, colIdx) {
  let total = 0;
  let numeric = 0;
  for (const row of rows) {
    const v = row[colIdx];
    if (v == null || v === '') continue;
    total++;
    if (Number.isFinite(Number(v))) numeric++;
  }
  return total > 0 && numeric / total >= 0.8;
}

// Render a parsed 2D array as an HTML table string. The first row is treated
// as a header (every CSV/TSV opened in mdpeek has one — and the rare header-
// less file still renders sensibly with column letters as headers).
function renderCsvTable(rows) {
  if (rows.length === 0) {
    return `<div class="csv-empty">No rows</div>`;
  }
  const header = rows[0];
  const body = rows.slice(1);
  const ths = header.map((label, i) => {
    const numeric = body.length > 0 && isNumericColumn(body, i);
    return `<th data-col="${i}" data-sort-type="${numeric ? 'number' : 'string'}" data-state="none" tabindex="0" role="button" aria-label="Sort by ${escapeHtml(label)}"><span class="th-label">${escapeText(label)}</span><span class="sort-ind" aria-hidden="true"></span></th>`;
  }).join('');
  const trs = body.map((row) => {
    const tds = header.map((_, i) => {
      const v = row[i] ?? '';
      const numeric = Number.isFinite(Number(v)) && v !== '';
      return `<td${numeric ? ' data-numeric="1"' : ''}>${escapeText(v)}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  return (
    `<div class="csv-scroll">` +
    `<table class="csv-table">` +
    `<thead><tr>${ths}</tr></thead>` +
    `<tbody>${trs}</tbody>` +
    `</table>` +
    `</div>`
  );
}

// Render CSV/TSV text as a sortable, filterable HTML table view. Pure function
// (no DOM); main.js wires up interactivity via initCsvViewer() after injecting.
export function renderCsv(text, opts = {}) {
  const input = text ?? '';
  const rows = parseCsv(input, !!opts.tsv);
  const total = rows.length > 0 ? rows.length - 1 : 0; // minus header
  ensurePurifyHook();
  const toolbar =
    `<div class="csv-toolbar">` +
    `<input class="csv-filter" type="search" placeholder="Filter rows…" aria-label="Filter rows" spellcheck="false" />` +
    `<button class="tool-btn csv-copy-btn" type="button" title="Copy the visible (filtered/sorted) rows as a Markdown table">Copy as Markdown</button>` +
    `<span class="csv-count" data-total="${total}" aria-live="polite">${total} rows</span>` +
    `</div>`;
  const raw = `<div class="csv-viewer-inner">${toolbar}${renderCsvTable(rows)}</div>`;
  return DOMPurify.sanitize(raw);
}

// Ensure a code language is registered before rendering. Returns true if the
// language is ready now, false if it's being loaded asynchronously (caller
// should re-render after a tick). Mirrors the markdown path's ensureLang().
export async function prepareCodeLang(lang) {
  return ensureLang(lang);
}

// Enhance rendered DOM: copy buttons on code blocks + mermaid diagrams.
// Options:
//   { mermaid: false } — skip mermaid rendering (expensive; used for the
//   edit-mode live preview where diagrams would re-layout on every keystroke).
//   { lineNumbers: true } — add a line-number gutter to each fenced code
//   block (opt-in; mirrors the code-file viewer's gutter at renderCode()).
export async function enhanceDom(container, {
  mermaid: renderMermaid = true,
  folding: renderFolding = true,
  lineNumbers = false,
  proseHighlights = false,
  wordFreq = false,
} = {}) {
  if (typeof window === 'undefined') return;
  enhanceCodeBlocks(container, { lineNumbers });
  enhanceAnchors(container);
  enhanceImages(container);
  enhanceTaskCheckboxes(container);
  enhanceTaskProgress(container);
  enhanceSpoilers(container);
  enhanceVideoEmbeds(container);
  if (wordFreq) enhanceWordFreq(container);
  if (proseHighlights) enhanceProseHighlights(container);
  if (renderFolding) enhanceFolding(container);
  // Kick off dynamic language registration for any fenced langs we don't yet
  // have. Non-blocking — this render stays as-is; the next render picks them up.
  registerVisibleLanguages(container);
  if (renderMermaid) await enhanceMermaid(container);
}

// v0.35.0: marked renders GFM task checkboxes with a `disabled` attribute (so
// they don't toggle natively). We remove `disabled` so real user clicks reach
// the delegated handler in main.js — the handler preventDefaults and toggles
// the source markdown instead. Keeps a `role=checkbox` + tabindex so the
// control stays keyboard-accessible. Idempotent across re-renders.
function enhanceTaskCheckboxes(container) {
  const boxes = container.querySelectorAll('input[type="checkbox"]');
  boxes.forEach((cb) => {
    if (cb.hasAttribute('disabled')) cb.removeAttribute('disabled');
    if (!cb.hasAttribute('role')) cb.setAttribute('role', 'checkbox');
    if (!cb.hasAttribute('tabindex')) cb.setAttribute('tabindex', '0');
  });
}

// v0.46.0: Insert a "✓ n/m" progress header above each GFM task list. Walks
// every <ul> whose first <li> holds a task checkbox, counts checked/total, and
// prepends a `.task-progress` div. Idempotent across re-renders (skips any <ul>
// that already has a `.task-progress` as its previous sibling). The counts
// recompute on the next re-render after a checkbox toggle (the toggle handler
// in main.js mutates the source and triggers a re-render).
function enhanceTaskProgress(container) {
  const lists = container.querySelectorAll('ul');
  lists.forEach((ul) => {
    // Only task lists: the first <li> must contain a task checkbox.
    const firstLi = ul.querySelector('li');
    if (!firstLi) return;
    const firstBox = firstLi.querySelector('input[type="checkbox"]');
    if (!firstBox) return;
    // Idempotency: skip if a progress header is already in place.
    if (ul.previousElementSibling && ul.previousElementSibling.classList.contains('task-progress')) return;
    const boxes = ul.querySelectorAll('input[type="checkbox"]');
    const total = boxes.length;
    if (total === 0) return;
    const done = Array.from(boxes).filter((b) => b.checked).length;
    const pct = Math.round((done / total) * 100);
    const header = document.createElement('div');
    header.className = 'task-progress';
    header.innerHTML =
      `<div class="task-progress-track"><div class="task-progress-bar" style="width:${pct}%"></div></div>` +
      `<span class="task-progress-count">${done}/${total}</span>`;
    ul.parentNode.insertBefore(header, ul);
  });
}

// v0.53.0: Highlight hard-to-read prose. Walks rendered paragraphs, wraps each
// 3+-syllable word in <mark class="prose-complex"> and adds .prose-dense to
// whole paragraphs that read as difficult. Skips code blocks, tables, and
// alert callouts so only real prose is marked. Idempotent across re-renders.
function enhanceProseHighlights(container) {
  if (!container) return;
  const paras = container.querySelectorAll('p');
  paras.forEach((p) => {
    // Skip paragraphs that aren't running prose.
    if (p.closest('pre')) return; // fenced/inline code
    if (p.closest('table')) return; // table cells
    if (p.closest('blockquote.markdown-alert')) return; // callouts
    // Whole-paragraph density tint.
    if (isDenseParagraph(p.textContent)) p.classList.add('prose-dense');
    // Wrap complex words. We walk text nodes and rebuild each one with text +
    // <mark> fragments, so existing inline elements (<a>, <strong>, <code>)
    // are left intact — only the text inside them is wrapped. Skip text nodes
    // already inside a <code> or a prior prose <mark>.
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement && node.parentElement.closest('code, mark.prose-complex, .prose-skip')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);
    for (const node of targets) {
      const text = node.nodeValue;
      const matches = findComplexWords(text);
      if (matches.length === 0) continue;
      // Build replacement fragments: plain text between matches + a <mark> for
      // each match. Offsets are into the original text, so slicing is exact.
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const { start, end } of matches) {
        if (start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, start)));
        const mark = document.createElement('mark');
        mark.className = 'prose-complex';
        mark.textContent = text.slice(start, end);
        frag.appendChild(mark);
        cursor = end;
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      node.parentNode.replaceChild(frag, node);
    }
  });
}

// v0.55.0: Word-frequency overlay — wraps occurrences of overused (5+ use)
// words in <span class="wordfreq-mark">. A distinct axis from prose highlights
// (which mark *hard* words); this marks *repetitive* words, in amber so the two
// never read as the same affordance. Skips code blocks, tables, alert callouts,
// and headings so only body prose is marked. Idempotent across re-renders.
function enhanceWordFreq(container) {
  if (!container) return;
  const paras = container.querySelectorAll('p');
  if (paras.length === 0) return;
  // Build the overused set from the container's own prose, so the underline is
  // driven by the same text the user reads. Skip non-prose <p> elements here
  // too so a table/callout doesn't inflate counts.
  let proseText = '';
  const proseParas = [];
  paras.forEach((p) => {
    if (p.closest('pre')) return;
    if (p.closest('table')) return;
    if (p.closest('blockquote.markdown-alert')) return;
    proseText += p.textContent + '\n';
    proseParas.push(p);
  });
  const overused = overusedWords(proseText);
  if (overused.size === 0) return;
  proseParas.forEach((p) => {
    // Walk text nodes; skip any inside <code> or an existing wrapper so we don't
    // double-wrap or touch code spans (matches enhanceProseHighlights guards).
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement && node.parentElement.closest('code, mark.prose-complex, .wordfreq-mark, .prose-skip')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);
    for (const node of targets) {
      const text = node.nodeValue;
      const matches = findWordsInText(text, overused);
      if (matches.length === 0) continue;
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const { start, end } of matches) {
        if (start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, start)));
        const span = document.createElement('span');
        span.className = 'wordfreq-mark';
        span.textContent = text.slice(start, end);
        frag.appendChild(span);
        cursor = end;
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      node.parentNode.replaceChild(frag, node);
    }
  });
}

// v0.62.0: Embedded video cards. A paragraph whose ONLY content is a
// YouTube/Vimeo link becomes a responsive 16:9 <iframe> card. The iframe is
// created here, in the live DOM AFTER sanitize — never via a DOMPurify
// exception — and its src is constructed from a strictly-validated video id,
// never from raw user text. Supports:
//
//   https://www.youtube.com/watch?v=ID     https://youtu.be/ID
//   https://www.youtube.com/watch?v=ID&t=30s (start time preserved)
//   https://vimeo.com/ID
//
// Any other paragraph shape (link with text, multiple links, mixed prose) is
// left untouched, so inline mentions never turn into players.
const VIDEO_LINK_RE = /^https?:\/\/(?:(?:www|m)\.youtube(?:-nocookie)?\.com\/watch\?v=|youtu\.be\/|www\.youtube-nocookie\.com\/embed\/|vimeo\.com\/)([\w-]{6,15})/;
function videoEmbedSrc(href) {
  const m = String(href || '').trim().match(VIDEO_LINK_RE);
  if (!m) return null;
  const id = m[1];
  let src;
  if (/youtu/.test(href)) {
    src = `https://www.youtube-nocookie.com/embed/${id}`;
    const t = href.match(/[?&]t=(\d+)/);
    if (t) src += `?start=${t[1]}`;
  } else {
    src = `https://player.vimeo.com/video/${id}`;
  }
  return src;
}
function enhanceVideoEmbeds(container) {
  if (typeof window === 'undefined') return;
  container.querySelectorAll('p').forEach((p) => {
    // Only a bare autolink paragraph qualifies: exactly one child element,
    // it's an <a>, and the visible link text is itself a video URL (so a
    // labeled link like [watch this](url) or mixed prose stays a link).
    if (p.children.length !== 1 || p.children[0].tagName !== 'A') return;
    const a = p.children[0];
    if (p.textContent.trim() !== a.textContent.trim()) return;
    if (!videoEmbedSrc(a.textContent)) return;
    const src = videoEmbedSrc(a.getAttribute('href'));
    if (!src) return;
    const card = document.createElement('div');
    card.className = 'video-embed';
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.setAttribute('title', 'Embedded video');
    card.append(iframe);
    p.replaceWith(card);
  });
}

// v0.46.0: Wire click-to-reveal on `||spoiler||` spans (rendered as
// `<span class="spoiler">`). One delegated listener per container; toggling
// `.revealed` unmasks the text via CSS. Idempotent (sets a data flag so a
// second enhanceDom on the same container doesn't double-bind).
function enhanceSpoilers(container) {
  const spoilers = container.querySelectorAll('.spoiler');
  if (spoilers.length === 0) return;
  if (container.__spoilerWired) return;
  container.__spoilerWired = true;
  container.addEventListener('click', (e) => {
    const sp = e.target.closest('.spoiler');
    if (sp && container.contains(sp)) sp.classList.toggle('revealed');
  });
}

// Scan code blocks in the container and ensure their languages are registered.
// Fire-and-forget; re-rendering after registration will show the highlight.
async function registerVisibleLanguages(container) {
  const langs = new Set();
  container.querySelectorAll('code[class*="language-"]').forEach((c) => {
    const m = c.className.match(/language-(\S+)/);
    if (m) langs.add(m[1]);
  });
  for (const lang of langs) {
    // Don't await — we don't want to block the current render.
    ensureLang(lang);
  }
}

// Adds a copy button, a language badge, and an optional line-number gutter to
// each <pre> that contains a <code> block. One delegated click listener per
// container — avoids a listener per button (the rendered DOM is rebuilt on
// every keystroke in edit mode, so per-button listeners would leak).
//
// Options:
//   { lineNumbers: true } — inject a 1-indexed gutter to the left of the code.
//   Mirrors the code-file viewer's gutter (renderCode). Off by default; the
//   caller passes it through from the mdpeek-code-line-numbers setting.
function enhanceCodeBlocks(container, { lineNumbers = false } = {}) {
  if (typeof window === 'undefined') return;
  const pres = container.querySelectorAll('pre');
  pres.forEach((pre) => {
    const code = pre.querySelector(':scope > code');
    if (!code) return;

    // Language badge — small pill in the top-left showing the detected lang.
    // Skipped for plaintext (no value showing "plaintext") and when a
    // .code-title filename bar is present (v0.62.0 — the title already
    // identifies the block). Idempotent.
    const lang = (code.className.match(/language-(\S+)/) || [])[1];
    const hasTitleBar = pre.parentElement && pre.parentElement.classList.contains('code-block');
    if (lang && lang !== 'plaintext' && !hasTitleBar && !pre.querySelector('.code-lang')) {
      const badge = document.createElement('span');
      badge.className = 'code-lang';
      badge.textContent = lang;
      pre.append(badge);
    }

    // Line-number gutter. Toggled by the setting; re-running enhanceDom with
    // the flag flipped will add or leave it. We only add (never strip in-place)
    // — a setting change triggers a full re-render that rebuilds pres fresh.
    if (lineNumbers && !pre.querySelector('.code-gutter')) {
      addCodeGutter(pre, code);
    }

    let actions = pre.querySelector('.code-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'code-actions';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'code-action-btn save-code-btn';
      saveBtn.type = 'button';
      saveBtn.setAttribute('aria-label', 'Save code block as file');
      saveBtn.title = 'Save code block';
      saveBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-action-btn copy-btn';
      copyBtn.type = 'button';
      copyBtn.setAttribute('aria-label', 'Copy code');
      copyBtn.title = 'Copy';
      copyBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

      actions.append(saveBtn, copyBtn);
      pre.append(actions);
    }
  });

  if (!container.__codeActionHandler) {
    const handler = async (e) => {
      const copyBtn = e.target.closest('.copy-btn');
      const saveBtn = e.target.closest('.save-code-btn');
      if ((!copyBtn && !saveBtn) || !container.contains(copyBtn || saveBtn)) return;

      const pre = (copyBtn || saveBtn).closest('pre');
      const code = pre ? pre.querySelector('code') : null;
      if (!code) return;

      if (copyBtn) {
        try {
          await navigator.clipboard.writeText(code.textContent);
          flashCopied(copyBtn);
        } catch {}
      } else if (saveBtn) {
        saveCodeBlockAsFile(code, pre);
      }
    };
    container.addEventListener('click', handler);
    container.__codeActionHandler = handler;
  }
}

// Build a 1-indexed line-number gutter matching the code block's line count.
// The gutter shares line-height with the <pre><code> so rows stay aligned.
// Layout: <pre class="with-gutter"> wraps a flex row of .code-gutter + the
// original <code>. We move the existing <code> into the wrapper rather than
// cloning, so the copy/save handlers still target the live code element.
function addCodeGutter(pre, code) {
  const lineCount = (code.textContent || '').split('\n').length;
  // Trailing newline from ``` fences produces an extra empty line — trim it
  // so the gutter doesn't show a phantom last row.
  const count = code.textContent.endsWith('\n') ? lineCount - 1 : lineCount;
  const gutter = document.createElement('div');
  gutter.className = 'code-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  let html = '';
  for (let i = 1; i <= count; i++) html += `<div>${i}</div>`;
  gutter.innerHTML = html;

  const row = document.createElement('div');
  row.className = 'code-row';
  // Move the existing <code> into the row so highlighting + copy handlers
  // keep working unchanged. The <pre> becomes a positioning shell.
  row.append(gutter);
  pre.append(row);
  // Move code last (after gutter) — visually right of the gutter.
  row.append(code);
  pre.classList.add('with-gutter');
}

function saveCodeBlockAsFile(codeEl, preEl) {
  let ext = 'txt';
  const match = preEl.className.match(/language-([a-z0-9_-]+)/i) || codeEl.className.match(/language-([a-z0-9_-]+)/i);
  if (match) {
    const lang = match[1].toLowerCase();
    const map = {
      javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
      python: 'py', py: 'py', json: 'json', html: 'html', css: 'css',
      sql: 'sql', bash: 'sh', sh: 'sh', rust: 'rs', rs: 'rs',
      cpp: 'cpp', c: 'c', java: 'java', go: 'go', markdown: 'md', md: 'md',
    };
    ext = map[lang] || lang;
  }
  const blob = new Blob([codeEl.textContent], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `snippet.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Briefly swap the button to a checkmark so the user sees feedback.
const COPY_FLASH_MS = 1200;
function flashCopied(btn) {
  if (btn.dataset.copied === '1') return;
  btn.dataset.copied = '1';
  btn.classList.add('copied');
  btn.dataset.original = btn.innerHTML;
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  setTimeout(() => {
    btn.innerHTML = btn.dataset.original;
    btn.classList.remove('copied');
    delete btn.dataset.copied;
  }, COPY_FLASH_MS);
}

// Heading anchor links — appends a `#` glyph link to each h1-h6 that already
// has a slug id (assigned during markdown rendering). Hovering the heading
// reveals the link; clicking copies the `#slug` fragment to the clipboard so
// it can be shared as a deep link. One delegated listener per container.
const ANCHOR_HASH_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9.5a3 3 0 0 0 4.24 0l2.12-2.12a3 3 0 0 0-4.24-4.24L8.06 4.18"/><path d="M9 6.5a3 3 0 0 0-4.24 0L2.64 8.62a3 3 0 0 0 4.24 4.24l1.06-1.06"/></svg>';
function enhanceAnchors(container) {
  if (typeof window === 'undefined') return;
  const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headings.forEach((h) => {
    if (!h.id || h.querySelector('.anchor-link')) return;
    const a = document.createElement('a');
    a.className = 'anchor-link';
    a.href = `#${h.id}`;
    a.setAttribute('aria-label', 'Copy link to this heading');
    a.title = 'Copy link';
    a.innerHTML = ANCHOR_HASH_SVG;
    h.append(a);
  });

  if (!container.__anchorHandler) {
    const handler = async (e) => {
      const a = e.target.closest('.anchor-link');
      if (!a || !container.contains(a)) return;
      e.preventDefault();
      const hash = a.getAttribute('href') || '';
      try {
        await navigator.clipboard.writeText(hash);
        flashAnchor(a);
      } catch {
        // Insecure context — silently fall back to the default navigation.
      }
    };
    container.addEventListener('click', handler);
    container.__anchorHandler = handler;
  }
}

// Flash the anchor link green briefly so the user sees the copy registered.
const ANCHOR_FLASH_MS = 1200;
function flashAnchor(a) {
  if (a.dataset.copied === '1') return;
  a.dataset.copied = '1';
  a.classList.add('copied');
  setTimeout(() => {
    a.classList.remove('copied');
    delete a.dataset.copied;
  }, ANCHOR_FLASH_MS);
}

// v0.36.0: click-to-zoom for inline images in the markdown preview. A single
// shared overlay (#mdpeek-lightbox) is lazily created in <body> on first use;
// clicking any <img> inside the rendered markdown opens it full-size against a
// dim backdrop. Click anywhere / press Esc to dismiss. Idempotent across
// re-renders — one delegated listener per container (matches enhanceAnchors).
// We opt OUT for images that are inside a link (<a><img></a>) so the link's
// navigation isn't hijacked.
function enhanceImages(container) {
  if (typeof window === 'undefined') return;
  // Mark images as zoomable so CSS can add the hover affordance. Done on every
  // pass (re-render rebuilds the DOM), with a guard so we don't re-tag.
  container.querySelectorAll('img').forEach((img) => {
    if (img.dataset.zoom === undefined) {
      // Skip images wrapped in an anchor — clicking should follow the link.
      img.dataset.zoom = img.closest('a') ? '0' : '1';
    }
  });
  if (!container.__imageZoomHandler) {
    const handler = (e) => {
      const img = e.target.closest('img');
      if (!img || !container.contains(img)) return;
      if (img.dataset.zoom !== '1') return;
      openLightbox(img);
    };
    container.addEventListener('click', handler);
    container.__imageZoomHandler = handler;
  }
}

// v0.45.0: gallery navigation state. When the lightbox opens, we collect every
// zoomable image in the same container as the clicked one and track the index.
// Prev/next buttons + arrow keys move through the gallery; the counter shows
// "i / n". A single module-level object holds the current gallery so the
// keydown + button handlers can reach it without closure gymnastics.
const _lightbox = { images: [], index: -1 };

function openLightbox(img) {
  const overlay = ensureLightbox();
  // Build the gallery from the clicked image's container so each rendered doc
  // is its own gallery (a long doc with 50 images won't merge with another).
  const container = img.closest('.markdown-body') || img.parentElement || document.body;
  const all = Array.from(container.querySelectorAll('img[data-zoom="1"]'));
  _lightbox.images = all.length ? all : [img];
  _lightbox.index = Math.max(0, _lightbox.images.indexOf(img));
  showLightboxAt(_lightbox.index);
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

// Render the image at `index` and update the counter. No-op if out of range.
function showLightboxAt(index) {
  if (index < 0 || index >= _lightbox.images.length) return;
  _lightbox.index = index;
  const overlay = document.getElementById('mdpeek-lightbox');
  if (!overlay) return;
  const img = _lightbox.images[index];
  const lbImg = overlay.querySelector('img');
  if (lbImg) {
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt || '';
  }
  const counter = overlay.querySelector('.lb-count');
  if (counter) {
    counter.textContent = _lightbox.images.length > 1
      ? `${index + 1} / ${_lightbox.images.length}`
      : '';
  }
}

// Move ±1 through the gallery, wrapping at the ends.
function lightboxNav(dir) {
  if (_lightbox.images.length <= 1) return;
  const n = _lightbox.images.length;
  showLightboxAt((_lightbox.index + dir + n) % n);
}

function closeLightbox() {
  const overlay = document.getElementById('mdpeek-lightbox');
  if (!overlay || !overlay.classList.contains('open')) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  _lightbox.images = [];
  _lightbox.index = -1;
  // Drop the src once faded out so a long data: URL doesn't stay in memory.
  const lbImg = overlay.querySelector('img');
  if (lbImg) lbImg.removeAttribute('src');
}

function ensureLightbox() {
  let overlay = document.getElementById('mdpeek-lightbox');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'mdpeek-lightbox';
  overlay.className = 'mdpeek-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Image preview');
  // v0.45.0: prev/next arrow buttons + a counter pill join the <img>. The
  // buttons stopPropagation so the overlay's click-to-close doesn't fire when
  // the user taps an arrow.
  overlay.innerHTML = ''
    + '<button class="lb-prev" type="button" aria-label="Previous image">‹</button>'
    + '<img alt="" />'
    + '<button class="lb-next" type="button" aria-label="Next image">›</button>'
    + '<div class="lb-count" aria-live="polite"></div>';
  overlay.addEventListener('click', closeLightbox);
  const prev = overlay.querySelector('.lb-prev');
  const next = overlay.querySelector('.lb-next');
  prev.addEventListener('click', (e) => { e.stopPropagation(); lightboxNav(-1); });
  next.addEventListener('click', (e) => { e.stopPropagation(); lightboxNav(1); });
  document.body.appendChild(overlay);
  // Esc closes — but only while open. A one-time document listener is fine
  // because closeLightbox no-ops when the overlay isn't open. v0.45.0: arrow
  // keys move through the gallery when more than one image is present.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (e.key === 'ArrowLeft') { lightboxNav(-1); return; }
    if (e.key === 'ArrowRight') { lightboxNav(1); return; }
  });
  return overlay;
}

// --------------------------- outline folding -------------------------------
// Prepends a clickable ▶ triangle to each heading that has following content
// at a deeper level. Clicking toggles a `collapsed` class on the heading and
// hides every following sibling until a heading of equal-or-lower level.
// H1 headings are not foldable (top-level — collapsing the whole doc isn't
// useful). Persistence is left to the caller via the .folded-headings map on
// the container; collapsed state is restored on re-render by checking the
// map. One delegated listener per container.
const FOLD_TRIANGLE_SVG =
  '<svg class="fold-triangle" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 4 10 8 6 12"/></svg>';

function headingLevel(h) {
  return parseInt(h.tagName.slice(1), 10);
}

// Returns every following sibling of `heading` until (and excluding) the next
// heading at level <= the heading's level. Used both to figure out if folding
// is applicable and to know what to hide on collapse.
function sectionSiblings(heading) {
  const level = headingLevel(heading);
  const out = [];
  let cur = heading.nextElementSibling;
  while (cur) {
    if (/^H[1-6]$/.test(cur.tagName) && headingLevel(cur) <= level) break;
    out.push(cur);
    cur = cur.nextElementSibling;
  }
  return out;
}

function enhanceFolding(container) {
  if (typeof window === 'undefined') return;
  const headings = container.querySelectorAll('h2, h3, h4, h5, h6');
  headings.forEach((h) => {
    // Skip if already enhanced, or if the heading has no foldable content.
    if (h.querySelector('.fold-toggle')) return;
    const section = sectionSiblings(h);
    if (section.length === 0) return; // nothing to fold
    const btn = document.createElement('button');
    btn.className = 'fold-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Fold section');
    btn.title = 'Click to fold/unfold';
    btn.innerHTML = FOLD_TRIANGLE_SVG;
    h.prepend(btn);
    // Restore collapsed state from the per-container cache (if any).
    const cache = container.__foldedHeadings;
    if (cache && cache.has(h.id)) {
      h.classList.add('collapsed');
      section.forEach((el) => el.classList.add('folded-away'));
    }
  });

  if (!container.__foldHandler) {
    const handler = (e) => {
      const btn = e.target.closest('.fold-toggle');
      if (!btn || !container.contains(btn)) return;
      const heading = btn.parentElement;
      e.preventDefault();
      const collapsed = heading.classList.toggle('collapsed');
      const section = sectionSiblings(heading);
      section.forEach((el) => el.classList.toggle('folded-away', collapsed));
      // Track in the per-container cache so re-renders preserve the state.
      if (!container.__foldedHeadings) container.__foldedHeadings = new Set();
      if (collapsed) container.__foldedHeadings.add(heading.id);
      else container.__foldedHeadings.delete(heading.id);
    };
    container.addEventListener('click', handler);
    container.__foldHandler = handler;
  }
}

// Monotonic counter for mermaid render IDs — Math.random() can collide across
// concurrent re-renders in edit mode, producing duplicate SVG IDs.
let _mmdSeq = 0;

async function enhanceMermaid(container) {
  const nodes = container.querySelectorAll('.mermaid');
  if (nodes.length === 0) return;
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false,
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
  });
  for (const node of nodes) {
    const code = node.textContent;
    const id = 'mmd-' + (++_mmdSeq);
    try {
      const { svg } = await mermaid.render(id, code);
      node.innerHTML = svg;
    } catch {
      // Clear any partial/error SVG mermaid may have inserted, then mark the
      // node so CSS can show a friendly placeholder.
      node.innerHTML = '';
      node.classList.add('mermaid-error');
      node.setAttribute('data-source', code);
    }
  }
}
