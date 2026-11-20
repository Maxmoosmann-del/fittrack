// Tab "Heute": Kalorien/Makros, Mahlzeiten, Wasser, Gewohnheiten.
import { db, save, removeById } from '../store.js';
import { fmtDate, fmtSubDate } from '../util.js';
import { MEALS, calcEntry, dayTotals, effectiveKcalGoal } from '../nutrition.js';
import { habitStreak, toggleHabit } from '../habits.js';
import { $, el, ICONS, toast, setBar } from './dom.js';
import { register, render } from './render.js';
import { openLogFood, openPortionEdit } from './foods.js';

export function renderDateHeader() {
  $('#dateLabel').textContent = fmtDate(db.state.date);
  $('#dateSub').textContent = fmtSubDate(db.state.date);
}

function renderToday() {
  const day = db.state.date;
  renderDateHeader();

  const entries = db.log[day] || [];
  const totals = dayTotals(entries);
  const { burned, goal } = effectiveKcalGoal(db.goals.kcal, db.cardio[day] || [], db.appSettings.cardioAddToBudget);

  $('#kcalNum').textContent = totals.kcal;
  $('#kcalGoal').textContent = goal;
  $('#kcalLeft').textContent = Math.max(goal - totals.kcal, 0);
  setBar('kcalBar', totals.kcal, goal);

  const burnedRow = $('#cardioBurnedRow');
  const showBurned = burned > 0 && db.appSettings.cardioAddToBudget;
  burnedRow.style.display = showBurned ? 'flex' : 'none';
  if (showBurned) $('#cardioBurnedText').textContent = `${burned} kcal verbrannt → ${goal} kcal Tagesbedarf`;

  for (const m of ['protein', 'carbs', 'fat']) {
    $(`#${m}Num`).textContent = totals[m];
    $(`#${m}Goal`).textContent = db.goals[m];
    setBar(`${m}Bar`, totals[m], db.goals[m]);
  }

  $('#meals').replaceChildren(...MEALS.map(m => {
    const mealEntries = entries.filter(e => e.meal === m.key);
    const kcal = mealEntries.reduce((s, e) => s + calcEntry(e).kcal, 0);
    return el('div', { class: 'meal' },
      el('div', { class: 'meal-head' },
        el('div', { class: 'title', text: m.label }),
        el('div', { class: 'kcal', text: `${kcal} kcal` })),
      el('div', { class: 'entries' }, mealEntries.map(e => mealEntryRow(e, day, m.label))),
      el('button', { class: 'add-btn', type: 'button', 'aria-label': `${m.label} hinzufügen`,
                     text: '+ Hinzufügen', onclick: () => openLogFood(m.key) }));
  }));
}

function mealEntryRow(e, day, mealLabel) {
  const c = calcEntry(e);
  return el('div', { class: 'entry' },
    el('div', {},
      el('div', { class: 'name', text: c.name }),
      el('div', { class: 'meta', text: `${c.grams} g · P ${c.protein}g · K ${c.carbs}g · F ${c.fat}g` })),
    el('div', { class: 'right' },
      el('div', { class: 'kcal', text: `${c.kcal} kcal` }),
      el('div', { class: 'entry-actions' },
        el('button', { class: 'mini-btn accent', type: 'button', html: ICONS.edit,
                       'aria-label': `${c.name} Portion bearbeiten`,
                       onclick: () => openPortionEdit(e.id) }),
        el('button', { class: 'mini-btn', type: 'button', html: ICONS.trash,
                       'aria-label': `${c.name} aus ${mealLabel} löschen`,
                       onclick: () => {
                         const r = removeById(db.log, day, e.id);
                         if (!r) return;
                         save('log'); render('today');
                         toast(`${c.name} entfernt`, () => { r.undo(); save('log'); render('today'); });
                       } }))));
}

// ---------- Wasser ----------
function renderWater() {
  const goal = db.appSettings.waterGoal || 8;
  const size = db.appSettings.waterGlassSize || 250;
  const drunk = db.water[db.state.date] || 0;

  const glasses = [];
  for (let i = 0; i < goal; i++) {
    const filled = i < drunk;
    glasses.push(el('button', {
      class: 'glass-btn' + (filled ? ' filled' : ''), type: 'button', dataset: { idx: i },
      'aria-label': `Glas ${i + 1}${filled ? ' (gefüllt)' : ''}`, 'aria-pressed': String(filled),
      html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l1 16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-16Z"/>${filled ? '<path d="M6 10l.5 9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l.5-9Z" stroke="none" fill="currentColor" opacity="0.35"/>' : ''}</svg>`
    }));
  }
  const bar = el('span');
  bar.style.width = Math.min(100, drunk / goal * 100) + '%';
  const reset = el('button', { class: 'water-reset-btn', type: 'button', 'data-action': 'reset',
                               'aria-label': 'Wasser zurücksetzen', text: '↺' });
  if (drunk === 0) reset.style.display = 'none';

  $('#waterTracker').replaceChildren(
    el('div', { class: 'water-header' },
      el('div', {},
        el('div', { class: 'water-count' }, String(drunk), el('span', { class: 'water-unit', text: ` / ${goal} Gläser` })),
        el('div', { class: 'water-ml', text: `${drunk * size} ml` })),
      reset),
    el('div', { class: 'glass-grid' }, glasses),
    el('div', { class: 'water-progress-bar' }, bar));
}

// ---------- Gewohnheiten ----------
function renderHabits() {
  const box = $('#habitTracker');
  if (db.habits.length === 0) {
    box.replaceChildren(el('div', { class: 'empty', text: 'Noch keine Gewohnheiten. Füge sie in den Einstellungen hinzu.' }));
    return;
  }
  const done = db.habitLog[db.state.date] || {};
  box.replaceChildren(...db.habits.map(h => {
    const isDone = !!done[h.id];
    const streak = habitStreak(db.habitLog, h.id, db.state.date);
    return el('div', { class: 'habit-row' + (isDone ? ' done' : '') },
      el('button', { class: 'habit-check', type: 'button', 'aria-pressed': String(isDone),
                     'aria-label': `${h.name} ${isDone ? 'als nicht erledigt markieren' : 'als erledigt markieren'}`,
                     html: isDone ? ICONS.check : '',
                     onclick: () => { toggleHabit(db.habitLog, db.state.date, h.id); save('habitLog'); renderHabits(); } }),
      el('div', { class: 'habit-info' },
        el('div', { class: 'habit-name', text: h.name }),
        streak > 0
          ? el('div', { class: 'habit-streak', text: `🔥 ${streak} Tag${streak === 1 ? '' : 'e'}` })
          : el('div', { class: 'habit-streak muted', text: 'Noch kein Streak' })));
  }));
}

export function initToday() {
  // Ein Listener für den ganzen Wasser-Tracker statt einer pro Glas.
  $('#waterTracker').addEventListener('click', ev => {
    const day = db.state.date;
    if (ev.target.closest('[data-action="reset"]')) {
      delete db.water[day]; save('water'); renderWater(); return;
    }
    const btn = ev.target.closest('.glass-btn');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    const current = db.water[day] || 0;
    // Klick auf ein volles Glas leert ab dort, Klick auf ein leeres füllt bis dorthin auf
    const next = idx < current ? idx : idx + 1;
    if (next === 0) delete db.water[day]; else db.water[day] = next;
    save('water'); renderWater();
  });

  register('today', renderToday);
  register('water', renderWater);
  register('habits', renderHabits);
}
