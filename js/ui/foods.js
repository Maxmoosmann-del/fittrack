// Tab "Lebensmittel" + Modals: Lebensmittel anlegen/bearbeiten, Mahlzeit wählen, Portion.
import { db, save, findById, removeById } from '../store.js';
import { uid, round1, validateNonNegativeFloat } from '../util.js';
import { MEALS, nutrientSnapshot } from '../nutrition.js';
import { loadCatalog, searchCatalog, catalogLabel } from '../catalog.js';
import { recentFoods, relativeDay } from '../stats.js';
import { searchOnline } from '../api.js';
import { $, el, ICONS, toast, showFieldError, openModal, closeModal, isModalOpen } from './dom.js';
import { register, render } from './render.js';

const byName = (a, b) => a.name.localeCompare(b.name);
const macroLine = f => `${f.kcal} kcal · P ${f.protein} · K ${f.carbs} · F ${f.fat}`;

function foodMeta(f) {
  return el('div', { class: 'meta' }, macroLine(f) + ' ', el('span', { class: 'tag', text: '/100g' }));
}

// ---------- Katalog (Supermarktprodukte, offline) + Online-Suche ----------

// Katalogprodukt in die eigenen Lebensmittel übernehmen. Schon vorhanden (gleicher
// Barcode)? Dann das eigene nehmen – evtl. selbst korrigierte Werte bleiben erhalten.
function adoptProduct(it) {
  const existing = db.foods.find(f => f.barcode === it.code);
  if (existing) return existing;
  const food = { id: uid(), name: catalogLabel(it), kcal: it.kcal, protein: it.protein,
                 carbs: it.carbs, fat: it.fat, barcode: it.code };
  db.foods.push(food);
  save('foods');
  return food;
}

function productRow(it, tagText, onPick) {
  const stores = it.stores?.length ? ` · ${it.stores.join('/')}` : '';
  return el('div', { class: 'food-row clickable', onclick: () => onPick(it) },
    el('div', {},
      el('div', { class: 'name', text: catalogLabel(it) }),
      el('div', { class: 'meta' }, `${macroLine(it)}${stores} `, el('span', { class: 'tag', text: '/100g' }))),
    el('span', { class: 'tag source-tag', text: tagText }));
}

// Katalog-Treffer, die man nicht schon als eigenes Lebensmittel hat
async function catalogHits(q, limit) {
  const own = new Set(db.foods.map(f => f.barcode).filter(Boolean));
  return searchCatalog(await loadCatalog(), q, limit + own.size).filter(it => !own.has(it.code)).slice(0, limit);
}

function onlineButton(q, target, onPick) {
  const btn = el('button', { class: 'btn-line', type: 'button', text: `⌕ „${q}“ online suchen (Open Food Facts)` });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Suche läuft…';
    try {
      const found = await searchOnline(q);
      const own = new Set(db.foods.map(f => f.barcode).filter(Boolean));
      const rows = found.filter(it => !own.has(it.code)).map(it => productRow(it, 'ONLINE', onPick));
      btn.replaceWith(el('h2', { class: 'sec' }, '// Online', el('span', { class: 'sec-meta', text: String(rows.length) })),
        ...(rows.length ? rows : [el('div', { class: 'empty', text: 'Online nichts gefunden. Lege es mit + selbst an oder scanne den Barcode.' })]));
    } catch (err) {
      btn.disabled = false;
      btn.textContent = `⌕ Erneut versuchen – ${err.message}`;
    }
  });
  target.append(btn);
}

