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

// Recalcula las novedades externas: estrenos RECIENTES de tus artistas seguidos (Deezer +
// Spotify) que NO tienes, tenga MB constancia o no. Las que MB aún no lista se marcan
// `ahead = 1` («adelantada»); el resto son recientes normales (feed semanal). months = la
// ventana hacia atrás (por defecto 6 meses, suficiente para un feed semana a semana).
export async function refreshExternalReleases({ months = 6, maxArtists = 500 } = {}) {
  const seeds = db
    .prepare(
      `SELECT ar.id, ar.name FROM tracked_artists t JOIN artists ar ON ar.id = t.artist_id
       WHERE t.facet = 'artist' AND ar.name IS NOT NULL ORDER BY ar.name COLLATE NOCASE LIMIT ?`
    )
    .all(maxArtists);
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
  }

  // poda: fuera solo lo más viejo que la ventana (los que ya tienes se conservan, para la
  // opción «mostrar los que ya tengo»; lo que MB alcanza deja de ser «adelantada» vía upsert)
  const stored = db.prepare('SELECT id, release_date FROM external_releases').all();
  const del = db.prepare('DELETE FROM external_releases WHERE id = ?');
  const prune = db.transaction(() => {
    for (const r of stored) {
      if (r.release_date && r.release_date < cutoff) del.run(r.id);
    }
  });
  prune();

  const count = externalNewReleases({ limit: 100000 }).length; // los que NO tienes (para el aviso)
  return { count, added, seeds: seeds.length };
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
       WHERE e.dismissed = 0
       ORDER BY e.release_date DESC, e.artist COLLATE NOCASE`
    )
    .all()
    .map((r) => ({ ...r, tracked: !!r.tracked, ahead: !!r.ahead, owned: owned(r.artist_id, r.artist, r.title) }))
    .filter((r) => includeOwned || !r.owned)
    .slice(0, limit);
}

export function dismissExternalRelease(id) {
  db.prepare('UPDATE external_releases SET dismissed = 1 WHERE id = ?').run(Number(id));
  return { ok: true };
}
