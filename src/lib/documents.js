// Pure logic: Document model + DocumentStore. No DOM, fully unit-testable.

let _idCounter = 0;
function newId() {
  _idCounter += 1;
  return `doc-${Date.now().toString(36)}-${_idCounter}`;
}

// A doc is "plain" when it's a .txt file — plain-text docs skip the markdown
// preview entirely and open in a full-width editor (Notepad-style). Anything
// else (.md / .markdown / .mdx / untitled) is treated as markdown.
export function isPlainPath(path) {
  return !!path && /\.txt$/i.test(path);
}

// A doc is a "pdf" when it's a .pdf file — rendered read-only via pdf.js.
export function isPdfPath(path) {
  return !!path && /\.pdf$/i.test(path);
}

// A doc is an "excalidraw" canvas when it's a .excalidraw file.
export function isExcalidrawPath(path) {
  return !!path && /\.excalidraw$/i.test(path);
}

// A doc is an "image" when it's a raster/vector we can render via <img>:
// png, jpg/jpeg, gif, webp, svg, bmp, ico, avif. Loaded read-only via the
// asset protocol (same path PDFs use).
export function isImagePath(path) {
  return !!path && /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(path);
}

// A doc is "csv" when it's a .csv or .tsv — rendered as a sortable, filterable
// table by renderCsv(). Treated as a distinct type (not code) so it doesn't
// fall into the highlight.js path.
export function isCsvPath(path) {
  return !!path && /\.(csv|tsv)$/i.test(path);
}

// A doc is a "code" file when its extension is a known text/code/config type
// that isn't already handled (markdown / plain text / PDF / Excalidraw / CSV).
// Code docs render read-only with highlight.js syntax coloring. The list is
// broad but explicit — better than "anything not on the other lists," which
// would catch unknown binary extensions.
const CODE_EXT_RE =
  /\.(js|mjs|cjs|ts|tsx|jsx|json|json5|jsonc|css|scss|sass|less|styl|html|htm|xml|svg|vue|svelte|yml|yaml|toml|ini|cfg|conf|properties|env|sh|bash|zsh|fish|py|pyw|rb|go|rs|java|c|h|cpp|cc|hpp|cs|php|swift|kt|kts|scala|sql|graphql|gql|proto|dockerfile|makefile|mk|gitignore|gitattributes|gitconfig|editorconfig|bat|cmd|ps1|psm1|lua|r|dart|clj|cljs|edn|ex|exs|erl|hs|lhs|ml|mli|fs|fsx|nim|v|zig|d|gradle|log|diff|patch|nix|tf|hcl)$/i;
// Extensions with no dot (basename-only match): Dockerfile, Makefile, etc.
const CODE_NAME_RE = /^(\.?(dockerfile|makefile|cmakelists|gemfile|rakefile|brewfile|procfile|justfile))$/i;
export function isCodePath(path) {
  if (!path) return false;
  const base = path.split(/[\\/]/).pop();
  if (CODE_NAME_RE.test(base)) return true;
  return CODE_EXT_RE.test(path);
}

// Map a file extension/basename to a highlight.js language id. Most extensions
// map directly (hljs's alias system), but a few need an explicit table. Returns
// null when the language isn't recognized → caller falls back to plaintext.
const LANG_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', pyw: 'python',
  rb: 'ruby', rs: 'rust', go: 'go', kt: 'kotlin', kts: 'kotlin',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  yml: 'yaml', yaml: 'yaml',
  cs: 'csharp', fs: 'fsharp', fsx: 'fsharp',
  cc: 'cpp', cpp: 'cpp', hxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  h: 'c',
  'gitignore': 'plaintext', 'gitattributes': 'plaintext', 'gitconfig': 'ini',
  'editorconfig': 'ini', properties: 'properties', env: 'bash',
  ps1: 'powershell', psm1: 'powershell',
  md: 'markdown', markdown: 'markdown',
  html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml',
  plist: 'xml', atom: 'xml', rss: 'xml',
  graphql: 'graphql', gql: 'graphql',
  proto: 'protobuf', dockerfile: 'dockerfile',
  txt: 'plaintext', log: 'plaintext', csv: 'plaintext', tsv: 'plaintext',
  diff: 'diff', patch: 'diff',
  nix: 'plaintext', tf: 'hcl', hcl: 'hcl',
};
const LANG_BY_NAME = {
  dockerfile: 'dockerfile', makefile: 'makefile', cmakelists: 'cmake',
  gemfile: 'ruby', rakefile: 'ruby', brewfile: 'ruby', procfile: 'yaml',
  justfile: 'plaintext',
};
export function langFromPath(path) {
  if (!path) return null;
  const base = path.split(/[\\/]/).pop();
  // Basename match first (Dockerfile, Makefile — case-insensitive).
  const byName = LANG_BY_NAME[base.toLowerCase()];
  if (byName) return byName;
  // Extract the extension. Three cases:
  //   `app.js`     → dot at 3, ext = `js`
  //   `.gitignore` → dot at 0 (dotfile), ext = `gitignore`
  //   `README`     → no dot → null
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx < 0) return null; // no extension at all
  const ext = (dotIdx === 0 ? base.slice(1) : base.slice(dotIdx + 1)).toLowerCase();
  if (!ext) return null;
  return LANG_BY_EXT[ext] || ext;
}

