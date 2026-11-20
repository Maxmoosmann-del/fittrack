// Service Worker, Update-Hinweis und Versionsanzeige.
import { $, toast } from './dom.js';

const CHECK_INTERVAL_MS = 60 * 1000;
let registration = null;
let lastCheck = 0;

function showBanner() {
  $('#updateBanner').hidden = false;
}

// Version = Name des aktuellen Caches (steht nur an einer Stelle: CACHE in sw.js)
export async function currentVersion() {
  if (!('caches' in window)) return null;
  const keys = (await caches.keys()).filter(k => /^fittrack-v\d+$/.test(k));
  if (!keys.length) return null;
  return 'v' + Math.max(...keys.map(k => Number(k.split('-v')[1])));
}

// Wartet, bis ein gerade gefundenes Update installiert und aktiv ist.
function whenActivated(worker) {
  return new Promise(resolve => {
    if (!worker) return resolve(false);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve(true);
      if (worker.state === 'redundant') resolve(false);
    });
  });
}

// Manuell (Knopf in den Einstellungen): gibt true zurück, wenn ein Update kam.
export async function checkForUpdate() {
  if (!registration) return false;
  lastCheck = Date.now();
  await registration.update();
  const worker = registration.installing || registration.waiting;
  return worker ? whenActivated(worker) : false;
}

export function initUpdates() {
  $('#updateBanner').addEventListener('click', () => location.reload());

  const isDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!('serviceWorker' in navigator) || isDev) return;

  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Beim allerersten Installieren gibt es nichts "Neues" anzuzeigen
    if (hadController) showBanner();
  });

  window.addEventListener('load', async () => {
    try { registration = await navigator.serviceWorker.register('sw.js'); }
    catch { /* offline oder blockiert – App läuft trotzdem */ }
  });

  // Holt man die installierte App aus dem Hintergrund, lädt der Browser die Seite nicht
  // neu und prüft auch nicht auf Updates – deshalb hier selbst nachsehen.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !registration) return;
    if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
    lastCheck = Date.now();
    registration.update().catch(() => {});
  });
}

export async function onCheckUpdateClick(btn) {
  if (!registration) { toast('Update-Prüfung nur in der installierten App möglich'); return; }
  btn.disabled = true;
  btn.textContent = 'Suche…';
  try {
    const updated = await checkForUpdate();
    if (!updated) toast(`Du hast die neueste Version (${await currentVersion() ?? '?'})`);
  } catch {
    toast('Keine Verbindung – später nochmal versuchen');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Nach Update suchen';
  }
}
