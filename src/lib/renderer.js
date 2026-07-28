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
import { markedSubSup, expandSuperscript } from './subsup.js';
import { parseImageSize } from './image-size.js';
import { escapeHtml } from './escape.js';

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
      slugCounts.set(slug, seen + 1);
      if (seen > 0) slug = `${slug}-${seen}`;
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
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hljs-language-registered', { detail: { lang: name } }));
    }
    return true;
  } catch {
    return false; // import failed (offline / typo) — fall back to plaintext
  }
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
        const inner = this.parser.parseInline(tokens);
        const id = uniqueSlug(slugify(text));
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
        // text token so it doesn't appear in the rendered body.
        const firstPara = tokens.find((t) => t.type === 'paragraph');
        if (firstPara && firstPara.tokens && firstPara.tokens[0]) {
          const t0 = firstPara.tokens[0];
          const lead = t0.text || t0.raw || '';
          t0.text = lead.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '');
        }
        const body = this.parser.parse(tokens);
        return (
          `<blockquote class="markdown-alert markdown-alert-${alert.type}">` +
          `<p class="markdown-alert-title">${alert.icon}${alert.type}</p>` +
          `${body}</blockquote>`
        );
      },
      code({ text, lang }) {
        if (lang === 'mermaid') {
          // Escape so a fence containing `</div>` can't break out of the wrapper.
          return `<div class="mermaid">${escapeText(text)}</div>`;
        }
        const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
        let highlighted;
        try {
          highlighted = language === 'plaintext'
            ? escapeText(text)
            : hljs.highlight(text, { language }).value;
        } catch {
          highlighted = escapeText(text);
        }
        return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
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
  // Rewrite mkDocs `!!! type` admonitions into GFM `> [!TYPE]` alerts so the
  // existing blockquote callout renderer themes them. Must run BEFORE the
  // other pre-passes (the `>` prefix we emit could confuse them otherwise).
  const admExpanded = expandAdmonitions(input);
  // Expand any [[toc]] markers into an inline heading list BEFORE wiki-link
  // preprocessing (otherwise [[toc]] would be rewritten as a wiki-link).
  const tocExpanded = expandTocMarker(admExpanded);
  // Expand Pandoc-style superscript `x^2^` → `x<sup>2</sup>` BEFORE marked.
  // Necessary because marked's GFM inline text tokenizer eats `^` as a plain
  // char (it's not in the text stop-set), so a tokenizer extension never
  // gets a chance. Subscript `~` is handled by a marked extension instead
  // (marked stops at `~`). Skips fenced/inline code.
  const supExpanded = expandSuperscript(tocExpanded);
  // Preprocess Obsidian-style wiki-links: [[Target]] → [Target](Target.md)
  // and [[Target|Display]] → [Display](Target.md). Done before marked so the
  // result is a standard markdown link rendered like any other. Code blocks
  // and inline code are skipped to avoid mangling code that contains [[ ]].
  const processed = preprocessWikiLinks(supExpanded);
  const raw = marked.parse(processed, { async: false });
  const html = DOMPurify.sanitize(raw);
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
    return `<th data-col="${i}" data-sort-type="${numeric ? 'number' : 'string'}" data-state="none" tabindex="0" role="button" aria-label="Sort by ${escapeText(label)}"><span class="th-label">${escapeText(label)}</span><span class="sort-ind" aria-hidden="true"></span></th>`;
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
    `<span class="csv-count" data-total="${total}">${total} rows</span>` +
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
} = {}) {
  if (typeof window === 'undefined') return;
  enhanceCodeBlocks(container, { lineNumbers });
  enhanceAnchors(container);
  enhanceImages(container);
  enhanceTaskCheckboxes(container);
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
    // Skipped for plaintext (no value showing "plaintext"). Idempotent.
    const lang = (code.className.match(/language-(\S+)/) || [])[1];
    if (lang && lang !== 'plaintext' && !pre.querySelector('.code-lang')) {
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
