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

// La brecha: artistas que escuchas mucho y de los que tienes poco o nada.
// El mejor candidato a seguir/encargar, porque es tu gusto real, no un algoritmo.
export function ownershipGap({ minPlays = 15 } = {}) {
  return db
    .prepare(
      `SELECT l.artist, COUNT(*) AS plays,
        (SELECT ar.id FROM artists ar WHERE ar.name = l.artist COLLATE NOCASE LIMIT 1) AS artist_id,
        (SELECT ar.mbid FROM artists ar WHERE ar.name = l.artist COLLATE NOCASE LIMIT 1) AS artist_mbid,
        (SELECT COUNT(*) FROM albums a JOIN artists ar ON ar.id=a.artist_id
          WHERE ar.name = l.artist COLLATE NOCASE AND a.match_state!='dismissed') AS owned_albums,
        (SELECT 1 FROM tracked_artists t JOIN artists ar ON ar.id=t.artist_id
          WHERE ar.name = l.artist COLLATE NOCASE LIMIT 1) AS tracked
       FROM listens l WHERE l.source='lastfm'
       GROUP BY l.artist COLLATE NOCASE
       HAVING plays >= @minPlays AND owned_albums <= 1
       ORDER BY plays DESC, owned_albums ASC LIMIT 60`
    )
    .all({ minPlays })
    .map((r) => ({ ...r, tracked: !!r.tracked }));
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
