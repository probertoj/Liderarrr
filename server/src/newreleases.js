import { db } from './db.js';
import { matchKey, normName, cleanTitleForMatch } from './matchkey.js';
import { deezerFindArtist } from './artistpix.js';
import { spotifyArtistAlbums, spotifyConfigured } from './spotify.js';

// ¿YA lo tienes? Cruce robusto contra la biblioteca, con DOS señales para no mostrar como
// «novedad» algo que ya está en tu disco: (1) matchKey(artista, título) global —casa por
// nombre— y (2) por artist_id + título limpio —casa aunque el album_artist guardado
// difiera del nombre del artista seguido, que es lo que se colaba—. Se calcula en vivo
// (no un flag guardado, que envejece), igual que ownedMatcher del calendario.
function buildOwnedCheck() {
  const rows = db.prepare("SELECT artist_id, album_artist, title FROM albums WHERE match_state != 'dismissed'").all();
  const byKey = new Set();
  const byArtist = new Map(); // artist_id -> Set(cleanTitleForMatch(title))
  for (const r of rows) {
    byKey.add(matchKey(r.album_artist, r.title));
    if (r.artist_id != null) {
      let s = byArtist.get(r.artist_id);
      if (!s) byArtist.set(r.artist_id, (s = new Set()));
      s.add(cleanTitleForMatch(r.title));
    }
  }
  return (artistId, artist, title) => {
    if (byKey.has(matchKey(artist, title))) return true;
    const s = artistId != null ? byArtist.get(artistId) : null;
    return !!(s && s.has(cleanTitleForMatch(title)));
  };
}

// NOVEDADES ADELANTADAS: MusicBrainz va con retraso en estrenos recientes, así que sus
// discografías (release_groups) no traen lo que salió ayer. Deezer y Spotify sí lo tienen
// el día 1. Para cada artista SEGUIDO, pedimos su discografía reciente ahí y marcamos lo
// que NO tienes y MB AÚN no lista → aparece en Lanzamientos antes que en ningún sitio.
// Cuando MB (o tu biblioteca) lo alcanza, se poda solo. Deezer no necesita API key;
// Spotify se activa si hay credenciales (client credentials).

const UA = 'Liderarrr ( https://github.com/probertoj/Liderarrr )';

// Discografía reciente de Deezer por id de artista. Sin API key. (Exportada: la reusa el
// radar de descubrimiento para los estrenos de artistas similares.)
export async function deezerArtistAlbums(artistId) {
  try {
    const res = await fetch(`https://api.deezer.com/artist/${artistId}/albums?limit=100`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((al) => ({
      source: 'deezer',
      title: al.title,
      release_date: al.release_date || null,
      record_type: al.record_type || 'album', // album | ep | single | compile
      cover: al.cover_xl || al.cover_big || al.cover_medium || null,
      url: al.link || null,
    }));
  } catch {
    return [];
  }
}

// Se guardan discos (album/ep) Y singles (canciones nuevas, vista aparte). Fuera
// recopilatorios y demás. La vista de discos excluye 'single' (ver externalNewReleases).
const STORE_TYPES = new Set(['album', 'ep', 'single']);
const SINGLE_RETENTION_DAYS = 45; // los singles caducan antes que los discos (hay muchos)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Estado del barrido externo, para que la UI muestre progreso sin bloquear la petición
// (barrer miles de artistas de la colección tarda minutos). El botón «Buscar novedades
// ahora» lo lanza en segundo plano y consulta este objeto.
export const externalRefreshStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  done: 0, // artistas sondeados en esta pasada
  total: 0, // artistas en la cola de esta pasada
  searched: 0, // ids de Deezer resueltos por primera vez en esta pasada
  added: 0, // novedades nuevas (que no tienes) detectadas
  count: 0, // total de novedades (discos) que no tienes tras la pasada
  seeds: 0,
  lastError: null,
};

