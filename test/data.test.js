// Tests für Datenhaltung, Migration und Backup.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { db, load, save, migrate, removeById, useStorage, onSaveError, KEYS, SCHEMA_VERSION, defaults } from '../js/store.js';
import { buildBackup, sanitizeBackup } from '../js/backup.js';

// Minimaler localStorage-Ersatz für Node
class MemoryStorage {
  constructor(init = {}) { this.m = new Map(Object.entries(init)); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

let storage;
beforeEach(() => { storage = new MemoryStorage(); useStorage(storage); });

const OLD_FOODS = [{ id: 'f1', name: 'Reis', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }];
const OLD_LOG = { '2026-11-01': [
  { foodId: 'f1', grams: 200, meal: 'lunch' },
  { foodId: 'weg', grams: 50, meal: 'snack' }          // Lebensmittel schon gelöscht
] };

test('Migration v1 → v2: Nährwert-Kopie + IDs, bestehende Werte bleiben', () => {
  storage.setItem(KEYS.foods, JSON.stringify(OLD_FOODS));
  storage.setItem(KEYS.log, JSON.stringify(OLD_LOG));
  storage.setItem(KEYS.workouts, JSON.stringify({ '2026-11-01': [{ exercise: 'Bankdrücken', sets: [{ weight: 80, reps: 8 }] }] }));
  load();

  const [rice, gone] = db.log['2026-11-01'];
  assert.equal(rice.name, 'Reis');
  assert.equal(rice.kcal, 130);
  assert.ok(rice.id);
  assert.equal(gone.name, '(gelöscht)');
  assert.ok(db.workouts['2026-11-01'][0].id);
  assert.deepEqual(db.workouts['2026-11-01'][0].sets, [{ weight: 80, reps: 8 }]);   // Übungen unverändert
  assert.equal(storage.getItem(KEYS.schema), String(SCHEMA_VERSION));
  // und gespeichert:
  assert.equal(JSON.parse(storage.getItem(KEYS.log))['2026-11-01'][0].name, 'Reis');
});

test('Migration ist idempotent', () => {
  const data = { foods: OLD_FOODS, log: structuredClone(OLD_LOG), workouts: {}, cardio: {} };
  migrate(data);
  const once = structuredClone(data.log);
  migrate(data);
  assert.deepEqual(data.log, once);
});

test('Lebensmittel ändern/löschen verfälscht alte Tage nicht mehr', () => {
  storage.setItem(KEYS.foods, JSON.stringify(OLD_FOODS));
  storage.setItem(KEYS.log, JSON.stringify(OLD_LOG));
  load();
  db.foods[0].kcal = 999;
  db.foods.splice(0, 1);
  assert.equal(db.log['2026-11-01'][0].kcal, 130);
});

test('load(): kaputter Bereich reißt die anderen nicht mit', () => {
  storage.setItem(KEYS.schema, String(SCHEMA_VERSION));
  storage.setItem(KEYS.log, '{kaputt');
  storage.setItem(KEYS.water, JSON.stringify({ '2026-11-20': 3 }));
  storage.setItem(KEYS.goals, JSON.stringify({ kcal: 1800 }));
  load();
  assert.deepEqual(db.log, {});
  assert.equal(db.water['2026-11-20'], 3);
  assert.equal(db.goals.kcal, 1800);
  assert.equal(db.goals.protein, 150);             // Default ergänzt
});

test('save() meldet volle Speicher statt zu werfen', () => {
  let reported = null;
  useStorage({ setItem() { throw new Error('QuotaExceeded'); }, getItem: () => null, removeItem() {} });
  onSaveError(err => { reported = err; });
  assert.equal(save('log'), false);
  assert.match(reported.message, /Quota/);
});

test('removeById + undo stellt an der alten Stelle wieder her, auch nach weiterem Löschen', () => {
  const map = { d: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  const ra = removeById(map, 'd', 'a');
  const rc = removeById(map, 'd', 'c');
  ra.undo();
  assert.deepEqual(map.d.map(x => x.id), ['a', 'b']);
  rc.undo();
  assert.deepEqual(map.d.map(x => x.id), ['a', 'b', 'c']);
  ra.undo();                                        // doppeltes Undo fügt nichts doppelt ein
  assert.equal(map.d.length, 3);
  assert.equal(removeById(map, 'd', 'gibtsnicht'), null);
});

test('removeById löscht leere Tage', () => {
  const map = { d: [{ id: 'a' }] };
  removeById(map, 'd', 'a');
  assert.equal('d' in map, false);
});

test('Backup: Export → Import ergibt dieselben Daten', () => {
  const current = defaults();
  const data = {
    ...current,
    foods: [{ id: 'f1', name: 'Reis', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, barcode: '400' }],
    log: { '2026-11-01': [{ id: 'e1', foodId: 'f1', name: 'Reis', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, grams: 200, meal: 'lunch' }] },
    workouts: { '2026-11-01': [{ id: 'w1', exercise: 'Kniebeuge', sets: [{ weight: 100, reps: 5 }] }] },
    habits: [{ id: 'h1', name: 'Kreatin' }],
    habitLog: { '2026-11-01': { h1: true } }
  };
  const json = JSON.parse(JSON.stringify(buildBackup(data)));
  const back = sanitizeBackup(json, current);
  for (const k of ['foods', 'log', 'workouts', 'habits', 'habitLog', 'goals']) assert.deepEqual(back[k], data[k], k);
});

test('Backup v2 (alt, ohne Nährwert-Kopie) wird beim Import ergänzt', () => {
  const back = sanitizeBackup({ v: 2, foods: OLD_FOODS, log: OLD_LOG }, defaults());
  const entries = back.log['2026-11-01'];
  assert.equal(entries.length, 1);                 // Eintrag ohne bekanntes Lebensmittel fällt raus
  assert.equal(entries[0].name, 'Reis');
  assert.equal(entries[0].kcal, 130);
});

test('Backup-Import lehnt Unsinn ab bzw. setzt sichere Werte', () => {
  assert.throws(() => sanitizeBackup([], defaults()));
  const back = sanitizeBackup({
    goals: { kcal: 0, protein: 'abc', carbs: 200, fat: 60 },
    log: { 'kein-datum': [], '2026-11-01': [{ foodId: 'x', grams: -5, kcal: 1 }] },
    habits: [{ id: '"><img src=x onerror=alert(1)>', name: 'X' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }, { id: 4, name: 'D' }],
    appSettings: { geminiModel: '../../evil' }
  }, defaults());
  assert.equal(back.goals.kcal, 2200);
  assert.equal(back.goals.protein, 150);
  assert.deepEqual(back.log, {});
  assert.equal(back.habits.length, 3);
  assert.equal(back.appSettings.geminiModel, 'gemini-flash-latest');
});


// ---------- Fälle aus dem Code-Review ----------

test('Review 1: Speicher voll beim Start → load() wirft nicht, Anzeige ohne NaN', () => {
  const full = new MemoryStorage({ [KEYS.foods]: JSON.stringify(OLD_FOODS), [KEYS.log]: JSON.stringify(OLD_LOG) });
  full.setItem = () => { throw new Error('QuotaExceeded'); };
  useStorage(full);
  onSaveError(() => {});
  assert.doesNotThrow(() => load());
  assert.equal(db.log['2026-11-01'][0].kcal, 130);          // im Speicher migriert
  assert.equal(full.getItem(KEYS.schema), null);             // Version NICHT gesetzt
});

test('Review 2: unlesbare Lebensmittel → Einträge werden nicht als gelöscht gestempelt', () => {
  storage.setItem(KEYS.foods, '{kaputt');
  storage.setItem(KEYS.log, JSON.stringify(OLD_LOG));
  load();
  const e = db.log['2026-11-01'][0];
  assert.notEqual(e.name, '(gelöscht)');
  assert.equal(typeof e.kcal, 'undefined');
  assert.equal(storage.getItem(KEYS.foods), '{kaputt');      // nicht mit [] überschrieben
  // Sobald die Lebensmittel wieder lesbar sind, holt der nächste Start die Werte nach:
  storage.setItem(KEYS.foods, JSON.stringify(OLD_FOODS));
  load();
  assert.equal(db.log['2026-11-01'][0].kcal, 130);
});

test('Review 2: Rohdaten werden vor der ersten Migration gesichert', () => {
  storage.setItem(KEYS.foods, JSON.stringify(OLD_FOODS));
  storage.setItem(KEYS.log, JSON.stringify(OLD_LOG));
  load();
  const backup = JSON.parse(storage.getItem(KEYS.preMigration));
  assert.equal(backup.raw[KEYS.log], JSON.stringify(OLD_LOG));
});

test('Review 3: alte Einträge nach gesetzter Version werden trotzdem migriert', () => {
  storage.setItem(KEYS.schema, String(SCHEMA_VERSION));
  storage.setItem(KEYS.foods, JSON.stringify(OLD_FOODS));
  storage.setItem(KEYS.log, JSON.stringify(OLD_LOG));
  load();
  assert.ok(db.log['2026-11-01'][0].id);
  assert.equal(db.log['2026-11-01'][0].kcal, 130);
});
