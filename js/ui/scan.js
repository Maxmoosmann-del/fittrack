// Barcode-Scanner (Kamera + OpenFoodFacts) und KI-Scanner (Gemini).
import { db, save } from '../store.js';
import { uid, validateNonNegativeFloat, validatePositiveInt } from '../util.js';
import { per100g } from '../nutrition.js';
import { lookupBarcode, askGemini, prepareImage, GEMINI_PROMPT_MEAL, GEMINI_PROMPT_LABEL } from '../api.js';
import { $, toast, showFieldError, openModal, closeModal, onModalClose, isModalOpen } from './dom.js';
import { render } from './render.js';
import { upsertFood, openPortion } from './foods.js';
import { openSettings, getGeminiKey, getGeminiModel } from './settings.js';

const display = (id, value) => { $('#' + id).style.display = value; };

// ---------- Barcode ----------
let stream = null;
let scanActive = false;
let context = 'foods';        // 'foods' | 'log'
let currentBarcode = null;    // gefundener Code – zum Wiedererkennen beim nächsten Scan

function stopCamera() {
  scanActive = false;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  $('#barcodeVideo').srcObject = null;
}

const BARCODE_PANES = ['barcodeViewfinder', 'barcodeHint', 'barcodeManual', 'barcodeLoading', 'barcodeResult'];
function showPane(...visible) {
  for (const id of BARCODE_PANES) display(id, visible.includes(id) ? 'block' : 'none');
}

function fillResult(p) {
  $('#barcodeProductName').value = p.name || '';
  $('#barcodeKcal').value = p.kcal || 0;
  $('#barcodeProtein').value = p.protein || 0;
  $('#barcodeCarbs').value = p.carbs || 0;
  $('#barcodeFat').value = p.fat || 0;
  showPane('barcodeResult');
}

function loading(text) {
  $('#barcodeLoadingText').textContent = text;
  showPane('barcodeLoading');
}

async function handleBarcode(code) {
  stopCamera();
  currentBarcode = code;
  loading('Produkt wird gesucht…');
  try {
    const product = await lookupBarcode(code);
    if (product) return fillResult(product);
    showPane('barcodeManual');
    toast('Barcode nicht in Datenbank – bitte manuell eingeben');
  } catch (err) {
    showPane('barcodeManual');
    toast('Suche fehlgeschlagen: ' + err.message);
  }
}

async function startScanner() {
  if (!('BarcodeDetector' in window)) return showPane('barcodeManual');
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    // Modal schon wieder zu, während die Kamera-Freigabe lief? Dann sofort aus.
    if (!isModalOpen('barcodeModal')) { s.getTracks().forEach(t => t.stop()); return; }
    stream = s;
    const video = $('#barcodeVideo');
    video.srcObject = stream;
    await video.play();
    showPane('barcodeViewfinder', 'barcodeHint');
    scanActive = true;
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
    const tick = async () => {
      if (!scanActive) return;
      try {
        if (video.readyState >= 2) {
          const codes = await detector.detect(video);
          if (codes.length > 0) return handleBarcode(codes[0].rawValue);
        }
      } catch { /* einzelnes Frame unlesbar – weiter versuchen */ }
      setTimeout(tick, 250);
    };
    tick();
  } catch {
    showPane('barcodeManual');
    toast('Kamerazugriff verweigert');
  }
}

function openBarcode(ctx) {
  context = ctx;
  currentBarcode = null;
  showPane();
  $('#barcodeManualInput').value = '';
  openModal('barcodeModal');
  startScanner();
}

function confirmBarcode() {
  const name = $('#barcodeProductName').value.trim();
  if (!name) return showFieldError($('#barcodeProductName'), 'Bitte Namen eingeben');
  const values = { name };
  for (const k of ['Kcal', 'Protein', 'Carbs', 'Fat']) {
    values[k.toLowerCase()] = validateNonNegativeFloat($('#barcode' + k).value) ?? 0;
  }
  // Wiedererkennung nur über den Barcode – nicht über den Namen, sonst würden
  // eigene Lebensmittel mit gleichem Namen überschrieben.
  const { food, updated } = upsertFood(values, currentBarcode);
  closeModal('barcodeModal');
  if (context === 'log') openPortion(food);
  else { render('foods'); toast(`${food.name} ${updated ? 'aktualisiert' : 'gespeichert'}`); }
}

