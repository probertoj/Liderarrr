import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, setSetting } from './db.js';
import { splitRoots, isJunkEntry } from './libkey.js';
import { runScan, scanStatus } from './scanner.js';
import { regroupDiscs } from './discgroup.js';
import { barrerHuerfanos, resumenHuerfanos } from './orphans.js';

// Dos cosas que comparten fichero porque las dos cuelgan de «¿qué hay de verdad en mi
// biblioteca?» y ninguna toca lo que ya existe:
//
//  1. LISTADOS DE CALIDAD — qué álbumes están a 44,1 kHz, a 48 kHz, sin ReplayGain o sin
//     carátula. Solo LEEN lo que el escáner ya guardó (tracks.sample_rate,
//     tracks.has_replaygain, albums.cover): nada que reescanear.
//
//  2. SINCRONIZACIÓN AUTOMÁTICA — el comportamiento de Lidarr: cada cierto tiempo escanea la
//     biblioteca (incremental) y, después, quita de la BASE DE DATOS los álbumes cuyos
//     ficheros ya no existen. Hasta ahora el escáner solo añadía o actualizaba: un disco
//     borrado del disco se quedaba para siempre en la base.
//
// REGLA DE ORO: la poda solo borra FILAS. Nunca toca un fichero de música (eso solo lo hace
// albumdelete.js, a mano y con confirmación). Y ante la duda, NO borra: una biblioteca en red
// que no ha montado, un volumen vacío o un error de permisos parecen «se ha borrado todo», y
// vaciar la base por eso sería el peor fallo posible. De ahí las salvaguardas de pruneMissing.

// Mismas extensiones que el escáner (scanner.js). Si allí se añade un formato, añadirlo aquí.
const AUDIO_EXT = new Set([
  '.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.oga', '.wav', '.wv', '.ape',
  '.alac', '.aiff', '.aif', '.dsf', '.dff', '.mpc', '.tak', '.tta', '.wma',
]);

const LIVE = "a.match_state != 'dismissed'"; // mismo criterio «descriptivo» que queries.js
const ORDER = 'ORDER BY a.album_artist COLLATE NOCASE, a.year, a.title COLLATE NOCASE';
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

// ─────────────────────────── 1. LISTADOS DE CALIDAD ───────────────────────────

// Contadores de las pestañas: cuántos ÁLBUMES (no pistas) hay en cada lista.
export function qualityListsSummary() {
  const sampleRates = db
    .prepare(
      `SELECT t.sample_rate AS rate, COUNT(DISTINCT t.album_id) AS albums
       FROM tracks t JOIN albums a ON a.id = t.album_id
       WHERE ${LIVE} AND t.sample_rate IS NOT NULL
       GROUP BY t.sample_rate ORDER BY albums DESC`
    )
    .all();
  const noReplaygain = db
    .prepare(
      `SELECT COUNT(DISTINCT t.album_id) AS n
       FROM tracks t JOIN albums a ON a.id = t.album_id
       WHERE ${LIVE} AND t.has_replaygain = 0`
    )
    .get().n;
  // misma definición que qualityOverview().noCover (queries.js): el número de la tarjeta
  // «Sin carátula» y el de esta lista tienen que cuadrar.
  const noCover = db
    .prepare(`SELECT COUNT(*) AS n FROM albums a WHERE ${LIVE} AND (a.cover IS NULL OR a.cover = '')`)
    .get().n;
  return { sampleRates, noReplaygain, noCover };
}

// Álbumes con AL MENOS una pista a esa frecuencia. Si un álbum mezcla frecuencias (44,1 y
// 48) sale en las dos listas y lleva `rates` con todas, para que no se esconda nada.
export function albumsAtSampleRate(rate) {
  const hz = Math.round(Number(rate));
  if (!Number.isFinite(hz) || hz <= 0) throw new Error('Frecuencia de muestreo no válida');
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.path, a.track_file_count,
        COUNT(t.id) AS at_rate,
        (SELECT GROUP_CONCAT(DISTINCT t2.sample_rate) FROM tracks t2
          WHERE t2.album_id = a.id AND t2.sample_rate IS NOT NULL) AS rates
       FROM albums a JOIN tracks t ON t.album_id = a.id AND t.sample_rate = @hz
       WHERE ${LIVE}
       GROUP BY a.id ${ORDER}`
    )
    .all({ hz });
  return rows.map((r) => ({
    ...r,
    rates: String(r.rates || '')
      .split(',')
      .map(Number)
      .filter(Boolean)
      .sort((x, y) => x - y),
  }));
}

// Álbumes con alguna pista sin ReplayGain (el mismo has_replaygain=0 que ya cuenta la
// página de Calidad), con cuántas pistas de cuántas.
export function albumsWithoutReplaygain() {
  return db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.path,
        COUNT(t.id) AS total,
        SUM(CASE WHEN t.has_replaygain = 0 THEN 1 ELSE 0 END) AS without
       FROM albums a JOIN tracks t ON t.album_id = a.id
       WHERE ${LIVE}
       GROUP BY a.id HAVING without > 0 ${ORDER}`
    )
    .all();
}

