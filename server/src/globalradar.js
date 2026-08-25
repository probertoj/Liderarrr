import { db, cacheRead, cacheWrite } from './db.js';
import { matchKey, normName } from './matchkey.js';
import { spotifyNewReleases, spotifyConfigured } from './spotify.js';
import { deezerFindArtist } from './artistpix.js';
import { deezerArtistAlbums } from './newreleases.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Estado del barrido global (para progreso en la UI, no bloquear la petición).
export const globalRefreshStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  done: 0,
  total: 0,
  added: 0,
  count: 0,
  spotify: null, // 'ok' | 'no configurado' | mensaje de error (p.ej. deprecado)
  lastError: null,
};

// Id de Deezer de un artista SIMILAR (no está en tu biblioteca), cacheado 30 días —también
// los «no hallado»— para no re-buscar en cada refresco. Guard por nombre normalizado.
const DEEZER_ID_TTL = 30 * 24 * 3600 * 1000;
async function cachedDeezerId(name) {
  const key = `deezer:simartist:${normName(name)}`;
  const cached = cacheRead(key, DEEZER_ID_TTL);
  if (cached !== null) return cached.id; // incluye -1 (no hallado) cacheado
  let id = -1;
  try {
    const d = await deezerFindArtist(name);
    if (d?.id && normName(d.name) === normName(name)) id = d.id;
  } catch {
    return null; // fallo transitorio: no cachea
  }
  cacheWrite(key, { id });
  return id;
}

// RADAR DE DESCUBRIMIENTO («otros grupos»): novedades GLOBALES del feed editorial de Spotify,
// de cualquier artista, ordenadas por AFINIDAD contigo. No es un firehose: resalta primero lo
// de artistas que ya tienes/sigues y lo PARECIDO a lo que te gusta (similares de Last.fm), y
// deja el resto (descubrimiento puro) al final o escondido. La afinidad se calcula EN VIVO al
// leer (tu colección y tus similares cambian), no se guarda; en la tabla solo va el crudo.

const STORE_TYPES = new Set(['album', 'ep', 'single']); // fuera 'compilation' y demás
const RETENTION_DAYS = 45; // el feed editorial es reciente; poda lo más viejo que esto

const upsert = db.prepare(
  `INSERT INTO global_releases
     (source, artist, artists_json, title, match_key, release_date, record_type, cover, url, first_seen)
   VALUES (@source, @artist, @artists_json, @title, @match_key, @release_date, @record_type, @cover, @url, @now)
   ON CONFLICT(source, match_key) DO UPDATE SET
     release_date = excluded.release_date,
     record_type = excluded.record_type,
     cover = COALESCE(excluded.cover, global_releases.cover),
     url = COALESCE(excluded.url, global_releases.url),
     artists_json = excluded.artists_json
   WHERE global_releases.dismissed = 0`
);

const storeRow = (now) => (source, artist, artists, title, date, type, cover, url) => {
  if (!STORE_TYPES.has(type) || !artist) return 0;
  if (!date || date.length < 10) return 0; // sin fecha completa no sirve para «hoy/ayer»
  const info = upsert.run({
    source,
    artist,
    artists_json: JSON.stringify(artists && artists.length ? artists : [artist]),
    title,
    match_key: matchKey(artist, title),
    release_date: date,
    record_type: type,
    cover: cover || null,
    url: url || null,
    now,
  });
  return info.changes ? 1 : 0;
};

