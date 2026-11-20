// Tests für den Produktkatalog (Open-Food-Facts-Daten prüfen, packen, durchsuchen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogProduct, dedupeCatalog, packCatalog, unpackCatalog, searchCatalog,
         storesFromTags, catalogLabel, loadCatalog } from '../js/catalog.js';

const off = (over = {}) => ({
  code: '4000417025005', product_name_de: 'Skyr Natur', brands: 'Milbona, Lidl',
  stores_tags: ['lidl', 'lidl-deutschland'],
  nutriments: { 'energy-kcal_100g': 63, proteins_100g: 11, carbohydrates_100g: 4, fat_100g: 0.2 },
  ...over
});

test('parseCatalogProduct: gültiges Produkt', () => {
  assert.deepEqual(parseCatalogProduct(off()), {
    code: '4000417025005', name: 'Skyr Natur', brand: 'Milbona', stores: ['Lidl'],
    kcal: 63, protein: 11, carbs: 4, fat: 0.2
  });
});

test('parseCatalogProduct: lehnt unvollständige und unplausible Daten ab', () => {
  assert.equal(parseCatalogProduct(off({ product_name_de: '', product_name: '' })), null);
  assert.equal(parseCatalogProduct(off({ nutriments: { 'energy-kcal_100g': 63, proteins_100g: 11, carbohydrates_100g: 4 } })), null);
  assert.equal(parseCatalogProduct(off({ nutriments: { 'energy-kcal_100g': 900, proteins_100g: 1, carbohydrates_100g: 1, fat_100g: 1 } })), null); // kcal passt nicht zu Makros
  assert.equal(parseCatalogProduct(off({ nutriments: { 'energy-kcal_100g': 2000, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 222 } })), null);
  assert.equal(parseCatalogProduct(off({ code: '123' })), null);
  assert.equal(parseCatalogProduct(null), null);
});

test('parseCatalogProduct: kJ wird umgerechnet, Name ohne de-Feld', () => {
  const p = parseCatalogProduct(off({ product_name_de: undefined, product_name: 'Haferflocken',
    nutriments: { energy_100g: 1550, proteins_100g: 13.5, carbohydrates_100g: 58.7, fat_100g: 7 } }));
  assert.equal(p.name, 'Haferflocken');
  assert.equal(p.kcal, 370);
});

test('storesFromTags erkennt Ketten', () => {
  assert.deepEqual(storesFromTags(['aldi-sud', 'rewe', 'dm-drogerie-markt', 'unbekannt', 'aldi-nord']), ['Aldi', 'Rewe', 'dm']);
});

test('dedupe nach Barcode und Name+Marke, Reihenfolge bleibt', () => {
  const a = parseCatalogProduct(off());
  const b = { ...a, code: '1111111111111' };                 // gleicher Name+Marke
  const c = { ...a, code: '2222222222222', name: 'Skyr Vanille' };
  assert.deepEqual(dedupeCatalog([a, a, b, c]).map(x => x.code), [a.code, c.code]);
});

test('pack → unpack ist verlustfrei', () => {
  const items = [parseCatalogProduct(off())];
  const back = unpackCatalog(JSON.parse(JSON.stringify(packCatalog(items, { builtAt: 'x' }))));
  const { search, rank, ...plain } = back[0];
  assert.deepEqual(plain, items[0]);
  assert.equal(rank, 0);
});

test('searchCatalog: alle Wörter, Umlaute egal, Namensanfang zuerst, sonst Beliebtheit', () => {
  const mk = (code, name, brand = '') => ({ code, name, brand, stores: [], kcal: 1, protein: 0, carbs: 0, fat: 0 });
  const items = unpackCatalog(packCatalog([
    mk('1', 'Frucht Müsli', 'Kölln'), mk('2', 'Müsli Schoko', 'Seitenbacher'), mk('3', 'Joghurt'), mk('4', 'Muesli Nuss', 'Kölln')
  ], {}));
  assert.deepEqual(searchCatalog(items, 'müsli').map(i => i.code), ['2', '4', '1']);
  assert.deepEqual(searchCatalog(items, 'muesli koelln').map(i => i.code), ['4', '1']);
  assert.deepEqual(searchCatalog(items, ''), []);
  assert.deepEqual(searchCatalog(items, 'pizza'), []);
});

test('catalogLabel hängt die Marke nur an, wenn sie nicht schon im Namen steht', () => {
  assert.equal(catalogLabel({ name: 'Skyr Natur', brand: 'Milbona' }), 'Skyr Natur (Milbona)');
  assert.equal(catalogLabel({ name: 'Nutella', brand: 'Nutella' }), 'Nutella');
  assert.equal(catalogLabel({ name: 'Brot', brand: '' }), 'Brot');
});

test('loadCatalog: Netzfehler liefert leere Liste statt Absturz', async () => {
  assert.deepEqual(await loadCatalog(() => Promise.reject(new Error('offline'))), []);
});

test('Gebaute Katalogdatei (falls vorhanden) ist gültig', async () => {
  const { readFile } = await import('node:fs/promises');
  let data;
  try { data = JSON.parse(await readFile(new URL('../data/catalog-de.json', import.meta.url), 'utf8')); }
  catch { return; }                                           // noch nicht gebaut
  const items = unpackCatalog(data);
  assert.ok(items.length > 100, 'zu wenige Produkte');
  for (const it of items) {
    assert.ok(it.name && it.code.length >= 8);
    for (const k of ['kcal', 'protein', 'carbs', 'fat']) assert.ok(Number.isFinite(it[k]) && it[k] >= 0, `${it.name}: ${k}`);
  }
  assert.equal(new Set(items.map(i => i.code)).size, items.length, 'doppelte Barcodes');
});

test('Eigenmarken ergeben den Laden; Kettenname wird nicht als Marke genommen', () => {
  assert.deepEqual(storesFromTags([], ['Milsani']), ['Aldi']);
  assert.deepEqual(storesFromTags([], ['ja!']), ['Rewe']);
  assert.deepEqual(storesFromTags([], ['Gut & Günstig']), ['Edeka']);
  const p = parseCatalogProduct(off({ brands: ['Lidl', 'Milbona'], stores_tags: [] }));
  assert.equal(p.brand, 'Milbona');
  assert.deepEqual(p.stores, ['Lidl']);
});
