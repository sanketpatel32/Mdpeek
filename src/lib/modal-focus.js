// Shared keyboard and focus behavior for the app's modal sheets.
const MODALS = '.modal-overlay, .diff-overlay, .te-overlay';
const CONTROLS = 'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]';
let refresh = () => {};

// Close handlers release background controls before moving focus or running an action.
export function syncModalFocus() { refresh(); }

function visible(node) {
  if (!node.isConnected || node.closest('.hidden, .is-leaving, [hidden], [inert]')) return false;
  for (let el = node; el; el = el.parentElement) {
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function modalOwnsKeyboard(doc = document) {
  return [...doc.querySelectorAll(MODALS)].some((el) => visible(el));
}

export function initModalFocus(doc = document) {
  const win = doc.defaultView;
  const stack = [];
  const inertStates = new Map();
  let lastFocus = doc.activeElement;
  let syncing = false;

  function controls(modal) {
    return [...modal.querySelectorAll(CONTROLS)].filter((el) =>
      el.tabIndex >= 0 && !el.matches(':disabled') && visible(el));
  }
  function focusInside(modal) {
    if (modal.contains(doc.activeElement)) return;
    if (!modal.hasAttribute('tabindex')) modal.tabIndex = -1;
    (controls(modal)[0] || modal).focus();
  }
  function restoreInert() {
    for (const [el, wasInert] of inertStates) el.toggleAttribute('inert', wasInert);
    inertStates.clear();
  }
  function sync() {
    if (syncing) return;
    syncing = true;
    try {
      // Remove our inert flags before checking which sheets are still open.
      restoreInert();
      const open = [...doc.querySelectorAll(MODALS)].filter(visible);
      const closed = stack.filter((entry) => !open.includes(entry.modal));
      for (const entry of closed) {
        entry.modal.style.zIndex = entry.zIndex;
        stack.splice(stack.indexOf(entry), 1);
      }
      for (const modal of open) {
        if (!stack.some((entry) => entry.modal === modal)) {
          stack.push({ modal, opener: lastFocus, zIndex: modal.style.zIndex });
        }
      }
      const top = stack.at(-1)?.modal;
      stack.forEach((entry, i) => { entry.modal.style.zIndex = String(1200 + i); });
      if (closed.length && (doc.activeElement === doc.body || closed.some((entry) => entry.modal.contains(doc.activeElement)))) {
        const opener = closed.map((entry) => entry.opener).reverse().find((el) => el && visible(el));
        if (opener && visible(opener) && (!top || top.contains(opener))) opener.focus();
      }
      if (top) {
        for (const child of doc.body.children) {
          if (child === top || child.contains(top) || ['SCRIPT', 'STYLE'].includes(child.tagName)) continue;
          inertStates.set(child, child.hasAttribute('inert'));
          child.setAttribute('inert', '');
        }
        focusInside(top);
      }
    } finally { syncing = false; }
  }
  function onFocus(event) {
    sync();
    const top = stack.at(-1)?.modal;
    if (top && !top.contains(event.target)) focusInside(top);
    lastFocus = doc.activeElement;
  }
  function onKey(event) {
    sync();
    const top = stack.at(-1)?.modal;
    if (!top || event.key !== 'Tab') return;
    const items = controls(top);
    const index = items.indexOf(doc.activeElement);
    if (!items.length || (event.shiftKey ? index <= 0 : index === items.length - 1 || index < 0)) {
      event.preventDefault();
      (event.shiftKey ? items.at(-1) : items[0])?.focus();
    }
  }
  // Class/hidden changes cover both static dialogs and dynamically built pickers.
  const observer = new win.MutationObserver(sync);
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  doc.addEventListener('focusin', onFocus);
  win.addEventListener('keydown', onKey, true);
  refresh = sync;
  sync();
  return () => {
    refresh = () => {};
    observer.disconnect();
    doc.removeEventListener('focusin', onFocus);
    win.removeEventListener('keydown', onKey, true);
    restoreInert();
    stack.forEach((entry) => { entry.modal.style.zIndex = entry.zIndex; });
  };
}
