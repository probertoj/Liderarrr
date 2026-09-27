import { db, getSetting, setSetting } from './db.js';

// LETRAS (LRCLIB). Trae la letra de cada pista desde lrclib.net —abierta, sin clave, con
// letras SINCRONIZADAS (.lrc) además de planas— y la guarda EN LA BASE DE DATOS.
//
// Nunca se escribe en tus ficheros, como todo lo demás en esta app: la letra es un metadato
// más, y tu audio no se toca. Si algún día quieres los .lrc junto al audio, será una acción
// explícita, no un efecto secundario de mirar una letra.
//
// LRCLIB es un servicio gratuito mantenido por voluntarios, así que aquí se le trata bien:
// una petición cada vez, con pausa entre medias, User-Agent que dice quiénes somos, y todo
// cacheado (también los fallos) para no volver a preguntar lo mismo.

const BASE = 'https://lrclib.net/api';
const PAUSA_MS = 250; // entre peticiones, para no castigar un servicio gratuito
const REINTENTO_MS = [500, 1500, 4000]; // ante «servidor ocupado»

function userAgent() {
  const v = process.env.npm_package_version || '1.1.0';
  return `Liderarrr v${v} (https://github.com/probertoj/Liderarrr)`;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Llamada cruda. Devuelve {ok, status, data}. NO lanza por 404: «no hay letra» es una
// respuesta válida y hay que distinguirla de «el servidor está ocupado» (503), que es
// temporal y no debe cachearse como si no existiera.
async function lrclib(path) {
  let ultimo = null;
  for (let intento = 0; intento <= REINTENTO_MS.length; intento++) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, {
        headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      ultimo = { ok: false, status: 0, error: String(e.message || e) };
      if (intento < REINTENTO_MS.length) {
        await espera(REINTENTO_MS[intento]);
        continue;
      }
      return ultimo;
    }
    if (res.status === 404) return { ok: false, status: 404, notFound: true };
    if (res.status === 503 || res.status === 429) {
      ultimo = { ok: false, status: res.status, busy: true };
      if (intento < REINTENTO_MS.length) {
        await espera(REINTENTO_MS[intento]);
        continue;
      }
      return ultimo;
    }
    if (!res.ok) return { ok: false, status: res.status, error: `LRCLIB ${res.status}` };
    return { ok: true, status: res.status, data: await res.json() };
  }
  return ultimo || { ok: false, status: 0, error: 'sin respuesta' };
}

const q = (o) =>
  Object.entries(o)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

// --- almacén ------------------------------------------------------------------

const guardar = db.prepare(
  `INSERT INTO lyrics (track_id, state, plain, synced, instrumental, lrclib_id, source, fetched_at)
   VALUES (@track_id, @state, @plain, @synced, @instrumental, @lrclib_id, 'lrclib', @now)
   ON CONFLICT(track_id) DO UPDATE SET
     state = excluded.state, plain = excluded.plain, synced = excluded.synced,
     instrumental = excluded.instrumental, lrclib_id = excluded.lrclib_id,
     source = excluded.source, fetched_at = excluded.fetched_at`
);

export function lyricsOfTrack(trackId) {
  return db.prepare('SELECT * FROM lyrics WHERE track_id = ?').get(trackId) || null;
}

// Pistas de un álbum con lo que sabemos de su letra (sin traer el texto entero: la lista
// solo necesita saber si hay o no).
export function albumLyricsState(albumId) {
  return db
    .prepare(
      `SELECT t.id AS track_id, l.state, l.instrumental, (l.synced IS NOT NULL AND l.synced != '') AS synced
         FROM tracks t LEFT JOIN lyrics l ON l.track_id = t.id
        WHERE t.album_id = ? ORDER BY t.disc, t.num`
    )
    .all(albumId);
}

// --- búsqueda -----------------------------------------------------------------

// Margen de duración al aceptar un resultado de la BÚSQUEDA difusa. LRCLIB indexa muchas
// versiones del mismo tema (directos, ediciones, remezclas) y la duración es lo único que
// distingue la tuya. Fuera de este margen preferimos no poner letra a poner la equivocada.
const MARGEN_S = 4;

// Busca la letra de una pista. Primero por coincidencia exacta (artista + tema + álbum +
// duración); si no, búsqueda difusa exigiendo que la duración cuadre.
export async function fetchLyrics(track) {
  const artista = track.artist || track.album_artist;
  const segundos = track.duration_ms ? Math.round(track.duration_ms / 1000) : null;
  if (!artista || !track.title) return { ok: false, reason: 'sin artista o título' };

  const exacta = await lrclib(
    `/get?${q({ artist_name: artista, track_name: track.title, album_name: track.album, duration: segundos })}`
  );
  if (exacta.ok) return { ok: true, data: exacta.data, how: 'exacta' };
  if (exacta.busy || exacta.status === 0) return { ok: false, busy: true, reason: 'LRCLIB ocupado' };

  await espera(PAUSA_MS);
  const buscada = await lrclib(`/search?${q({ artist_name: artista, track_name: track.title })}`);
  if (buscada.busy || buscada.status === 0) return { ok: false, busy: true, reason: 'LRCLIB ocupado' };
  if (!buscada.ok || !Array.isArray(buscada.data) || !buscada.data.length) {
    return { ok: false, notFound: true, reason: 'sin letra en LRCLIB' };
  }

  const elegida = pickLyricsCandidate(buscada.data, segundos);
  if (!elegida.ok) return { ok: false, notFound: true, reason: elegida.reason };
  return { ok: true, data: elegida.data, how: 'búsqueda' };
}

