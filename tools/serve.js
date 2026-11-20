// Mini-Webserver für die lokale Entwicklung (ohne Abhängigkeiten).
// ES-Module und Service Worker brauchen http://, file:// reicht nicht.
// Start:  npm run serve   →  http://localhost:8080
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
                '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
  if (!file.startsWith(ROOT.replace(/[\\/]$/, '') + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': (TYPES[extname(file)] || 'application/octet-stream') + '; charset=utf-8',
                         'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Nicht gefunden');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`FitTrack läuft auf http://localhost:${PORT}`));
