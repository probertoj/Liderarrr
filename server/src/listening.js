import { db } from './db.js';

// Análisis de escuchas y la brecha escucha↔propiedad. Se casa el texto libre de
// Last.fm con tu biblioteca por nombre (COLLATE NOCASE): imperfecto pero
// suficiente, y lo que no case cuenta como "no lo tienes", que es justo la señal
// que buscamos en la brecha.

export function hasScrobbles() {
  return db.prepare("SELECT COUNT(*) AS n FROM listens WHERE source='lastfm'").get().n > 0;
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

  const topArtists = db
    .prepare(
      `SELECT l.artist, COUNT(*) AS plays,
        (SELECT ar.id FROM artists ar WHERE ar.name = l.artist COLLATE NOCASE LIMIT 1) AS artist_id,
        (SELECT COUNT(*) FROM albums a JOIN artists ar ON ar.id=a.artist_id
          WHERE ar.name = l.artist COLLATE NOCASE AND a.match_state!='dismissed') AS owned_albums
       FROM listens l WHERE l.source='lastfm'
       GROUP BY l.artist COLLATE NOCASE ORDER BY plays DESC LIMIT 25`
    )
    .all();

  const topAlbums = db
    .prepare(
      `SELECT l.artist, l.album, COUNT(*) AS plays,
        (SELECT a.id FROM albums a JOIN artists ar ON ar.id=a.artist_id
          WHERE ar.name = l.artist COLLATE NOCASE AND a.title = l.album COLLATE NOCASE
          AND a.match_state!='dismissed' LIMIT 1) AS owned_album_id
       FROM listens l WHERE l.source='lastfm' AND l.album <> ''
       GROUP BY l.artist COLLATE NOCASE, l.album COLLATE NOCASE ORDER BY plays DESC LIMIT 25`
    )
    .all()
    .map((r) => ({ ...r, owned: !!r.owned_album_id }));

  const byYear = db
    .prepare(
      `SELECT CAST(strftime('%Y', ts/1000, 'unixepoch') AS INTEGER) AS year, COUNT(*) AS plays
       FROM listens WHERE source='lastfm' GROUP BY year ORDER BY year`
    )
    .all();

  return { totals, topArtists, topAlbums, byYear };
}

// Normaliza un nombre de artista para casar Last.fm con la biblioteca pese a
// diferencias de mayúsculas, acentos, "The" inicial o espacios/puntuación. El
// COLLATE NOCASE de SQLite solo pliega ASCII, así que esto se hace en JS.
const normArtist = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, '');

// Mapa nombre-normalizado -> { albums, id, mbid } de lo que TIENES, sumando
// homónimos. Se usa para el cruce con las escuchas.
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

function trackedArtistSet() {
  const rows = db
    .prepare('SELECT ar.name FROM tracked_artists t JOIN artists ar ON ar.id=t.artist_id')
    .all();
  return new Set(rows.map((r) => normArtist(r.name)));
}

// La brecha: artistas que escuchas mucho y de los que tienes poco o nada.
// El mejor candidato a seguir/encargar, porque es tu gusto real, no un algoritmo.
export function ownershipGap({ minPlays = 15 } = {}) {
  const owned = ownedArtistMap();
  const tracked = trackedArtistSet();
  // escuchas por artista (agrupando por nombre normalizado, para fundir variantes)
  const scrobbles = new Map();
  for (const r of db.prepare("SELECT artist, COUNT(*) AS plays FROM listens WHERE source='lastfm' GROUP BY LOWER(artist)").all()) {
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

// Lo contrario, para la sección de escuchas: álbumes que TIENES pero no has
// escuchado nunca (según Last.fm). Joyas olvidadas en tu propio disco.
export function ownedUnplayed() {
  return db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.cover
       FROM albums a
       WHERE a.match_state NOT IN ('dismissed','orphan')
         AND NOT EXISTS (
           SELECT 1 FROM listens l WHERE l.source='lastfm'
             AND l.artist = a.album_artist COLLATE NOCASE
             AND l.album = a.title COLLATE NOCASE)
       ORDER BY a.album_artist, a.year LIMIT 100`
    )
    .all();
}
