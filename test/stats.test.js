// Tests für Verlauf, Streaks und "Zuletzt gegessen".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastDays, dailySeries, seriesSummary, sparkChars, weekdayInitial, habitStats,
         recentFoods, relativeDay, yesterdayOf } from '../js/stats.js';

const e = (name, kcal, protein, grams = 100, extra = {}) =>
  ({ id: name + grams, foodId: 'f-' + name, name, kcal, protein, carbs: 0, fat: 0, grams, meal: 'lunch', ...extra });

test('lastDays über Monatsgrenze', () => {
  assert.deepEqual(lastDays('2026-12-02', 3), ['2026-11-30', '2026-12-01', '2026-12-02']);
});

test('dailySeries + Zusammenfassung ohne laufenden Tag und ohne leere Tage', () => {
  const log = {
    '2026-11-18': [e('A', 2000, 100)],
    '2026-11-19': [e('A', 1000, 50, 200)],     // 2000 kcal, 100 g
    '2026-11-20': [e('A', 500, 10)]            // heute, unvollständig
  };
  const s = dailySeries(log, '2026-11-20', 4);
  assert.deepEqual(s.map(d => [d.kcal, d.hasData]), [[0, false], [2000, true], [2000, true], [500, true]]);
  assert.deepEqual(seriesSummary(s, 100, '2026-11-20'), { days: 2, kcal: 2000, protein: 100, proteinHits: 2 });
  assert.deepEqual(seriesSummary(dailySeries({}, '2026-11-20', 7), 100, '2026-11-20'),
                   { days: 0, kcal: null, protein: null, proteinHits: 0 });
});

test('sparkChars skaliert auf Maximum aus Werten und Ziel', () => {
  assert.equal(sparkChars([0, 1000, 2000, null], 2000).join(''), '▁▅█·');
  assert.equal(sparkChars([3000, 1500], 2000).join(''), '█▅');
  assert.equal(sparkChars([null, null], 0).join(''), '··');
});

test('weekdayInitial', () => {
  assert.equal(weekdayInitial('2026-11-20'), 'F');   // Freitag
  assert.equal(weekdayInitial('2026-11-22'), 'S');   // Sonntag
});

test('habitStats: Streak in Folge vs. bis gestern, Rekord, Kästchen', () => {
  const log = {};
  for (const d of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05',   // 5er-Rekord
                   '2026-11-17', '2026-11-18', '2026-11-19']) log[d] = { h: true };
  const yesterday = habitStats(log, 'h', '2026-11-20', 14);
  assert.equal(yesterday.streak, 3);
  assert.equal(yesterday.doneToday, false);
  assert.equal(yesterday.best, 5);
  assert.equal(yesterday.strip.length, 14);
  assert.equal(yesterday.doneCount, 3);
  assert.equal(yesterday.strip.at(-1).date, '2026-11-20');

  log['2026-11-20'] = { h: true };
  const today = habitStats(log, 'h', '2026-11-20', 14);
  assert.equal(today.streak, 4);
  assert.equal(today.doneToday, true);
  assert.equal(habitStats(log, 'x', '2026-11-20').streak, 0);
  assert.equal(habitStats(log, 'x', '2026-11-20').best, 0);
});

test('Rekord zählt auch über Monats-/Jahresgrenzen', () => {
  const log = { '2026-12-30': { h: true }, '2026-12-31': { h: true }, '2027-01-01': { h: true } };
  assert.equal(habitStats(log, 'h', '2027-01-01').best, 3);
});

test('recentFoods: neueste zuerst, je Lebensmittel einmal, nicht aus der Zukunft', () => {
  const log = {
    '2026-11-18': [e('Skyr', 63, 11, 250), e('Banane', 89, 1, 120)],
    '2026-11-19': [e('Skyr', 63, 11, 300), e('Hafer', 370, 13, 60)],
    '2026-11-21': [e('Zukunft', 1, 1)],
    '2026-11-20': [{ foodId: 'alt', grams: 5, meal: 'snack' }]   // ohne Nährwert-Kopie → ignorieren
  };
  const r = recentFoods(log, '2026-11-20', 10);
  assert.deepEqual(r.map(x => `${x.name}:${x.grams}:${x.date}`),
                   ['Hafer:60:2026-11-19', 'Skyr:300:2026-11-19', 'Banane:120:2026-11-18']);
  assert.equal(recentFoods(log, '2026-11-20', 1).length, 1);
});

test('relativeDay + yesterdayOf', () => {
  assert.equal(relativeDay('2026-11-20', '2026-11-20'), 'heute');
  assert.equal(relativeDay('2026-11-19', '2026-11-20'), 'gestern');
  assert.equal(relativeDay('2026-11-15', '2026-11-20'), 'vor 5 Tagen');
  assert.equal(yesterdayOf('2026-03-01'), '2026-02-28');
});
