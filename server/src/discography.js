import { db } from './db.js';
import * as mb from './musicbrainz.js';

// "La caza": cruza la discografía que MusicBrainz conoce de un artista con lo que
// TIENES en el disco, y calcula el completismo. Un artista sin MBID no se puede
// completar (MB no lo conoce), así que se salta: sus discos existen igual, pero
// no hay una referencia contra la que medir huecos. Es la misma regla del diseño:
// lo comparativo solo aplica a lo que la base externa conoce.

const today = () => new Date().toISOString().slice(0, 10);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Un "álbum de estudio" es primary_type Album SIN tipos secundarios (recopilatorio,
// directo, remezcla, banda sonora, demo...). Con tipos explícitos de MB esto es
// una condición limpia, no una heurística de duración como en cine.
export function isStudioAlbum(primaryType, secondaryTypes) {
  return primaryType === 'Album' && (!secondaryTypes || secondaryTypes.length === 0);
}

const upsertRg = db.prepare(`
INSERT INTO release_groups (rg_mbid, artist_id, artist_mbid, title, first_release, primary_type,
  secondary_types, is_owned, owned_album_id, is_upcoming, fetched_at)
VALUES (@rg_mbid, @artist_id, @artist_mbid, @title, @first_release, @primary_type,
  @secondary_types, @is_owned, @owned_album_id, @is_upcoming, @fetched_at)
ON CONFLICT(rg_mbid) DO UPDATE SET
  artist_id=excluded.artist_id, artist_mbid=excluded.artist_mbid, title=excluded.title,
  first_release=excluded.first_release, primary_type=excluded.primary_type,
  secondary_types=excluded.secondary_types, is_owned=excluded.is_owned,
  owned_album_id=excluded.owned_album_id, is_upcoming=excluded.is_upcoming, fetched_at=excluded.fetched_at
`);
const upsertStats = db.prepare(`
INSERT INTO artist_stats (artist_id, studio_total, studio_owned, missing, upcoming, fetched_at)
VALUES (@artist_id, @studio_total, @studio_owned, @missing, @upcoming, @fetched_at)
ON CONFLICT(artist_id) DO UPDATE SET studio_total=excluded.studio_total,
  studio_owned=excluded.studio_owned, missing=excluded.missing, upcoming=excluded.upcoming,
  fetched_at=excluded.fetched_at
`);

// Rellena release_groups + artist_stats para un artista. Devuelve sus stats o null.
export async function enrichArtistDiscography(artistId) {
  const artist = db.prepare('SELECT id, name, mbid FROM artists WHERE id = ?').get(artistId);
  if (!artist?.mbid) return null;

  const rgs = await mb.artistReleaseGroups(artist.mbid);

  // álbumes que tienes de este artista, para casar por rg_mbid o por título
  const ownedByRg = new Map();
  const ownedByTitle = new Map();
  for (const a of db.prepare('SELECT id, title, rg_mbid FROM albums WHERE artist_id = ?').all(artistId)) {
    if (a.rg_mbid) ownedByRg.set(a.rg_mbid, a.id);
    ownedByTitle.set(norm(a.title), a.id);
  }

  const now = today();
  let studioTotal = 0;
  let studioOwned = 0;
  let missing = 0;
  let upcoming = 0;
  const nowMs = Date.now();

  const tx = db.transaction(() => {
    // fuera lo viejo de este artista antes de reescribir (discos retirados de MB)
    db.prepare('DELETE FROM release_groups WHERE artist_id = ?').run(artistId);
    for (const rg of rgs) {
      const ownedId = ownedByRg.get(rg.rg_mbid) ?? ownedByTitle.get(norm(rg.title)) ?? null;
      const isOwned = ownedId != null;
      const isUpcoming = rg.first_release && rg.first_release > now ? 1 : 0;
      upsertRg.run({
        rg_mbid: rg.rg_mbid,
        artist_id: artistId,
        artist_mbid: artist.mbid,
        title: rg.title,
        first_release: rg.first_release || null,
        primary_type: rg.primary_type || null,
        secondary_types: JSON.stringify(rg.secondary_types || []),
        is_owned: isOwned ? 1 : 0,
        owned_album_id: ownedId,
        is_upcoming: isUpcoming,
        fetched_at: nowMs,
      });
      const studio = isStudioAlbum(rg.primary_type, rg.secondary_types);
      if (studio && isUpcoming) upcoming++;
      if (studio && !isUpcoming) {
        studioTotal++;
        if (isOwned) studioOwned++;
        else missing++;
      }
    }
    upsertStats.run({
      artist_id: artistId,
      studio_total: studioTotal,
      studio_owned: studioOwned,
      missing,
      upcoming,
      fetched_at: nowMs,
    });
  });
  tx();
  return { artist_id: artistId, studio_total: studioTotal, studio_owned: studioOwned, missing, upcoming };
}

export const discographyStatus = {
  running: false,
  total: 0,
  done: 0,
  current: null,
  startedAt: null,
  finishedAt: null,
  error: null,
};

// Enriquece la discografía de todos los artistas relevantes: los que SIGUES y,
// opcionalmente, todos los que tienen MBID. Trabajo lento (respeta el límite de
// MB); va en segundo plano, nunca en la petición del usuario.
export async function enrichAllDiscographies({ onlyTracked = false, maxAgeDays = 7 } = {}) {
  if (discographyStatus.running) return discographyStatus;
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const sql = onlyTracked
    ? `SELECT DISTINCT ar.id FROM artists ar
       JOIN tracked_artists t ON t.artist_id = ar.id
       LEFT JOIN artist_stats s ON s.artist_id = ar.id
       WHERE ar.mbid IS NOT NULL AND (s.fetched_at IS NULL OR s.fetched_at < ?)`
    : `SELECT ar.id FROM artists ar
       LEFT JOIN artist_stats s ON s.artist_id = ar.id
       WHERE ar.mbid IS NOT NULL AND (s.fetched_at IS NULL OR s.fetched_at < ?)
       ORDER BY (SELECT COUNT(*) FROM albums a WHERE a.artist_id = ar.id) DESC`;
  const ids = db.prepare(sql).all(cutoff).map((r) => r.id);

  Object.assign(discographyStatus, {
    running: true,
    total: ids.length,
    done: 0,
    current: null,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  });
  try {
    // Barrido de fondo: carril LENTO de MB, cede el paso a lo interactivo.
    await mb.runBackground(async () => {
      for (const id of ids) {
        const name = db.prepare('SELECT name FROM artists WHERE id = ?').get(id)?.name;
        discographyStatus.current = name;
        try {
          await enrichArtistDiscography(id);
        } catch (err) {
          // un artista que falle (MB caído, MBID malo) no debe parar al resto
          console.warn('[discography]', name, String(err.message || err));
        }
        discographyStatus.done++;
      }
    });
  } catch (err) {
    discographyStatus.error = String(err.message || err);
  } finally {
    discographyStatus.running = false;
    discographyStatus.finishedAt = Date.now();
    discographyStatus.current = null;
  }
  return discographyStatus;
}

// Completismo de un artista para su ficha: barra + lista de lo que falta y lo que
// está por estrenar, con filtro de tipos.
export function artistCompleteness(artistId, { includeTypes } = {}) {
  const stats = db.prepare('SELECT * FROM artist_stats WHERE artist_id = ?').get(artistId);
  const rgs = db
    .prepare('SELECT * FROM release_groups WHERE artist_id = ? ORDER BY first_release, title')
    .all(artistId)
    .map((r) => ({ ...r, secondary_types: r.secondary_types ? JSON.parse(r.secondary_types) : [] }));

  const studioMissing = rgs.filter(
    (r) => isStudioAlbum(r.primary_type, r.secondary_types) && !r.is_owned && !r.is_upcoming
  );
  const upcoming = rgs.filter((r) => r.is_upcoming);
  const pct = stats && stats.studio_total ? Math.round((stats.studio_owned / stats.studio_total) * 100) : null;
  return { stats, pct, missing: studioMissing, upcoming, all: rgs };
}
