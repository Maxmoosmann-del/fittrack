// Datenhaltung: ein zentrales `db`-Objekt statt vieler globaler Variablen,
// gespeichert in localStorage (pro Bereich ein Key), plus Schema-Migration.
import { todayStr, uid } from './util.js';

export const KEYS = {
  goals: 'ft_goals',
  foods: 'ft_foods',
  log: 'ft_log',
  workouts: 'ft_workouts',
  exercises: 'ft_exercises',
  state: 'ft_state',
  cardio: 'ft_cardio',
  appSettings: 'ft_appsettings',
  water: 'ft_water',
  habits: 'ft_habits',
  habitLog: 'ft_habitlog',
  // Nicht Teil des Backups, aber Teil von "Alle Daten löschen":
  geminiKey: 'ft_gemini_key',
  seeded: 'ft_seeded',
  schema: 'ft_schema',
  lastBackup: 'ft_lastbackup',
  preMigration: 'ft_premigration_v1'   // Rohdaten vor der ersten Migration (Notfall-Sicherung)
};

// v1: Tageseinträge nur mit foodId, Positionen statt IDs.
// v2: Einträge tragen eigene ID + Nährwert-Kopie; Übungen tragen eine ID.
export const SCHEMA_VERSION = 2;

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export function defaults() {
  return {
    state: { date: todayStr(), tab: 'today' },
    goals: { kcal: 2200, protein: 150, carbs: 250, fat: 70 },
    foods: [],          // {id,name,kcal,protein,carbs,fat,barcode?}  – Werte pro 100 g
    log: {},            // {dateStr: [{id,foodId,name,kcal,protein,carbs,fat,grams,meal}]}
    workouts: {},       // {dateStr: [{id,exercise,sets:[{weight,reps}]}]}
    exerciseNames: [],  // Autovervollständigung
    cardio: {},         // {dateStr: [{id,name,intensity,duration,kcalBurned}]}
    appSettings: { bodyWeight: 75, cardioAddToBudget: true, waterGoal: 8, waterGlassSize: 250,
                   geminiModel: DEFAULT_GEMINI_MODEL },
    water: {},          // {dateStr: Gläser}
    habits: [],         // [{id,name}]
    habitLog: {}        // {dateStr: {habitId: true}}
  };
}

export const db = defaults();

// db-Feld -> localStorage-Key
const FIELDS = {
  goals: KEYS.goals, foods: KEYS.foods, log: KEYS.log, workouts: KEYS.workouts,
  exerciseNames: KEYS.exercises, state: KEYS.state, cardio: KEYS.cardio,
  appSettings: KEYS.appSettings, water: KEYS.water, habits: KEYS.habits, habitLog: KEYS.habitLog
};

let storage = globalThis.localStorage;
let onError = err => console.error('Speichern fehlgeschlagen', err);

export function useStorage(s) { storage = s; }
export function onSaveError(fn) { onError = fn; }
export function getStorage() { return storage; }

// save() schreibt alles, save('log','state') nur die genannten Bereiche.
export function save(...fields) {
  const list = fields.length ? fields : Object.keys(FIELDS);
  try {
    for (const f of list) storage.setItem(FIELDS[f], JSON.stringify(db[f]));
    return true;
  } catch (err) {
    onError(err);
    return false;
  }
}

// Jeden Bereich einzeln lesen: ein kaputter Eintrag darf nicht alle anderen mitreißen.
// `broken` sammelt Keys, die zwar existieren, aber nicht lesbar waren.
function read(key, broken) {
  let raw;
  try { raw = storage.getItem(key); } catch { return null; }
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('Konnte ' + key + ' nicht lesen', err);
    broken?.add(key);
    return null;
  }
}

const MIGRATED_FIELDS = ['log', 'workouts', 'cardio'];

