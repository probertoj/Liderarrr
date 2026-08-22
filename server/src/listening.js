import { db } from './db.js';
import { deezerAlbumCover } from './artistpix.js';

// Análisis de escuchas y la brecha escucha↔propiedad.
//
// CLAVE DE RENDIMIENTO: better-sqlite3 es SÍNCRONO y corre en el hilo principal,
// así que una consulta lenta congela TODO el servidor (peticiones y healthcheck).
// Con ~128k escuchas y ~3k álbumes, cruzarlos con subconsultas correlacionadas en
// SQL era O(álbumes × escuchas) → decenas de segundos. Por eso el cruce se hace
// EN MEMORIA: una pasada por cada tabla para montar Sets/Maps, y luego se casan.

// Normalización para casar Last.fm con la biblioteca pese a mayúsculas, acentos,
// "The" inicial o espacios/puntuación (el COLLATE NOCASE de SQLite solo pliega ASCII).
const strip = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
const normArtist = (s) => strip(String(s || '').toLowerCase().replace(/^the\s+/, ''));
const normText = (s) => strip(s);
const albumKey = (artist, title) => `${normArtist(artist)}|${normText(title)}`;

export function hasScrobbles() {
  return db.prepare("SELECT COUNT(*) AS n FROM listens WHERE source='lastfm'").get().n > 0;
}

// Mapa nombre-normalizado -> { albums, id, mbid } de artistas que TIENES.
function ownedArtistMap() {
  const rows = db
    .prepare(
      `SELECT ar.id, ar.name, ar.mbid, COUNT(a.id) AS albums
       FROM artists ar JOIN albums a ON a.artist_id=ar.id AND a.match_state!='dismissed'
       GROUP BY ar.id`
    )
    .all();
  const map = new Map();
  for (const r of rows) {
    const k = normArtist(r.name);
    if (!k) continue;
    const e = map.get(k) || { albums: 0, id: r.id, mbid: r.mbid };
    e.albums += r.albums;
    if (!e.mbid && r.mbid) e.mbid = r.mbid;
    map.set(k, e);
  }
  return map;
}

// Set de álbumes que tienes (clave artista|título normalizada).
function ownedAlbumSet() {
  const s = new Set();
  for (const a of db.prepare("SELECT album_artist, title FROM albums WHERE match_state != 'dismissed'").all())
    s.add(albumKey(a.album_artist, a.title));
  return s;
}

function trackedArtistSet() {
  return new Set(
    db.prepare('SELECT ar.name FROM tracked_artists t JOIN artists ar ON ar.id=t.artist_id').all().map((r) => normArtist(r.name))
  );
}

