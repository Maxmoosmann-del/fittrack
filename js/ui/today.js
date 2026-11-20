// Tab "Heute": Kalorien/Makros, Mahlzeiten, Wasser, Gewohnheiten.
import { db, save, removeById } from '../store.js';
import { uid } from '../util.js';
import { MEALS, calcEntry, dayTotals, effectiveKcalGoal } from '../nutrition.js';
import { toggleHabit } from '../habits.js';
import { dailySeries, seriesSummary, sparkChars, weekdayInitial, habitStats, yesterdayOf } from '../stats.js';
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

  renderHistory();

  const yesterday = db.log[yesterdayOf(day)] || [];
  $('#meals').replaceChildren(...MEALS.map(m => {
    const mealEntries = entries.filter(e => e.meal === m.key);
    const kcal = mealEntries.reduce((s, e) => s + calcEntry(e).kcal, 0);
    const fromYesterday = mealEntries.length ? [] : yesterday.filter(e => e.meal === m.key);
    return el('div', { class: 'meal' },
      el('h2', { class: 'sec' }, `// ${m.label}`, el('span', { class: 'sec-meta', text: `${kcal} kcal` })),
      el('div', { class: 'entries' }, mealEntries.map(e => mealEntryRow(e, day, m.label))),
      fromYesterday.length > 0 && repeatYesterdayButton(m, fromYesterday, day),
      el('button', { class: 'add-btn', type: 'button', 'aria-label': `${m.label} hinzufügen`,
                     text: '+ Hinzufügen', onclick: () => openLogFood(m.key) }));
  }));
}

// "Wie gestern": Einträge der gleichen Mahlzeit vom Vortag kopieren (mit Rückgängig)
function repeatYesterdayButton(meal, source, day) {
  const kcal = source.reduce((s, e) => s + calcEntry(e).kcal, 0);
  return el('button', { class: 'repeat-btn', type: 'button',
                        'aria-label': `${meal.label} wie gestern eintragen: ${source.length} Einträge, ${kcal} kcal`,
                        onclick: () => {
                          const copies = source.map(e => ({ ...e, id: uid() }));
                          (db.log[day] ||= []).push(...copies);
                          save('log'); render('today');
                          toast(`${meal.label} wie gestern eingetragen`, () => {
                            for (const c of copies) removeById(db.log, day, c.id);
                            save('log'); render('today');
                          });
                        } },
    el('span', { class: 'repeat-label', text: '↻ Wie gestern' }),
    el('span', { class: 'repeat-meta', text: `${source.length} Eintr${source.length === 1 ? 'ag' : 'äge'} · ${kcal} kcal` }));
}

// ---------- Verlauf (kcal + Protein) ----------
const HIST_DAYS = [7, 14, 30];

function sparkLine(label, values, chars, classify) {
  return el('div', { class: 'hist-line' },
    el('span', { class: 'hist-key', text: label }),
    el('span', { class: 'hist-spark' }, chars.map((ch, i) => el('span', { class: classify(values[i], i), text: ch }))));
}

function renderHistory() {
  const days = HIST_DAYS.includes(db.state.histDays) ? db.state.histDays : 14;
  const today = db.state.date;
  const series = dailySeries(db.log, today, days);
  const kcalVals = series.map(d => (d.hasData ? d.kcal : null));
  const protVals = series.map(d => (d.hasData ? d.protein : null));
  const last = series.length - 1;
  const base = i => (i === last ? 'today' : '');

  $('#histDaysLabel').textContent = days;
  document.querySelectorAll('.hist-range button').forEach(b => {
    const on = Number(b.dataset.days) === days;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });

  const sum = seriesSummary(series, db.goals.protein, today);
  const summary = sum.days
    ? `Ø ${sum.kcal} kcal · Ø ${sum.protein} g Protein · Proteinziel ${sum.proteinHits}/${sum.days} Tage`
    : 'Noch keine abgeschlossenen Tage im Zeitraum.';
  $('#historyChart').replaceChildren(
    sparkLine('kcal', kcalVals, sparkChars(kcalVals, db.goals.kcal),
              (v, i) => `${base(i)} ${v > db.goals.kcal ? 'over' : ''}`.trim()),
    sparkLine('prot', protVals, sparkChars(protVals, db.goals.protein),
              (v, i) => `${base(i)} ${v != null && v >= db.goals.protein ? 'hit' : 'low'}`.trim()),
    el('div', { class: 'hist-line hist-days', 'aria-hidden': 'true' },
      el('span', { class: 'hist-key' }),
      el('span', { class: 'hist-spark' }, series.map((d, i) => el('span', { class: base(i), text: weekdayInitial(d.date) })))),
    el('div', { class: 'hist-summary', text: summary }));
  $('#historyChart').style.setProperty('--days', days);
  $('#historyChart').setAttribute('aria-label',
    `Verlauf der letzten ${days} Tage. ${summary}`);
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
  box.replaceChildren(...db.habits.map(h => {
    const st = habitStats(db.habitLog, h.id, db.state.date, 14);
    const isDone = st.doneToday;
    const days = n => `${n} Tag${n === 1 ? '' : 'e'}`;
    // Heute noch offen, aber gestern erledigt: Streak ist nicht verloren, nur "bis gestern"
    const streakText = st.streak === 0 ? '—' : `▲ ${st.streak} ${isDone ? 'in Folge' : 'bis gestern'}`;
    return el('div', { class: 'habit-row' + (isDone ? ' done' : '') },
      el('div', { class: 'habit-top' },
        el('button', { class: 'habit-check', type: 'button', 'aria-pressed': String(isDone),
                       'aria-label': `${h.name} ${isDone ? 'als nicht erledigt markieren' : 'als erledigt markieren'}`,
                       html: isDone ? ICONS.check : '',
                       onclick: () => { toggleHabit(db.habitLog, db.state.date, h.id); save('habitLog'); renderHabits(); } }),
        el('div', { class: 'habit-info' },
          el('div', { class: 'habit-name', text: h.name }),
          el('div', { class: 'habit-streak' + (st.streak && isDone ? '' : ' muted'), text: streakText,
                      'aria-label': st.streak ? `${days(st.streak)} ${isDone ? 'in Folge' : 'in Folge bis gestern'}` : 'Noch kein Streak' }))),
      el('div', { class: 'habit-strip', 'aria-hidden': 'true' },
        st.strip.map((s, i) => el('span', { class: `sq${s.done ? ' on' : ''}${i === st.strip.length - 1 ? ' today' : ''}`,
                                           title: s.date }))),
      el('div', { class: 'habit-meta', text: `Rekord ${st.best} · ${st.doneCount} von 14 Tagen` }));
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

  // Zeitraum des Verlaufs umschalten (wird gemerkt)
  document.querySelectorAll('.hist-range button').forEach(b => b.addEventListener('click', () => {
    db.state.histDays = Number(b.dataset.days);
    save('state'); renderHistory();
  }));

  register('today', renderToday);
  register('water', renderWater);
  register('habits', renderHabits);
}
