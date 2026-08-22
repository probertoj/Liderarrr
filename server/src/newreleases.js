import { db } from './db.js';
import { matchKey, normName } from './matchkey.js';
import { deezerFindArtist } from './artistpix.js';
import { spotifyArtistAlbums, spotifyConfigured } from './spotify.js';

// NOVEDADES ADELANTADAS: MusicBrainz va con retraso en estrenos recientes, así que sus
// discografías (release_groups) no traen lo que salió ayer. Deezer y Spotify sí lo tienen
// el día 1. Para cada artista SEGUIDO, pedimos su discografía reciente ahí y marcamos lo
// que NO tienes y MB AÚN no lista → aparece en Lanzamientos antes que en ningún sitio.
// Cuando MB (o tu biblioteca) lo alcanza, se poda solo. Deezer no necesita API key;
// Spotify se activa si hay credenciales (client credentials).

const UA = 'Liderarrr ( https://github.com/probertoj/Liderarrr )';

// Discografía reciente de Deezer por id de artista. Sin API key.
async function deezerArtistAlbums(artistId) {
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

const KEEP_TYPES = new Set(['album', 'ep']); // fuera singles y recopilatorios: buscamos discos

const upsert = db.prepare(
  `INSERT OR IGNORE INTO external_releases
     (source, artist_id, artist, title, match_key, release_date, record_type, cover, url, first_seen)
   VALUES (@source, @artist_id, @artist, @title, @match_key, @release_date, @record_type, @cover, @url, @now)`
);

// Recalcula las novedades externas. months = ventana hacia atrás (por defecto 18 meses).
export async function refreshExternalReleases({ months = 18, maxArtists = 500 } = {}) {
  const seeds = db
    .prepare(
      `SELECT ar.id, ar.name FROM tracked_artists t JOIN artists ar ON ar.id = t.artist_id
       WHERE t.facet = 'artist' AND ar.name IS NOT NULL ORDER BY ar.name COLLATE NOCASE LIMIT ?`
    )
    .all(maxArtists);
  if (!seeds.length) return { count: 0, added: 0, seeds: 0 };

  const cutoff = new Date(Date.now() - months * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  // lo que YA tienes (biblioteca) y lo que MB YA conoce (release_groups): para no repetir
  const ownedKeys = new Set(
    db
      .prepare("SELECT album_artist, title FROM albums WHERE match_state != 'dismissed'")
      .all()
      .map((r) => matchKey(r.album_artist, r.title))
  );
  const mbKeys = new Set(
    db
      .prepare('SELECT ar.name AS artist, rg.title FROM release_groups rg JOIN artists ar ON ar.id = rg.artist_id')
      .all()
      .map((r) => matchKey(r.artist, r.title))
  );
  const seen = (mk) => ownedKeys.has(mk) || mbKeys.has(mk);

  const spotifyOn = spotifyConfigured();
  let added = 0;
  const now = Date.now();

  for (const s of seeds) {
    const candidates = [];
    // Deezer (siempre). Guard: el artista de Deezer debe coincidir por nombre normalizado,
    // para no traer la discografía de un homónimo popular.
    try {
      // eslint-disable-next-line no-await-in-loop
      const d = await deezerFindArtist(s.name);
      if (d?.id && normName(d.name) === normName(s.name)) {
        // eslint-disable-next-line no-await-in-loop
        candidates.push(...(await deezerArtistAlbums(d.id)));
      }
    } catch {
      /* Deezer caído para este artista: seguimos */
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
      if (!KEEP_TYPES.has(type)) continue;
      const date = (c.release_date || '').slice(0, 10);
      if (!date || date < cutoff || date === '0000-00-00') continue;
      const mk = matchKey(s.name, c.title);
      if (seen(mk)) continue;
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
        now,
      });
      if (info.changes) added++;
    }
  }

  // poda: fuera lo que MB/biblioteca ya alcanzaron, y lo más viejo que la ventana
  const stored = db.prepare('SELECT id, match_key, release_date FROM external_releases').all();
  const del = db.prepare('DELETE FROM external_releases WHERE id = ?');
  const prune = db.transaction(() => {
    for (const r of stored) {
      if (seen(r.match_key) || (r.release_date && r.release_date < cutoff)) del.run(r.id);
    }
  });
  prune();

  const count = db.prepare('SELECT COUNT(*) c FROM external_releases WHERE dismissed = 0').get().c;
  return { count, added, seeds: seeds.length };
}

// Novedades para la UI (Lanzamientos). Más recientes primero. Marca el artista local.
export function externalNewReleases({ limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT e.id, e.source, e.artist_id, e.artist, e.title, e.release_date, e.record_type, e.cover, e.url,
        (SELECT 1 FROM tracked_artists ta WHERE ta.artist_id = e.artist_id) AS tracked
       FROM external_releases e
       WHERE e.dismissed = 0
       ORDER BY e.release_date DESC, e.artist COLLATE NOCASE
       LIMIT ?`
    )
    .all(limit)
    .map((r) => ({ ...r, tracked: !!r.tracked }));
}

export function dismissExternalRelease(id) {
  db.prepare('UPDATE external_releases SET dismissed = 1 WHERE id = ?').run(Number(id));
  return { ok: true };
}
