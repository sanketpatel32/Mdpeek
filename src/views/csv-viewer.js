// CSV viewer interactivity controller. Wired up by main.js after renderCsv()
// injects the table HTML into the document container. Pure presentation —
// no parsing here (that's parseCsv in renderer.js). Holds the parsed rows in
// a closure so sort/filter can re-render without re-parsing.
//
// Returns { destroy() } so main.js can tear it down when switching tabs,
// mirroring the PDF / Excalidraw controllers.

export function initCsvViewer(container, rows) {
  // rows is the parsed 2D array from parseCsv(). The first row is the header.
  const header = rows.length > 0 ? rows[0] : [];
  const originalBody = rows.slice(1); // never mutated; sort/filter work on a copy

  let sortCol = -1;       // column index currently sorted, -1 = none
  let sortDir = 'none';   // 'asc' | 'desc' | 'none'
  let filterText = '';    // lower-case substring filter

  const filterInput = container.querySelector('.csv-filter');
  const countEl = container.querySelector('.csv-count');
  const tbody = container.querySelector('.csv-table tbody');
  const ths = container.querySelectorAll('.csv-table th');

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
        sortDir === 'asc' ? 'ascending' :
        sortDir === 'desc' ? 'descending' : 'none');
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
    renderBody(computeRows());
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
      renderBody(computeRows());
    }, 100);
  }

  const tableEl = container.querySelector('.csv-table');
  tableEl.addEventListener('click', onHeaderClick);
  tableEl.addEventListener('keydown', onHeaderKey);
  if (filterInput) filterInput.addEventListener('input', onFilterInput);

  // Initial state: no sort, all rows visible.
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
