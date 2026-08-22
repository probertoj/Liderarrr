import { db } from './db.js';
import * as lastfm from './lastfm.js';
import { normName, matchKey } from './matchkey.js';

// Recomendaciones desde la ficha del álbum (estilo «Valence Recommendations» de Roon):
//  - «Más de este artista»: otros álbumes del artista (principal o co-acreditado) que
//    TIENES en la biblioteca. Local, instantáneo.
//  - «Te podría gustar»: artistas similares (Last.fm), marcando cuáles ya tienes/sigues.
// Bajo demanda desde la ficha.
export async function albumRecommendations(albumId) {
  const a = db
    .prepare('SELECT a.id, a.artist_id, a.album_artist, ar.name AS artist FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id WHERE a.id = ?')
    .get(albumId);
  if (!a) throw new Error('Álbum no encontrado');

  // más de este artista (local): colapsa duplicados por rg_mbid/título para no repetir
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.year, a.cover, a.rg_mbid FROM albums a
       WHERE a.id != @id AND a.match_state != 'dismissed'
         AND (a.artist_id = @aid OR a.id IN (SELECT album_id FROM album_artists WHERE artist_id = @aid))
       ORDER BY a.year DESC`
    )
    .all({ id: albumId, aid: a.artist_id });
  const seen = new Set();
  const moreFromArtist = [];
  for (const r of rows) {
    const key = r.rg_mbid || String(r.title || '').toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    moreFromArtist.push({ id: r.id, title: r.title, year: r.year });
    if (moreFromArtist.length >= 18) break;
  }

  // artistas similares (Last.fm), cruzados con la biblioteca por MBID y por nombre
  const artistName = a.artist || a.album_artist || '';
  let similar = await lastfm.similarArtists(artistName).catch(() => []);
  const byName = new Map(db.prepare('SELECT id, name FROM artists').all().map((r) => [normName(r.name), r.id]));
  const byMbid = new Map(db.prepare('SELECT id, mbid FROM artists WHERE mbid IS NOT NULL').all().map((r) => [r.mbid, r.id]));
  const tracked = new Set(db.prepare('SELECT DISTINCT artist_id FROM tracked_artists').all().map((r) => r.artist_id));
  similar = similar.map((s) => {
    const localId = (s.mbid && byMbid.get(s.mbid)) || byName.get(normName(s.name)) || null;
    return { name: s.name, mbid: s.mbid, url: s.url, artist_id: localId, owned: !!localId, tracked: localId ? tracked.has(localId) : false };
  });

  // DISCOS que quizá te gusten: el top álbum de artistas afines que AÚN NO TIENES, para
  // descubrir discos concretos (no solo nombres) y poder seguir/descargar. Uno por artista,
  // priorizando los afines que aún no tienes. Cada consulta a Last.fm va cacheada.
  const ownedAlbumKeys = new Set(
    db.prepare("SELECT album_artist, title FROM albums WHERE match_state != 'dismissed'").all().map((r) => matchKey(r.album_artist, r.title))
  );
  const recommendedAlbums = [];
  if (lastfm.lastfmConfigured()) {
    const pool = [...similar].sort((x, y) => (x.owned === y.owned ? 0 : x.owned ? 1 : -1)).slice(0, 8);
    for (const s of pool) {
      if (recommendedAlbums.length >= 8) break;
      // eslint-disable-next-line no-await-in-loop
      const albums = await lastfm.topAlbums(s.name, 3).catch(() => []);
      const pick = albums.find((al) => !ownedAlbumKeys.has(matchKey(s.name, al.name)));
      if (pick) {
        recommendedAlbums.push({
          artist: s.name,
          album: pick.name,
          mbid: pick.mbid,
          artist_mbid: s.mbid,
          artist_id: s.artist_id,
          owned_artist: s.owned,
          tracked: s.tracked,
        });
      }
    }
  }

  return {
    artist: { id: a.artist_id, name: artistName },
    moreFromArtist,
    similar,
    recommendedAlbums,
    lastfm: lastfm.lastfmConfigured(),
  };
}
