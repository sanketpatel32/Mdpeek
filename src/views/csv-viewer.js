// CSV viewer interactivity controller. Wired up by main.js after renderCsv()
// injects the table HTML into the document container. Pure presentation —
// no parsing here (that's parseCsv in renderer.js). Holds the parsed rows in
// a closure so sort/filter can re-render without re-parsing.
//
// Returns { destroy() } so main.js can tear it down when switching tabs,
// mirroring the PDF / Excalidraw controllers.

// ---------- UI polish (injected once) ----------
// Presentation-only styles scoped to .csv-viewer-inner: column type badges,
// numeric-column alignment, keyboard focus ring on headers/filter, big-file
// busy shimmer, and the delimiter-mismatch warning bar. Id-guarded so repeated
// initCsvViewer() calls never stack duplicate <style> elements.
const POLISH_CSS = `
/* Column type badges (renderer tags th[data-sort-type]) — a quiet pill that
   makes column types scannable without adding chrome. */
.csv-table th[data-sort-type] .th-type {
  display: inline-block;
  margin-left: var(--sp-1, 4px);
  padding: 0 var(--sp-1, 4px);
  border-radius: var(--radius-sm, 6px);
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.02em;
  vertical-align: 1px;
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--fg-muted) 12%, transparent);
}
.csv-table th[data-sort-type="number"] .th-type {
  color: var(--accent);
  background: var(--accent-soft);
}
/* Numeric columns: figures right-aligned in both header and body, tabular
   digits so they line up vertically (body rule lives in content.css). */
.csv-table th[data-sort-type="number"] { text-align: right; }
.csv-table td[data-numeric="1"] {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}
/* Keyboard navigation visuals: shared --focus-ring token, inset on table
   headers so it doesn't clip against neighbouring cells. */
.csv-table th:focus-visible {
  outline: none;
  box-shadow: inset var(--focus-ring), inset 0 0 0 1px var(--accent);
}
.csv-filter:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
/* Big-file loading state: an indeterminate sweep across the top of the viewer
   while sort/filter work, plus a dimmed, inert scroll area. .csv-busy is
   toggled from JS only for files above the row threshold. */
@keyframes csv-sweep {
  from { background-position-x: -60%; }
  to   { background-position-x: 110%; }
}
.csv-viewer-inner { position: relative; }
.csv-viewer-inner.csv-busy::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  z-index: 3;
  border-radius: var(--radius-sm, 6px);
  background-image: linear-gradient(90deg, transparent, var(--accent), transparent);
  background-size: 40% 100%;
  background-repeat: no-repeat;
  animation: csv-sweep 900ms linear infinite;
}
.csv-viewer-inner .csv-scroll {
  transition: opacity var(--dur-2, 180ms) var(--ease-out, ease);
}
.csv-viewer-inner.csv-busy .csv-scroll {
  opacity: 0.55;
  cursor: progress;
  pointer-events: none;
}
/* Delimiter error state: rows whose field count doesn't match the header
   usually mean the delimiter was misparsed. Designed inline warning, not a
   console-only failure. */
@keyframes csv-warn-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: none; }
}
.csv-delim-warn {
  display: flex;
  align-items: center;
  gap: var(--sp-2, 6px);
  margin-bottom: var(--sp-2, 6px);
  padding: var(--sp-2, 6px) var(--sp-3, 8px);
  border: 1px solid color-mix(in srgb, var(--warning, #9a6700) 45%, var(--border));
  background: color-mix(in srgb, var(--warning, #9a6700) 10%, transparent);
  border-radius: var(--radius-sm, 6px);
  font-size: 12px;
  color: var(--fg);
  animation: csv-warn-in var(--dur-3, 240ms) var(--ease-out, ease);
}
.csv-delim-warn .csv-warn-glyph { color: var(--warning, #9a6700); }
.csv-delim-warn .csv-warn-text { flex: 1; min-width: 0; }
.csv-delim-warn .csv-warn-close {
  padding: 0 var(--sp-2, 6px);
  line-height: 1.4;
  transition: background-color var(--dur-1, 120ms) var(--ease-out, ease);
}
`;

