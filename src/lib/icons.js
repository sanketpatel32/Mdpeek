// Centralized icon registry built on lucide.
//
// One place to declare every icon the UI uses. HTML uses placeholders like
// `<span data-icon="folder-open"></span>`; renderIcons(root) swaps them for
// real SVGs. This keeps markup clean and lets us re-skin the whole set by
// editing this one file.
//
// To add an icon: import it from lucide below and add it to the ICONS map.
// The key is the kebab-case name used in data-icon="...".

import {
  ChevronLeft, ChevronRight, ChevronDown,
  FolderOpen, Save, Pencil, PenTool,
  PanelLeft, FolderTree, FolderSearch, Search,
  Download, FileText, Presentation, Share2, Calendar,
  Columns3, Kanban, TerminalSquare,
  ZoomOut, ZoomIn,
  Contrast, Settings, SlidersHorizontal,
  Minus, Square, X, Plus,
  Copy, RotateCw,
  ListChecks, PencilLine, ToggleLeft, Sparkles,
  Keyboard, ScrollText, Info,
  MoreHorizontal, Bell,
  Check, Palette,
} from 'lucide';

// Map of kebab-case alias -> lucide icon node.
// A lucide icon is an array tuple: [tag, attrs, children].
const ICONS = {
  'chevron-left':  ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down':  ChevronDown,
  'folder-open':   FolderOpen,
  'save':          Save,
  'pencil':        Pencil,
  'pen-tool':      PenTool,
  'panel-left':    PanelLeft,
  'folder-tree':   FolderTree,
  'folder-search': FolderSearch,
  'search':        Search,
  'download':      Download,
  'file-text':     FileText,
  'presentation':  Presentation,
  'share':         Share2,
  'calendar':      Calendar,
  'columns':       Columns3,
  'kanban':        Kanban,
  'terminal':      TerminalSquare,
  'zoom-out':      ZoomOut,
  'zoom-in':       ZoomIn,
  'contrast':      Contrast,
  'settings':      Settings,
  'sliders':       SlidersHorizontal,
  'minus':         Minus,
  'square':        Square,
  'x':             X,
  'copy':          Copy,
  'rotate-cw':     RotateCw,
  'list-checks':   ListChecks,
  'pencil-line':   PencilLine,
  'toggle-left':   ToggleLeft,
  'sparkles':      Sparkles,
  'keyboard':      Keyboard,
  'scroll':        ScrollText,
  'info':          Info,
  'more':          MoreHorizontal,
  'bell':          Bell,
  'check':         Check,
  'palette':       Palette,
  'plus':          Plus,
};

/** Default icon size (matches the old inline SVGs). */
const DEFAULT_SIZE = 16;

/**
 * Build an SVG string for an icon alias.
 * @param {string} alias  kebab-case key in ICONS
 * @param {number} [size] pixel size (square)
 * @returns {string} inline SVG markup (stroke=currentColor)
 */
export function icon(alias, size = DEFAULT_SIZE) {
  const node = ICONS[alias];
  if (!node) {
    if (typeof console !== 'undefined') console.warn(`[icons] unknown icon: ${alias}`);
    return '';
  }
  return toSvg(node, size);
}

/**
 * Replace every `[data-icon]` element under `root` with its SVG.
 * Safe to call multiple times — it no-ops elements already rendered
 * (marks them with `data-icon-rendered`). Call once on DOMContentLoaded.
 * @param {ParentNode} [root=document.body]
 */
export function renderIcons(root = document.body) {
  const holders = root.querySelectorAll('[data-icon]:not([data-icon-rendered])');
  holders.forEach((el) => {
    const alias = el.getAttribute('data-icon');
    const size = parseInt(el.getAttribute('data-icon-size') || '', 10) || DEFAULT_SIZE;
    const svg = icon(alias, size);
    if (svg) {
      el.innerHTML = svg;
      el.classList.add('icon-host');
    }
    el.setAttribute('data-icon-rendered', '');
  });
}

/** The full set of registered aliases (for tests / debugging). */
export const iconNames = () => Object.keys(ICONS);

// ---- internal: lucide node -> SVG string ------------------------------
// A lucide icon node is a FLAT ARRAY of [tag, attrs] tuples (the children of
// the <svg>). The <svg> wrapper itself (viewBox, stroke, fill, size) is added
// here. Verified shape:
//   FolderOpen = [['path', { d: '...' }]]            // 1 child
//   X          = [['path',{d:'M18 6 6 18'}],['path',{d:'m6 6 12 12'}]]  // 2

function toSvg(node, size) {
  const svgAttrs = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  const attrsStr = Object.entries(svgAttrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  const inner = renderChildren(node);
  return `<svg ${attrsStr}>${inner}</svg>`;
}

function renderChildren(children) {
  if (!children || !Array.isArray(children)) return '';
  return children
    .map((child) => {
      if (typeof child === 'string') return child;
      const [tag, attrs] = child;
      const attrsStr = Object.entries(attrs || {})
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${attrsStr} />`;
    })
    .join('');
}
