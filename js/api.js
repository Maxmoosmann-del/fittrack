// Externe Dienste: OpenFoodFacts (Barcode) und Google Gemini (Foto-Analyse).
import { round1, validateNonNegativeFloat, validatePositiveInt } from './util.js';
import { parseCatalogProduct, dedupeCatalog } from './catalog.js';

// Ohne Timeout dreht sich der Spinner bei schlechtem Netz endlos.
export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Zeitüberschreitung – Verbindung prüfen');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- OpenFoodFacts ----------
export function parseOffProduct(data) {
  if (!data || data.status !== 1 || !data.product) return null;
  const p = data.product;
  const n = p.nutriments || {};
  const kj = n['energy_100g'];
  const kcal = n['energy-kcal_100g'] ?? n['energy-kcal'] ?? (kj ? kj / 4.184 : 0);
  return {
    name:    p.product_name_de || p.product_name || p.brands || 'Unbekanntes Produkt',
    kcal:    Math.round(Number(kcal) || 0),
    protein: round1(Number(n['proteins_100g']) || 0),
    carbs:   round1(Number(n['carbohydrates_100g']) || 0),
    fat:     round1(Number(n['fat_100g']) || 0)
  };
}

export async function lookupBarcode(barcode) {
  const res = await fetchWithTimeout(
    `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`);
  if (!res.ok) throw new Error('Netzwerkfehler');
  return parseOffProduct(await res.json());
}

// Volltextsuche in Open Food Facts, auf in Deutschland verkaufte Produkte beschränkt,
// beliebteste zuerst. Nur auf Knopfdruck (OFF erlaubt ~10 Suchen pro Minute).
// (Die neuere search.openfoodfacts.org erlaubt keine Browser-Anfragen/CORS – daher search.pl.)
export async function searchOnline(query) {
  const terms = query.trim();
  if (!terms) return [];
  const params = new URLSearchParams({
    search_terms: terms, search_simple: '1', action: 'process', json: '1', page_size: '40',
    sort_by: 'unique_scans_n', tagtype_0: 'countries', tag_contains_0: 'contains', tag_0: 'germany',
    fields: 'code,product_name_de,product_name,brands,stores_tags,nutriments'
  });
  const url = `https://world.openfoodfacts.org/cgi/search.pl?${params}`;
  let res;
  // Ist OFF überlastet, fehlt der Fehlerantwort der CORS-Header und fetch wirft nur
  // "Failed to fetch". Einmal kurz warten und erneut versuchen, dann klar melden.
  for (let attempt = 1; ; attempt++) {
    try { res = await fetchWithTimeout(url, {}, 25000); break; }
    catch (err) {
      if (attempt >= 2) throw new Error(/Zeitüberschreitung/.test(err.message) ? err.message : 'Open Food Facts nicht erreichbar – gleich nochmal versuchen');
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  if (res.status === 429) throw new Error('Zu viele Suchen – kurz warten');
  if (res.status >= 500) throw new Error('Open Food Facts gerade überlastet');
  if (!res.ok) throw new Error('Open Food Facts nicht erreichbar');
  const data = await res.json();
  return dedupeCatalog((data.products || []).map(parseCatalogProduct).filter(Boolean)).slice(0, 25);
}

// ---------- Gemini ----------
export const GEMINI_PROMPT_MEAL = 'Analysiere diese Mahlzeit. Antworte NUR mit einem JSON-Objekt: {"name":"Name auf Deutsch","kcal":500,"protein":25,"carbs":60,"fat":15,"grams":350}. Schätze Gesamtwerte für die sichtbare Portion.';
export const GEMINI_PROMPT_LABEL = 'Lies die Nährwerttabelle. Antworte NUR mit einem JSON-Objekt: {"name":"Produktname","kcal":100,"protein":5,"carbs":12,"fat":3}. Alle Werte pro 100g.';

// Robust gegen Markdown-Zäune o. Ä.: erstes {...} herausschneiden.
export function parseGeminiJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Keine Nährwerte erkannt');
  const obj = JSON.parse(text.slice(start, end + 1));
  return {
    name:    typeof obj.name === 'string' ? obj.name : '',
    kcal:    validateNonNegativeFloat(obj.kcal) ?? 0,
    protein: validateNonNegativeFloat(obj.protein) ?? 0,
    carbs:   validateNonNegativeFloat(obj.carbs) ?? 0,
    fat:     validateNonNegativeFloat(obj.fat) ?? 0,
    grams:   validatePositiveInt(obj.grams)
  };
}

// Key im Header statt in der URL – so landet er nicht im Verlauf oder in Logs.
export async function askGemini({ key, model, base64, mime, prompt }) {
  if (!key) throw new Error('Kein API-Key hinterlegt');
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: mime, data: base64 } }, { text: prompt }] }],
        // JSON-Modus statt Regex-Raten. Großzügiges Token-Limit, weil neuere
        // Modelle vor der Antwort "denken" und das Budget sonst aufbrauchen.
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' }
      })
    },
    45000
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error(`Modell "${model}" nicht gefunden – in den Einstellungen ändern`);
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  return parseGeminiJson(text);
}

// ---------- Bild vorbereiten (Browser) ----------
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
    r.readAsDataURL(file);
  });
}

// Handyfotos sind schnell 4–8 MB. Vor dem Upload auf max. 1024 px verkleinern.
export async function prepareImage(file, maxSize = 1024) {
  const dataUrl = await readFileAsDataURL(file);
  const mime = (dataUrl.match(/data:([^;]+)/) || [, 'image/jpeg'])[1];
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Format nicht lesbar'));
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    if (scale === 1 && dataUrl.length < 1.5e6) return { dataUrl, base64: dataUrl.split(',')[1], mime };
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', 0.85);
    return { dataUrl: out, base64: out.split(',')[1], mime: 'image/jpeg' };
  } catch {
    return { dataUrl, base64: dataUrl.split(',')[1], mime };   // exotisches Format: unverändert
  }
}
