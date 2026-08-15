import { db } from './db.js';
import { searchArtists, searchReleaseGroups } from './musicbrainz.js';
import { matchKey, normName } from './matchkey.js';

// Búsqueda rápida del Dashboard: el punto de entrada. Dos niveles:
//  - LOCAL (instantáneo, SQL): artistas y discos que YA tienes → a su ficha.
//  - EXTERNO (MusicBrainz): artistas y discos que NO tienes → seguir / descargar.
// La idea rectora de la app: lo que tienes y, sobre todo, lo que aún no tienes.

// Búsqueda local instantánea (para cada tecla). Artistas por nombre, discos por título
// o artista. Limitado y ligero.
export function findLocal(q, limit = 6) {
  const term = String(q || '').trim();
  if (!term) return { artists: [], albums: [] };
  const like = `%${term}%`;
  const starts = `${term}%`;
  const artists = db
    .prepare(
      `SELECT ar.id, ar.name, COUNT(a.id) AS albums,
        (SELECT a2.id FROM albums a2 WHERE a2.artist_id=ar.id AND a2.match_state!='dismissed'
          ORDER BY (a2.cover IS NULL), a2.added_at DESC LIMIT 1) AS cover_album_id
       FROM artists ar JOIN albums a ON a.artist_id=ar.id AND a.match_state!='dismissed'
       WHERE ar.name LIKE @like
       GROUP BY ar.id HAVING albums > 0
       ORDER BY (ar.name LIKE @starts) DESC, albums DESC LIMIT @limit`
    )
    .all({ like, starts, limit });
  const albums = db
    .prepare(
      `SELECT id, title, album_artist, year, artist_id FROM albums
       WHERE match_state != 'dismissed' AND (title LIKE @like OR album_artist LIKE @like)
       ORDER BY (title LIKE @starts) DESC, album_artist COLLATE NOCASE LIMIT @limit`
    )
    .all({ like, starts, limit });
  return { artists, albums };
}

// Búsqueda externa en MusicBrainz: artistas y release-groups. Cada resultado se cruza con
// tu biblioteca para saber si ya lo tienes/sigues (y no ofrecerte añadir lo que ya está).
export async function findExternal(q) {
  const term = String(q || '').trim();
  if (!term) return { artists: [], albums: [] };
  const [mbArtists, mbRgs] = await Promise.all([
    searchArtists(term, 6).catch(() => []),
    searchReleaseGroups(term, null, 6).catch(() => []),
  ]);

  const localArtistByMbid = new Map(db.prepare('SELECT id, mbid FROM artists WHERE mbid IS NOT NULL').all().map((a) => [a.mbid, a.id]));
  const localArtistByName = new Map(db.prepare('SELECT id, name FROM artists').all().map((a) => [normName(a.name), a.id]));
  const tracked = new Set(db.prepare("SELECT DISTINCT artist_id FROM tracked_artists WHERE facet='artist'").all().map((r) => r.artist_id));
  const owned = db.prepare("SELECT rg_mbid, album_artist, title FROM albums WHERE match_state != 'dismissed'").all();
  const ownedRg = new Set(owned.filter((o) => o.rg_mbid).map((o) => o.rg_mbid));
  const ownedKey = new Set(owned.map((o) => matchKey(o.album_artist, o.title)));

  const artists = mbArtists.map((a) => {
    const localId = (a.mbid && localArtistByMbid.get(a.mbid)) || localArtistByName.get(normName(a.name)) || null;
    return {
      mbid: a.mbid,
      name: a.name,
      disambiguation: a.disambiguation,
      country: a.country,
      type: a.type,
      artist_id: localId,
      tracked: localId ? tracked.has(localId) : false,
    };
  });

  const albums = mbRgs.map((r) => ({
    rg_mbid: r.rg_mbid,
    title: r.title,
    artist: r.artist,
    year: r.year,
    primary_type: r.primary_type,
    owned: (r.rg_mbid && ownedRg.has(r.rg_mbid)) || ownedKey.has(matchKey(r.artist, r.title)),
  }));

  return { artists, albums };
}
