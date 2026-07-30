// v0.50.0: Note-graph model + layout for the Workspace "Graph" view.
//
// buildGraph() turns a set of notes into a node/edge model by reusing
// extractDocLinks (link-checker.js) for forward edges and basename() to
// normalize targets against the known note set. circleLayout() assigns each
// node a deterministic {x, y} position (degree-weighted concentric rings) so
// the SVG render needs no animation/force-simulation.
//
// Both pure + DOM-free → unit-tested. Non-throwing: a single malformed note
// (or one whose content fails extractDocLinks) is skipped, never aborting the
// whole graph.

import { extractDocLinks, basename } from './link-checker.js';

// Derive a note's basename label from its path: 'docs/Foo.md' → 'Foo'.
// Mirrors link-checker's basename() but also strips the directory (that one
// takes a link target which may already be bare). Reused here for node labels.
function pathBasename(path) {
  if (!path) return '';
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  return file.replace(/\.(md|markdown|mdx)$/i, '');
}

// Build a graph model from a set of notes.
//
// Input:  files = [{ path, content }]  (content may be null/undefined for
//         unreadable files — they become orphan nodes with no outgoing edges)
// Output: { nodes, edges, orphans }
//   - nodes : [{ id, label, path, degree }] sorted by degree desc, then label.
//             `id` is the normalized basename (case-sensitive). `degree` counts
//             both outgoing and incoming edges.
//   - edges : [{ from, to }] de-duplicated, self-loops removed. `from`/`to` are
//             node ids. Only edges whose `to` resolves to a known note are kept
//             (broken links don't draw edges).
//   - orphans: count of nodes with degree 0.
//
// Non-throwing: a note whose content throws during extractDocLinks is treated
// as having no outgoing links (it still appears as a node).
export function buildGraph(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return { nodes: [], edges: [], orphans: 0 };
  }
  // Map of basename → path (first file wins on collision; case-sensitive).
  const idToPath = new Map();
  const nodes = [];
  for (const f of files) {
    if (!f || !f.path) continue;
    const id = pathBasename(f.path);
    if (!id || idToPath.has(id)) continue;
    idToPath.set(id, f.path);
    nodes.push({ id, label: id, path: f.path, degree: 0 });
  }
  const idSet = new Set(idToPath.keys());

  // Collect edges, normalized + de-duplicated. Self-loops dropped.
  const edgeKeys = new Set();
  const edges = [];
  for (const f of files) {
    if (!f || !f.path || typeof f.content !== 'string') continue;
    const fromId = pathBasename(f.path);
    if (!fromId || !idSet.has(fromId)) continue;
    let links;
    try {
      links = extractDocLinks(f.content);
    } catch {
      continue; // malformed content → no outgoing edges from this note
    }
    for (const link of links) {
      const toId = basename(link.target);
      if (!toId || toId === fromId) continue; // self-loop
      if (!idSet.has(toId)) continue; // broken link → no edge
      const key = fromId + '\u0000' + toId;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ from: fromId, to: toId });
    }
  }

  // Degree = outgoing + incoming edge count.
  const degree = new Map();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }
  let orphans = 0;
  for (const n of nodes) {
    n.degree = degree.get(n.id) || 0;
    if (n.degree === 0) orphans += 1;
  }
  // Sort: highest degree first (so the most-connected notes land center in the
  // layout), tiebreak alphabetically for determinism.
  nodes.sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
  return { nodes, edges, orphans };
}

// Assign each node a deterministic {x, y} position within a width×height box.
//
// Layout: the single highest-degree node (if any) sits at the center; remaining
// nodes are placed on concentric rings, ring N holding up to 6×N nodes, ring
// radius growing by `ringGap`. Degree-0 orphans go to the outermost ring first
// (so connected nodes cluster inward). Deterministic given the node order.
//
// Returns a Map<id, {x, y}>. Pure — no DOM. Guards against zero nodes.
export function circleLayout(nodes, width, height) {
  const positions = new Map();
  if (!Array.isArray(nodes) || nodes.length === 0 || !width || !height) {
    return positions;
  }
  const cx = width / 2;
  const cy = height / 2;
  const minDim = Math.min(width, height);
  // Base ring gap scales with canvas size; keep nodes from overlapping.
  const ringGap = Math.max(40, minDim / 8);
  const nodeR = Math.max(6, minDim / 60); // used by the renderer, kept here for spacing math

  if (nodes.length === 1) {
    positions.set(nodes[0].id, { x: cx, y: cy });
    return positions;
  }

  // The most-connected node goes center.
  const center = nodes[0];
  positions.set(center.id, { x: cx, y: cy });

  const rest = nodes.slice(1);
  // Place orphans (degree 0) at the end so connected nodes get inner rings.
  rest.sort((a, b) => {
    const ao = a.degree === 0 ? 1 : 0;
    const bo = b.degree === 0 ? 1 : 0;
    if (ao !== bo) return ao - bo;
    return b.degree - a.degree;
  });

  let ring = 1;
  let placedOnRing = 0;
  let ringCapacity = 6; // ring N holds 6*N nodes
  let angleOffset = 0;
  for (const n of rest) {
    if (placedOnRing >= ringCapacity) {
      ring += 1;
      placedOnRing = 0;
      ringCapacity = 6 * ring;
      angleOffset = Math.PI / ring; // stagger so rings don't line up radially
    }
    const radius = ring * ringGap + nodeR;
    const theta = angleOffset + (placedOnRing / ringCapacity) * Math.PI * 2;
    positions.set(n.id, {
      x: cx + radius * Math.cos(theta),
      y: cy + radius * Math.sin(theta),
    });
    placedOnRing += 1;
  }
  return positions;
}
