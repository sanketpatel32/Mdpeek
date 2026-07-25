// Tasks inbox — merges Kanban cards with `- [ ]` / `- [x]` checkboxes scanned
// from notes into one unified list.
//
// Pure functions — no DOM, no I/O. The scan itself happens in main.js via the
// Rust `search_in_folder` command; this module:
//   1. normalizes the raw scan hits into task objects,
//   2. merges them with Kanban cards,
//   3. sorts/filters/groups the result.
//
// Unified task shape:
//   {
//     id,                       // stable id ('kanban:<id>' or 'note:<path>:<line>')
//     kind:     'kanban'|'note',
//     text,                     // the task text
//     done:     boolean,        // status==='done' or [x]
//     source:   'kanban' | { path, line },   // for jump-to-source
//     createdAt: number | 0,    // for sort (notes use 0 since we don't track)
//     dueDate:  string | null,  // kanban-only (optional field)
//     column:   'todo'|'progress'|'done' | null,  // kanban-only
//   }

const TASK_OPEN_RE = /^(\s*)([-*+]\s+)\[ \]\s+(.*)$/;   // "- [ ] text"
const TASK_DONE_RE = /^(\s*)([-*+]\s+)\[[xX]\]\s+(.*)$/; // "- [x] text"

/**
 * Filter raw `search_in_folder` hits down to real GFM task-list lines.
 * The Rust scan is a substring match for "- [ ]", so it catches prose/code;
 * this enforces `^ \s* [-*+] \s+ [ ] ` syntax.
 * Returns an array of normalized note-task objects.
 *
 * @param {Array<{path:string, line:number, text:string}>} hits
 * @returns {Array<object>} note tasks
 */
export function normalizeNoteTasks(hits) {
  if (!Array.isArray(hits)) return [];
  const out = [];
  for (const h of hits) {
    if (!h || !h.path) continue;
    const text = String(h.text || '').trimEnd();
    let m = TASK_DONE_RE.exec(text);
    const done = !!m;
    if (!m) m = TASK_OPEN_RE.exec(text);
    if (!m) continue;
    const body = stripInline(m[3]);
    if (!body) continue;
    out.push({
      id: `note:${h.path}:${h.line}`,
      kind: 'note',
      text: body,
      done,
      source: { path: h.path, line: h.line },
      createdAt: 0,
      dueDate: null,
      column: null,
    });
  }
  return out;
}

/**
 * Convert Kanban tasks to the unified shape. Skips done tasks unless
 * `includeDone` is true.
 * @param {Array} kanbanTasks   the mdpeek-kanban-tasks array
 * @param {boolean} [includeDone=false]
 * @returns {Array<object>}
 */
export function normalizeKanbanTasks(kanbanTasks, includeDone = false) {
  if (!Array.isArray(kanbanTasks)) return [];
  const out = [];
  for (const t of kanbanTasks) {
    if (!t || !t.id) continue;
    const done = t.status === 'done';
    if (done && !includeDone) continue;
    out.push({
      id: `kanban:${t.id}`,
      kind: 'kanban',
      text: String(t.text || ''),
      done,
      source: 'kanban',
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : 0,
      dueDate: t.dueDate || null,
      column: t.status || null,
    });
  }
  return out;
}

/**
 * Merge kanban + note tasks into one list.
 */
export function mergeTasks(kanbanTasks, noteTasks) {
  return [...(kanbanTasks || []), ...(noteTasks || [])];
}

/**
 * Filter the merged list by a free-text query (matches text or source path).
 */
export function filterTasks(tasks, query) {
  if (!query) return tasks;
  const q = String(query).toLowerCase();
  return tasks.filter((t) => {
    if (String(t.text || '').toLowerCase().includes(q)) return true;
    if (t.source && typeof t.source === 'object' && t.source.path) {
      if (String(t.source.path).toLowerCase().includes(q)) return true;
    }
    return false;
  });
}

/**
 * Sort the merged list. Modes:
 *   'created'  — newest kanban first, notes last (default)
 *   'source'   — kanban first, then notes grouped by file
 *   'due'      — tasks with a dueDate first (soonest first), then the rest
 *   'status'   — incomplete first, then complete
 */
export function sortTasks(tasks, mode = 'created') {
  const arr = [...tasks];
  if (mode === 'due') {
    arr.sort((a, b) => {
      const ad = a.dueDate || '9999';
      const bd = b.dueDate || '9999';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  } else if (mode === 'source') {
    arr.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'kanban' ? -1 : 1;
      if (a.kind === 'note') {
        const pa = (a.source && a.source.path) || '';
        const pb = (b.source && b.source.path) || '';
        if (pa !== pb) return pa < pb ? -1 : 1;
        return (a.source.line || 0) - (b.source.line || 0);
      }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  } else if (mode === 'status') {
    arr.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  } else {
    // 'created' — kanban newest first, notes after (stable-ish).
    arr.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'kanban' ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }
  return arr;
}

/** Count open vs done in a task list. */
export function taskStats(tasks) {
  let open = 0;
  let done = 0;
  for (const t of tasks) {
    if (t.done) done++;
    else open++;
  }
  return { open, done, total: open + done };
}

/** Strip trailing markdown emphasis/links noise from a checkbox line for display. */
function stripInline(s) {
  let out = String(s || '').trim();
  // Drop trailing trailing inline code / link closures lightly — keep it readable.
  return out;
}
