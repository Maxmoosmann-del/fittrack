// Einstiegspunkt: Daten laden, Module verdrahten, App starten.
import { db, load, save, KEYS, getStorage, onSaveError } from './store.js';
import { todayStr, fromStr, uid } from './util.js';
import { PRESET_FOODS } from './presets.js';
import { $, $$, toast, initModals } from './ui/dom.js';
import { register, render } from './ui/render.js';
import { renderHeader } from './ui/header.js';
import { initToday } from './ui/today.js';
import { initFoods, openLogFood, openCreateFood } from './ui/foods.js';
import { initWorkouts, openExerciseModal } from './ui/workouts.js';
import { initSettings, maybeRemindBackup } from './ui/settings.js';
import { initScan } from './ui/scan.js';

const TABS = ['today', 'foods', 'workouts'];
const TAB_VIEWS = { today: ['today', 'water', 'habits'], foods: ['foods'], workouts: ['workouts'] };

function renderCurrent() {
  renderHeader();
  render(...TAB_VIEWS[db.state.tab]);
}

// Mahlzeit nach Uhrzeit vorschlagen
function mealForNow(h = new Date().getHours()) {
  if (h >= 4 && h < 11) return 'breakfast';
  if (h >= 11 && h < 16) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}

// Roter +-Button: tut je nach Tab das Naheliegende
const FAB_ACTIONS = {
  today:    { label: 'Lebensmittel eintragen', run: () => openLogFood(mealForNow()) },
  foods:    { label: 'Neues Lebensmittel anlegen', run: openCreateFood },
  workouts: { label: 'Übung hinzufügen', run: openExerciseModal }
};

function showTab(tab) {
  db.state.tab = tab;
  $$('nav.bottom button').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + tab));
  $('#fab').setAttribute('aria-label', FAB_ACTIONS[tab].label);
  renderCurrent();
  window.scrollTo(0, 0);
}

function shiftDay(delta) {
  const d = fromStr(db.state.date);
  d.setDate(d.getDate() + delta);
  db.state.date = todayStr(d);
  save('state');
  renderCurrent();
}

function initNavigation() {
  $$('nav.bottom button').forEach(b => b.addEventListener('click', () => { showTab(b.dataset.tab); save('state'); }));
  $('#fab').addEventListener('click', () => FAB_ACTIONS[db.state.tab].run());
  $('#prevDay').addEventListener('click', () => shiftDay(-1));
  $('#nextDay').addEventListener('click', () => shiftDay(1));

  // Läuft die App über Mitternacht, springt sie beim nächsten Öffnen auf den neuen Tag –
  // aber nur, wenn man nicht bewusst einen anderen Tag ausgewählt hat.
  let lastKnownToday = todayStr();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const now = todayStr();
    if (now === lastKnownToday) return;
    if (db.state.date === lastKnownToday) { db.state.date = now; save('state'); renderCurrent(); }
    lastKnownToday = now;
  });
}

function initPwa() {
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredPrompt = e;
    $('#installBanner').classList.add('show');
  });
  $('#installBtn').addEventListener('click', async () => {
    $('#installBanner').classList.remove('show');
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });
  window.addEventListener('appinstalled', () => $('#installBanner').classList.remove('show'));

  // Lokal (npm run serve) ohne Service Worker – sonst sieht man Änderungen erst
  // nach dem Hochzählen von CACHE.
  const isDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !isDev) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('Update verfügbar', () => location.reload(), { label: 'Neu laden', duration: 15000 });
    });
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  // Browser bitten, die Daten nicht bei Speicherknappheit zu löschen.
  navigator.storage?.persist?.().catch(() => {});
}

// ---------- Start ----------
onSaveError(err => { console.error('Speichern fehlgeschlagen', err); toast('Speichern fehlgeschlagen – Gerätespeicher voll?'); });
load();

// Standard-Lebensmittel nur beim allerersten Start anlegen.
if (!getStorage().getItem(KEYS.seeded)) {
  if (db.foods.length === 0) {
    db.foods = PRESET_FOODS.map(f => ({ id: uid(), ...f }));
    save('foods');
  }
  getStorage().setItem(KEYS.seeded, '1');
}
if (!TABS.includes(db.state.tab)) db.state.tab = 'today';

initModals();
initToday();
initFoods();
initWorkouts();
initSettings();
initScan();
initNavigation();
initPwa();

register('current', renderCurrent);
register('all', () => render('today', 'water', 'habits', 'foods', 'workouts', 'current'));

render('today', 'water', 'habits', 'foods', 'workouts');
showTab(db.state.tab);
maybeRemindBackup();