export function albumsWithoutCover() {
  return db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.path, a.track_file_count
       FROM albums a
       WHERE ${LIVE} AND (a.cover IS NULL OR a.cover = '')
       ${ORDER}`
    )
    .all();
}

// ───────────────────── 2. SINCRONIZACIÓN AUTOMÁTICA (poda) ─────────────────────

// Si la poda va a quitar más de esta fracción de la biblioteca (y más de MIN_ABS álbumes),
// se DETIENE y pide confirmación: borrar de golpe una cuarta parte de la colección casi
// nunca es intencionado (lo normal es un montaje caído o una ruta cambiada).
const MAX_FRACTION = 0.25;
const MIN_ABS = 25;

export const syncStatus = {
  running: false,
  phase: 'idle', // idle | scanning | pruning | done | error
  trigger: null, // auto | manual
  startedAt: null,
  finishedAt: null,
  checked: 0,
  removed: 0,
  removedTracks: 0,
  removedSample: [],
  skippedRoots: [],
  blocked: null, // { count, evaluated, sample } cuando la salvaguarda frena la poda
  scanError: null,
  error: null,
};

export function autoSyncConfig() {
  return {
    // activo por defecto: es justo lo que se pidió («como Lidarr, sin que yo haga nada»).
    // Se apaga con auto_sync_enabled = 0.
    enabled: getSetting('auto_sync_enabled') !== '0',
    intervalMin: Math.max(5, Number(getSetting('auto_sync_interval_min')) || 60),
    lastRun: Number(getSetting('auto_sync_last_run') || 0) || null,
  };
}

function lastResult() {
  try {
    return JSON.parse(getSetting('auto_sync_last') || 'null');
  } catch {
    return null;
  }
}

// Una raíz es fiable si existe, es una carpeta y NO está vacía. Una biblioteca de verdad
// siempre tiene algo; una vacía suele ser un montaje de red que no ha subido.
async function rootHealthy(root) {
  try {
    const st = await fs.promises.stat(root);
    if (!st.isDirectory()) return false;
    return (await fs.promises.readdir(root)).length > 0;
  } catch {
    return false;
  }
}

// ¿Ha desaparecido de verdad este álbum? true = sí · false = sigue ahí · null = no se sabe.
// Solo ENOENT/ENOTDIR cuentan como «no existe»; un EACCES, un timeout de la red o un EIO NO
// prueban nada, así que se deja el álbum como está.
async function albumGone(a) {
  let st;
  try {
    st = await fs.promises.stat(a.path);
  } catch (e) {
    return e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? true : null;
  }
  if (!st.isDirectory()) return null;
  // La carpeta existe. Si no ha cambiado desde el último escaneo, su contenido es el que
  // la base ya conoce. Si cambió, el escáner la habrá releído SALVO que ya no quede audio
  // (una carpeta sin audio no se visita): ese es el único caso que hay que mirar aquí.
  if (a.scanned_at && st.mtimeMs <= a.scanned_at) return false;
  let entries;
  try {
    entries = await fs.promises.readdir(a.path, { withFileTypes: true });
  } catch {
    return null;
  }
  const hasAudio = entries.some(
    (e) => e.isFile() && !isJunkEntry(e.name) && AUDIO_EXT.has(path.extname(e.name).toLowerCase())
  );
  return !hasAudio;
}

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// Quita de la base los álbumes cuyos ficheros ya no están. Devuelve el resumen.
export async function pruneMissingAlbums({ force = false } = {}) {
  const out = { checked: 0, removed: 0, tracks: 0, sample: [], skippedRoots: [], unknown: 0, blocked: null };
  const roots = splitRoots(getSetting('music_dirs')).map((raw) => ({ raw, n: norm(raw) }));
  if (!roots.length) return out;

  // Salvaguarda 1: solo se juzgan los álbumes de raíces que responden. Una raíz caída se
  // salta ENTERA (y se avisa), nunca se interpreta como «todo borrado». `force` NO salta
  // esto: si el montaje no está, no hay nada que decidir.
  const healthy = [];
  for (const r of roots) (await rootHealthy(r.raw)) ? healthy.push(r) : out.skippedRoots.push(r.raw);
  if (!healthy.length) return out;
  const inHealthyRoot = (p) => healthy.some((r) => p === r.n || p.startsWith(`${r.n}/`));

  // Salvaguarda 2: un álbum cuya ruta NO cuelga de ninguna raíz actual (montaje antiguo, o
  // music_dirs cambiado) no se toca: el escáner ya lo reubica por su identidad (local_key).
  const rows = db
    .prepare("SELECT id, path, title, album_artist, scanned_at FROM albums WHERE path IS NOT NULL AND path != ''")
    .all();
  const candidates = rows.filter((a) => inHealthyRoot(norm(a.path)));
  out.checked = candidates.length;

  const gone = [];
  await inBatches(candidates, 32, async (a) => {
    const v = await albumGone(a);
    if (v === true) gone.push(a);
    else if (v === null) out.unknown++;
  });
  if (!gone.length) return out;

  // Salvaguarda 3: freno de mano ante una poda desproporcionada.
  if (!force && gone.length > MIN_ABS && gone.length / candidates.length > MAX_FRACTION) {
    out.blocked = {
      count: gone.length,
      evaluated: candidates.length,
      sample: gone.slice(0, 10).map((a) => `${a.album_artist || '?'} — ${a.title || '?'}`),
    };
    return out;
  }

  const countTracks = db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE album_id = ?');
  const steps = [
    db.prepare('DELETE FROM lyrics WHERE track_id IN (SELECT id FROM tracks WHERE album_id = ?)'),
    db.prepare('DELETE FROM tracks WHERE album_id = ?'),
    db.prepare('DELETE FROM album_tags WHERE album_id = ?'),
    db.prepare('DELETE FROM album_labels WHERE album_id = ?'),
    db.prepare('DELETE FROM album_artists WHERE album_id = ?'),
    db.prepare('DELETE FROM albums WHERE id = ?'),
  ];
  const dropBatch = db.transaction((batch) => {
    for (const a of batch) {
      out.tracks += countTracks.get(a.id).n;
      for (const st of steps) st.run(a.id);
      out.removed++;
    }
  });
  // por tandas pequeñas: better-sqlite3 es síncrono y una transacción enorme dejaría la
  // web sin responder; entre tandas se cede el turno al bucle de eventos.
  for (let i = 0; i < gone.length; i += 100) {
    dropBatch(gone.slice(i, i + 100));
    await new Promise((r) => setImmediate(r));
  }
  out.sample = gone.slice(0, 10).map((a) => `${a.album_artist || '?'} — ${a.title || '?'}`);

  // 1.6.1: el esquema no tiene claves ajenas, así que lo que colgaba de los álbumes quitados
  // (sobre todo release_groups.owned_album_id: mientras siga apuntando a una copia que ya no
  // existe, el disco cuenta como «lo tienes» y ni el completismo ni la auto-descarga lo
  // vuelven a pedir) se recoge aquí mismo con la barrida de orphans.js, en lugar de esperar
  // al refresco nocturno.
  try {
    const barrido = barrerHuerfanos();
    if (barrido.borrados || barrido.soltados) console.log(`[autosync] restos recogidos: ${resumenHuerfanos(barrido)}`);
  } catch (e) {
    console.warn('[autosync] no se pudo recoger lo que colgaba de los álbumes quitados:', String(e.message || e));
  }

  // una caja multidisco a la que se le ha ido un disco tiene que reagruparse
  try {
    regroupDiscs();
  } catch (e) {
    console.warn('[autosync] no se pudo reagrupar multidiscos tras la poda:', String(e.message || e));
  }
  return out;
}

// El ciclo completo: escanear (incremental) y después podar. `scan:false` solo poda
// (lo usa «Eliminar igualmente», que ya viene de un escaneo reciente).
export async function runAutoSync({ force = false, scan = true, trigger = 'manual' } = {}) {
  if (syncStatus.running) return syncStatus;
  Object.assign(syncStatus, {
    running: true,
    phase: scan ? 'scanning' : 'pruning',
    trigger,
    startedAt: Date.now(),
    finishedAt: null,
    checked: 0,
    removed: 0,
    removedTracks: 0,
    removedSample: [],
    skippedRoots: [],
    blocked: null,
    scanError: null,
    error: null,
  });
  try {
    if (scan && !scanStatus.running) {
      await runScan(); // incremental: solo relee las carpetas que cambiaron
      syncStatus.scanError = scanStatus.error || null;
    }
    syncStatus.phase = 'pruning';
    // si hay un escaneo en marcha (el de otro proceso: botón, refresco nocturno) no se poda
    // a la vez; el siguiente ciclo lo hará.
    if (!scanStatus.running) {
      const r = await pruneMissingAlbums({ force });
      Object.assign(syncStatus, {
        checked: r.checked,
        removed: r.removed,
        removedTracks: r.tracks,
        removedSample: r.sample,
        skippedRoots: r.skippedRoots,
        blocked: r.blocked,
      });
      if (r.removed)
        console.log(`[autosync] poda: ${r.removed} álbumes (${r.tracks} pistas) ya no están en disco${force ? ' (confirmado)' : ''}`);
      if (r.blocked)
        console.warn(`[autosync] poda DETENIDA por seguridad: ${r.blocked.count} de ${r.blocked.evaluated} álbumes parecen desaparecidos`);
      if (r.skippedRoots.length) console.warn(`[autosync] raíz sin responder, se omite: ${r.skippedRoots.join(', ')}`);
    }
    syncStatus.phase = 'done';
  } catch (err) {
    syncStatus.phase = 'error';
    syncStatus.error = String(err.message || err);
    console.error('[autosync] error:', syncStatus.error);
  } finally {
    syncStatus.running = false;
    syncStatus.finishedAt = Date.now();
    setSetting('auto_sync_last_run', String(Date.now()));
    // resumen persistente, para que sobreviva a un reinicio (como last_scan)
    setSetting(
      'auto_sync_last',
      JSON.stringify({
        at: Date.now(),
        trigger,
        checked: syncStatus.checked,
        removed: syncStatus.removed,
        removedTracks: syncStatus.removedTracks,
        removedSample: syncStatus.removedSample,
        skippedRoots: syncStatus.skippedRoots,
        blocked: syncStatus.blocked,
        scanError: syncStatus.scanError,
        error: syncStatus.error,
      })
    );
  }
  return syncStatus;
}

// Temporizador fijo (setInterval cada minuto) en vez de un setTimeout encadenado: si un
// ciclo tarda mucho o falla, el reloj NO se para (lección de scheduleAutoImport en index.js).
// Relee los ajustes en cada vuelta, así que cambiarlos aplica sin reiniciar.
//
// Desde la 1.6.2, importar index.js NO puede programar nada (los tests lo importan para
// hacerle `inject()` a las rutas), así que esto se arranca aparte: index.js lo llama desde
// start(), junto a los demás temporizadores. `busy` dice si hay algo más trabajando.
let schedulerStarted = false;
export function startLibrarySyncScheduler(busy = () => false) {
  if (schedulerStarted) return;
  schedulerStarted = true;
  // el primer ciclo, 10 min después de arrancar: que no compita con el arranque
  // (regroupDiscs, limpieza de ocultos, reanudar la cola de Lidarr…).
  let nextAt = Date.now() + 10 * 60 * 1000;
  setInterval(() => {
    const cfg = autoSyncConfig();
    if (!cfg.enabled || syncStatus.running || Date.now() < nextAt) return;
    if (scanStatus.running || busy()) return; // no pisar un escaneo/refresco/importación en curso
    runAutoSync({ trigger: 'auto' })
      .catch((e) => console.warn('[autosync] ciclo falló:', String(e.message || e)))
      .finally(() => {
        nextAt = Date.now() + autoSyncConfig().intervalMin * 60 * 1000;
      });
  }, 60 * 1000);
}

// ─────────────────────────────────── rutas ───────────────────────────────────

// Se llama UNA vez desde index.js, con la instancia de Fastify. Solo REGISTRA las rutas
// nuevas: no toca ninguna existente y no arranca nada (el temporizador es
// startLibrarySyncScheduler, que se llama desde start()).
export function registerLibrarySync(app) {
  app.get('/api/quality/lists', async () => qualityListsSummary());

  app.get('/api/quality/list', async (req, reply) => {
    const { kind, rate } = req.query || {};
    try {
      let albums;
      if (kind === 'samplerate') albums = albumsAtSampleRate(rate);
      else if (kind === 'replaygain') albums = albumsWithoutReplaygain();
      else if (kind === 'cover') albums = albumsWithoutCover();
      else return reply.code(400).send({ error: 'Lista desconocida' });
      return { kind, total: albums.length, albums };
    } catch (err) {
      return reply.code(400).send({ error: String(err.message || err) });
    }
  });

  app.get('/api/autosync', async () => ({ ...autoSyncConfig(), status: syncStatus, last: lastResult() }));

  app.post('/api/autosync/config', async (req) => {
    const b = req.body || {};
    if (typeof b.enabled === 'boolean') setSetting('auto_sync_enabled', b.enabled ? '1' : '0');
    if (b.intervalMin != null) {
      const m = Math.round(Number(b.intervalMin));
      if (Number.isFinite(m)) setSetting('auto_sync_interval_min', String(Math.min(1440, Math.max(5, m))));
    }
    return { ...autoSyncConfig(), status: syncStatus, last: lastResult() };
  });

  // En segundo plano: un escaneo + poda en una biblioteca grande por red tarda minutos. La
  // UI sigue el progreso sondeando /api/autosync.
  app.post('/api/autosync/run', async (req) => {
    const b = req.body || {};
    runAutoSync({ force: b.force === true, scan: b.scan !== false, trigger: 'manual' }).catch((e) =>
      console.warn('[autosync] ciclo manual falló:', String(e.message || e))
    );
    return { started: true, status: syncStatus };
  });
}
