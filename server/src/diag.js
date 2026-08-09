import { db, getSetting } from './db.js';
import { scanStatus } from './scanner.js';
import { identifyStatus } from './identify.js';
import { lidarrAddStatus } from './lidarr.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Diagnóstico dentro de la app: sube a la interfaz lo que antes había que leer por
// `docker logs`. Un buffer en memoria captura los eventos importantes (nuestras
// marcas [scan]/[lidarr]/[fatal] y cualquier warn/error), y diagnostics() arma un
// resumen del estado. Así se depura sin SSH ni copiar-pegar logs.

const MAX = 400;
const events = [];
export function pushEvent(level, text) {
  events.push({ t: Date.now(), level, text: String(text).slice(0, 600) });
  if (events.length > MAX) events.shift();
}
export function recentEvents() {
  return events.slice().reverse();
}

// Intercepta console.warn/error (siempre) y console.log (solo nuestras marcas
// [algo]) para volcarlos también al buffer. Fastify loguea por pino aparte, así
// que esto no captura el ruido de las peticiones.
function patchConsole() {
  const fmt = (args) =>
    args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
      .join(' ');
  for (const level of ['warn', 'error', 'log']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try {
        const line = fmt(args);
        if (level !== 'log' || /^\s*\[[a-zA-Z]/.test(line)) pushEvent(level, line);
      } catch {
        /* noop */
      }
      orig(...args);
    };
  }
}
patchConsole();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

export function diagnostics() {
  const mem = process.memoryUsage();
  const states = Object.fromEntries(
    db.prepare('SELECT match_state, COUNT(*) AS n FROM albums GROUP BY match_state').all().map((r) => [r.match_state, r.n])
  );
  const unknownArtist = db
    .prepare("SELECT COUNT(*) AS n FROM albums WHERE album_artist = 'Artista desconocido' OR album_artist IS NULL OR album_artist = ''")
    .get().n;
  const formats = db
    .prepare("SELECT format AS name, COUNT(*) AS n FROM tracks WHERE format IS NOT NULL AND format <> '' GROUP BY format ORDER BY n DESC")
    .all();
  const totals = {
    albums: db.prepare('SELECT COUNT(*) AS n FROM albums').get().n,
    artists: db.prepare('SELECT COUNT(DISTINCT artist_id) AS n FROM albums').get().n,
    tracks: db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n,
    listens: db.prepare("SELECT COUNT(*) AS n FROM listens WHERE source='lastfm'").get().n,
  };
  let lastScan = null;
  try {
    lastScan = JSON.parse(getSetting('last_scan') || 'null');
  } catch {
    /* ignore */
  }
  const has = (k) => !!getSetting(k);
  return {
    version: pkg.version,
    now: Date.now(),
    uptimeSec: Math.round(process.uptime()),
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    dataDir: process.env.DATA_DIR || null,
    settings: {
      music_dirs: getSetting('music_dirs') || '',
      lidarr: has('lidarr_url') && has('lidarr_key'),
      lidarr_folder: !!getSetting('lidarr_root_folder'),
      lastfm: has('lastfm_key'),
      lastfm_user: !!getSetting('lastfm_user'),
      discogs: has('discogs_token'),
      acoustid: has('acoustid_key'),
      tag_writing: getSetting('allow_tag_writing') === '1',
    },
    totals,
    states,
    unknownArtist,
    formats,
    scan: {
      running: scanStatus.running,
      phase: scanStatus.phase,
      foldersFound: scanStatus.foldersFound,
      albumsDone: scanStatus.albumsDone,
      skipped: scanStatus.skipped,
      errors: scanStatus.errors,
      current: scanStatus.current,
      lastScan,
    },
    identify: {
      running: identifyStatus.running,
      total: identifyStatus.total,
      done: identifyStatus.done,
      matched: identifyStatus.matched,
      unmatched: identifyStatus.unmatched,
      current: identifyStatus.current,
    },
    lidarrQueue: {
      running: lidarrAddStatus.running,
      total: lidarrAddStatus.total,
      done: lidarrAddStatus.done,
      added: lidarrAddStatus.added,
      pending: lidarrAddStatus.pending,
      errors: lidarrAddStatus.errors.length,
    },
    events: recentEvents(),
  };
}
