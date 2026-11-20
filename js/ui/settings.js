// Einstellungen, Backup (Export/Import) und "Alle Daten löschen".
import { db, save, KEYS, getStorage, clearAll, DEFAULT_GEMINI_MODEL } from '../store.js';
import { uid, todayStr, toNumber, validatePositiveInt, daysBetween } from '../util.js';
import { pruneHabitLog, MAX_HABITS } from '../habits.js';
import { buildBackup, sanitizeBackup } from '../backup.js';
import { $, toast, showFieldError, openModal, closeModal } from './dom.js';
import { render } from './render.js';
import { currentVersion, onCheckUpdateClick } from './update.js';

const habitInput = i => $('#habitInput' + (i + 1));

export function getGeminiKey() { return getStorage().getItem(KEYS.geminiKey) || ''; }
export function getGeminiModel() { return db.appSettings.geminiModel || DEFAULT_GEMINI_MODEL; }

export function lastBackupDate() { return getStorage().getItem(KEYS.lastBackup); }

function renderLastBackup() {
  const last = lastBackupDate();
  const days = last ? daysBetween(last, todayStr()) : null;
  $('#lastBackupInfo').textContent = last === null
    ? 'Noch kein Backup erstellt. Deine Daten liegen nur auf diesem Gerät.'
    : `Letztes Backup: ${days === 0 ? 'heute' : days === 1 ? 'gestern' : `vor ${days} Tagen`}`;
}

export function openSettings() {
  const { goals, appSettings } = db;
  $('#goalKcal').value = goals.kcal;
  $('#goalProtein').value = goals.protein;
  $('#goalCarbs').value = goals.carbs;
  $('#goalFat').value = goals.fat;
  $('#bodyWeight').value = appSettings.bodyWeight || 75;
  $('#cardioAddToBudget').checked = appSettings.cardioAddToBudget;
  $('#geminiKey').value = getGeminiKey();
  $('#geminiModel').value = getGeminiModel();
  $('#waterGoalInput').value = appSettings.waterGoal || 8;
  $('#waterGlassSizeInput').value = appSettings.waterGlassSize || 250;
  // Habit-Felder füllen und die ID am Feld merken (nicht über die Position)
  for (let i = 0; i < MAX_HABITS; i++) {
    const h = db.habits[i];
    habitInput(i).value = h ? h.name : '';
    habitInput(i).dataset.habitId = h ? h.id : '';
  }
  renderLastBackup();
  $('#appVersion').textContent = 'Installierte Version: …';
  currentVersion().then(v => { $('#appVersion').textContent = `Installierte Version: ${v ?? 'Entwicklung (ohne Cache)'}`; });
  openModal('settingsModal');
}

function saveSettings() {
  const checks = [
    ['#goalKcal', 'Bitte einen gültigen Kalorienwert eingeben'],
    ['#goalProtein', 'Bitte Protein-Ziel eingeben'],
    ['#goalCarbs', 'Bitte Kohlenhydrat-Ziel eingeben'],
    ['#goalFat', 'Bitte Fett-Ziel eingeben'],
    ['#waterGoalInput', 'Bitte ein gültiges Wasser-Tagesziel eingeben'],
    ['#waterGlassSizeInput', 'Bitte eine gültige Glasgröße eingeben']
  ];
  const v = {};
  for (const [sel, msg] of checks) {
    v[sel] = validatePositiveInt($(sel).value);
    if (!v[sel]) return showFieldError($(sel), msg);
  }
  const weight = toNumber($('#bodyWeight').value);
  if (weight === null || weight <= 0) return showFieldError($('#bodyWeight'), 'Bitte ein gültiges Körpergewicht eingeben');
  const model = $('#geminiModel').value.trim() || DEFAULT_GEMINI_MODEL;
  if (!/^[\w.-]+$/.test(model)) return showFieldError($('#geminiModel'), 'Ungültiger Modellname');

  db.goals = { kcal: v['#goalKcal'], protein: v['#goalProtein'], carbs: v['#goalCarbs'], fat: v['#goalFat'] };
  Object.assign(db.appSettings, {
    bodyWeight: weight,
    cardioAddToBudget: $('#cardioAddToBudget').checked,
    waterGoal: v['#waterGoalInput'],
    waterGlassSize: v['#waterGlassSizeInput'],
    geminiModel: model
  });

  const key = $('#geminiKey').value.trim();
  if (key) getStorage().setItem(KEYS.geminiKey, key);
  else getStorage().removeItem(KEYS.geminiKey);

  // Feld leeren = Gewohnheit aufgeben; neuer Text danach ist eine neue Gewohnheit
  const newHabits = [];
  for (let i = 0; i < MAX_HABITS; i++) {
    const inp = habitInput(i);
    const name = inp.value.trim();
    if (!name) continue;
    const id = inp.dataset.habitId && db.habits.some(h => h.id === inp.dataset.habitId) ? inp.dataset.habitId : uid();
    inp.dataset.habitId = id;
    newHabits.push({ id, name });
  }
  db.habits = newHabits;
  pruneHabitLog(db.habits, db.habitLog);

  save(); closeModal('settingsModal'); render('all');
  toast('Einstellungen gespeichert');
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(buildBackup(db), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `fittrack-backup-${todayStr()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  getStorage().setItem(KEYS.lastBackup, todayStr());
  renderLastBackup();
  toast('Backup erstellt');
}

async function importBackup(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let clean;
  try {
    clean = sanitizeBackup(JSON.parse(await file.text()), db);
  } catch (err) {
    console.error(err);
    return toast('Datei konnte nicht gelesen werden.');
  }
  if (!confirm('Backup einspielen? Deine aktuellen Daten werden dabei ersetzt.')) return;
  Object.assign(db, clean);
  save(); closeModal('settingsModal'); render('all');
  toast('Daten importiert');
}

// Einmal pro Start erinnern, wenn das letzte Backup lange her ist und es Daten gibt.
export function maybeRemindBackup() {
  const hasData = Object.keys(db.log).length + Object.keys(db.workouts).length > 0;
  if (!hasData) return;
  const last = lastBackupDate();
  const days = last ? daysBetween(last, todayStr()) : Infinity;
  if (days >= 30) {
    setTimeout(() => toast(last ? `Letztes Backup vor ${days} Tagen – Einstellungen → Exportieren`
                                : 'Tipp: Erstelle ein Backup unter Einstellungen → Exportieren'), 1500);
  }
}

export function initSettings() {
  $('#settingsBtn').addEventListener('click', openSettings);
  for (let i = 0; i < MAX_HABITS; i++) {
    const inp = habitInput(i);
    inp.addEventListener('input', () => { if (!inp.value.trim()) inp.dataset.habitId = ''; });
  }
  $('#saveGoals').addEventListener('click', saveSettings);
  $('#exportData').addEventListener('click', exportBackup);
  $('#checkUpdate').addEventListener('click', e => onCheckUpdateClick(e.currentTarget));
  $('#importData').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', importBackup);
  $('#resetData').addEventListener('click', () => {
    if (confirm('Wirklich ALLE Daten löschen? Das kann nicht rückgängig gemacht werden.')) {
      clearAll();
      location.reload();
    }
  });
}