// Rellena el radar de descubrimiento. FUENTE PRINCIPAL: estrenos recientes de tus artistas
// SIMILARES (los «similares de Last.fm» de artist_suggestions) vía Deezer —sin API key y
// fiable, el mismo camino que «Canciones nuevas»—. FUENTE SECUNDARIA (opcional): el feed
// editorial «New Releases» de Spotify, que Spotify ha ido restringiendo (403 en apps nuevas);
// si falla, se anota y se sigue: el radar no depende de él. windowDays = cuánto hacia atrás
// se recogen los estrenos (la UI luego filtra por su ventana de días).
export async function refreshGlobalReleases({ windowDays = RETENTION_DAYS, throttleMs = 150, spotifyPages = 5 } = {}) {
  if (globalRefreshStatus.running) return { ...globalRefreshStatus, busy: true };
  const now = Date.now();
  const since = new Date(now - windowDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const store = storeRow(now);
  let added = 0;

  // Semillas de descubrimiento (por nombre, sin duplicar): artistas SIMILARES (Last.fm) +
  // artistas de tus SELLOS seguidos (por su catálogo cacheado). De ambos sondeamos sus
  // estrenos recientes en Deezer; el nivel de afinidad («parecido», «de tu sello») se decide
  // al leer. Sondear a un artista que además ya tienes/sigues no molesta: su estreno saldrá
  // en el nivel alto y, si ya lo tienes, se oculta por defecto.
  const seedNames = new Map(); // normName -> nombre a mostrar
  for (const r of db.prepare("SELECT name FROM artist_suggestions WHERE dismissed = 0 AND name IS NOT NULL").all()) {
    seedNames.set(normName(r.name), r.name);
  }
  for (const r of db
    .prepare("SELECT DISTINCT artist_credit AS name FROM label_release_groups WHERE artist_credit IS NOT NULL AND artist_credit != ''")
    .all()) {
    const k = normName(r.name);
    if (!seedNames.has(k)) seedNames.set(k, r.name);
  }
  const seeds = [...seedNames.values()];
  Object.assign(globalRefreshStatus, {
    running: true,
    startedAt: now,
    finishedAt: null,
    done: 0,
    total: seeds.length,
    added: 0,
    count: 0,
    spotify: null,
    lastError: null,
  });

  try {
    // 1) SIMILARES + ARTISTAS DE TUS SELLOS → sus estrenos recientes en Deezer
    for (const name of seeds) {
      const s = { name };
      // eslint-disable-next-line no-await-in-loop
      const dzId = await cachedDeezerId(s.name);
      // eslint-disable-next-line no-await-in-loop
      if (throttleMs) await sleep(throttleMs);
      if (dzId && dzId > 0) {
        let albums = [];
        try {
          // eslint-disable-next-line no-await-in-loop
          albums = await deezerArtistAlbums(dzId);
        } catch {
          /* Deezer caído para este artista */
        }
        // eslint-disable-next-line no-await-in-loop
        if (throttleMs) await sleep(throttleMs);
        for (const c of albums) {
          const date = (c.release_date || '').slice(0, 10);
          if (date && date >= since) {
            added += store('deezer', s.name, [s.name], c.title, date, String(c.record_type || 'album').toLowerCase(), c.cover, c.url);
          }
        }
      }
      globalRefreshStatus.done++;
      globalRefreshStatus.added = added;
    }

    // 2) SPOTIFY new-releases (descubrimiento puro más allá de tus similares) — best-effort
    if (spotifyConfigured()) {
      try {
        const items = await spotifyNewReleases({ pages: spotifyPages });
        globalRefreshStatus.spotify = items.length ? 'ok' : 'sin resultados (endpoint restringido por Spotify)';
        for (const it of items) {
          const artist = (it.artists && it.artists[0]) || it.artist || '';
          added += store(
            'spotify',
            artist,
            it.artists,
            it.title,
            (it.release_date || '').slice(0, 10),
            String(it.record_type || 'album').toLowerCase(),
            it.cover,
            it.url
          );
        }
      } catch (e) {
        globalRefreshStatus.spotify = String(e.message || e);
      }
    } else {
      globalRefreshStatus.spotify = 'no configurado';
    }

    // poda lo más viejo que la ventana de retención
    const cutoff = new Date(now - RETENTION_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
    db.prepare('DELETE FROM global_releases WHERE release_date < ?').run(cutoff);
    const count = db.prepare('SELECT COUNT(*) n FROM global_releases WHERE dismissed = 0').get().n;
    globalRefreshStatus.count = count;
    return { count, added, seeds: seeds.length, spotify: globalRefreshStatus.spotify };
  } catch (err) {
    globalRefreshStatus.lastError = String(err.message || err);
    throw err;
  } finally {
    globalRefreshStatus.running = false;
    globalRefreshStatus.finishedAt = Date.now();
  }
}

// Índices de afinidad (en vivo): artistas tuyos (seguidos/en colección) y parecidos (Last.fm).
function buildAffinity() {
  const mine = new Map(); // normName -> { name, followed:boolean }
  const rows = db
    .prepare(
      `SELECT ar.name AS name,
              EXISTS(SELECT 1 FROM tracked_artists t WHERE t.artist_id = ar.id AND t.facet='artist') AS followed
         FROM artists ar
        WHERE ar.name IS NOT NULL AND ar.name != '' AND (
          EXISTS(SELECT 1 FROM tracked_artists t WHERE t.artist_id = ar.id AND t.facet='artist')
          OR EXISTS(SELECT 1 FROM albums al WHERE al.artist_id = ar.id AND al.match_state != 'dismissed')
        )`
    )
    .all();
  for (const r of rows) {
    const k = normName(r.name);
    const prev = mine.get(k);
    // si aparece como seguido en alguna fila, que gane «followed»
    if (!prev || (r.followed && !prev.followed)) mine.set(k, { name: r.name, followed: !!r.followed });
  }

  const similar = new Map(); // normName -> reasons[] (artistas tuyos a los que se parece)
  try {
    for (const r of db.prepare('SELECT key, reasons FROM artist_suggestions WHERE dismissed = 0').all()) {
      let reasons = [];
      try {
        reasons = JSON.parse(r.reasons || '[]');
      } catch {
        reasons = [];
      }
      similar.set(r.key, reasons);
    }
  } catch {
    /* sin sugerencias todavía */
  }

  // artistas de tus SELLOS seguidos (por su catálogo cacheado) -> nombre del sello, para
  // resaltar sus estrenos aunque no sigas al artista.
  const labelArtists = new Map(); // normName -> nombre del sello
  try {
    for (const r of db
      .prepare(
        `SELECT lrg.artist_credit AS artist, tl.name AS label
           FROM label_release_groups lrg JOIN tracked_labels tl ON tl.label_mbid = lrg.label_mbid
          WHERE lrg.artist_credit IS NOT NULL AND lrg.artist_credit != ''`
      )
      .all()) {
      const k = normName(r.artist);
      if (!labelArtists.has(k)) labelArtists.set(k, r.label);
    }
  } catch {
    /* sin sellos seguidos */
  }

  // ¿ya lo tienes? (para poder ocultar lo que ya está en tu disco)
  const ownedKeys = new Set(
    db
      .prepare("SELECT album_artist, title FROM albums WHERE match_state != 'dismissed'")
      .all()
      .map((r) => matchKey(r.album_artist, r.title))
  );

  return { mine, similar, labelArtists, ownedKeys };
}

// Puntúa una novedad por afinidad, quedándose con la mejor señal entre sus artistas:
// 100 sigues · 90 la tienes · 70 en tu sello seguido · 50 parecido · 0 sin relación.
function scoreRelease(artists, aff) {
  let best = { score: 0, reason: null };
  const bump = (score, reason) => {
    if (score > best.score) best = { score, reason };
  };
  for (const name of artists) {
    const k = normName(name);
    const m = aff.mine.get(k);
    if (m?.followed) bump(100, `Sigues a ${m.name}`);
    else if (m) bump(90, `Tienes a ${m.name} en tu colección`);
    if (aff.labelArtists.has(k)) bump(70, `En tu sello ${aff.labelArtists.get(k)}`);
    if (aff.similar.has(k)) {
      const reasons = aff.similar.get(k) || [];
      bump(50, reasons.length ? `Parecido a ${reasons[0]}` : 'Parecido a lo que escuchas');
    }
  }
  return best;
}

// Novedades globales para la UI, ordenadas por afinidad y fecha. Por defecto solo las que
// tienen relación contigo (score>0) y que NO tienes ya; con includeAll se muestra el feed
// entero (descubrimiento puro incluido) y con includeOwned también lo que ya está en tu disco.
export function globalReleases({ days = 14, includeAll = false, includeOwned = false, limit = 300 } = {}) {
  const since = new Date(Date.now() - Math.max(0, Number(days) || 0) * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const aff = buildAffinity();
  const rows = db
    .prepare(
      `SELECT id, source, artist, artists_json, title, release_date, record_type, cover, url
         FROM global_releases
        WHERE dismissed = 0 AND release_date >= @since
        ORDER BY release_date DESC`
    )
    .all({ since });
  const out = [];
  for (const r of rows) {
    let artists = [r.artist];
    try {
      const a = JSON.parse(r.artists_json || '[]');
      if (Array.isArray(a) && a.length) artists = a;
    } catch {
      /* usa el principal */
    }
    const owned = aff.ownedKeys.has(matchKey(r.artist, r.title));
    if (owned && !includeOwned) continue;
    const { score, reason } = scoreRelease(artists, aff);
    if (score === 0 && !includeAll) continue;
    out.push({
      id: r.id,
      source: r.source,
      artist: r.artist,
      artists,
      title: r.title,
      release_date: r.release_date,
      record_type: r.record_type,
      cover: r.cover,
      url: r.url,
      affinity: score,
      reason,
      owned,
    });
  }
  // afinidad primero, luego fecha (ya venía ordenado por fecha, orden estable)
  out.sort((a, b) => b.affinity - a.affinity);
  return out.slice(0, limit);
}

export function dismissGlobalRelease(id) {
  db.prepare('UPDATE global_releases SET dismissed = 1 WHERE id = ?').run(Number(id));
  return { ok: true };
}
