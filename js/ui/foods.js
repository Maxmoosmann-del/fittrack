// Tab "Lebensmittel" + Modals: Lebensmittel anlegen/bearbeiten, Mahlzeit wählen, Portion.
import { db, save, findById, removeById } from '../store.js';
import { uid, round1, validateNonNegativeFloat } from '../util.js';
import { MEALS, nutrientSnapshot } from '../nutrition.js';
import { $, el, ICONS, toast, showFieldError, openModal, closeModal, isModalOpen } from './dom.js';
import { register, render } from './render.js';

const byName = (a, b) => a.name.localeCompare(b.name);
const macroLine = f => `${f.kcal} kcal · P ${f.protein} · K ${f.carbs} · F ${f.fat}`;

function foodMeta(f) {
  return el('div', { class: 'meta' }, macroLine(f) + ' ', el('span', { class: 'tag', text: '/100g' }));
}

// ---------- Liste ----------
function renderFoods() {
  const q = $('#foodSearch').value.trim().toLowerCase();
  const list = db.foods.filter(f => !q || f.name.toLowerCase().includes(q)).sort(byName);
  $('#foodCount').textContent = db.foods.length;
  $('#foodsMeta').textContent = q ? `${list.length} Treffer` : String(list.length);
  if (list.length === 0) {
    $('#foodsList').replaceChildren(el('div', { class: 'empty', html: q
      ? 'Keine Treffer. Mit <b>+</b> legst du es neu an.' : 'Noch keine Lebensmittel. Tippe auf <b>+</b>.' }));
    return;
  }
  $('#foodsList').replaceChildren(...list.map(f => el('div', { class: 'food-row' },
    el('div', {}, el('div', { class: 'name', text: f.name }), foodMeta(f)),
    el('div', { class: 'actions' },
      el('button', { type: 'button', 'aria-label': `${f.name} bearbeiten`,
                     html: ICONS.edit.replace(/14/g, '16'), onclick: () => openEditFood(f) })))));
}

// ---------- Lebensmittel anlegen / bearbeiten ----------
let editingFoodId = null;
const FOOD_FIELDS = { foodName: 'name', foodKcal: 'kcal', foodProtein: 'protein', foodCarbs: 'carbs', foodFat: 'fat' };

export function openCreateFood() {
  editingFoodId = null;
  $('#foodModalTitle').textContent = 'Neues Lebensmittel';
  for (const id of Object.keys(FOOD_FIELDS)) $('#' + id).value = '';
  $('#deleteFood').style.display = 'none';
  openModal('foodModal', '#foodName');
}

function openEditFood(f) {
  editingFoodId = f.id;
  $('#foodModalTitle').textContent = 'Bearbeiten';
  for (const [id, key] of Object.entries(FOOD_FIELDS)) $('#' + id).value = f[key];
  $('#deleteFood').style.display = 'block';
  openModal('foodModal');
}

function saveFood() {
  const name = $('#foodName').value.trim();
  if (!name) return showFieldError($('#foodName'), 'Bitte einen Namen eingeben');
  const data = { name };
  const labels = { kcal: 'Kalorienwert', protein: 'Proteinwert', carbs: 'Kohlenhydratwert', fat: 'Fettwert' };
  for (const [id, key] of Object.entries(FOOD_FIELDS)) {
    if (key === 'name') continue;
    const v = validateNonNegativeFloat($('#' + id).value);
    if (v === null) return showFieldError($('#' + id), `Bitte einen gültigen ${labels[key]} eingeben`);
    data[key] = v;
  }
  if (editingFoodId) {
    const f = db.foods.find(x => x.id === editingFoodId);
    if (f) Object.assign(f, data);
  } else {
    db.foods.push({ id: uid(), ...data });
  }
  save('foods'); closeModal('foodModal');
  render('foods');
  if (isModalOpen('logFoodModal')) renderLogFoodResults();
  toast('Gespeichert');
}

function deleteFood() {
  const idx = db.foods.findIndex(x => x.id === editingFoodId);
  if (idx < 0) return;
  const [removed] = db.foods.splice(idx, 1);
  // Tageseinträge behalten ihre eigene Nährwert-Kopie – vergangene Tage bleiben korrekt.
  save('foods'); closeModal('foodModal'); render('foods');
  toast(`${removed.name} gelöscht`, () => {
    if (!db.foods.some(f => f.id === removed.id)) db.foods.splice(Math.min(idx, db.foods.length), 0, removed);
    save('foods'); render('foods');
  });
}

// Für Scanner: neues Lebensmittel anlegen (oder per Barcode vorhandenes aktualisieren).
export function upsertFood(values, barcode) {
  const existing = barcode ? db.foods.find(f => f.barcode === barcode) : null;
  if (existing) { Object.assign(existing, values); save('foods'); return { food: existing, updated: true }; }
  const food = { id: uid(), ...values };
  if (barcode) food.barcode = barcode;
  db.foods.push(food);
  save('foods');
  return { food, updated: false };
}

// ---------- Mahlzeit: Lebensmittel auswählen ----------
let activeMeal = 'breakfast';

export function openLogFood(meal) {
  activeMeal = meal;
  $('#logFoodTitle').textContent = MEALS.find(m => m.key === meal).label + ' hinzufügen';
  $('#logFoodSearch').value = '';
  renderLogFoodResults();
  openModal('logFoodModal', '#logFoodSearch');
}

export function getActiveMeal() { return activeMeal; }

