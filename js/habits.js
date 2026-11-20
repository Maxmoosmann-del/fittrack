// Gewohnheiten: Streak-Berechnung und Aufräumen (rein, ohne DOM).
import { fromStr, todayStr } from './util.js';

export const MAX_HABITS = 3;

// Streak relativ zum ANGEZEIGTEN Tag, nicht zum echten Heute.
// Ist der angezeigte Tag noch nicht abgehakt, zählt der Streak bis zum Vortag.
export function habitStreak(habitLog, habitId, dateStr) {
  const d = fromStr(dateStr);
  if (!habitLog[dateStr]?.[habitId]) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (habitLog[todayStr(d)]?.[habitId]) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// Abhak-Historie von nicht mehr existierenden Gewohnheiten entfernen (in place).
export function pruneHabitLog(habits, habitLog) {
  const keep = new Set(habits.map(h => h.id));
  for (const ds of Object.keys(habitLog)) {
    for (const id of Object.keys(habitLog[ds])) if (!keep.has(id)) delete habitLog[ds][id];
    if (Object.keys(habitLog[ds]).length === 0) delete habitLog[ds];
  }
  return habitLog;
}

export function toggleHabit(habitLog, dateStr, habitId) {
  if (!habitLog[dateStr]) habitLog[dateStr] = {};
  if (habitLog[dateStr][habitId]) {
    delete habitLog[dateStr][habitId];
    if (Object.keys(habitLog[dateStr]).length === 0) delete habitLog[dateStr];
  } else {
    habitLog[dateStr][habitId] = true;
  }
}
