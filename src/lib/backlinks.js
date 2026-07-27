// Backlinks helpers (v0.40.0). Pure functions — no DOM, no IPC. Used by the
// "Find backlinks" command-palette entry in main.js, which runs two
// `search_in_folder` queries (wiki-link + standard-link forms) and feeds the
// combined hits through `formatBacklinkItems` to produce picker entries.

// Strip directory + markdown extension from an absolute path.
//   'C:\\notes\\Foo.md'        → 'Foo'
//   '/home/me/notes/bar.MDX'   → 'bar'
//   'Untitled'                 → 'Untitled'
//   null / empty               → null
export function docBasename(path) {
  if (!path) return null;
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  return file.replace(/\.(md|markdown|mdx)$/i, '');
}

// Two search queries that together catch both link forms for a doc named `basename`.
//   [[Foo]] / [[Foo|alias]] / [[Foo.md]]   ← caught by `[[Foo`
//   [text](Foo.md) / [text](<Foo.md>)      ← caught by `Foo.md`
// Returns plain strings (the Rust grep takes a string query). Double quotes
// would never appear in a real basename but are stripped defensively so a
// crafted name can't break out of the query.
export function backlinkQueries(basename) {
  if (!basename) return [];
  const safe = basename.replace(/"/g, '');
  return [`[[${safe}`, `${safe}.md`];
}

// Dedupe hits by path, drop the active doc (a file never backlinks itself),
// sort alphabetically, and shape them as picker items.
//
// `hits` is the combined `results` array from one or more `search_in_folder`
// calls. Each entry has `{ path, matches: [{ line, column, text }] }`.
export function formatBacklinkItems(hits, activePath) {
  if (!hits || !hits.length) return [];
  const seen = new Set();
  const items = [];
  for (const hit of hits) {
    if (!hit || !hit.path || hit.path === activePath) continue;
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    const slash = Math.max(hit.path.lastIndexOf('/'), hit.path.lastIndexOf('\\'));
    const name = slash >= 0 ? hit.path.slice(slash + 1) : hit.path;
    const preview = (hit.matches && hit.matches[0] && hit.matches[0].text) || '';
    const hint = preview.length > 60 ? preview.slice(0, 57) + '…' : preview;
    items.push({
      label: name,
      hint,
      keywords: name + ' ' + hit.path,
      path: hit.path,
    });
  }
  items.sort((a, b) => a.label.localeCompare(b.label));
  return items;
}