function renderLogFoodResults() {
  const q = $('#logFoodSearch').value.trim().toLowerCase();
  const list = db.foods.filter(f => !q || f.name.toLowerCase().includes(q)).sort(byName);
  if (list.length === 0) {
    $('#logFoodResults').replaceChildren(el('div', { class: 'empty', text: 'Keine Treffer. Du kannst unten ein neues Lebensmittel anlegen.' }));
    return;
  }
  // Ganze Zeile antippbar (auf dem Handy tippt man meist auf den Namen)
  $('#logFoodResults').replaceChildren(...list.slice(0, 40).map(f => el('div', { class: 'food-row clickable', onclick: () => openPortion(f) },
    el('div', {}, el('div', { class: 'name', text: f.name }), foodMeta(f)),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': `${f.name} auswählen`,
                   html: ICONS.chevron, onclick: ev => { ev.stopPropagation(); openPortion(f); } }))));
}

// ---------- Portion ----------
let portion = null;            // {snapshot, foodId, entryId|null, dateKey}
let portionMode = 'grams';     // 'grams' | 'portions'

function setPortionMode(mode) {
  portionMode = mode;
  $('#portionTabGrams').classList.toggle('active', mode === 'grams');
  $('#portionTabPortions').classList.toggle('active', mode === 'portions');
  $('#portionTabGrams').setAttribute('aria-pressed', String(mode === 'grams'));
  $('#portionTabPortions').setAttribute('aria-pressed', String(mode === 'portions'));
  $('#portionGramsArea').style.display = mode === 'grams' ? 'block' : 'none';
  $('#portionPortionsArea').style.display = mode === 'portions' ? 'block' : 'none';
  updatePortionPreview();
}

function openPortionModal(p, grams) {
  portion = p;
  const s = p.snapshot;
  $('#portionFoodName').textContent = s.name;
  $('#portionFoodMacros').textContent = `${macroLine(s)} pro 100g`;
  $('#portionGrams').value = grams;
  $('#portionCount').value = 1;
  $('#portionSize').value = 100;
  setPortionMode('grams');
  $('#confirmPortion').textContent = p.entryId ? 'Aktualisieren' : 'Hinzufügen';
  $('#deleteLogEntry').style.display = p.entryId ? 'block' : 'none';
  openModal('portionModal', '#portionGrams');
}

export function openPortion(food) {
  closeModal('logFoodModal');
  openPortionModal({ snapshot: nutrientSnapshot(food), foodId: food.id, entryId: null,
                     dateKey: db.state.date, meal: activeMeal }, 100);
}

// Bearbeiten nutzt die gespeicherte Kopie – klappt also auch, wenn das Lebensmittel gelöscht ist.
export function openPortionEdit(entryId) {
  const e = findById(db.log, db.state.date, entryId);
  if (!e) return;
  openPortionModal({ snapshot: nutrientSnapshot(e), foodId: e.foodId, entryId, dateKey: db.state.date }, e.grams);
}

function getPortionGrams() {
  if (portionMode === 'grams') return validateNonNegativeFloat($('#portionGrams').value) || 0;
  const count = validateNonNegativeFloat($('#portionCount').value) || 0;
  const size = validateNonNegativeFloat($('#portionSize').value) || 100;
  return count * size;
}

function updatePortionPreview() {
  if (!portion) return;
  const r = getPortionGrams() / 100;
  const s = portion.snapshot;
  $('#portionKcal').textContent = Math.round(s.kcal * r) + ' kcal';
  $('#portionProtein').textContent = round1(s.protein * r) + ' g';
  $('#portionCarbs').textContent = round1(s.carbs * r) + ' g';
  $('#portionFat').textContent = round1(s.fat * r) + ' g';
}

function confirmPortion() {
  if (!portion) return;              // Doppelklick nach dem Schließen
  const g = getPortionGrams();
  if (!(g > 0)) {
    return showFieldError(portionMode === 'grams' ? $('#portionGrams') : $('#portionCount'), 'Bitte eine Menge angeben');
  }
  const { dateKey, entryId } = portion;
  if (entryId) {
    const e = findById(db.log, dateKey, entryId);
    if (e) e.grams = g;
    toast('Portion aktualisiert');
  } else {
    (db.log[dateKey] ||= []).push({ id: uid(), foodId: portion.foodId, ...portion.snapshot,
                                    grams: g, meal: portion.meal });
    toast('Hinzugefügt');
  }
  portion = null;
  save('log'); closeModal('portionModal'); render('today');
}

function deleteLogEntry() {
  if (!portion?.entryId) return;
  const r = removeById(db.log, portion.dateKey, portion.entryId);
  portion = null;
  closeModal('portionModal');
  if (!r) return;
  save('log'); render('today');
  toast('Eintrag entfernt', () => { r.undo(); save('log'); render('today'); });
}

export function initFoods() {
  $('#cancelFood').addEventListener('click', () => closeModal('foodModal'));
  $('#saveFood').addEventListener('click', saveFood);
  $('#deleteFood').addEventListener('click', deleteFood);
  $('#foodSearch').addEventListener('input', renderFoods);

  $('#logFoodSearch').addEventListener('input', renderLogFoodResults);
  $('#openCreateFood').addEventListener('click', () => { closeModal('logFoodModal'); openCreateFood(); });

  $('#portionTabGrams').addEventListener('click', () => setPortionMode('grams'));
  $('#portionTabPortions').addEventListener('click', () => setPortionMode('portions'));
  for (const id of ['#portionGrams', '#portionCount', '#portionSize']) $(id).addEventListener('input', updatePortionPreview);
  $('#cancelPortion').addEventListener('click', () => { portion = null; closeModal('portionModal'); });
  $('#confirmPortion').addEventListener('click', confirmPortion);
  $('#deleteLogEntry').addEventListener('click', deleteLogEntry);

  register('foods', renderFoods);
}
