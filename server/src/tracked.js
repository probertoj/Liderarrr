import { db } from './db.js';
import * as mb from './musicbrainz.js';
import { enrichArtistDiscography } from './discography.js';

// Artistas que sigues, con faceta (artist | producer | label). Alimentan los
// huecos, el calendario de próximos y el auto-Lidarr. Equivalente a los favoritos
// de PowaFlex, pero aquí la faceta por defecto es "artist".

const followStmt = db.prepare(
  `INSERT INTO tracked_artists (artist_id, facet, added_at) VALUES (?, ?, ?)
   ON CONFLICT(artist_id, facet) DO NOTHING`
);
const unfollowStmt = db.prepare('DELETE FROM tracked_artists WHERE artist_id = ? AND facet = ?');

export function followArtist(artistId, facet = 'artist') {
  const exists = db.prepare('SELECT 1 FROM artists WHERE id = ?').get(artistId);
  if (!exists) throw new Error('Artista no encontrado');
  followStmt.run(artistId, facet, Date.now());
  return { ok: true };
}

export function unfollowArtist(artistId, facet = 'artist') {
  unfollowStmt.run(artistId, facet);
  return { ok: true };
}

// Sigue a un artista por su MBID de MusicBrainz, creándolo en local si no existe
// (para seguir a alguien de quien aún no tienes nada). Tras crearlo, dispara el
// cálculo de su discografía en segundo plano.
export async function followByMbid(mbid, facet = 'artist') {
  if (!mbid) throw new Error('Falta el MBID');
  let row = db.prepare('SELECT id FROM artists WHERE mbid = ?').get(mbid);
  if (!row) {
    const info = await mb.artistByMbid(mbid);
    if (!info) throw new Error('MusicBrainz no conoce ese artista');
    const res = db
      .prepare(
        `INSERT INTO artists (name, sort_name, mbid, type, country, began, ended, disambiguation, details_fetched_at)
         VALUES (@name, @sort_name, @mbid, @type, @country, @began, @ended, @disambiguation, @now)`
      )
      .run({ ...info, now: Date.now() });
    row = { id: Number(res.lastInsertRowid) };
  }
  followArtist(row.id, facet);
  enrichArtistDiscography(row.id).catch(() => {});
  return { ok: true, artist_id: row.id };
}

// Lista de seguidos con su completismo (para la página de favoritos/seguidos).
export function trackedList() {
  return db
    .prepare(
      `SELECT ar.id, ar.name, ar.mbid, ar.country, ar.type,
        GROUP_CONCAT(t.facet) AS facets,
        (SELECT COUNT(*) FROM albums a WHERE a.artist_id = ar.id AND a.match_state != 'dismissed') AS owned_albums,
        s.studio_total, s.studio_owned, s.missing, s.upcoming
       FROM tracked_artists t
       JOIN artists ar ON ar.id = t.artist_id
       LEFT JOIN artist_stats s ON s.artist_id = ar.id
       GROUP BY ar.id
       ORDER BY ar.name COLLATE NOCASE`
    )
    .all()
    .map((r) => ({
      ...r,
      facets: (r.facets || 'artist').split(','),
      pct: s2pct(r),
    }));
}

function s2pct(r) {
  return r.studio_total ? Math.round((r.studio_owned / r.studio_total) * 100) : null;
}

export function isTracked(artistId) {
  return db
    .prepare('SELECT facet FROM tracked_artists WHERE artist_id = ?')
    .all(artistId)
    .map((r) => r.facet);
}

// Sugerencias para empezar: los artistas con más álbumes que AÚN no sigues.
export function suggestedArtists(limit = 24) {
  return db
    .prepare(
      `SELECT ar.id, ar.name, ar.mbid, COUNT(a.id) AS albums
       FROM artists ar JOIN albums a ON a.artist_id = ar.id AND a.match_state != 'dismissed'
       WHERE ar.id NOT IN (SELECT artist_id FROM tracked_artists)
       GROUP BY ar.id ORDER BY albums DESC LIMIT ?`
    )
    .all(limit);
}
