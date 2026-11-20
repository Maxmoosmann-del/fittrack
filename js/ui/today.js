// Tab "Heute": Kalorien/Makros, Mahlzeiten, Wasser, Gewohnheiten.
import { db, save, removeById } from '../store.js';
import { MEALS, calcEntry, dayTotals, effectiveKcalGoal } from '../nutrition.js';
import { habitStreak, toggleHabit } from '../habits.js';
import { $, el, ICONS, toast, setBar } from './dom.js';
import { register, render } from './render.js';
import { renderHeader } from './header.js';
import { openLogFood, openPortionEdit } from './foods.js';

function renderToday() {
  const day = db.state.date;
  renderHeader();

  const entries = db.log[day] || [];
  const totals = dayTotals(entries);
  const { burned, goal } = effectiveKcalGoal(db.goals.kcal, db.cardio[day] || [], db.appSettings.cardioAddToBudget);

  $('#kcalNum').textContent = totals.kcal;
  $('#kcalGoal').textContent = goal;
  $('#kcalLeft').textContent = Math.max(goal - totals.kcal, 0);
  setBar('kcalBar', totals.kcal, goal, { percent: true });

  const burnedRow = $('#cardioBurnedRow');
  const showBurned = burned > 0 && db.appSettings.cardioAddToBudget;
  burnedRow.style.display = showBurned ? 'block' : 'none';
  if (showBurned) $('#cardioBurnedText').textContent = `${burned} kcal verbrannt → ziel ${goal}`;

  for (const m of ['protein', 'carbs', 'fat']) {
    $(`#${m}Num`).textContent = totals[m];
    $(`#${m}Goal`).textContent = db.goals[m];
    setBar(`${m}Bar`, totals[m], db.goals[m]);
  }

  $('#meals').replaceChildren(...MEALS.map(m => {
    const mealEntries = entries.filter(e => e.meal === m.key);
    const kcal = mealEntries.reduce((s, e) => s + calcEntry(e).kcal, 0);
    return el('div', { class: 'meal' },
      el('h2', { class: 'sec' }, `// ${m.label}`, el('span', { class: 'sec-meta', text: `${kcal} kcal` })),
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

  // Gläser als ASCII-Kästchen: ■ voll, □ leer
  const glasses = [];
  for (let i = 0; i < goal; i++) {
    const filled = i < drunk;
    glasses.push(el('button', {
      class: 'glass-btn' + (filled ? ' filled' : ''), type: 'button', dataset: { idx: i },
      'aria-label': `Glas ${i + 1}${filled ? ' (gefüllt)' : ''}`, 'aria-pressed': String(filled),
    }));
  }
  $('#waterMeta').textContent = `${drunk}/${goal} · ${drunk * size} ml`;
  $('#waterTracker').replaceChildren(
    el('div', { class: 'water-row' }, glasses,
      drunk > 0 && el('button', { class: 'water-reset-btn', type: 'button', 'data-action': 'reset',
                                  'aria-label': 'Wasser zurücksetzen', text: '↺' })));
}

// ---------- Gewohnheiten ----------
function renderHabits() {
  const box = $('#habitTracker');
  if (db.habits.length === 0) {
    box.replaceChildren(el('div', { class: 'empty', text: 'Lege bis zu drei Gewohnheiten in den Einstellungen an.' }));
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
          ? el('div', { class: 'habit-streak', text: `▲ ${streak}`,
                        title: `${streak} Tag${streak === 1 ? '' : 'e'} in Folge`,
                        'aria-label': `${streak} Tag${streak === 1 ? '' : 'e'} in Folge` })
          : el('div', { class: 'habit-streak muted', text: '—', 'aria-label': 'Noch kein Streak' })));
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