// Elige entre los resultados de la búsqueda difusa. Aquí es donde se cuela una letra
// equivocada si uno se despista: LRCLIB indexa muchas versiones del mismo tema (directos,
// ediciones, remezclas) y la DURACIÓN es lo único que distingue la tuya. Fuera del margen,
// preferimos no poner letra a poner la que no es. Función pura, para poder probarla.
export function pickLyricsCandidate(resultados, segundos) {
  const candidatos = (resultados || []).filter((r) => r && (r.plainLyrics || r.syncedLyrics || r.instrumental));
  if (!candidatos.length) return { ok: false, reason: 'sin letra en LRCLIB' };
  if (segundos == null) {
    // sin duración no hay forma de desempatar: solo vale si hay una sola candidata
    if (candidatos.length !== 1) return { ok: false, reason: 'varias versiones y sin duración para elegir' };
    return { ok: true, data: candidatos[0] };
  }
  let mejor = null;
  for (const c of candidatos) {
    const d = Math.abs((Number(c.duration) || 0) - segundos);
    if (d > MARGEN_S) continue;
    // a igualdad de cercanía, gana la que trae letra sincronizada
    if (!mejor || d < mejor.d || (d === mejor.d && c.syncedLyrics && !mejor.c.syncedLyrics)) mejor = { c, d };
  }
  if (!mejor) return { ok: false, reason: 'ninguna versión cuadra en duración' };
  return { ok: true, data: mejor.c };
}

// Busca y guarda la letra de UNA pista. Devuelve el estado resultante.
export async function importTrackLyrics(trackId, { force = false } = {}) {
  const t = db
    .prepare(
      `SELECT t.id, t.title, t.artist, t.duration_ms, a.album_artist, a.title AS album
         FROM tracks t JOIN albums a ON a.id = t.album_id WHERE t.id = ?`
    )
    .get(trackId);
  if (!t) throw new Error('Pista no encontrada');

  const ya = lyricsOfTrack(trackId);
  if (!force && ya && ya.state !== 'error') return { ...ya, cached: true };

  const r = await fetchLyrics(t);
  const now = Date.now();
  if (r.ok) {
    const d = r.data;
    guardar.run({
      track_id: trackId,
      state: d.instrumental ? 'instrumental' : 'found',
      plain: d.plainLyrics || null,
      synced: d.syncedLyrics || null,
      instrumental: d.instrumental ? 1 : 0,
      lrclib_id: d.id || null,
      now,
    });
    return { ...lyricsOfTrack(trackId), how: r.how };
  }
  // «Ocupado» NO se cachea como «no hay letra»: sería perder la letra para siempre por un
  // fallo pasajero. Se marca como error para poder reintentarlo.
  guardar.run({
    track_id: trackId,
    state: r.busy ? 'error' : 'notfound',
    plain: null,
    synced: null,
    instrumental: 0,
    lrclib_id: null,
    now,
  });
  return { ...lyricsOfTrack(trackId), reason: r.reason };
}

// --- importación de un álbum entero -------------------------------------------

export const lyricsStatus = {
  running: false,
  album_id: null,
  done: 0,
  total: 0,
  found: 0,
  notFound: 0,
  errors: 0,
  lastRun: Number(getSetting('lyrics_last_run') || 0) || null,
};

// Trae las letras de todas las pistas de un álbum, una a una y con pausa. En segundo plano:
// un disco de 12 temas son 12 peticiones y no tiene sentido bloquear la página.
export async function importAlbumLyrics(albumId, { force = false } = {}) {
  if (lyricsStatus.running) return lyricsStatus;
  const pistas = db
    .prepare(
      `SELECT t.id, t.title, t.artist, t.duration_ms, a.album_artist, a.title AS album
         FROM tracks t JOIN albums a ON a.id = t.album_id
        WHERE t.album_id = ? AND t.title IS NOT NULL AND t.title != ''
        ORDER BY t.disc, t.num`
    )
    .all(albumId);
  Object.assign(lyricsStatus, {
    running: true,
    album_id: albumId,
    done: 0,
    total: pistas.length,
    found: 0,
    notFound: 0,
    errors: 0,
  });
  try {
    for (const p of pistas) {
      const ya = lyricsOfTrack(p.id);
      if (!force && ya && ya.state !== 'error') {
        lyricsStatus.done++;
        if (ya.state === 'found' || ya.state === 'instrumental') lyricsStatus.found++;
        else lyricsStatus.notFound++;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const r = await importTrackLyrics(p.id, { force });
      lyricsStatus.done++;
      if (r.state === 'found' || r.state === 'instrumental') lyricsStatus.found++;
      else if (r.state === 'error') lyricsStatus.errors++;
      else lyricsStatus.notFound++;
      // eslint-disable-next-line no-await-in-loop
      await espera(PAUSA_MS);
    }
    lyricsStatus.lastRun = Date.now();
    setSetting('lyrics_last_run', String(Date.now()));
  } finally {
    lyricsStatus.running = false;
  }
  return lyricsStatus;
}

// Cuántas letras tienes, para el panel de ajustes.
export function lyricsCounts() {
  const r = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM tracks) AS tracks,
         (SELECT COUNT(*) FROM lyrics WHERE state = 'found') AS found,
         (SELECT COUNT(*) FROM lyrics WHERE state = 'instrumental') AS instrumental,
         (SELECT COUNT(*) FROM lyrics WHERE state = 'notfound') AS notfound,
         (SELECT COUNT(*) FROM lyrics WHERE synced IS NOT NULL AND synced != '') AS synced`
    )
    .get();
  return r;
}