const upsert = db.prepare(
  `INSERT INTO external_releases
     (source, artist_id, artist, title, match_key, release_date, record_type, cover, url, ahead, first_seen)
   VALUES (@source, @artist_id, @artist, @title, @match_key, @release_date, @record_type, @cover, @url, @ahead, @now)
   ON CONFLICT(artist_id, match_key) DO UPDATE SET
     source = excluded.source,
     release_date = excluded.release_date,
     record_type = excluded.record_type,
     cover = COALESCE(excluded.cover, external_releases.cover),
     url = COALESCE(excluded.url, external_releases.url),
     ahead = excluded.ahead
   WHERE external_releases.dismissed = 0`
);

// Caché del id de Deezer por artista: buscar una vez, reusar siempre. Sin esto, barrer los
// miles de artistas de la colección re-buscaría en cada refresco (2 llamadas por artista).
const setDeezerId = db.prepare('UPDATE artists SET deezer_id = ?, deezer_checked_at = ? WHERE id = ?');
const markChecked = db.prepare('UPDATE artists SET ext_checked_at = ? WHERE id = ?');
const DEEZER_RECHECK_MS = 30 * 24 * 3600 * 1000; // reintentar los «no hallado» al mes

// Resuelve (y cachea) el id de Deezer de un artista de la colección. Devuelve el id (>0),
// -1 si se buscó y no hay coincidencia fiable, o null si el fallo fue transitorio (no cachea).
async function resolveDeezerId(s, now) {
  if (s.deezer_id != null) {
    // -1 = no hallado; reintenta solo pasado un tiempo, por si Deezer lo ha añadido
    if (s.deezer_id > 0) return s.deezer_id;
    if (now - (s.deezer_checked_at || 0) < DEEZER_RECHECK_MS) return -1;
  }
  let id;
  try {
    const d = await deezerFindArtist(s.name);
    // Guard: el artista de Deezer debe coincidir por nombre normalizado, para no traer la
    // discografía de un homónimo popular.
    id = d?.id && normName(d.name) === normName(s.name) ? d.id : -1;
  } catch {
    return null; // Deezer caído: no lo cacheamos como «no hallado»
  }
  setDeezerId.run(id, now, s.id);
  return id;
}

