// motion.js — runtime helpers backing motion.css (v0.32.0)
//
// 1. transitionHidden(): animate overlays out before `display:none` hides them.
//    base.css uses `.hidden { display:none !important }`, which kills any exit
//    animation. This helper removes .hidden, adds .is-leaving, waits for the
//    leave animation (animationend or a fallback timeout), then re-adds .hidden.
// 2. wireRipples(): pointerdown listener that spawns a ripple <span> at the
//    click point inside [data-ripple] elements.
// 3. positionTabIndicator(): measures the active .tab and moves .tab-indicator.
//
// All helpers are no-ops in jsdom (no layout) and respect prefers-reduced-motion.

const REDUCE =
  typeof matchMedia !== 'undefined'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

/** True if the user has asked the OS to minimize motion. */
export function prefersReducedMotion() {
  return !!(REDUCE && REDUCE.matches);
}

/**
 * Show or hide an overlay element with an exit animation.
 *
 * @param {HTMLElement} el      the overlay element (must support .hidden)
 * @param {boolean}     show    true → reveal, false → animate out then hide
 * @param {object}      [opts]
 * @param {string}      [opts.leavingClass='is-leaving']  class added during exit
 * @param {number}      [opts.fallbackMs=400]             safety timeout in case animationend never fires
 * @returns {Promise<void>} resolves when the transition is complete
 */
export function transitionHidden(el, show, opts = {}) {
  if (!el) return Promise.resolve();
  const { leavingClass = 'is-leaving', fallbackMs = 400 } = opts;

  if (show) {
    el.classList.remove(leavingClass);
    el.classList.remove('hidden');
    return Promise.resolve();
  }

  // Hiding. If reduced motion or element already hidden, just hide.
  if (prefersReducedMotion() || el.classList.contains('hidden')) {
    el.classList.add('hidden');
    el.classList.remove(leavingClass);
    return Promise.resolve();
  }

  // Animate out: reveal (it's currently visible), mark leaving, wait.
  el.classList.remove('hidden');
  el.classList.add(leavingClass);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      el.classList.add('hidden');
      el.classList.remove(leavingClass);
      resolve();
    };
    const onEnd = (e) => {
      // Only react to the element's own animation (not children's).
      if (e.target === el && e.animationName && e.animationName.endsWith('-out')) {
        finish();
      }
    };
    const timer = setTimeout(finish, fallbackMs);
    function cleanup() {
      clearTimeout(timer);
      el.removeEventListener('animationend', onEnd);
    }
    el.addEventListener('animationend', onEnd);
  });
}

/**
 * Attach ripple-on-press behavior to every [data-ripple] element under root.
 * Idempotent — safe to call again after dynamically inserting elements
 * (marks each host with `data-ripple-bound`).
 * @param {ParentNode} [root=document.body]
 */
export function wireRipples(root = document.body) {
  const hosts = root.querySelectorAll('[data-ripple]:not([data-ripple-bound])');
  hosts.forEach((host) => {
    host.setAttribute('data-ripple-bound', '');
    host.addEventListener('pointerdown', (e) => {
      if (prefersReducedMotion()) return;
      const rect = host.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2;
      const y = (e.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2;
      const wave = document.createElement('span');
      wave.className = 'ripple-wave';
      wave.style.width = `${size}px`;
      wave.style.height = `${size}px`;
      wave.style.left = `${x}px`;
      wave.style.top = `${y}px`;
      host.appendChild(wave);
      wave.addEventListener('animationend', () => wave.remove(), { once: true });
      // Safety: remove after 600ms in case the event is missed.
      setTimeout(() => wave.remove(), 600);
    });
  });
}

/**
 * Position the tab indicator bar under the active tab.
 * No-op if there's no indicator element or no active tab (e.g. jsdom).
 * @param {object} args
 * @param {HTMLElement|null} args.strip     the .tab-strip container
 * @param {HTMLElement|null} args.indicator the .tab-indicator bar
 */
export function positionTabIndicator({ strip, indicator } = {}) {
  if (!strip || !indicator) return;
  const active = strip.querySelector('.tab.active');
  if (!active) {
    indicator.classList.add('is-hidden');
    return;
  }
  const stripRect = strip.getBoundingClientRect();
  const tabRect = active.getBoundingClientRect();
  if (tabRect.width === 0) {
    // Not laid out yet (hidden / zero size). Hide gracefully; will reposition on show.
    indicator.classList.add('is-hidden');
    return;
  }
  const left = tabRect.left - stripRect.left + strip.scrollLeft + 12;
  const width = Math.max(0, tabRect.width - 24);
  indicator.style.left = `${left}px`;
  indicator.style.width = `${width}px`;
  indicator.classList.remove('is-hidden');
}