export function createDocument({ path = null, content = '', mode = 'view', plain, excalidraw, code, csv, pinned = false } = {}) {
  // `plain` override lets a fresh Untitled tab be plain text without a .txt
  // path (used by the new-tab-format preference). When omitted, plainness is
  // derived from the path as before.
  const isPlain = plain !== undefined ? plain : isPlainPath(path);
  const isPdf = isPdfPath(path);
  const isImage = isImagePath(path);
  const isExcalidraw = excalidraw !== undefined ? excalidraw : isExcalidrawPath(path);
  const isCsv = csv !== undefined ? csv : (!isPlain && !isPdf && !isImage && !isExcalidraw && isCsvPath(path));
  const isCode = code !== undefined ? code : (!isPlain && !isPdf && !isImage && !isExcalidraw && !isCsv && isCodePath(path));
  return {
    id: newId(),
    path, // string | null (null = Untitled, not yet saved)
    content: (isPdf || isImage) ? '' : content, // PDF + image bytes never ride this field
    mode: isPlain ? 'edit' : ((isPdf || isImage || isExcalidraw || isCode || isCsv) ? 'view' : mode),
    plain: isPlain, // true = no markdown preview, full-width editor
    pdf: isPdf, // true = rendered via pdf.js, read-only
    image: isImage, // true = rendered via <img>, read-only
    excalidraw: isExcalidraw, // true = Excalidraw canvas tab
    code: isCode, // true = rendered read-only with syntax highlighting
    csv: isCsv, // true = rendered as a sortable/filterable table
    pinned: !!pinned, // true = pinned to the left of the tab strip, survives bulk-close
    dirty: false,
    scrollY: 0,
    editor: null, // lazy-init in main.js when entering edit mode
  };
}

