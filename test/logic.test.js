// Tests für die reine Logik. Ausführen mit:  npm test   (oder: node --test test/)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toNumber, validatePositiveInt, validateNonNegativeFloat, todayStr, fromStr, escapeHtml, daysBetween } from '../js/util.js';
import { calcEntry, dayTotals, per100g, calcCardioKcal, effectiveKcalGoal, nutrientSnapshot } from '../js/nutrition.js';
import { habitStreak, pruneHabitLog, toggleHabit } from '../js/habits.js';
import { parseOffProduct, parseGeminiJson } from '../js/api.js';

test('toNumber: Komma, Leerzeichen, Müll', () => {
  assert.equal(toNumber('12,5'), 12.5);
  assert.equal(toNumber(' 7 '), 7);
  assert.equal(toNumber('12abc'), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(undefined), null);
});

test('Validatoren', () => {
  assert.equal(validatePositiveInt('2,6'), 3);
  assert.equal(validatePositiveInt('0'), null);
  assert.equal(validateNonNegativeFloat('0'), 0);
  assert.equal(validateNonNegativeFloat('-1'), null);
});

test('Datumsfunktionen sind symmetrisch und zählen Tage korrekt (auch über Zeitumstellung)', () => {
  assert.equal(todayStr(fromStr('2026-03-29')), '2026-03-29');
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);   // Sommerzeit-Wechsel dazwischen
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);   // Winterzeit-Wechsel dazwischen
});

test('escapeHtml', () => {
  assert.equal(escapeHtml('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(escapeHtml(null), '');
});

test('calcEntry rechnet aus der gespeicherten Kopie, nicht aus dem Lebensmittel', () => {
  const entry = { grams: 250, ...nutrientSnapshot({ name: 'Skyr', kcal: 63, protein: 11, carbs: 4, fat: 0.2 }) };
  assert.deepEqual(calcEntry(entry), { name: 'Skyr', grams: 250, kcal: 158, protein: 27.5, carbs: 10, fat: 0.5 });
});

test('dayTotals summiert und rundet Makros', () => {
  const e = { grams: 100, name: 'X', kcal: 100, protein: 10.4, carbs: 0, fat: 1 };
  assert.deepEqual(dayTotals([e, e]), { kcal: 200, protein: 21, carbs: 0, fat: 2 });
  assert.deepEqual(dayTotals([]), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
});

test('per100g rechnet Portionswerte zurück', () => {
  assert.deepEqual(per100g({ kcal: 500, protein: 25, carbs: 60, fat: 15 }, 250),
                   { kcal: 200, protein: 10, carbs: 24, fat: 6 });
});

test('Cardio: MET-Formel und Tagesziel', () => {
  assert.equal(calcCardioKcal(7, 60, 80), 560);
  assert.equal(calcCardioKcal(7, 60, 0), 525);                 // Fallback 75 kg
  const entries = [{ kcalBurned: 300 }, { kcalBurned: 100 }];
  assert.deepEqual(effectiveKcalGoal(2000, entries, true), { burned: 400, goal: 2400 });
  assert.deepEqual(effectiveKcalGoal(2000, entries, false), { burned: 400, goal: 2000 });
});

test('habitStreak zählt bis zum angezeigten Tag bzw. Vortag', () => {
  const log = { '2026-11-17': { h: true }, '2026-11-18': { h: true }, '2026-11-19': { h: true } };
  assert.equal(habitStreak(log, 'h', '2026-11-19'), 3);
  assert.equal(habitStreak(log, 'h', '2026-11-20'), 3);        // heute noch offen
  assert.equal(habitStreak(log, 'h', '2026-11-22'), 0);        // Lücke
  assert.equal(habitStreak(log, 'x', '2026-11-19'), 0);
});

test('toggleHabit + pruneHabitLog räumen leere Tage weg', () => {
  const log = {};
  toggleHabit(log, '2026-11-20', 'a');
  toggleHabit(log, '2026-11-20', 'b');
  toggleHabit(log, '2026-11-20', 'a');
  assert.deepEqual(log, { '2026-11-20': { b: true } });
  pruneHabitLog([{ id: 'a' }], log);
  assert.deepEqual(log, {});
});

test('OpenFoodFacts: kJ-Umrechnung und fehlende Werte', () => {
  assert.equal(parseOffProduct({ status: 0 }), null);
  const p = parseOffProduct({ status: 1, product: { product_name: 'Hafer', nutriments: { energy_100g: 1550, proteins_100g: 13.5 } } });
  assert.deepEqual(p, { name: 'Hafer', kcal: 370, protein: 13.5, carbs: 0, fat: 0 });
});

test('parseGeminiJson: Markdown-Zäune, ungültige Zahlen, kein JSON', () => {
  const r = parseGeminiJson('```json\n{"name":"Pasta","kcal":"650","protein":-3,"carbs":80,"fat":20,"grams":400}\n```');
  assert.deepEqual(r, { name: 'Pasta', kcal: 650, protein: 0, carbs: 80, fat: 20, grams: 400 });
  assert.throws(() => parseGeminiJson('Sorry, kein Essen erkannt'), /Keine Nährwerte/);
});
