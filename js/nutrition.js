// Nährwert- und Cardio-Berechnungen (rein, ohne DOM).
import { round1 } from './util.js';

export const MEALS = [
  { key: 'breakfast', label: 'Frühstück' },
  { key: 'lunch',     label: 'Mittagessen' },
  { key: 'dinner',    label: 'Abendessen' },
  { key: 'snack',     label: 'Snacks' }
];

export const MACROS = ['kcal', 'protein', 'carbs', 'fat'];

// Nährwerte (pro 100 g) aus einem Lebensmittel herauskopieren.
// Ein Tageseintrag speichert diese Kopie, damit spätere Änderungen oder das
// Löschen des Lebensmittels vergangene Tage nicht mehr verfälschen.
export function nutrientSnapshot(food) {
  const n = v => (Number.isFinite(v) ? v : 0);
  return {
    name: String(food.name ?? '(unbekannt)'),
    kcal: n(food.kcal), protein: n(food.protein), carbs: n(food.carbs), fat: n(food.fat)
  };
}

// Werte eines Tageseintrags für seine Grammzahl.
// Fehlende Werte (z. B. noch nicht migrierbarer Eintrag) zählen als 0 statt NaN.
export function calcEntry(entry) {
  const n = v => (Number.isFinite(v) ? v : 0);
  const grams = n(entry.grams);
  const r = grams / 100;
  return {
    name: entry.name || '(unbekannt)',
    grams,
    kcal: Math.round(n(entry.kcal) * r),
    protein: round1(n(entry.protein) * r),
    carbs: round1(n(entry.carbs) * r),
    fat: round1(n(entry.fat) * r)
  };
}

export function dayTotals(entries) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries) {
    const c = calcEntry(e);
    t.kcal += c.kcal; t.protein += c.protein; t.carbs += c.carbs; t.fat += c.fat;
  }
  return { kcal: t.kcal, protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
}

// Gesamtwerte einer Portion (z. B. aus dem KI-Scan) auf 100 g umrechnen.
export function per100g(totals, grams) {
  const r = 100 / grams;
  return {
    kcal: Math.round(totals.kcal * r),
    protein: round1(totals.protein * r),
    carbs: round1(totals.carbs * r),
    fat: round1(totals.fat * r)
  };
}

export const PRESET_CARDIO = [
  { name: 'Spaziergang',          intensity: 'niedrig',   met: 3.5 },
  { name: 'Wandern',              intensity: 'niedrig',   met: 4.5 },
  { name: 'Radfahren (gemäßigt)', intensity: 'mittel',    met: 6 },
  { name: 'Schwimmen',            intensity: 'mittel',    met: 7 },
  { name: 'Joggen (moderat)',     intensity: 'mittel',    met: 7.5 },
  { name: 'Rudern (Ergometer)',   intensity: 'mittel',    met: 7 },
  { name: 'Radfahren (intensiv)', intensity: 'hoch',      met: 10 },
  { name: 'Laufen (schnell)',     intensity: 'hoch',      met: 11 },
  { name: 'Seilspringen',         intensity: 'hoch',      met: 11 },
  { name: 'HIIT',                 intensity: 'sehr hoch', met: 12 },
  { name: 'Spinning',             intensity: 'sehr hoch', met: 13 },
  { name: 'Yoga / Stretching',    intensity: 'niedrig',   met: 2.5 }
];
export const CUSTOM_CARDIO_MET = 7;

export function calcCardioKcal(met, durationMin, bodyWeight) {
  const kg = bodyWeight > 0 ? bodyWeight : 75;
  return Math.round(met * kg * durationMin / 60);
}

// Tagesziel inkl. Cardio-Bonus (wenn in den Einstellungen aktiviert).
export function effectiveKcalGoal(goal, cardioEntries, addToBudget) {
  const burned = cardioEntries.reduce((s, e) => s + (e.kcalBurned || 0), 0);
  return { burned, goal: addToBudget && burned > 0 ? goal + burned : goal };
}
