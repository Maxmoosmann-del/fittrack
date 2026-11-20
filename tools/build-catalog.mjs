// Baut data/catalog-de.json + data/KATALOG.md aus Open Food Facts.
// Holt Produkte des deutschen Markts (Hauptsprache Deutsch, in Deutschland verkauft),
// sortiert nach Beliebtheit, und behält nur solche mit vollständigen, plausiblen Nährwerten.
//
//   node tools/build-catalog.mjs [Zielanzahl=2500]
//
// Nutzt die Such-API search.openfoodfacts.org (die alte /api/v2/search ist oft überlastet).
// Jede Seite wird zwischengespeichert – ein Abbruch kostet beim nächsten Lauf nichts.
// Daten: © Open Food Facts contributors, Lizenz ODbL (https://opendatacommons.org/licenses/odbl/1-0/)
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCatalogProduct, dedupeCatalog, packCatalog, catalogLabel } from '../js/catalog.js';

const TARGET = Number(process.argv[2]) || 2500;
const PAGE_SIZE = 100;
const MAX_PAGES = 60;
const PAUSE_MS = 1500;
const UA = 'FitTrack-Catalog-Builder/1.0 (open-source PWA)';
const QUERY = 'countries_tags:"en:germany" AND lang:de';
const FIELDS = 'code,product_name,brands,stores_tags,nutriments';
const OUT = new URL('../data/', import.meta.url);
const CACHE_DIR = join(tmpdir(), 'fittrack-catalog-cache');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(page, attempt = 1) {
  const cacheFile = join(CACHE_DIR, `page-${page}.json`);
  try { return JSON.parse(await readFile(cacheFile, 'utf8')); } catch { /* nicht im Cache */ }
  const params = new URLSearchParams({ q: QUERY, sort_by: '-unique_scans_n', page_size: String(PAGE_SIZE),
                                       page: String(page), fields: FIELDS, langs: 'de' });
  try {
    const res = await fetch(`https://search.openfoodfacts.org/search?${params}`,
                            { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
    if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' (kein Retry)');
    const hits = (await res.json()).hits || [];
    await writeFile(cacheFile, JSON.stringify(hits));
    await sleep(PAUSE_MS);
    return hits;
  } catch (err) {
    if (attempt >= 5 || /kein Retry/.test(err.message)) throw err;
    const wait = 5000 * 2 ** attempt;
    console.log(`  Seite ${page}: ${err.message} – neuer Versuch in ${wait / 1000}s`);
    await sleep(wait);
    return fetchPage(page, attempt + 1);
  }
}

await mkdir(CACHE_DIR, { recursive: true });
let raw = 0, items = [], complete = true;
for (let page = 1; page <= MAX_PAGES && items.length < TARGET; page++) {
  let products;
  try {
    products = await fetchPage(page);
  } catch (err) {
    // Server dauerhaft gestört: mit dem bisher Geholten weitermachen statt alles zu verlieren
    console.log(`Seite ${page} endgültig fehlgeschlagen (${err.message}) – speichere ${items.length} Produkte.`);
    complete = false;
    break;
  }
  if (!products.length) break;
  raw += products.length;
  items = dedupeCatalog([...items, ...products.map(parseCatalogProduct).filter(Boolean)]);
  console.log(`Seite ${page}: ${raw} geprüft, ${items.length} übernommen`);
}
items = items.slice(0, TARGET);
if (!items.length) { console.error('Keine Produkte – nichts geschrieben.'); process.exit(1); }

await mkdir(OUT, { recursive: true });
const builtAt = new Date().toISOString().slice(0, 10);
await writeFile(new URL('catalog-de.json', OUT), JSON.stringify(packCatalog(items, {
  source: 'Open Food Facts (https://world.openfoodfacts.org)',
  license: 'ODbL 1.0 – © Open Food Facts contributors',
  builtAt, checked: raw
})));

// Lesbare Liste für Menschen
const byStore = {};
for (const it of items) for (const s of (it.stores.length ? it.stores : ['ohne Ladenangabe'])) byStore[s] = (byStore[s] || 0) + 1;
const esc = s => String(s).replace(/\|/g, '\\|');
const md = [
  '# FitTrack-Produktkatalog', '',
  `Stand ${builtAt} · ${items.length} Produkte des deutschen Markts (aus ${raw} geprüften, beliebteste zuerst ausgewählt).`,
  'Quelle: [Open Food Facts](https://world.openfoodfacts.org), Lizenz [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) –',
  '© Open Food Facts contributors. Werte pro 100 g bzw. 100 ml. Laden = erkannt aus Ladenangabe oder Eigenmarke.', '',
  '## Nach Laden', '',
  ...Object.entries(byStore).sort((a, b) => b[1] - a[1]).map(([s, n]) => `- ${s}: ${n}`), '',
  '## Alle Produkte (alphabetisch)', '',
  '| Produkt | Laden | kcal | Protein | KH | Fett | Barcode |',
  '|---|---|---:|---:|---:|---:|---|',
  ...[...items].sort((a, b) => catalogLabel(a).localeCompare(catalogLabel(b), 'de'))
    .map(it => `| ${esc(catalogLabel(it))} | ${it.stores.join(', ')} | ${it.kcal} | ${it.protein} | ${it.carbs} | ${it.fat} | ${it.code} |`)
].join('\n') + '\n';
await writeFile(new URL('KATALOG.md', OUT), md);
console.log(`Fertig${complete ? '' : ' (unvollständig)'}: ${items.length} Produkte → data/catalog-de.json, data/KATALOG.md`);
