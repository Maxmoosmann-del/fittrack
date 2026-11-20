// Auswertungen für Verlauf, Streaks und "Zuletzt gegessen" (rein, ohne DOM).
import { fromStr, todayStr, daysBetween } from './util.js';
import { dayTotals } from './nutrition.js';

const shift = (dateStr, delta) => { const d = fromStr(dateStr); d.setDate(d.getDate() + delta); return todayStr(d); };

// Datumsliste der letzten `days` Tage bis einschließlich `endDate`
export function lastDays(endDate, days) {
  return Array.from({ length: days }, (_, i) => shift(endDate, i - days + 1));
}

// Tageswerte für den Verlauf. hasData = an dem Tag wurde überhaupt etwas eingetragen.
export function dailySeries(log, endDate, days) {
  return lastDays(endDate, days).map(date => {
    const entries = log[date] || [];
    const t = dayTotals(entries);
    return { date, kcal: t.kcal, protein: t.protein, hasData: entries.length > 0 };
  });
}

// Schnitt nur über abgeschlossene Tage mit Einträgen – der laufende Tag würde ihn drücken.
export function seriesSummary(series, proteinGoal, today) {
  const done = series.filter(d => d.hasData && d.date !== today);
  const avg = k => (done.length ? Math.round(done.reduce((s, d) => s + d[k], 0) / done.length) : null);
  return { days: done.length, kcal: avg('kcal'), protein: avg('protein'),
           proteinHits: done.filter(d => d.protein >= proteinGoal).length };
}

const BLOCKS = '▁▂▃▄▅▆▇█';
// Ein Zeichen pro Wert; null/0 ohne Daten = "·". Skala: Maximum aus Werten und Ziel.
export function sparkChars(values, goal) {
  const max = Math.max(goal || 0, ...values.filter(v => v != null));
  return values.map(v => (v == null || !(max > 0) ? '·'
    : BLOCKS[Math.min(7, Math.max(0, Math.round(v / max * 7)))]));
}

const WD = ['S', 'M', 'D', 'M', 'D', 'F', 'S'];   // So, Mo, Di, Mi, Do, Fr, Sa
export const weekdayInitial = dateStr => WD[fromStr(dateStr).getDay()];

// ---------- Gewohnheiten ----------
export function habitStats(habitLog, habitId, endDate, days = 14) {
  const done = d => !!habitLog[d]?.[habitId];
  const doneToday = done(endDate);
  let streak = 0;
  for (let d = doneToday ? endDate : shift(endDate, -1); done(d); d = shift(d, -1)) streak++;

  // Rekord über die gesamte Historie
  const dates = Object.keys(habitLog).filter(done).sort();
  let best = 0, run = 0, prev = null;
  for (const d of dates) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const strip = lastDays(endDate, days).map(d => ({ date: d, done: done(d) }));
  return { streak, doneToday, best, strip, doneCount: strip.filter(s => s.done).length };
}

// ---------- Zuletzt gegessen ----------
// Neueste zuerst, je Lebensmittel nur einmal, mit Menge und Datum vom letzten Mal.
export function recentFoods(log, uptoDate, limit = 10) {
  const out = [], seen = new Set();
  const dates = Object.keys(log).filter(d => d <= uptoDate).sort().reverse();
  for (const date of dates) {
    for (const e of [...log[date]].reverse()) {
      const key = e.foodId || e.name;
      if (!key || seen.has(key) || typeof e.kcal !== 'number') continue;
      seen.add(key);
      out.push({ key, foodId: e.foodId, name: e.name, kcal: e.kcal, protein: e.protein,
                 carbs: e.carbs, fat: e.fat, grams: e.grams, date });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function relativeDay(date, today) {
  const n = daysBetween(date, today);
  return n <= 0 ? 'heute' : n === 1 ? 'gestern' : `vor ${n} Tagen`;
}

export const yesterdayOf = date => shift(date, -1);
