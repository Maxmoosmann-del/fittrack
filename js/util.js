// Reine Hilfsfunktionen ohne DOM – laufen auch in Node (Tests).

export function todayStr(d) {
  const x = d || new Date();
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function fromStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isDateKey(k) {
  return /^\d{4}-\d{2}-\d{2}$/.test(k);
}

export function fmtDate(s, now = new Date()) {
  const d = fromStr(s);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Heute';
  if (diff === -1) return 'Gestern';
  if (diff === 1) return 'Morgen';
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function fmtSubDate(s) {
  return fromStr(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Kalenderwoche nach ISO 8601 (Woche mit dem ersten Donnerstag = KW 1)
export function isoWeek(s) {
  const d = fromStr(s);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));       // Donnerstag dieser Woche
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

// "FR 20.11.2026"
export function fmtShortDate(s) {
  const d = fromStr(s);
  const wd = d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '').toUpperCase();
  return `${wd} ${fmtSubDate(s)}`;
}

// Text-Fortschrittsbalken: "████████▒▒▒▒" – über dem Ziel komplett gefüllt
export function asciiBar(value, goal, width = 20) {
  const ratio = goal > 0 ? Math.max(0, value / goal) : 0;
  const filled = Math.min(width, Math.round(ratio * width));
  return '█'.repeat(filled) + '▒'.repeat(width - filled);
}

export function daysBetween(a, b) {
  return Math.round((fromStr(b) - fromStr(a)) / 86400000);
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Number() statt parseInt/parseFloat: "12abc" ist damit ungültig statt still 12.
export function toNumber(val) {
  const s = String(val ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function validatePositiveInt(val) {
  const n = toNumber(val);
  return n !== null && n > 0 ? Math.round(n) : null;
}

export function validateNonNegativeFloat(val) {
  const n = toNumber(val);
  return n !== null && n >= 0 ? n : null;
}

export const round1 = n => Math.round(n * 10) / 10;

export const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
