// Produktkatalog deutscher Supermarktprodukte (Quelle: Open Food Facts, ODbL).
// Reine Logik ohne DOM – genutzt von der App UND vom Build-Skript tools/build-catalog.mjs.
import { round1 } from './util.js';

export const CATALOG_URL = 'data/catalog-de.json';
export const CATALOG_FIELDS = ['code', 'name', 'brand', 'stores', 'kcal', 'protein', 'carbs', 'fat'];

// Ladenketten, die wir aus den Open-Food-Facts-Tags erkennen
const STORES = [
  [/^lidl/, 'Lidl'], [/^aldi/, 'Aldi'], [/^rewe/, 'Rewe'], [/^edeka/, 'Edeka'],
  [/^kaufland/, 'Kaufland'], [/^penny/, 'Penny'], [/^netto/, 'Netto'], [/^norma/, 'Norma'],
  [/^dm($|-)/, 'dm'], [/^rossmann/, 'Rossmann'], [/^globus/, 'Globus'], [/^real($|-)/, 'Real']
];

// Eigenmarken der Ketten – Ladenangaben fehlen in Open Food Facts oft, die Marke nicht.
const HOUSE_BRANDS = {
  Lidl: ['milbona', 'alesto', 'crownfield', 'pilos', 'freeway', 'solevita', 'gelatelli', 'fin carre',
         'chef select', 'vemondo', 'snack day', 'combino', 'deluxe', 'lidl'],
  Aldi: ['milsani', 'gut bio', 'moser roth', 'choceur', 'golden bridge', 'lyttos', 'cucina nobile',
         'happy harvest', 'le gusto', 'aldi'],
  Rewe: ['ja!', 'rewe beste wahl', 'rewe bio', 'rewe'],
  Edeka: ['gut & gunstig', 'gut & guenstig', 'edeka bio', 'edeka'],
  Kaufland: ['k-classic', 'k-bio', 'kaufland'],
  Penny: ['penny', 'naturgut']
};
const brandKey = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export function storesFromTags(tags = [], brands = []) {
  const out = new Set();
  for (const t of tags) for (const [re, name] of STORES) if (re.test(String(t))) out.add(name);
  for (const b of brands.map(brandKey)) {
    for (const [store, list] of Object.entries(HOUSE_BRANDS)) if (list.includes(b)) out.add(store);
  }
  return [...out];
}

const brandList = b => (Array.isArray(b) ? b : String(b || '').split(',')).map(s => String(s).trim()).filter(Boolean);

const num = v => (v === '' || v === null || v === undefined ? NaN : Number(v));

// Ein Produkt aus der Open-Food-Facts-API prüfen und in unser Format bringen.
// Gibt null zurück, wenn Name oder Nährwerte fehlen oder unplausibel sind.
export function parseCatalogProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const name = String(p.product_name_de || p.product_name || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) return null;
  const n = p.nutriments || {};
  let kcal = num(n['energy-kcal_100g']);
  if (!Number.isFinite(kcal) && Number.isFinite(num(n['energy_100g']))) kcal = num(n['energy_100g']) / 4.184;
  const protein = num(n.proteins_100g), carbs = num(n.carbohydrates_100g), fat = num(n.fat_100g);
  if (![kcal, protein, carbs, fat].every(v => Number.isFinite(v) && v >= 0)) return null;
  if (kcal > 950 || protein + carbs + fat > 105) return null;
  // Kalorien müssen grob zu den Makros passen (Ballaststoffe/Alkohol großzügig toleriert)
  const est = 4 * protein + 4 * carbs + 9 * fat;
  if (Math.abs(est - kcal) > Math.max(45, 0.35 * kcal)) return null;
  const code = String(p.code || '').replace(/\D/g, '');
  if (code.length < 8) return null;
  const brands = brandList(p.brands);
  // Erste Marke, die keine reine Ladenkette ist ("Milbona, Lidl" → Milbona)
  const brand = (brands.find(b => !/^(lidl|aldi|rewe|edeka|kaufland|penny|netto)$/i.test(b)) || brands[0] || '').slice(0, 40);
  return {
    code, name, brand,
    stores: storesFromTags(p.stores_tags || [], brands),
    kcal: Math.round(kcal), protein: round1(protein), carbs: round1(carbs), fat: round1(fat)
  };
}

const norm = s => String(s).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

// Doppelte entfernen (gleicher Barcode oder gleicher Name + Marke); Reihenfolge = Beliebtheit.
export function dedupeCatalog(items) {
  const codes = new Set(), keys = new Set(), out = [];
  for (const it of items) {
    const key = norm(it.name + '|' + it.brand);
    if (codes.has(it.code) || keys.has(key)) continue;
    codes.add(it.code); keys.add(key); out.push(it);
  }
  return out;
}

// Kompaktes Dateiformat: Kopfzeile + Zeilen-Arrays (spart ~40 % gegenüber Objekten)
export function packCatalog(items, meta) {
  return { ...meta, fields: CATALOG_FIELDS, rows: items.map(it => CATALOG_FIELDS.map(f => it[f])) };
}

export function unpackCatalog(data) {
  const f = data?.fields;
  if (!Array.isArray(f) || !Array.isArray(data.rows)) return [];
  return data.rows.map((r, i) => {
    const it = Object.fromEntries(f.map((k, j) => [k, r[j]]));
    it.search = norm(`${it.name} ${it.brand} ${(it.stores || []).join(' ')}`);
    it.rank = i;
    return it;
  });
}

// Suche: alle Wörter müssen vorkommen; Treffer am Namensanfang zuerst, sonst Beliebtheit.
export function searchCatalog(items, query, limit = 30) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const it of items) {
    if (!words.every(w => it.search.includes(w))) continue;
    const nameN = norm(it.name);
    const score = (nameN.startsWith(words[0]) ? 0 : new RegExp('\\b' + words[0]).test(nameN) ? 1 : 2);
    hits.push([score, it.rank, it]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return hits.slice(0, limit).map(h => h[2]);
}

export function catalogLabel(it) {
  return it.brand && !norm(it.name).includes(norm(it.brand)) ? `${it.name} (${it.brand})` : it.name;
}

// ---------- Laden im Browser (einmal, dann im Speicher) ----------
let loaded = null;
export function loadCatalog(fetchFn = globalThis.fetch) {
  loaded ||= fetchFn(CATALOG_URL)
    .then(r => (r.ok ? r.json() : null))
    .then(d => (d ? unpackCatalog(d) : []))
    .catch(() => { loaded = null; return []; });
  return loaded;
}