export function load() {
  const isPlainObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const d = defaults();
  const broken = new Set();
  for (const [field, key] of Object.entries(FIELDS)) {
    const v = read(key, broken);
    if (v === null) continue;
    if (Array.isArray(d[field])) { if (Array.isArray(v)) d[field] = v; }
    else if (isPlainObj(v)) {
      // goals/appSettings/state: Defaults ergänzen fehlende Felder
      d[field] = ['goals', 'appSettings', 'state'].includes(field) ? { ...d[field], ...v } : v;
    }
  }
  d.state.date = todayStr();
  Object.assign(db, d);

  // Bei JEDEM Start migrieren (idempotent, billig): fängt auch alte Einträge ab,
  // die z. B. ein noch offener Tab mit der alten App-Version geschrieben hat.
  // Sind die Lebensmittel unlesbar, werden alte Einträge nicht als "gelöscht"
  // gestempelt, sondern unverändert gelassen – sonst wäre das endgültig.
  const before = JSON.stringify(MIGRATED_FIELDS.map(f => db[f]));
  migrate(db, { foodsReliable: !broken.has(KEYS.foods) });
  if (JSON.stringify(MIGRATED_FIELDS.map(f => db[f])) !== before) {
    backupBeforeMigration();
    // Nur die migrierten Bereiche schreiben – nie unlesbare Bereiche mit Defaults überschreiben.
    save(...MIGRATED_FIELDS.filter(f => !broken.has(FIELDS[f])));
  }
  try { storage.setItem(KEYS.schema, String(SCHEMA_VERSION)); } catch { /* Info, nicht kritisch */ }
  return db;
}

// Rohdaten einmalig sichern, bevor die Migration sie umschreibt.
function backupBeforeMigration() {
  try {
    if (storage.getItem(KEYS.preMigration) !== null) return;
    const raw = {};
    for (const k of [KEYS.foods, KEYS.log, KEYS.workouts, KEYS.cardio]) raw[k] = storage.getItem(k);
    storage.setItem(KEYS.preMigration, JSON.stringify({ at: new Date().toISOString(), raw }));
  } catch { /* Speicher voll: Migration läuft trotzdem im Speicher */ }
}

// Bringt Daten auf den aktuellen Stand. Idempotent – darf mehrfach laufen.
export function migrate(data, { foodsReliable = true } = {}) {
  const foodIndex = new Map((data.foods || []).map(f => [f.id, f]));
  for (const ds of Object.keys(data.log || {})) {
    if (!Array.isArray(data.log[ds])) continue;
    data.log[ds] = data.log[ds].map(e => {
      const out = { ...e, id: e.id || uid() };
      if (typeof e.kcal !== 'number') {
        const f = foodIndex.get(e.foodId);
        if (f) Object.assign(out, { name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat });
        // Lebensmittel wirklich gelöscht: Werte sind verloren – ehrlich anzeigen.
        else if (foodsReliable) Object.assign(out, { name: '(gelöscht)', kcal: 0, protein: 0, carbs: 0, fat: 0 });
      }
      return out;
    });
  }
  for (const map of [data.workouts, data.cardio]) {
    for (const ds of Object.keys(map || {})) {
      if (Array.isArray(map[ds])) map[ds] = map[ds].map(x => (x.id ? x : { ...x, id: uid() }));
    }
  }
  return data;
}

export function clearAll() {
  Object.values(KEYS).forEach(k => storage.removeItem(k));
}

// ---------- Listen-Helfer mit IDs statt Positionen ----------

// Entfernt ein Element per ID und gibt eine Undo-Funktion zurück.
export function removeById(map, dateKey, id) {
  const list = map[dateKey];
  if (!list) return null;
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return null;
  // Nachbarn merken statt nur der Position: wird zwischendurch etwas anderes
  // gelöscht oder wiederhergestellt, landet der Eintrag trotzdem an der richtigen Stelle.
  const prevId = list[idx - 1]?.id;
  const nextId = list[idx + 1]?.id;
  const [removed] = list.splice(idx, 1);
  if (list.length === 0) delete map[dateKey];
  return {
    removed,
    undo() {
      if (!map[dateKey]) map[dateKey] = [];
      const l = map[dateKey];
      if (l.some(x => x.id === removed.id)) return;   // schon wieder da
      const next = l.findIndex(x => x.id === nextId);
      const prev = l.findIndex(x => x.id === prevId);
      const at = next >= 0 ? next : prev >= 0 ? prev + 1 : Math.min(idx, l.length);
      l.splice(at, 0, removed);
    }
  };
}

export function findById(map, dateKey, id) {
  return map[dateKey]?.find(x => x.id === id) || null;
}
