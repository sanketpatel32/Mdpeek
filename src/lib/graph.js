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
//
// v0.72.0 UI-polish iteration: a presentation layer layered ON TOP of the
// model above, without touching layout or physics:
//   - graphTooltipHtml / graphEmptyHtml / graphLegendHtml — small pure markup
//     builders (escaped, token-styled classes) for the graph chrome.
//   - initGraphPolish() — installs hover-halo + connected-edge emphasis, the
//     title/path tooltip card, zoom-cluster styling, the "No links yet" empty
//     state, legend chips, and a Building… skeleton. Idempotent (style-tag id
//     + module flag), injects one <style>, and is a silent no-op wherever its
//     anchors (#graph-svg / .graph-canvas-wrap) are missing — e.g. under the
//     jsdom unit tests, which never see app chrome.

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

// ===================== v0.72.0: presentation layer ==========================
// Everything below is chrome: markup builders + one self-installing enhancer
// that layers CSS classes and overlay elements over whatever main.js renders.
// No layout math, no model changes — buildGraph/circleLayout stay pure.

// Escape a string for safe interpolation into HTML text/attributes (mirrors
// the esc() helper in main.js's drawGraph).
function graphEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Directory portion of a note path for the tooltip's path row:
// 'docs/deep/Foo.md' → 'docs / deep'; bare 'Foo.md' → '' (row omitted).
function graphPathDir(path) {
  if (!path) return '';
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (slash < 0) return '';
  return path.slice(0, slash).replace(/[\\/]+$/g, '').replace(/[\\/]/g, ' / ');
}

// Floating tooltip card: title + muted directory path + degree chip. Pure →
// unit-tested. The degree line is pluralized here so the DOM layer stays dumb.
export function graphTooltipHtml({ label, path, degree } = {}) {
  const title = graphEsc(label || '');
  const dir = graphPathDir(path);
  const n = Number.isFinite(degree) ? degree : 0;
  const degreeChip =
    `<span class="gp-tip-degree">${n} link${n === 1 ? '' : 's'}</span>`;
  return (
    `<span class="gp-tip-title">${title}</span>` +
    (dir ? `<span class="gp-tip-path">${graphEsc(dir)}</span>` : '') +
    degreeChip
  );
}

// Empty-state card. `message` defaults to the "No links yet" copy used when a
// folder has notes but not a single resolvable link between them.
export function graphEmptyHtml(message = 'No links yet') {
  return (
    `<div class="gp-empty-icon" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"` +
    ` stroke-width="1.6" stroke-linecap="round">` +
    `<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="8" r="2.4"/><circle cx="12" cy="18" r="2.4"/>` +
    `<path d="M8.2 7l7.4 0.7M7 8.2l3.8 7.6M16.9 10.2l-3.6 5.7"/></svg></div>` +
    `<div class="gp-empty-title">${graphEsc(message)}</div>` +
    `<div class="gp-empty-hint">Connect notes with [[wiki-links]] to draw edges.</div>`
  );
}

// Legend chips for the canvas corner: what the three node treatments mean.
export function graphLegendHtml() {
  return (
    `<span class="gp-legend-chip"><i class="gp-dot gp-dot-linked"></i>Linked</span>` +
    `<span class="gp-legend-chip"><i class="gp-dot gp-dot-orphan"></i>Unlinked</span>` +
    `<span class="gp-legend-chip"><i class="gp-dot gp-dot-hub"></i>Hub</span>`
  );
}

let _graphPolishInstalled = false;
const GRAPH_POLISH_STYLE_ID = 'mdpeek-graph-polish-css';

