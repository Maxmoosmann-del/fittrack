// Tab "Workouts": Übungen (bewusst ein Satz pro Übung), Cardio, Verlauf.
import { db, save, findById, removeById } from '../store.js';
import { uid, fmtDate, fmtSubDate, toNumber, validatePositiveInt, validateNonNegativeFloat } from '../util.js';
import { PRESET_CARDIO, CUSTOM_CARDIO_MET, calcCardioKcal } from '../nutrition.js';
import { $, el, toast, showFieldError, openModal, closeModal } from './dom.js';
import { register, render } from './render.js';
import { renderHeader } from './header.js';

// ---------- Übungen ----------
function setField(dateKey, id, key, value) {
  const ex = findById(db.workouts, dateKey, id);
  if (!ex) return;
  if (!ex.sets[0]) ex.sets[0] = { weight: 0, reps: 0 };
  ex.sets[0][key] = value;
  save('workouts');
}

function numberField(label, value, aria, inputMode, onChange) {
  const inp = el('input', { type: 'number', inputmode: inputMode, min: '0', placeholder: '0', 'aria-label': aria });
  inp.value = value || '';
  inp.addEventListener('change', e => onChange(toNumber(e.target.value) || 0));
  return el('label', { class: 'ex-field' }, el('span', { text: label, 'aria-hidden': 'true' }), inp);
}

function exerciseCard(ex, dateKey) {
  const s = ex.sets[0] || { weight: 0, reps: 0 };
  const row = el('div', { class: 'ex-inputs' },
    numberField('KG', s.weight, `${ex.exercise} Gewicht in kg`, 'decimal',
                v => setField(dateKey, ex.id, 'weight', v)),
    numberField('WDH', s.reps, `${ex.exercise} Wiederholungen`, 'numeric',
                v => setField(dateKey, ex.id, 'reps', Math.round(v))));
  return el('div', { class: 'workout-card' },
    el('div', { class: 'ex-title' },
      el('span', { text: ex.exercise }),
      el('button', { class: 'ex-remove', type: 'button', text: '✕', 'aria-label': `${ex.exercise} entfernen`,
                     onclick: () => {
                       const r = removeById(db.workouts, dateKey, ex.id);
                       if (!r) return;
                       save('workouts'); render('workouts');
                       toast(`${ex.exercise} entfernt`, () => { r.undo(); save('workouts'); render('workouts'); });
                     } })),
    row);
}

function historyItem(d) {
  const day = db.workouts[d];
  const totalSets = day.reduce((s, ex) => s + ex.sets.length, 0);
  return el('div', { class: 'history-item' },
    el('div', { class: 'head' },
      el('div', { class: 'date-l' }, fmtDate(d) + ' ',
        el('span', { class: 'muted', style: 'font-weight:400', text: `· ${fmtSubDate(d)}` })),
      el('button', { class: 'text-btn', type: 'button', text: 'Öffnen', 'aria-label': `${fmtDate(d)} Workout öffnen`,
                     onclick: () => { db.state.date = d; save('state'); render('current'); } })),
    el('div', { class: 'summary', text: `${day.length} Übung${day.length !== 1 ? 'en' : ''} · ${totalSets} ${totalSets === 1 ? 'Satz' : 'Sätze'}` }),
    el('div', { class: 'ex-list' }, day.map(ex => el('div', { class: 'ex' },
      el('b', { text: ex.exercise }),
      ` — ${ex.sets.map(s => `${s.weight || 0}kg × ${s.reps || 0}`).join(', ')}`))));
}

function renderWorkouts() {
  const dateKey = db.state.date;
  renderHeader();

  const day = db.workouts[dateKey] || [];
  const cardioCount = (db.cardio[dateKey] || []).length;
  $('#sessionSummary').textContent =
    `${day.length} übung${day.length === 1 ? '' : 'en'} · ${cardioCount} cardio`;
  $('#exercisesList').replaceChildren(...(day.length
    ? day.map(ex => exerciseCard(ex, dateKey))
    : [el('div', { class: 'empty', html: 'Noch keine Übungen an diesem Tag. Tippe auf <b>+</b>.' })]));

  renderCardioList();

  const dates = Object.keys(db.workouts).filter(d => d !== dateKey).sort().reverse();
  $('#historyList').replaceChildren(...(dates.length
    ? dates.slice(0, 30).map(historyItem)
    : [el('div', { class: 'empty', text: 'Noch kein Verlauf.' })]));
}

function lastExerciseValues(name) {
  const lower = name.toLowerCase();
  const dates = Object.keys(db.workouts).filter(d => d !== db.state.date).sort().reverse();
  for (const d of dates) {
    const ex = db.workouts[d].find(e => e.exercise.toLowerCase() === lower);
    if (ex?.sets?.[0]) return { weight: ex.sets[0].weight || 0, reps: ex.sets[0].reps || 0 };
  }
  return null;
}

export function openExerciseModal() {
  for (const id of ['#exerciseName', '#exerciseWeight', '#exerciseReps']) $(id).value = '';
  $('#lastExerciseInfo').style.display = 'none';
  $('#exerciseHints').replaceChildren(...db.exerciseNames.map(n => el('option', { value: n })));
  openModal('exerciseModal', '#exerciseName');
}