function injectPolishStyle() {
  if (document.getElementById('csv-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'csv-polish-style';
  style.textContent = POLISH_CSS;
  document.head.appendChild(style);
}

export function initCsvViewer(container, rows) {
  // rows is the parsed 2D array from parseCsv(). The first row is the header.
  const header = rows.length > 0 ? rows[0] : [];
  const originalBody = rows.slice(1); // never mutated; sort/filter work on a copy

  let sortCol = -1;       // column index currently sorted, -1 = none
  let sortDir = 'none';   // 'asc' | 'desc' | 'none'
  let filterText = '';    // lower-case substring filter

  const filterInput = container.querySelector('.csv-filter');
  const countEl = container.querySelector('.csv-count');
  const copyBtn = container.querySelector('.csv-copy-btn');
  const tbody = container.querySelector('.csv-table tbody');
  const ths = container.querySelectorAll('.csv-table th');

  injectPolishStyle();

  // Big-file virtualized feel: above this many body rows, sort/filter runs get
  // deferred one frame behind a busy sweep, so the app paints "loading" before
  // the synchronous work blocks instead of silently freezing mid-click.
  const BIG_FILE_ROWS = 4000;

  function withLoading(run) {
    if (originalBody.length <= BIG_FILE_ROWS) { run(); return; }
    if (container.classList.contains('csv-busy')) return; // coalesce bursts
    container.classList.add('csv-busy');
    setTimeout(() => {
      try { run(); } finally { container.classList.remove('csv-busy'); }
    }, 16);
  }

  // Column type badges: renderer.js tags each th[data-sort-type] after
  // sampling the column; surface it as a quiet pill (# = numeric, A = text).
  function injectTypeBadges() {
    ths.forEach((th) => {
      const type = th.dataset.sortType;
      if (!type || th.querySelector('.th-type')) return;
      const badge = document.createElement('span');
      badge.className = 'th-type';
      badge.setAttribute('aria-hidden', 'true');
      badge.title = type === 'number' ? 'Numeric column' : 'Text column';
      badge.textContent = type === 'number' ? '#' : 'A';
      th.appendChild(badge);
    });
  }

  // Delimiter error state: rows whose field count differs from the header are
  // the classic signature of a misparsed delimiter (commas inside quoted
  // fields, semicolon exports…). Blank trailing lines don't count.
  function checkDelimiterMismatch() {
    let bad = 0;
    for (const row of originalBody) {
      const isBlank = row.length === 1 && (row[0] ?? '') === '';
      if (!isBlank && row.length !== header.length) bad++;
    }
    return bad;
  }

  function showDelimiterWarning(badCount) {
    if (!badCount) return;
    const toolbar = container.querySelector('.csv-toolbar');
    if (!toolbar || container.querySelector('.csv-delim-warn')) return;
    const bar = document.createElement('div');
    bar.className = 'csv-delim-warn';
    bar.innerHTML =
      '<span class="csv-warn-glyph" aria-hidden="true">⚠</span>'
      + '<span class="csv-warn-text"><strong>' + badCount + '</strong> row'
      + (badCount === 1 ? '' : 's')
      + ' with a mismatched field count — the delimiter may be misparsed.</span>'
      + '<button class="tool-btn csv-warn-close" type="button" aria-label="Dismiss warning">✕</button>';
    bar.querySelector('.csv-warn-close').addEventListener('click', () => bar.remove());
    toolbar.insertAdjacentElement('afterend', bar);
  }

  // Compute the current visible body rows: filter, then sort.
  function computeRows() {
    let body = originalBody;
    if (filterText) {
      body = body.filter((row) =>
        row.some((cell) => (cell ?? '').toString().toLowerCase().includes(filterText))
      );
    }
    if (sortCol >= 0 && sortDir !== 'none') {
      const numeric = ths[sortCol]?.dataset.sortType === 'number';
      body = [...body].sort((a, b) => {
        const av = a[sortCol] ?? '';
        const bv = b[sortCol] ?? '';
        let cmp;
        if (numeric) {
          cmp = (Number(av) || 0) - (Number(bv) || 0);
        } else {
          cmp = av.toString().localeCompare(bv.toString(), undefined, { numeric: !numeric });
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return body;
  }

  // Re-render the <tbody> from a row array. Mirrors the per-cell logic in
  // renderCsv so styling stays consistent.
  function renderBody(body) {
    const html = body.map((row) => {
      const tds = header.map((_, i) => {
        const v = row[i] ?? '';
        const numeric = Number.isFinite(Number(v)) && v !== '';
        return `<td${numeric ? ' data-numeric="1"' : ''}>${escapeForHtml(v)}</td>`;
      }).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    tbody.innerHTML = html;
    updateCount(body.length);
  }

  function escapeForHtml(s) {
    // Output is inserted via innerHTML; renderer.js already uses DOMPurify
    // globally, but a small inline escape keeps this self-contained.
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function updateCount(visible) {
    const total = originalBody.length;
    if (!countEl) return;
    if (filterText && visible !== total) {
      countEl.textContent = `${visible} of ${total} rows`;
    } else {
      countEl.textContent = `${total} rows`;
    }
  }

  function updateSortIndicators() {
    ths.forEach((th, i) => {
      const ind = th.querySelector('.sort-ind');
      const isActive = i === sortCol && sortDir !== 'none';
      th.dataset.state = isActive ? sortDir : 'none';
      th.setAttribute('aria-sort',
        isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      if (ind) ind.textContent = isActive ? (sortDir === 'asc' ? '▲' : '▼') : '';
    });
  }

  function applySort(col) {
    if (sortCol !== col) {
      sortCol = col;
      sortDir = 'asc';
    } else if (sortDir === 'asc') {
      sortDir = 'desc';
    } else if (sortDir === 'desc') {
      // Third click on the same column clears the sort.
      sortCol = -1;
      sortDir = 'none';
    } else {
      sortDir = 'asc';
    }
    updateSortIndicators();
    withLoading(() => renderBody(computeRows()));
  }

  // Click + keyboard (Enter/Space) on column headers.
  function onHeaderClick(e) {
    const th = e.target.closest('th');
    if (!th || !ths[Number(th.dataset.col)]) return;
    applySort(Number(th.dataset.col));
  }
  function onHeaderKey(e) {
    const th = e.target.closest('th');
    if (!th) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      applySort(Number(th.dataset.col));
    }
  }

  // Debounced filter — typing fast shouldn't re-render on every keystroke.
  let filterTimer = null;
  function onFilterInput(e) {
    const value = e.target.value.toLowerCase();
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      filterText = value;
      withLoading(() => renderBody(computeRows()));
    }, 100);
  }

  const tableEl = container.querySelector('.csv-table');
  tableEl.addEventListener('click', onHeaderClick);
  tableEl.addEventListener('keydown', onHeaderKey);
  if (filterInput) filterInput.addEventListener('input', onFilterInput);

  // v0.67.0: copy the visible (filtered + sorted) rows as a GFM Markdown
  // table — the usual reason to sort/filter a CSV is to take the result out.
  copyBtn?.addEventListener('click', async () => {
    // Escape pipes for GFM; flatten CR/LF (quoted CSV fields may embed
    // newlines) so a cell can't break the table's row structure.
    const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ');
    const lines = [];
    lines.push(`| ${header.map((h) => esc(h)).join(' | ')} |`);
    lines.push(`| ${header.map(() => '---').join(' | ')} |`);
    for (const row of computeRows()) {
      lines.push(`| ${header.map((_, i) => esc(row[i])).join(' | ')} |`);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy as Markdown'; }, 1400);
    } catch { /* clipboard denied — leave the label alone */ }
  });

  // Initial state: no sort, all rows visible. Badges + structural check run
  // once per file; the busy sweep only kicks in for large files on demand.
  injectTypeBadges();
  showDelimiterWarning(checkDelimiterMismatch());
  updateSortIndicators();

  return {
    destroy() {
      clearTimeout(filterTimer);
      tableEl.removeEventListener('click', onHeaderClick);
      tableEl.removeEventListener('keydown', onHeaderKey);
      if (filterInput) filterInput.removeEventListener('input', onFilterInput);
    },
  };
}