// Recalcula las novedades externas: estrenos RECIENTES de TU COLECCIÓN — artistas seguidos Y
// artistas que tienes en la biblioteca (aunque no los sigas, p.ej. Olivia Rodrigo) — en
// Deezer + Spotify, tengas MB constancia o no. Las que MB aún no lista se marcan `ahead = 1`
// («adelantada»). Como la colección puede tener miles de artistas, se BARRE POR ROTACIÓN:
// cada pasada sondea a los seguidos (siempre) más un lote de la colección ordenado por
// «el que lleva más sin mirarse», con throttle para no saturar Deezer. Varias pasadas
// (nocturnas o manuales) cubren toda la colección; los singles se conservan 45 días, así que
// un estreno reciente sigue visible cuando le llega su turno. months = ventana hacia atrás.
export async function refreshExternalReleases({
  months = 6,
  ownedPerRun = 1200, // artistas de colección (no seguidos) por pasada; el resto, en la siguiente
  throttleMs = 150, // pausa entre llamadas a Deezer, para respetar su límite (~50 req/5 s)
  newSearchCap = 700, // topes de ids nuevos por resolver por pasada (reparte el coste inicial)
} = {}) {
  if (externalRefreshStatus.running) return { ...externalRefreshStatus, busy: true };

  // Semillas: SEGUIDOS ∪ COLECCIÓN (artistas con álbumes). Los seguidos primero y siempre;
  // los de colección, por rotación (los menos mirados antes). Un solo barrido acotado.
  const followed = db
    .prepare(
      `SELECT ar.id, ar.name, ar.deezer_id, ar.deezer_checked_at
         FROM tracked_artists t JOIN artists ar ON ar.id = t.artist_id
        WHERE t.facet = 'artist' AND ar.name IS NOT NULL AND ar.name != ''`
    )
    .all();
  const followedIds = new Set(followed.map((r) => r.id));
  const ownedPool = db
    .prepare(
      `SELECT DISTINCT ar.id, ar.name, ar.deezer_id, ar.deezer_checked_at, ar.ext_checked_at
         FROM albums al JOIN artists ar ON ar.id = al.artist_id
        WHERE al.match_state != 'dismissed' AND ar.name IS NOT NULL AND ar.name != ''
        ORDER BY ar.ext_checked_at IS NULL DESC, ar.ext_checked_at ASC`
    )
    .all()
    .filter((r) => !followedIds.has(r.id))
    .slice(0, ownedPerRun);
  const seeds = [...followed, ...ownedPool];
  if (!seeds.length) return { count: 0, added: 0, seeds: 0 };

  const cutoff = new Date(Date.now() - months * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  // lo que YA tienes (cruce robusto) y lo que MB YA conoce (release_groups): para no repetir
  const owned = buildOwnedCheck();
  const mbKeys = new Set(
    db
      .prepare('SELECT ar.name AS artist, rg.title FROM release_groups rg JOIN artists ar ON ar.id = rg.artist_id')
      .all()
      .map((r) => matchKey(r.artist, r.title))
  );

  const spotifyOn = spotifyConfigured();
  const now = Date.now();
  Object.assign(externalRefreshStatus, {
    running: true,
    startedAt: now,
    finishedAt: null,
    done: 0,
    total: seeds.length,
    searched: 0,
    added: 0,
    count: 0,
    seeds: seeds.length,
    lastError: null,
  });
  let added = 0;

  try {
    for (const s of seeds) {
      const candidates = [];
      // Deezer: id cacheado o resuelto ahora (con tope de búsquedas nuevas por pasada).
      let dzId = s.deezer_id;
      if (dzId == null || (dzId < 0 && now - (s.deezer_checked_at || 0) >= DEEZER_RECHECK_MS)) {
        if (externalRefreshStatus.searched < newSearchCap) {
          externalRefreshStatus.searched++;
          // eslint-disable-next-line no-await-in-loop
          dzId = await resolveDeezerId(s, now);
          // eslint-disable-next-line no-await-in-loop
          if (throttleMs) await sleep(throttleMs);
        } else {
          dzId = null; // sin cupo de búsqueda: se resolverá en la próxima pasada
        }
      }
      if (dzId && dzId > 0) {
        try {
          // eslint-disable-next-line no-await-in-loop
          candidates.push(...(await deezerArtistAlbums(dzId)));
        } catch {
          /* Deezer caído para este artista: seguimos */
        }
        // eslint-disable-next-line no-await-in-loop
        if (throttleMs) await sleep(throttleMs);
      }
      // Spotify (si hay credenciales)
      if (spotifyOn) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const sp = await spotifyArtistAlbums(s.name);
          if (sp.length && normName(sp[0].artistName) === normName(s.name)) candidates.push(...sp);
        } catch {
          /* idem */
        }
      }

      for (const c of candidates) {
        const type = String(c.record_type || 'album').toLowerCase();
        if (!STORE_TYPES.has(type)) continue;
        const date = (c.release_date || '').slice(0, 10);
        if (!date || date < cutoff || date === '0000-00-00') continue;
        const mk = matchKey(s.name, c.title);
        // Guardamos TODOS los estrenos recientes (también los que ya tienes), para poder
        // ofrecer la opción «mostrar los que ya tengo». El filtrado por propiedad se hace EN
        // VIVO al mostrar. `added` cuenta solo los NUEVOS que NO tienes (para el aviso).
        const isOwnedRel = owned(s.id, s.name, c.title);
        const info = upsert.run({
          source: c.source,
          artist_id: s.id,
          artist: s.name,
          title: c.title,
          match_key: mk,
          release_date: date,
          record_type: type,
          cover: c.cover || null,
          url: c.url || null,
          ahead: mbKeys.has(mk) ? 0 : 1, // MB aún no lo lista → adelantada
          now,
        });
        if (info.changes && !isOwnedRel) added++;
      }
      // marca de rotación SOLO si hubo resolución definitiva (id>0 o -1 «no hallado»). Si
      // saltamos por agotar el cupo de búsquedas o por fallo transitorio (dzId == null), NO
      // lo marcamos: así se reintenta en la próxima pasada en vez de irse al final de la cola.
      if (dzId != null) markChecked.run(now, s.id);
      externalRefreshStatus.done++;
      externalRefreshStatus.added = added;
    }

    // poda: fuera solo lo más viejo que la ventana (los que ya tienes se conservan, para la
    // opción «mostrar los que ya tengo»; lo que MB alcanza deja de ser «adelantada» vía upsert)
    const singleCutoff = new Date(Date.now() - SINGLE_RETENTION_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const stored = db.prepare('SELECT id, release_date, record_type FROM external_releases').all();
    const del = db.prepare('DELETE FROM external_releases WHERE id = ?');
    const prune = db.transaction(() => {
      for (const r of stored) {
        if (!r.release_date) continue;
        const limit = r.record_type === 'single' ? singleCutoff : cutoff; // singles caducan antes
        if (r.release_date < limit) del.run(r.id);
      }
    });
    prune();

    const count = externalNewReleases({ limit: 100000 }).length; // los que NO tienes (para el aviso)
    externalRefreshStatus.count = count;
    return { count, added, seeds: seeds.length };
  } catch (err) {
    externalRefreshStatus.lastError = String(err.message || err);
    throw err;
  } finally {
    externalRefreshStatus.running = false;
    externalRefreshStatus.finishedAt = Date.now();
  }
}