function onExerciseNameInput() {
  const n = $('#exerciseName').value.trim();
  const last = n ? lastExerciseValues(n) : null;
  $('#lastExerciseInfo').style.display = last ? 'block' : 'none';
  if (!last) return;
  $('#exerciseWeight').value = last.weight;
  $('#exerciseReps').value = last.reps;
  $('#lastExerciseValues').textContent = `${last.weight} kg × ${last.reps} Wdh.`;
}

function confirmExercise() {
  const n = $('#exerciseName').value.trim();
  if (!n) return showFieldError($('#exerciseName'), 'Bitte einen Übungsnamen eingeben');
  const weight = validateNonNegativeFloat($('#exerciseWeight').value) ?? 0;
  const reps = Math.round(validateNonNegativeFloat($('#exerciseReps').value) ?? 0);
  // Autovervollständigung ohne Dubletten in anderer Schreibweise
  db.exerciseNames = [n, ...db.exerciseNames.filter(x => x.toLowerCase() !== n.toLowerCase())].slice(0, 40);
  (db.workouts[db.state.date] ||= []).push({ id: uid(), exercise: n, sets: [{ weight, reps }] });
  save('workouts', 'exerciseNames'); closeModal('exerciseModal'); render('workouts');
  toast('Übung hinzugefügt');
}

// ---------- Cardio ----------
function renderCardioList() {
  const dateKey = db.state.date;
  const entries = db.cardio[dateKey] || [];
  if (entries.length === 0) {
    $('#cardioList').replaceChildren(el('div', { class: 'empty', style: 'margin-bottom:8px', text: 'Noch kein Cardio heute.' }));
    return;
  }
  $('#cardioList').replaceChildren(...entries.map(e => el('div', { class: 'cardio-entry' },
    el('div', { class: 'left' },
      el('div', { class: 'name', text: e.name }),
      el('div', { class: 'meta' },
        el('span', { class: `intensity ${e.intensity.replace(' ', '-')}`, text: `[${e.intensity}]` }),
        ` · ${e.duration} min`)),
    el('div', { class: 'right' },
      el('div', { class: 'kcal-burned', text: `${e.kcalBurned} kcal` }),
      el('button', { class: 'text-btn', type: 'button', style: 'margin-top:4px', text: 'Löschen',
                     'aria-label': `${e.name} entfernen`,
                     onclick: () => {
                       const r = removeById(db.cardio, dateKey, e.id);
                       if (!r) return;
                       save('cardio'); render('workouts', 'today');
                       toast(`${e.name} entfernt`, () => { r.undo(); save('cardio'); render('workouts', 'today'); });
                     } })))));
}

function updateCardioKcalEst() {
  const val = $('#cardioSelect').value;
  const dur = validatePositiveInt($('#cardioDuration').value) || 0;
  const preset = PRESET_CARDIO[Number(val)];
  $('#cardioKcalEst').textContent = val === 'custom' || !preset
    ? '–' : calcCardioKcal(preset.met, dur, db.appSettings.bodyWeight) + ' kcal';
}

function openCardioModal() {
  $('#cardioSelect').replaceChildren(
    ...PRESET_CARDIO.map((p, i) => el('option', { value: i, text: `${p.name} (${p.intensity})` })),
    el('option', { value: 'custom', text: 'Eigene Aktivität…' }));
  $('#cardioDuration').value = 30;
  $('#cardioKcalOverride').value = '';
  $('#cardioCustomName').value = '';
  $('#cardioCustomNameField').style.display = 'none';
  updateCardioKcalEst();
  openModal('cardioModal');
}

function confirmCardio() {
  const val = $('#cardioSelect').value;
  const dur = validatePositiveInt($('#cardioDuration').value);
  if (!dur) return showFieldError($('#cardioDuration'), 'Bitte eine Dauer eingeben');
  const override = validatePositiveInt($('#cardioKcalOverride').value);

  let name, intensity, met;
  if (val === 'custom') {
    name = $('#cardioCustomName').value.trim();
    if (!name) return showFieldError($('#cardioCustomName'), 'Bitte einen Namen eingeben');
    intensity = 'mittel'; met = CUSTOM_CARDIO_MET;
  } else {
    ({ name, intensity, met } = PRESET_CARDIO[Number(val)]);
  }
  const kcalBurned = override || calcCardioKcal(met, dur, db.appSettings.bodyWeight);
  (db.cardio[db.state.date] ||= []).push({ id: uid(), name, intensity, duration: dur, kcalBurned });
  save('cardio'); closeModal('cardioModal'); render('workouts', 'today');
  toast(`${name} hinzugefügt · ${kcalBurned} kcal verbrannt`);
}

export function initWorkouts() {
  $('#exerciseName').addEventListener('input', onExerciseNameInput);
  $('#cancelExercise').addEventListener('click', () => closeModal('exerciseModal'));
  $('#confirmExercise').addEventListener('click', confirmExercise);

  $('#addCardioBtn').addEventListener('click', openCardioModal);
  $('#cardioSelect').addEventListener('change', () => {
    $('#cardioCustomNameField').style.display = $('#cardioSelect').value === 'custom' ? 'block' : 'none';
    updateCardioKcalEst();
  });
  $('#cardioDuration').addEventListener('input', updateCardioKcalEst);
  $('#cancelCardio').addEventListener('click', () => closeModal('cardioModal'));
  $('#confirmCardio').addEventListener('click', confirmCardio);

  register('workouts', renderWorkouts);
}