// ---------- Liste ----------
let foodsRenderSeq = 0;
function renderFoods() {
  const q = $('#foodSearch').value.trim().toLowerCase();
  const list = db.foods.filter(f => !q || f.name.toLowerCase().includes(q)).sort(byName);
  $('#foodCount').textContent = db.foods.length;
  $('#foodsMeta').textContent = q ? `${list.length} Treffer` : String(list.length);
  const box = $('#foodsList');
  box.replaceChildren(...(list.length ? list.map(f => el('div', { class: 'food-row' },
    el('div', {}, el('div', { class: 'name', text: f.name }), foodMeta(f)),
    el('div', { class: 'actions' },
      el('button', { type: 'button', 'aria-label': `${f.name} bearbeiten`,
                     html: ICONS.edit.replace(/14/g, '16'), onclick: () => openEditFood(f) }))))
    : [el('div', { class: 'empty', html: q ? 'Nicht in deiner Liste.' : 'Noch keine Lebensmittel. Tippe auf <b>+</b>.' })]));

  // Katalog asynchron anhängen (erste Suche lädt die Datei einmalig)
  const seq = ++foodsRenderSeq;
  const pick = it => { const f = adoptProduct(it); renderFoods(); toast(`${f.name} übernommen`); };
  (async () => {
    if (!q) {
      const n = (await loadCatalog()).length;
      if (seq === foodsRenderSeq && n) box.append(el('div', { class: 'hint catalog-hint',
        text: `+ ${n} Supermarktprodukte im Katalog – oben suchen, antippen übernimmt sie.` }));
      return;
    }
    const hits = await catalogHits(q, 30);
    if (seq !== foodsRenderSeq) return;            // inzwischen weitergetippt
    if (hits.length) box.append(el('h2', { class: 'sec' }, '// Katalog', el('span', { class: 'sec-meta', text: String(hits.length) })),
                                ...hits.map(it => productRow(it, 'KATALOG', pick)));
    if (q.length >= 3) onlineButton(q, box, pick);
  })();
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

// ---------- Zuletzt gegessen ----------
// Werte: aktuelles eigenes Lebensmittel (falls inzwischen korrigiert), sonst die Kopie vom letzten Mal.
function recentAsFood(r) {
  const own = r.foodId && db.foods.find(f => f.id === r.foodId);
  return own || { id: r.foodId || '', name: r.name, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat };
}

function quickAdd(r) {
  const food = recentAsFood(r);
  const dateKey = db.state.date;
  const entry = { id: uid(), foodId: food.id, ...nutrientSnapshot(food), grams: r.grams, meal: activeMeal };
  (db.log[dateKey] ||= []).push(entry);
  save('log'); closeModal('logFoodModal'); render('today');
  toast(`${food.name} · ${r.grams} g eingetragen`, () => { removeById(db.log, dateKey, entry.id); save('log'); render('today'); });
}

function recentSection() {
  const recent = recentFoods(db.log, db.state.date, 10);
  if (!recent.length) return [];
  return [
    el('h2', { class: 'sec' }, '// Zuletzt', el('span', { class: 'sec-meta', text: String(recent.length) })),
    ...recent.map(r => {
      const food = recentAsFood(r);
      const kcal = Math.round(food.kcal * r.grams / 100);
      return el('div', { class: 'food-row clickable', onclick: () => openPortion(food, r.grams) },
        el('div', {},
          el('div', { class: 'name', text: food.name }),
          el('div', { class: 'meta', text: `${r.grams} g · ${kcal} kcal · ${relativeDay(r.date, db.state.date)}` })),
        el('button', { class: 'quick-add', type: 'button', text: `+ ${r.grams} g`,
                       'aria-label': `${food.name}, ${r.grams} g sofort eintragen`,
                       onclick: ev => { ev.stopPropagation(); quickAdd(r); } }));
    }),
    el('h2', { class: 'sec' }, '// Deine Liste', el('span', { class: 'sec-meta', text: String(db.foods.length) }))
  ];
}

let logRenderSeq = 0;
function renderLogFoodResults() {
  const q = $('#logFoodSearch').value.trim().toLowerCase();
  const list = db.foods.filter(f => !q || f.name.toLowerCase().includes(q)).sort(byName);
  const box = $('#logFoodResults');
  // Ganze Zeile antippbar (auf dem Handy tippt man meist auf den Namen)
  box.replaceChildren(...(q ? [] : recentSection()),
    ...(list.length ? list.slice(0, 40).map(f => el('div', { class: 'food-row clickable', onclick: () => openPortion(f) },
    el('div', {}, el('div', { class: 'name', text: f.name }), foodMeta(f)),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': `${f.name} auswählen`,
                   html: ICONS.chevron, onclick: ev => { ev.stopPropagation(); openPortion(f); } })))
    : [el('div', { class: 'empty', text: q ? 'Nicht in deiner Liste.' : 'Noch keine Lebensmittel.' })]));
  if (!q) return;

  const seq = ++logRenderSeq;
  const pick = it => openPortion(adoptProduct(it));
  (async () => {
    const hits = await catalogHits(q, 25);
    if (seq !== logRenderSeq) return;
    if (hits.length) box.append(el('h2', { class: 'sec' }, '// Katalog', el('span', { class: 'sec-meta', text: String(hits.length) })),
                                ...hits.map(it => productRow(it, 'KATALOG', pick)));
    if (q.length >= 3) onlineButton(q, box, pick);
  })();
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

export function openPortion(food, grams = 100) {
  closeModal('logFoodModal');
  openPortionModal({ snapshot: nutrientSnapshot(food), foodId: food.id, entryId: null,
                     dateKey: db.state.date, meal: activeMeal }, grams);
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
