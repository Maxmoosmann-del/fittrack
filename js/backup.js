// Backup-Export und -Import (rein, ohne DOM).
// Beim Import wird nur übernommen, was plausibel aussieht – eine kaputte Datei
// soll nicht z. B. das Kalorienziel auf 0 setzen.
import { isObj, isDateKey, toNumber, uid } from './util.js';
import { MEALS } from './nutrition.js';
import { pruneHabitLog, MAX_HABITS } from './habits.js';
import { migrate, DEFAULT_GEMINI_MODEL } from './store.js';

export const BACKUP_VERSION = 3;

export function buildBackup(db, now = new Date()) {
  const { goals, foods, log, workouts, exerciseNames, cardio, appSettings, water, habits, habitLog } = db;
  return { v: BACKUP_VERSION, exportedAt: now.toISOString(),
           goals, foods, log, workouts, exerciseNames, cardio, appSettings, water, habits, habitLog };
}

const pos = (v, fallback) => { const n = toNumber(v); return n !== null && n > 0 ? n : fallback; };
const nonNeg = v => { const n = toNumber(v); return n !== null && n >= 0 ? n : 0; };

function cleanDateMap(src, cleanList) {
  const out = {};
  if (!isObj(src)) return out;
  for (const [ds, list] of Object.entries(src)) {
    if (!isDateKey(ds) || !Array.isArray(list)) continue;
    const clean = cleanList(list);
    if (clean.length) out[ds] = clean;
  }
  return out;
}

// Gibt nur die Bereiche zurück, die in der Datei gültig vorhanden waren.
// `current` liefert Fallbacks für einzelne ungültige Zahlen.
export function sanitizeBackup(d, current) {
  if (!isObj(d)) throw new Error('Kein FitTrack-Backup');
  const out = {};

  if (isObj(d.goals)) {
    out.goals = {
      kcal:    Math.round(pos(d.goals.kcal,    current.goals.kcal)),
      protein: Math.round(pos(d.goals.protein, current.goals.protein)),
      carbs:   Math.round(pos(d.goals.carbs,   current.goals.carbs)),
      fat:     Math.round(pos(d.goals.fat,     current.goals.fat))
    };
  }

  const foods = Array.isArray(d.foods)
    ? d.foods.filter(f => isObj(f) && f.id && f.name).map(f => {
        const food = { id: String(f.id), name: String(f.name), kcal: nonNeg(f.kcal),
                       protein: nonNeg(f.protein), carbs: nonNeg(f.carbs), fat: nonNeg(f.fat) };
        if (f.barcode) food.barcode = String(f.barcode);
        return food;
      })
    : null;
  if (foods) out.foods = foods;

  if (isObj(d.log)) {
    const known = new Set((foods || current.foods).map(f => f.id));
    out.log = cleanDateMap(d.log, list => list
      // Neue Backups (v3) tragen die Nährwerte im Eintrag, alte brauchen das Lebensmittel.
      .filter(e => isObj(e) && pos(e.grams, 0) > 0 &&
                   (typeof e.kcal === 'number' || known.has(String(e.foodId))))
      .map(e => {
        const entry = { id: e.id ? String(e.id) : uid(), foodId: String(e.foodId ?? ''),
                        grams: pos(e.grams, 100),
                        meal: MEALS.some(m => m.key === e.meal) ? e.meal : 'snack' };
        if (typeof e.kcal === 'number') {
          Object.assign(entry, { name: String(e.name || '(unbenannt)'), kcal: nonNeg(e.kcal),
            protein: nonNeg(e.protein), carbs: nonNeg(e.carbs), fat: nonNeg(e.fat) });
        }
        return entry;
      }));
  }

  if (isObj(d.workouts)) {
    out.workouts = cleanDateMap(d.workouts, list => list
      .filter(ex => isObj(ex) && ex.exercise)
      .map(ex => ({ id: ex.id ? String(ex.id) : uid(), exercise: String(ex.exercise),
                    sets: (Array.isArray(ex.sets) ? ex.sets : [])
                      .map(s => ({ weight: nonNeg(s?.weight), reps: Math.round(nonNeg(s?.reps)) })) })));
  }

  if (isObj(d.cardio)) {
    out.cardio = cleanDateMap(d.cardio, list => list
      .filter(c => isObj(c) && c.name)
      .map(c => ({ id: String(c.id || uid()), name: String(c.name), intensity: String(c.intensity || 'mittel'),
                   duration: Math.round(nonNeg(c.duration)), kcalBurned: Math.round(nonNeg(c.kcalBurned)) })));
  }

  if (isObj(d.water)) {
    out.water = {};
    for (const [ds, n] of Object.entries(d.water)) {
      const glasses = Math.round(nonNeg(n));
      if (isDateKey(ds) && glasses > 0) out.water[ds] = glasses;
    }
  }

  if (Array.isArray(d.habits)) {
    out.habits = d.habits.filter(h => isObj(h) && h.id && h.name).slice(0, MAX_HABITS)
                         .map(h => ({ id: String(h.id), name: String(h.name) }));
  }
  if (isObj(d.habitLog)) {
    out.habitLog = {};
    for (const [ds, marks] of Object.entries(d.habitLog)) {
      if (!isDateKey(ds) || !isObj(marks)) continue;
      const clean = {};
      for (const [id, v] of Object.entries(marks)) if (v) clean[id] = true;
      if (Object.keys(clean).length) out.habitLog[ds] = clean;
    }
    pruneHabitLog(out.habits || current.habits, out.habitLog);
  }

  if (isObj(d.appSettings)) {
    const a = d.appSettings, c = current.appSettings;
    out.appSettings = {
      bodyWeight:        pos(a.bodyWeight, c.bodyWeight),
      cardioAddToBudget: a.cardioAddToBudget !== false,
      waterGoal:         Math.round(pos(a.waterGoal, c.waterGoal)),
      waterGlassSize:    Math.round(pos(a.waterGlassSize, c.waterGlassSize)),
      geminiModel:       typeof a.geminiModel === 'string' && /^[\w.-]+$/.test(a.geminiModel)
                           ? a.geminiModel : (c.geminiModel || DEFAULT_GEMINI_MODEL)
    };
  }

  if (Array.isArray(d.exerciseNames)) {
    out.exerciseNames = d.exerciseNames.filter(n => typeof n === 'string').slice(0, 40);
  }

  // Alte Einträge (ohne Nährwert-Kopie) über die Lebensmittel der Datei ergänzen.
  migrate({ foods: out.foods || current.foods, log: out.log || {},
            workouts: out.workouts || {}, cardio: out.cardio || {} });
  return out;
}
