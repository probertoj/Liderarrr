import { db, getSetting, setSetting } from './db.js';
import { recentTracks, lastfmConfigured } from './lastfm.js';

// Importa tu historial de escuchas de Last.fm a la tabla listens. Incremental:
// guarda el ts del scrobble más reciente y la próxima vez pide solo lo posterior.
// Es lo que alimenta la sección de Escuchas y, sobre todo, la brecha
// escucha↔propiedad: el mejor generador de candidatos que hay, porque es dato
// tuyo, no la recomendación de un algoritmo.

export const scrobbleStatus = {
  running: false,
  page: 0,
  totalPages: 0,
  imported: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

const insertListen = db.prepare(
  `INSERT OR IGNORE INTO listens (artist, album, track, ts, source, mbid)
   VALUES (@artist, @album, @track, @ts, 'lastfm', @mbid)`
);

export function scrobblesConfigured() {
  return lastfmConfigured() && !!getSetting('lastfm_user');
}

export async function importScrobbles({ full = false } = {}) {
  if (scrobbleStatus.running) return scrobbleStatus;
  const user = getSetting('lastfm_user');
  if (!scrobblesConfigured()) throw new Error('Falta el usuario de Last.fm o la API key (Ajustes)');

  // incremental salvo que se pida completo: desde el último ts conocido
  const lastTs = full ? 0 : Number(getSetting('lastfm_last_scrobble') || 0);
  const fromSec = lastTs ? Math.floor(lastTs / 1000) : 0;

  Object.assign(scrobbleStatus, {
    running: true,
    page: 0,
    totalPages: 0,
    imported: 0,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  });
  let maxTs = lastTs;
  try {
    // primera página para saber cuántas hay
    const first = await recentTracks(user, { from: fromSec, page: 1 });
    scrobbleStatus.totalPages = first.totalPages;
    const pages = first.totalPages;
    // recorre de la última a la primera para insertar en orden cronológico
    // (da igual por el OR IGNORE, pero así maxTs queda correcto aunque se corte)
    for (let p = pages; p >= 1; p--) {
      scrobbleStatus.page = pages - p + 1;
      const data = p === 1 ? first : await recentTracks(user, { from: fromSec, page: p });
      const tx = db.transaction((rows) => {
        for (const t of rows) {
          const res = insertListen.run(t);
          if (res.changes) scrobbleStatus.imported++;
          if (t.ts > maxTs) maxTs = t.ts;
        }
      });
      tx(data.tracks);
    }
    if (maxTs > lastTs) setSetting('lastfm_last_scrobble', String(maxTs));
  } catch (err) {
    scrobbleStatus.error = String(err.message || err);
  } finally {
    scrobbleStatus.running = false;
    scrobbleStatus.finishedAt = Date.now();
  }
  return scrobbleStatus;
}
