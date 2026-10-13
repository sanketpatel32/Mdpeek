import { afterEach, beforeEach, expect, it } from 'vitest';
import { initModalFocus, modalOwnsKeyboard, syncModalFocus } from '../src/lib/modal-focus.js';
import { makePicker } from '../src/views/command-palette.js';
import { initTableEditor } from '../src/views/table-editor.js';
import { initDiffViewer } from '../src/views/diff-viewer.js';

let destroy;
const press = (key, options = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
const show = (id) => {
  const modal = document.getElementById(id);
  modal.classList.remove('hidden');
  syncModalFocus();
  return modal;
};

beforeEach(() => {
  document.body.innerHTML = '<main><button id="open">Open</button></main><aside inert id="already-inert"></aside>' +
    '<div id="first" class="modal-overlay hidden"><button id="cancel">Cancel</button><input hidden><button disabled>Disabled</button><button id="last">Last</button></div>' +
    '<div id="second" class="modal-overlay hidden"><button id="confirm">Confirm</button></div>';
  document.getElementById('open').focus();
  destroy = initModalFocus();
});
afterEach(() => { destroy(); document.body.innerHTML = ''; });

it('contains keyboard focus, skips hidden/disabled controls, and restores the opener', () => {
  const modal = show('first');
  expect(document.activeElement.id).toBe('cancel');
  expect(document.querySelector('main').hasAttribute('inert')).toBe(true);
  press('Tab', { shiftKey: true });
  expect(document.activeElement.id).toBe('last');
  press('Tab');
  expect(document.activeElement.id).toBe('cancel');
  modal.classList.add('hidden');
  syncModalFocus();
  expect(document.activeElement.id).toBe('open');
  expect(document.querySelector('main').hasAttribute('inert')).toBe(false);
  expect(document.getElementById('already-inert').hasAttribute('inert')).toBe(true);
});

it('keeps only the top sheet interactive and returns to the parent sheet', () => {
  const parent = show('first');
  document.getElementById('last').focus();
  const child = show('second');
  expect(Number(child.style.zIndex)).toBeGreaterThan(Number(parent.style.zIndex));
  expect(parent.hasAttribute('inert')).toBe(true);
  child.classList.add('hidden');
  syncModalFocus();
  expect(parent.hasAttribute('inert')).toBe(false);
  expect(document.activeElement.id).toBe('last');
  parent.classList.add('hidden');
  syncModalFocus();
  expect(document.activeElement.id).toBe('open');
});

it('releases a leaving sheet immediately without moving focus away from the selected action', () => {
  const modal = show('first');
  modal.classList.add('is-leaving');
  syncModalFocus();
  expect(modalOwnsKeyboard()).toBe(false);
  expect(document.activeElement.id).toBe('open');
  const editor = document.createElement('textarea');
  document.querySelector('main').append(editor);
  editor.focus();
  modal.classList.add('hidden');
  syncModalFocus();
  expect(document.activeElement).toBe(editor);
});

it('handles an empty modal and restores focus when multiple layers close at once', () => {
  const parent = show('first');
  const child = document.getElementById('second');
  child.innerHTML = '';
  show('second');
  expect(document.activeElement).toBe(child);
  press('Tab');
  expect(document.activeElement).toBe(child);
  parent.classList.add('hidden');
  child.classList.add('hidden');
  syncModalFocus();
  expect(document.activeElement.id).toBe('open');
});

it('observes dynamically added dialogs and recovers after their removal', async () => {
  const modal = document.createElement('div');
  modal.className = 'te-overlay';
  modal.innerHTML = '<input id="cell">';
  document.body.append(modal);
  await Promise.resolve();
  expect(document.activeElement.id).toBe('cell');
  modal.remove();
  await Promise.resolve();
  expect(document.activeElement.id).toBe('open');
});

it('announces picker selection and clears the active result when the search has no matches', () => {
  const picker = makePicker({ id: 'audit-picker', placeholder: 'Search commands', getItems: () => [{ label: 'Open' }, { label: 'Save' }], onSelect() {} });
  picker.open();
  const input = document.querySelector('#audit-picker input');
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-activedescendant')).textContent).toBe('Open');
  press('ArrowDown');
  expect(document.getElementById(input.getAttribute('aria-activedescendant')).textContent).toBe('Save');
  input.value = 'unmatched';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  press('Escape');
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement.id).toBe('open');
});

it('releases table and diff dialogs before applying changes to the background editor', () => {
  const editor = document.createElement('textarea');
  document.querySelector('main').append(editor);
  editor.focus();
  const apply = (value) => {
    expect(document.querySelector('main').hasAttribute('inert')).toBe(false);
    editor.value = value;
    editor.focus();
  };
  const table = initTableEditor();
  table.open({ model: { rows: [['Name'], ['Ada']], aligns: [null] }, onApply: apply });
  document.querySelector('.te-apply').click();
  expect(document.querySelector('main').hasAttribute('inert')).toBe(false);
  expect(editor.value).toContain('Ada');
  expect(document.activeElement).toBe(editor);
  const diff = initDiffViewer();
  diff.open({ oldContent: 'Before', newContent: 'After', onApply: apply, onClose: () => expect(editor.value).toBe('After') });
  document.querySelector('.diff-apply').click();
  expect(document.querySelector('main').hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(editor);
});
