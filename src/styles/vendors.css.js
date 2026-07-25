// Vendor CSS bundling — replaces the CDN <link> tags that used to live in
// index.html. KaTeX CSS + the 6 highlight.js themes are now bundled locally:
//   • No CDN dependency (works offline)
//   • Version-matched to the npm deps (no more 0.16.11 vs 0.17.0 skew)
//   • Vite emits them as hashed assets under dist/assets/
//
// Each hljs theme is imported as a URL (?url) so we can construct <link>
// elements with stable IDs (hljs-light, hljs-dark, …) that applyThemeImpl()
// toggles via the `disabled` property — the exact same mechanism the old CDN
// links used. KaTeX CSS is imported for its side effects (it has no toggle).

import 'katex/dist/katex.min.css';

import hljsLight from 'highlight.js/styles/github.min.css?url';
import hljsDark from 'highlight.js/styles/github-dark.min.css?url';
import hljsSolarLight from 'highlight.js/styles/base16/solarized-light.min.css?url';
import hljsSolarDark from 'highlight.js/styles/base16/solarized-dark.min.css?url';
import hljsDracula from 'highlight.js/styles/base16/dracula.min.css?url';
import hljsNord from 'highlight.js/styles/nord.min.css?url';

// Map of element id → bundled asset URL. Order matters only for readability.
const HLJS_THEMES = {
  'hljs-light': hljsLight,
  'hljs-dark': hljsDark,
  'hljs-solar-light': hljsSolarLight,
  'hljs-solar-dark': hljsSolarDark,
  'hljs-dracula': hljsDracula,
  'hljs-nord': hljsNord,
};

// Inject the 6 hljs <link> elements into <head> with stable IDs. The first
// (light) is enabled, the rest disabled — applyThemeImpl() will flip the
// right one on once the saved theme loads. Idempotent: skips any id that
// already exists (e.g. HMR re-runs in dev).
export function installHljsThemes() {
  if (typeof document === 'undefined') return;
  for (const [id, href] of Object.entries(HLJS_THEMES)) {
    if (document.getElementById(id)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = id;
    link.href = href;
    // Disable all but the default light theme; applyThemeImpl re-enables the
    // right one based on the saved/active theme. Defaults match the old CDN
    // markup (only hljs-light enabled at first paint).
    link.disabled = id !== 'hljs-light';
    document.head.appendChild(link);
  }
}