async function onLabelPhoto(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!getGeminiKey()) {
    toast('Bitte zuerst Gemini API-Key in den Einstellungen eingeben');
    closeModal('barcodeModal'); return openSettings();
  }
  stopCamera();
  currentBarcode = null;
  loading('KI liest Nährwerttabelle…');
  try {
    const img = await prepareImage(file);
    fillResult(await askGemini({ key: getGeminiKey(), model: getGeminiModel(),
                                 base64: img.base64, mime: img.mime, prompt: GEMINI_PROMPT_LABEL }));
  } catch (err) {
    showPane('barcodeManual');
    toast('Fehler: ' + err.message);
  }
}

// ---------- KI-Scanner (Mahlzeit fotografieren) ----------
let scanImage = null;

function resetScan() {
  scanImage = null;
  display('scanPreview', 'none');
  display('scanUploadArea', 'block');
  display('scanAnalyse', 'none');
  display('scanLoading', 'none');
  display('scanResults', 'none');
  $('#scanFile').value = '';
}

async function onMealPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    scanImage = await prepareImage(file);
    $('#scanPreview').src = scanImage.dataUrl;
    display('scanPreview', 'block');
    display('scanAnalyse', 'flex');
  } catch (err) {
    toast('Fehler: ' + err.message);
  }
}

async function analyseMeal() {
  if (!scanImage) return;
  display('scanUploadArea', 'none');
  display('scanAnalyse', 'none');
  display('scanLoading', 'block');
  try {
    const r = await askGemini({ key: getGeminiKey(), model: getGeminiModel(),
                                base64: scanImage.base64, mime: scanImage.mime, prompt: GEMINI_PROMPT_MEAL });
    $('#scanName').value = r.name;
    $('#scanKcal').value = r.kcal;
    $('#scanGrams').value = r.grams ?? 100;
    $('#scanProtein').value = r.protein;
    $('#scanCarbs').value = r.carbs;
    $('#scanFat').value = r.fat;
    display('scanResults', 'block');
  } catch (err) {
    display('scanUploadArea', 'block');
    display('scanAnalyse', 'flex');
    toast('Fehler: ' + err.message);
  } finally {
    display('scanLoading', 'none');
  }
}

function confirmMeal() {
  const name = $('#scanName').value.trim();
  if (!name) return showFieldError($('#scanName'), 'Bitte einen Namen eingeben');
  const grams = validateNonNegativeFloat($('#scanGrams').value);
  if (!(grams > 0)) return showFieldError($('#scanGrams'), 'Bitte eine Portionsgröße eingeben');
  const totals = {};
  for (const k of ['Kcal', 'Protein', 'Carbs', 'Fat']) totals[k.toLowerCase()] = validateNonNegativeFloat($('#scan' + k).value) ?? 0;
  const food = { id: uid(), name, ...per100g(totals, grams) };
  db.foods.push(food);
  const { id: foodId, ...snapshot } = food;
  (db.log[db.state.date] ||= []).push({ id: uid(), foodId, ...snapshot, grams, meal: $('#scanMealSelect').value });
  save('foods', 'log'); closeModal('scanModal'); render('today', 'foods');
  toast(`${name} hinzugefügt`);
}

export function initScan() {
  onModalClose('barcodeModal', stopCamera);
  // Kamera nicht weiterlaufen lassen, wenn die App in den Hintergrund geht
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  window.addEventListener('pagehide', stopCamera);

  $('#barcodeFoodsBtn').addEventListener('click', () => openBarcode('foods'));
  $('#barcodeFoodLogBtn').addEventListener('click', () => { closeModal('logFoodModal'); openBarcode('log'); });
  $('#barcodeManualSearch').addEventListener('click', () => {
    const code = $('#barcodeManualInput').value.trim();
    if (!code) return showFieldError($('#barcodeManualInput'), 'Bitte Barcode eingeben');
    handleBarcode(code);
  });
  $('#barcodeManualInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#barcodeManualSearch').click(); });
  $('#barcodeScanAgain').addEventListener('click', () => { currentBarcode = null; startScanner(); });
  $('#barcodeConfirm').addEventListener('click', confirmBarcode);
  $('#barcodeLabelFile').addEventListener('change', onLabelPhoto);

  $('#scanBtn').addEventListener('click', () => {
    if (!getGeminiKey()) { toast('Bitte zuerst Gemini API-Key in den Einstellungen eingeben'); return openSettings(); }
    resetScan();
    openModal('scanModal');
  });
  $('#scanFile').addEventListener('change', onMealPhoto);
  $('#scanAnalyse').addEventListener('click', analyseMeal);
  $('#scanReset').addEventListener('click', resetScan);
  $('#scanConfirm').addEventListener('click', confirmMeal);
}