// One injected stylesheet, scoped under .gp-on on .graph-canvas-wrap so stock
// rules in base.css keep working untouched. Tokens carry fallbacks everywhere.
function injectGraphPolishCss() {
  if (document.getElementById(GRAPH_POLISH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = GRAPH_POLISH_STYLE_ID;
  style.textContent = `
.gp-on #graph-svg .graph-node circle {
  transition: fill var(--dur-1,120ms) var(--ease-out,ease-out),
    stroke var(--dur-1,120ms) var(--ease-out,ease-out),
    stroke-width var(--dur-2,180ms) var(--ease-out,ease-out),
    stroke-opacity var(--dur-2,180ms) var(--ease-out,ease-out);
}
/* Hover halo: wide translucent accent ring + soft glow around the node. */
.gp-on #graph-svg .graph-node:hover circle,
.gp-on #graph-svg .graph-node.graph-node-focus circle {
  stroke: var(--accent,#0071e3);
  stroke-opacity: 0.32;
  stroke-width: 7;
}
.gp-on #graph-svg .graph-node.graph-node-pinned circle { stroke-opacity: 0.55; }
.gp-on #graph-svg .graph-node:hover,
.gp-on #graph-svg .graph-node.graph-node-focus {
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--accent,#0071e3) 45%, transparent));
}
/* Connected-edge emphasis: active edges get an accent flow while focused. */
@media (prefers-reduced-motion: no-preference) {
  .gp-on #graph-svg.graph-focus-on line.graph-edge.graph-edge-active {
    stroke-dasharray: 5 7;
    animation: gp-edge-flow 900ms linear infinite;
  }
  @keyframes gp-edge-flow { to { stroke-dashoffset: -12; } }
}
/* Zoom cluster: three buttons joined into one floating pill. */
.gp-on .graph-controls {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: var(--bg-elevated,#fff);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg,12px);
  box-shadow: var(--shadow-md);
}
.gp-on .graph-controls button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--radius-sm,5px);
  background: transparent;
  color: var(--fg-muted,#828287);
}
.gp-on .graph-controls button:hover {
  background: var(--accent-soft);
  color: var(--accent,#0071e3);
  border-color: transparent;
}
/* Tooltip card: title row, muted path row, accent degree chip. */
.gp-on .graph-tooltip {
  max-width: 260px;
  padding: var(--sp-2,6px) var(--sp-3,8px);
  white-space: normal;
  border-radius: var(--radius,8px);
}
.gp-on .gp-tip-title { display: block; font-size: 12px; font-weight: 600; color: var(--fg); }
.gp-on .gp-tip-path {
  display: block;
  margin-top: 1px;
  font-size: 11px;
  color: var(--fg-muted,#828287);
  overflow: hidden;
  text-overflow: ellipsis;
}
.gp-on .gp-tip-degree {
  display: inline-block;
  margin-top: var(--sp-1,4px);
  padding: 0 var(--sp-2,6px);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent,#0071e3);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}
/* Canvas overlays (empty state / legend / skeleton): non-interactive. */
.gp-overlay {
  position: absolute;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-3,240ms) var(--ease-out,ease-out);
}
.gp-overlay.gp-show { opacity: 1; }
.gp-on .gp-empty {
  left: 50%; top: 50%;
  transform: translate(-50%,-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-1,4px);
  padding: var(--sp-5,16px) var(--sp-6,20px);
  text-align: center;
  color: var(--fg-muted,#828287);
}
.gp-on .gp-empty.gp-show { transform: translate(-50%,-50%); }
.gp-on .gp-empty-icon { color: var(--fg-muted,#828287); opacity: 0.7; }
.gp-on .gp-empty-title { font-size: 13px; font-weight: 600; color: var(--fg-secondary,var(--fg)); }
.gp-on .gp-empty-hint { font-size: 11px; max-width: 220px; }
.gp-on .gp-legend {
  left: var(--sp-3,8px);
  bottom: var(--sp-3,8px);
  display: flex;
  gap: var(--sp-3,8px);
  padding: var(--sp-1,4px) var(--sp-3,8px);
  background: var(--bg-elevated,#fff);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  box-shadow: var(--shadow-md);
  font-size: 11px;
  color: var(--fg-muted,#828287);
}
.gp-on .gp-legend-chip { display: inline-flex; align-items: center; gap: 5px; }
.gp-dot { width: 8px; height: 8px; border-radius: 50%; }
.gp-dot-linked { background: var(--accent,#0071e3); }
.gp-dot-orphan { background: color-mix(in srgb, var(--fg-muted,#828287) 55%, transparent); }
.gp-dot-hub {
  background: var(--accent,#0071e3);
  box-shadow: 0 0 4px color-mix(in srgb, var(--accent,#0071e3) 70%, transparent);
}
/* Building… skeleton: pulsing placeholder rings where nodes will land. */
.gp-on .gp-skeleton {
  left: 50%; top: 50%;
  width: 140px; height: 100px;
  transform: translate(-50%,-50%);
}
.gp-skel-ring {
  position: absolute;
  top: 50%; left: 50%;
  border: 1.5px solid var(--border-subtle);
  border-radius: 50%;
  transform: translate(-50%,-50%);
}
.gp-skel-ring.r1 { width: 34px; height: 34px; }
.gp-skel-ring.r2 { width: 68px; height: 68px; }
.gp-skel-ring.r3 { width: 100px; height: 100px; }
@media (prefers-reduced-motion: no-preference) {
  .gp-skel-ring { animation: gp-skel-pulse 1.4s var(--ease-out,ease-out) infinite; }
  .gp-skel-ring.r2 { animation-delay: 150ms; }
  .gp-skel-ring.r3 { animation-delay: 300ms; }
  @keyframes gp-skel-pulse { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }
}
`;
  document.head.appendChild(style);
}

// Recompute which canvas overlays should be visible from the current SVG +
// summary state. Called via rAF-throttled observers; cheap at note-graph scale.
function refreshGraphOverlays(wrap, svg, summaryEl) {
  const nodeCount = svg.querySelectorAll('g.graph-node').length;
  const edgeCount = svg.querySelectorAll('line.graph-edge').length;
  const building = /^Building/.test(summaryEl?.textContent || '');

  let skeleton = wrap.querySelector('.gp-skeleton');
  if (!skeleton) {
    skeleton = document.createElement('div');
    skeleton.className = 'gp-overlay gp-skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML =
      '<span class="gp-skel-ring r1"></span><span class="gp-skel-ring r2"></span>' +
      '<span class="gp-skel-ring r3"></span>';
    wrap.appendChild(skeleton);
  }
  skeleton.classList.toggle('gp-show', building && nodeCount === 0);

  let empty = wrap.querySelector('.gp-empty');
  if (!empty) {
    empty = document.createElement('div');
    empty.className = 'gp-overlay gp-empty';
    empty.setAttribute('role', 'status');
    empty.setAttribute('aria-live', 'polite');
    wrap.appendChild(empty);
  }
  // Notes but zero resolvable links → the "No links yet" card; no notes / no
  // folder / error → surface the summary line itself as the message.
  let emptyMsg = null;
  if (!building && nodeCount === 0) emptyMsg = summaryEl?.textContent || 'No links yet';
  else if (!building && nodeCount > 0 && edgeCount === 0) emptyMsg = 'No links yet';
  if (emptyMsg !== null) empty.innerHTML = graphEmptyHtml(emptyMsg);
  empty.classList.toggle('gp-show', emptyMsg !== null);

  let legend = wrap.querySelector('.gp-legend');
  if (!legend) {
    legend = document.createElement('div');
    legend.className = 'gp-overlay gp-legend';
    legend.setAttribute('aria-hidden', 'true');
    legend.innerHTML = graphLegendHtml();
    wrap.appendChild(legend);
  }
  legend.classList.toggle('gp-show', nodeCount > 0 && !building);
}

// Upgrade #graph-tooltip's plain "Label · N links" line into the full card and
// re-clamp it inside the canvas (same clamp math as main.js, run after the
// content swap changes the tooltip's box). Reads everything off the hovered
// <g data-node-id data-path> — zero coupling to main.js internals.
function upgradeGraphTooltip(tip, group, clientX, clientY, wrap) {
  if (!tip || !group) return;
  const id = group.getAttribute('data-node-id') || '';
  const label = group.querySelector('title')?.textContent || id;
  let degree = 0;
  const svg = group.ownerSVGElement;
  if (svg) {
    for (const line of svg.querySelectorAll('line.graph-edge')) {
      if (line.getAttribute('data-from') === id || line.getAttribute('data-to') === id) degree++;
    }
  }
  tip.innerHTML = graphTooltipHtml({
    label,
    path: group.getAttribute('data-path') || '',
    degree,
  });
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const x = Math.min(clientX - rect.left + 14, rect.width - tip.offsetWidth - 8);
  const y = Math.min(clientY - rect.top + 14, rect.height - tip.offsetHeight - 8);
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

// Install the polish layer once. Returns true when installed. Safe to call
// repeatedly; also self-invokes once on import in a real DOM (module scripts
// run after parsing, so the anchors exist by then; under jsdom tests they do
// not and this is a silent no-op).
export function initGraphPolish() {
  if (_graphPolishInstalled) return false;
  if (typeof document === 'undefined') return false;
  const wrap = document.querySelector('.graph-canvas-wrap');
  const svg = document.getElementById('graph-svg');
  if (!wrap || !svg) return false;

  _graphPolishInstalled = true;
  try {
    injectGraphPolishCss();
  } catch {
    _graphPolishInstalled = false;
    return false;
  }
  wrap.classList.add('gp-on');

  // ---- tooltip upgrade (delegated; runs after main.js's own handlers) ----
  let hoverGroup = null;
  let hoverPoint = { x: 0, y: 0 };
  let tipRaf = 0;
  const flushTooltip = () => {
    tipRaf = 0;
    const tip = document.getElementById('graph-tooltip');
    if (!tip || tip.classList.contains('hidden')) return;
    upgradeGraphTooltip(tip, hoverGroup, hoverPoint.x, hoverPoint.y, wrap);
  };
  wrap.addEventListener('pointerover', (e) => {
    const g = e.target?.closest ? e.target.closest('[data-node-id]') : null;
    if (g) hoverPoint = { x: e.clientX, y: e.clientY };
    if (g === hoverGroup) return; // churn among children of the same node
    hoverGroup = g || null;
    if (!hoverGroup) {
      // Left the nodes for the bare canvas — drop pending work.
      if (tipRaf) { cancelAnimationFrame(tipRaf); tipRaf = 0; }
      return;
    }
    if (!tipRaf) tipRaf = requestAnimationFrame(flushTooltip);
  });
  wrap.addEventListener('pointerout', (e) => {
    const from = e.target?.closest ? e.target.closest('[data-node-id]') : null;
    const to = e.relatedTarget?.closest ? e.relatedTarget.closest('[data-node-id]') : null;
    if (from && to && from === to) return; // churn inside one node's <g>
    if (hoverGroup && from && from !== hoverGroup) return;
    hoverGroup = null;
    if (tipRaf) { cancelAnimationFrame(tipRaf); tipRaf = 0; }
  });

  // ---- overlays: keep empty state / legend / skeleton in step with redraws --
  let overlayRaf = 0;
  const scheduleOverlays = () => {
    if (overlayRaf) return;
    overlayRaf = requestAnimationFrame(() => {
      overlayRaf = 0;
      refreshGraphOverlays(wrap, svg, document.getElementById('graph-summary'));
    });
  };
  scheduleOverlays(); // initial state (panel may open already populated)
  try {
    new MutationObserver(scheduleOverlays).observe(svg, { childList: true });
    const summaryEl = document.getElementById('graph-summary');
    if (summaryEl) {
      new MutationObserver(scheduleOverlays).observe(summaryEl, {
        childList: true, characterData: true, subtree: true,
      });
    }
  } catch { /* MutationObserver unavailable — overlays just won't auto-update */ }

  return true;
}

// Self-install in a live app without any wiring in main.js: module scripts are
// deferred, so the graph chrome already exists at import time. Fully guarded —
// never throws, never runs under the jsdom unit tests (no anchors there).
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  try {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => initGraphPolish(), { once: true });
    } else {
      initGraphPolish();
    }
  } catch { /* presentation-only: never block startup */ }
}