export function listeningOverview() {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS scrobbles, COUNT(DISTINCT artist) AS artists,
        COUNT(DISTINCT artist || '|' || album) AS albums,
        MIN(ts) AS first, MAX(ts) AS last
       FROM listens WHERE source='lastfm'`
    )
    .get();

  const owned = ownedArtistMap();
  const topArtists = db
    .prepare("SELECT artist, COUNT(*) AS plays FROM listens WHERE source='lastfm' GROUP BY LOWER(artist) ORDER BY plays DESC LIMIT 25")
    .all()
    .map((r) => {
      const o = owned.get(normArtist(r.artist));
      return { artist: r.artist, plays: r.plays, artist_id: o?.id || null, owned_albums: o?.albums || 0 };
    });

  const ownedAlbums = ownedAlbumSet();
  const topAlbums = db
    .prepare(
      "SELECT artist, album, COUNT(*) AS plays FROM listens WHERE source='lastfm' AND album<>'' GROUP BY LOWER(artist), LOWER(album) ORDER BY plays DESC LIMIT 25"
    )
    .all()
    .map((r) => ({ artist: r.artist, album: r.album, plays: r.plays, owned: ownedAlbums.has(albumKey(r.artist, r.album)) }));

  const byYear = db
    .prepare(
      `SELECT CAST(strftime('%Y', ts/1000, 'unixepoch') AS INTEGER) AS year, COUNT(*) AS plays
       FROM listens WHERE source='lastfm' GROUP BY year ORDER BY year`
    )
    .all();

  return { totals, topArtists, topAlbums, byYear };
}

// Los más escuchados en una ventana de fecha (since = ms, o null = todo). Devuelve
// artistas y álbumes, cada uno marcando lo que ya tienes. Es «Más escuchados» pero
// acotable: «lo que más he oído este mes / esta semana / este año».
export function topPlayed({ since = null, limit = 12 } = {}) {
  const owned = ownedArtistMap();
  const ownedAlbums = ownedAlbumSet();
  const args = { limit };
  let sinceClause = '';
  if (since) {
    sinceClause = ' AND ts >= @since';
    args.since = Number(since);
  }
  const artists = db
    .prepare(
      `SELECT artist, COUNT(*) AS plays FROM listens WHERE source='lastfm'${sinceClause}
       GROUP BY LOWER(artist) ORDER BY plays DESC LIMIT @limit`
    )
    .all(args)
    .map((r) => {
      const o = owned.get(normArtist(r.artist));
      return { artist: r.artist, plays: r.plays, artist_id: o?.id || null, owned_albums: o?.albums || 0 };
    });
  const albums = db
    .prepare(
      `SELECT artist, album, COUNT(*) AS plays FROM listens WHERE source='lastfm' AND album<>''${sinceClause}
       GROUP BY LOWER(artist), LOWER(album) ORDER BY plays DESC LIMIT @limit`
    )
    .all(args)
    .map((r) => ({ artist: r.artist, album: r.album, plays: r.plays, owned: ownedAlbums.has(albumKey(r.artist, r.album)) }));
  return { artists, albums };
}

// «Resumen» tipo Wrapped: la foto de un periodo (semana/mes/año o todo, vía since/until en
// ms). Totales, top artistas y álbumes escuchados (con carátula para el mosaico), cuántos
// discos añadiste a la colección y tu evolución por mes.
export async function wrapped({ since = null, until = null } = {}) {
  const range = (col = 'ts') => {
    let c = '';
    const a = {};
    if (since != null) {
      c += ` AND ${col} >= @since`;
      a.since = since;
    }
    if (until != null) {
      c += ` AND ${col} <= @until`;
      a.until = until;
    }
    return { c, a };
  };
  const rt = range();
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS scrobbles, COUNT(DISTINCT LOWER(artist)) AS artists,
        COUNT(DISTINCT LOWER(artist) || '|' || LOWER(album)) AS albums
       FROM listens WHERE source='lastfm'${rt.c}`
    )
    .get(rt.a);

  const owned = ownedArtistMap();
  const topArtists = db
    .prepare(`SELECT artist, COUNT(*) AS plays FROM listens WHERE source='lastfm'${rt.c} GROUP BY LOWER(artist) ORDER BY plays DESC LIMIT 12`)
    .all(rt.a)
    .map((r) => {
      const o = owned.get(normArtist(r.artist));
      return { artist: r.artist, plays: r.plays, artist_id: o?.id || null, owned_albums: o?.albums || 0 };
    });

  // mapa clave-álbum → id local (para carátula instantánea de lo que tienes)
  const ownedAlbumMap = new Map();
  for (const a of db.prepare("SELECT id, album_artist, title FROM albums WHERE match_state != 'dismissed'").all()) {
    const k = albumKey(a.album_artist, a.title);
    if (!ownedAlbumMap.has(k)) ownedAlbumMap.set(k, a.id);
  }
  const topAlbums = db
    .prepare(
      `SELECT artist, album, COUNT(*) AS plays FROM listens WHERE source='lastfm' AND album<>''${rt.c}
       GROUP BY LOWER(artist), LOWER(album) ORDER BY plays DESC LIMIT 24`
    )
    .all(rt.a)
    .map((r) => {
      const id = ownedAlbumMap.get(albumKey(r.artist, r.album)) || null;
      return { artist: r.artist, album: r.album, plays: r.plays, album_id: id, owned: !!id, cover: null };
    });
  // carátula de los que NO tienes: Deezer (cacheado), en paralelo, para el mosaico
  await Promise.all(
    topAlbums
      .filter((a) => !a.album_id)
      .map(async (a) => {
        a.cover = await deezerAlbumCover(a.artist, a.album).catch(() => null);
      })
  );

  // discos añadidos a la colección en el periodo (albums.added_at = mtime de la carpeta)
  const ra = range('added_at');
  const addedCount = db
    .prepare(`SELECT COUNT(*) AS n FROM albums WHERE match_state != 'dismissed' AND added_at IS NOT NULL${ra.c}`)
    .get(ra.a).n;
  const addedTop = db
    .prepare(
      `SELECT id, album_artist, title, year FROM albums
       WHERE match_state != 'dismissed' AND added_at IS NOT NULL${ra.c} ORDER BY added_at DESC LIMIT 12`
    )
    .all(ra.a);

  const byMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', ts/1000, 'unixepoch') AS month, COUNT(*) AS plays
       FROM listens WHERE source='lastfm'${rt.c} GROUP BY month ORDER BY month`
    )
    .all(rt.a);

  const years = db
    .prepare("SELECT DISTINCT CAST(strftime('%Y', ts/1000, 'unixepoch') AS INTEGER) AS y FROM listens WHERE source='lastfm' ORDER BY y DESC")
    .all()
    .map((r) => r.y);

  return { totals, topArtists, topAlbums, addedCount, addedTop, byMonth, years };
}

// La brecha: artistas que escuchas mucho y de los que tienes poco o nada.
// El mejor candidato a seguir/encargar, porque es tu gusto real, no un algoritmo.
export function ownershipGap({ minPlays = 15, since = null } = {}) {
  const owned = ownedArtistMap();
  const tracked = trackedArtistSet();
  const scrobbles = new Map();
  const args = {};
  let sinceClause = '';
  if (since) {
    sinceClause = ' AND ts >= @since';
    args.since = Number(since);
  }
  for (const r of db.prepare(`SELECT artist, COUNT(*) AS plays FROM listens WHERE source='lastfm'${sinceClause} GROUP BY LOWER(artist)`).all(args)) {
    const k = normArtist(r.artist);
    if (!k) continue;
    const e = scrobbles.get(k) || { artist: r.artist, plays: 0 };
    e.plays += r.plays;
    scrobbles.set(k, e);
  }
  const out = [];
  for (const [k, s] of scrobbles) {
    const o = owned.get(k);
    const ownedAlbums = o?.albums || 0;
    if (s.plays >= minPlays && ownedAlbums <= 1) {
      out.push({
        artist: s.artist,
        plays: s.plays,
        owned_albums: ownedAlbums,
        artist_id: o?.id || null,
        artist_mbid: o?.mbid || null,
        tracked: tracked.has(k),
      });
    }
  }
  out.sort((a, b) => b.plays - a.plays || a.owned_albums - b.owned_albums);
  return out.slice(0, 60);
}

// Brecha a nivel de ÁLBUM y acotable por fecha: discos que has escuchado (en la ventana
// dada) y que NO tienes. Con `since` = «último mes/3 meses/este año», sirve para pasar a
// propios los discos que suenas ahora (p. ej. en Spotify vía Last.fm) y aún no tienes.
export function unownedScrobbledAlbums({ since = null, minPlays = 2 } = {}) {
  const ownedAlbums = ownedAlbumSet();
  const owned = ownedArtistMap();
  const args = { minPlays };
  let sinceClause = '';
  if (since) {
    sinceClause = ' AND ts >= @since';
    args.since = Number(since);
  }
  const rows = db
    .prepare(
      `SELECT artist, album, COUNT(*) AS plays, MAX(ts) AS last
       FROM listens WHERE source='lastfm' AND album<>''${sinceClause}
       GROUP BY LOWER(artist), LOWER(album) HAVING plays >= @minPlays
       ORDER BY plays DESC, last DESC LIMIT 400`
    )
    .all(args);
  const out = [];
  for (const r of rows) {
    if (ownedAlbums.has(albumKey(r.artist, r.album))) continue;
    const o = owned.get(normArtist(r.artist));
    out.push({ artist: r.artist, album: r.album, plays: r.plays, last: r.last, artist_id: o?.id || null, artist_mbid: o?.mbid || null });
    if (out.length >= 120) break;
  }
  return out;
}

// Últimas escuchas para el dashboard: álbumes distintos más recientes. Usa el
// índice de fecha (LIMIT sobre ts DESC) y deduplica en memoria, en vez de un
// GROUP BY caro sobre las 128k filas.
export function recentListenedAlbums(limit = 14) {
  const idByKey = new Map();
  for (const a of db.prepare("SELECT id, album_artist, title FROM albums WHERE match_state != 'dismissed'").all())
    idByKey.set(albumKey(a.album_artist, a.title), a.id);
  const seen = new Set();
  const out = [];
  for (const r of db.prepare("SELECT artist, album, ts FROM listens WHERE source='lastfm' AND album<>'' ORDER BY ts DESC LIMIT 2000").all()) {
    const k = albumKey(r.artist, r.album);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ artist: r.artist, album: r.album, ts: r.ts, album_id: idByKey.get(k) || null });
    if (out.length >= limit) break;
  }
  return out;
}

// Álbumes que TIENES pero no has escuchado nunca (según Last.fm). Joyas olvidadas
// en tu propio disco. Cruce en memoria: Set de escuchados + filtro de álbumes.
export function ownedUnplayed() {
  const listened = new Set();
  for (const r of db.prepare("SELECT DISTINCT artist, album FROM listens WHERE source='lastfm' AND album<>''").all())
    listened.add(albumKey(r.artist, r.album));
  const albums = db
    .prepare(
      `SELECT id, title, album_artist, year, cover FROM albums
       WHERE match_state NOT IN ('dismissed','orphan') ORDER BY album_artist, year`
    )
    .all();
  const out = [];
  for (const a of albums) {
    if (!listened.has(albumKey(a.album_artist, a.title))) out.push(a);
    if (out.length >= 100) break;
  }
  return out;
}