// Novedades para la UI (Lanzamientos). Más recientes primero; `ahead` marca las que MB
// aún no lista (para el badge «⚡ MB no lo tiene»). Marca el artista local.
export function externalNewReleases({ limit = 200, includeOwned = false } = {}) {
  // Propiedad EN VIVO (no un flag guardado): por defecto oculta lo que ya tienes; con
  // includeOwned se muestran también, marcados con `owned` para que la UI lo indique.
  const owned = buildOwnedCheck();
  return db
    .prepare(
      `SELECT e.id, e.source, e.artist_id, e.artist, e.title, e.release_date, e.record_type, e.cover, e.url, e.ahead,
        (SELECT 1 FROM tracked_artists ta WHERE ta.artist_id = e.artist_id) AS tracked
       FROM external_releases e
       WHERE e.dismissed = 0 AND e.record_type != 'single'
       ORDER BY e.release_date DESC, e.artist COLLATE NOCASE`
    )
    .all()
    .map((r) => ({ ...r, tracked: !!r.tracked, ahead: !!r.ahead, owned: owned(r.artist_id, r.artist, r.title) }))
    .filter((r) => includeOwned || !r.owned)
    .slice(0, limit);
}

// Canciones nuevas (singles) de tus artistas seguidos en los últimos `days` días. Vista
// aparte de los discos (Lanzamientos). Más recientes primero.
export function externalNewSongs({ days = 7, includeOwned = false, limit = 300 } = {}) {
  const since = new Date(Date.now() - Math.max(0, Number(days) || 0) * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const owned = buildOwnedCheck();
  return db
    .prepare(
      `SELECT e.id, e.source, e.artist_id, e.artist, e.title, e.release_date, e.record_type, e.cover, e.url, e.ahead,
        (SELECT 1 FROM tracked_artists ta WHERE ta.artist_id = e.artist_id) AS tracked
       FROM external_releases e
       WHERE e.dismissed = 0 AND e.record_type = 'single' AND e.release_date >= @since
       ORDER BY e.release_date DESC, e.artist COLLATE NOCASE`
    )
    .all({ since })
    .map((r) => ({ ...r, tracked: !!r.tracked, ahead: !!r.ahead, owned: owned(r.artist_id, r.artist, r.title) }))
    .filter((r) => includeOwned || !r.owned)
    .slice(0, limit);
}

export function dismissExternalRelease(id) {
  db.prepare('UPDATE external_releases SET dismissed = 1 WHERE id = ?').run(Number(id));
  return { ok: true };
}