export class DocumentStore {
  constructor() {
    this.docs = [];
    this.activeId = null;
    this._listeners = new Map(); // event -> Set<fn>
  }

  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this._listeners.get(event)?.delete(cb);
  }

  _emit(event, payload) {
    this._listeners.get(event)?.forEach((cb) => cb(payload));
  }

  active() {
    return this.docs.find((d) => d.id === this.activeId) || null;
  }

  open({ path = null, content = '', plain, mode, excalidraw, code, csv, pinned } = {}) {
    // Duplicate check: files on disk (path != null) open once.
    if (path !== null) {
      const existing = this.docs.find((d) => d.path === path);
      if (existing) {
        this.switch(existing.id);
        return existing;
      }
    }
    const doc = createDocument({ path, content, plain, mode, excalidraw, code, csv, pinned });
    this.docs.push(doc);
    this.activeId = doc.id;
    this._emit('change');
    return doc;
  }

  switch(id) {
    if (!this.docs.find((d) => d.id === id)) return;
    if (this.activeId === id) return; // no-op: switching to already-active tab
    this.activeId = id;
    this._emit('change');
  }

  close(id) {
    const idx = this.docs.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this.docs.splice(idx, 1);
    if (this.activeId === id) {
      // activate a neighbor: prefer the one now at idx, else the previous
      const neighbor = this.docs[idx] || this.docs[idx - 1] || null;
      this.activeId = neighbor ? neighbor.id : null;
    }
    this._emit('change');
  }

  markDirty(id) {
    const d = this.docs.find((x) => x.id === id);
    if (d && !d.dirty) {
      d.dirty = true;
      this._emit('change');
    }
  }

  clearDirty(id) {
    const d = this.docs.find((x) => x.id === id);
    if (d && d.dirty) {
      d.dirty = false;
      this._emit('change');
    }
  }

  // Toggle a tab's pinned flag. Pinned tabs render at the left of the strip,
  // shrink to icon-only, and survive bulk-close actions. After updating the
  // flag, the docs array is stable-sorted so all pinned docs come first —
  // this keeps render order in sync without waiting for serialize/restore.
  setPinned(id, pinned) {
    const d = this.docs.find((x) => x.id === id);
    if (!d || d.pinned === pinned) return;
    d.pinned = pinned;
    // Stable partition: pinned first, preserve relative order within each group.
    const pinnedDocs = this.docs.filter((x) => x.pinned);
    const otherDocs = this.docs.filter((x) => !x.pinned);
    this.docs = [...pinnedDocs, ...otherDocs];
    this._emit('change');
  }

  // Plain-serializable snapshot for persistence.
  serialize() {
    return {
      // Skip blank untouched Untitled tabs — they shouldn't be restored on next
      // launch (we'd rather show the welcome screen than an empty tab), UNLESS
      // they're pinned (a user explicitly kept a scratch tab around).
      docs: this.docs
        .filter((d) => d.pinned || d.path !== null || d.content !== '' || d.dirty)
        // Sort so pinned tabs come first — preserves left-to-right ordering
        // across sessions, and the activeId fallback naturally prefers them.
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
        .map((d) => ({
          id: d.id,
          path: d.path,
          content: d.content,
          mode: d.mode,
          dirty: d.dirty,
          scrollY: d.scrollY,
          // Persist type flags so untitled tabs (path=null) survive a restart.
          // For saved files, these are also re-derivable from the path.
          plain: d.plain || false,
          pdf: d.pdf || false,
          image: d.image || false,
          excalidraw: d.excalidraw || false,
          code: d.code || false,
          csv: d.csv || false,
          pinned: d.pinned || false,
        })),
      activeId: this.activeId,
    };
  }

  restore(data) {
    if (!data || !Array.isArray(data.docs)) return;
    this.docs = data.docs
      .filter((d) => d && typeof d.content === 'string')
      .map((d) => {
        const path = typeof d.path === 'string' ? d.path : null;
        // Prefer the persisted type flag; fall back to path-based derivation
        // for older sessions that didn't serialize these flags.
        const plain = d.plain !== undefined ? !!d.plain : isPlainPath(path);
        const pdf = d.pdf !== undefined ? !!d.pdf : isPdfPath(path);
        const image = d.image !== undefined ? !!d.image : isImagePath(path);
        const excalidraw = d.excalidraw !== undefined ? !!d.excalidraw : isExcalidrawPath(path);
        const csv = d.csv !== undefined ? !!d.csv : (!plain && !pdf && !image && !excalidraw && isCsvPath(path));
        const code = d.code !== undefined ? !!d.code : (!plain && !pdf && !image && !excalidraw && !csv && isCodePath(path));
        const pinned = d.pinned !== undefined ? !!d.pinned : false;
        return {
          id: typeof d.id === 'string' ? d.id : newId(),
          path,
          content: (pdf || image) ? '' : d.content,
          // plain docs are always in edit mode; PDFs/images/Excalidraw/code/csv are always view; markdown honors the snapshot.
          mode: plain ? 'edit' : ((pdf || image || excalidraw || code || csv) ? 'view' : d.mode === 'edit' ? 'edit' : 'view'),
          plain,
          pdf,
          image,
          excalidraw,
          code,
          csv,
          pinned,
          dirty: false, // never restore as dirty — content was just re-read
          scrollY: Number.isFinite(d.scrollY) ? d.scrollY : 0,
          editor: null,
        };
      });
    this.activeId = this.docs.find((d) => d.id === data.activeId)
      ? data.activeId
      : (this.docs[0]?.id || null);
    this._emit('change');
  }
}
