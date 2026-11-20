// DOM-Helfer: Selektoren, Element-Bau, Toast, Modals, Balken.
import { asciiBar } from '../util.js';

export const $ = sel => document.querySelector(sel);
export const $$ = sel => document.querySelectorAll(sel);

// Kleiner Element-Baukasten statt dutzender createElement/appendChild-Zeilen.
// Text wird immer als textContent gesetzt – kein HTML aus Nutzerdaten.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;          // nur für feste Icons
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

export const ICONS = {
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
  chevron: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
};

// ---------- Toast (optional mit Rückgängig) ----------
let toastTimer;
export function toast(msg, actionFn, { label = 'Rückgängig', duration } = {}) {
  const t = $('#toast');
  t.replaceChildren(el('span', { text: msg }));
  if (actionFn) {
    t.append(el('button', { class: 'undo-btn', type: 'button', text: label, onclick: () => {
      actionFn();
      t.classList.remove('show');
      clearTimeout(toastTimer);
    } }));
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration ?? (actionFn ? 4000 : 1800));
}

export function showFieldError(input, msg) {
  input.classList.add('error');
  input.setAttribute('aria-invalid', 'true');
  input.focus();
  toast(msg);
  input.addEventListener('input', () => {
    input.classList.remove('error');
    input.removeAttribute('aria-invalid');
  }, { once: true });
}

// ---------- Modals: Escape, Fokusfalle, Fokus zurückgeben ----------
const openStack = [];          // [{id, returnFocus}]
const closeHooks = {};         // id -> fn (z. B. Kamera stoppen)

export function onModalClose(id, fn) { closeHooks[id] = fn; }

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])';
const visibleFocusables = m => [...m.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);

export function openModal(id, focusSel) {
  const m = document.getElementById(id);
  if (!openStack.some(x => x.id === id)) openStack.push({ id, returnFocus: document.activeElement });
  m.classList.add('show');
  setTimeout(() => {
    const target = (focusSel && m.querySelector(focusSel)) || visibleFocusables(m)[0];
    target?.focus();
    if (target?.select && focusSel) target.select();
  }, 50);
}

export function closeModal(id) {
  const m = document.getElementById(id);
  if (!m.classList.contains('show')) return;
  closeHooks[id]?.();
  m.classList.remove('show');
  const i = openStack.findIndex(x => x.id === id);
  if (i >= 0) {
    const [entry] = openStack.splice(i, 1);
    if (entry.returnFocus?.isConnected) entry.returnFocus.focus();
  }
}

export const isModalOpen = id => document.getElementById(id).classList.contains('show');

export function initModals() {
  $$('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) closeModal(o.id); }));
  document.addEventListener('keydown', e => {
    const top = openStack[openStack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(top.id); return; }
    if (e.key !== 'Tab') return;
    const items = visibleFocusables(document.getElementById(top.id));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

// ASCII-Balken + ARIA-Werte. Breite in Zeichen kommt aus data-width.
export function setBar(barId, value, goal, { percent = false } = {}) {
  const bar = document.getElementById(barId);
  const width = Number(bar.dataset.width) || 20;
  const pct = goal > 0 ? Math.round(value / goal * 100) : 0;
  bar.textContent = asciiBar(value, goal, width) + (percent ? ` ${pct}%` : '');
  bar.classList.toggle('over', goal > 0 && value > goal);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(goal));
  bar.setAttribute('aria-valuenow', String(Math.round(value)));
}
