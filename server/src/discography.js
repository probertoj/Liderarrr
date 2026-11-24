import { db } from './db.js';
import * as mb from './musicbrainz.js';
import { matchKey } from './matchkey.js';
import { isVariousArtists, variousArtistIds } from './various.js';
import { FRESCURA } from './cache-versions.js';

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
ON CONFLICT(rg_mbid, artist_id) DO UPDATE SET
  artist_mbid=excluded.artist_mbid, title=excluded.title,
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
// `maxAge`: cuánto se fía de la copia guardada de MusicBrainz (ver FRESCURA). Devuelve también
// `nuevos`: lo que MusicBrainz trae ahora y no estaba la última vez, para poder decirlo.
export async function enrichArtistDiscography(artistId, { maxAge } = {}) {
  const artist = db.prepare('SELECT id, name, mbid FROM artists WHERE id = ?').get(artistId);
  if (!artist?.mbid) return null;
  // El cajón de recopilatorios no tiene discografía que completar: son decenas de miles de
  // release groups ajenos, y pedirlos es castigar a MusicBrainz para llenar de ruido el
  // calendario. Ver various.js.
  if (isVariousArtists(artist)) return null;

  const rgs = await mb.artistReleaseGroups(artist.mbid, { maxAge });

  // Lo que ya se conocía, para saber qué es nuevo. La primera vez no hay «nuevo»: es todo.
  const yaCalculada = !!db.prepare('SELECT 1 FROM artist_stats WHERE artist_id = ?').get(artistId);
  const conocidos = new Set(
    db.prepare('SELECT rg_mbid FROM release_groups WHERE artist_id = ?').all(artistId).map((r) => r.rg_mbid)
  );
  const nuevos = yaCalculada
    ? rgs
        .filter((rg) => !conocidos.has(rg.rg_mbid))
        .map((rg) => ({ rg_mbid: rg.rg_mbid, title: rg.title, first_release: rg.first_release || null, primary_type: rg.primary_type || null }))
    : [];

  // álbumes que tienes de este artista, para casar por rg_mbid o por título. Incluye los
  // acreditados a él como co-artista (splits/colaboraciones vía album_artists), no solo
  // donde es el principal.
  const ownedByRg = new Map();
  const ownedByTitle = new Map();
  const ownedAlbums = db
    .prepare(
      `SELECT id, title, rg_mbid FROM albums
       WHERE artist_id = @id OR id IN (SELECT album_id FROM album_artists WHERE artist_id = @id)`
    )
    .all({ id: artistId });
  for (const a of ownedAlbums) {
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
  return { artist_id: artistId, studio_total: studioTotal, studio_owned: studioOwned, missing, upcoming, total: rgs.length, nuevos };
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
//
// Cada cuánto se vuelve a preguntar a MusicBrainz por un artista: los que SIGUES, cada noche
// (es de quienes esperas disco nuevo); el resto de la colección, cada `maxAgeDays`. Con
// `repartir` (el refresco nocturno) ese resto no se pide todo la misma noche: una sexta parte
// cada vez, los más antiguos primero, para no soltarle a MusicBrainz miles de peticiones de
// golpe una vez por semana. Lo que nunca se ha calculado va siempre.
export function artistasPorActualizar({ onlyTracked = false, maxAgeDays = 7, repartir = false, ahora = Date.now() } = {}) {
  const corteResto = ahora - maxAgeDays * 86400000;
  const corteSeguidos = ahora - 20 * 3600 * 1000; // «cada noche», con holgura si el refresco se adelanta
  const va = variousArtistIds();
  const filas = db
    .prepare(
      `SELECT ar.id, s.fetched_at AS visto,
              EXISTS (SELECT 1 FROM tracked_artists t WHERE t.artist_id = ar.id) AS seguido,
              (SELECT COUNT(*) FROM albums a WHERE a.artist_id = ar.id) AS discos
       FROM artists ar LEFT JOIN artist_stats s ON s.artist_id = ar.id
       WHERE ar.mbid IS NOT NULL`
    )
    .all()
    .filter((r) => !va.has(r.id)); // el cajón de recopilatorios no se enriquece

  const seguidos = filas.filter((r) => r.seguido && (r.visto == null || r.visto < corteSeguidos));
  if (onlyTracked) return seguidos.map((r) => ({ id: r.id, seguido: true }));

  const resto = filas.filter((r) => !r.seguido);
  const sinCalcular = resto.filter((r) => r.visto == null).sort((a, b) => b.discos - a.discos);
  let caducados = resto.filter((r) => r.visto != null && r.visto < corteResto).sort((a, b) => a.visto - b.visto);
  if (repartir) caducados = caducados.slice(0, Math.max(200, Math.ceil(resto.length / 6)));
  return [...seguidos, ...sinCalcular, ...caducados].map((r) => ({ id: r.id, seguido: !!r.seguido }));
}

export async function enrichAllDiscographies({ onlyTracked = false, maxAgeDays = 7, repartir = false } = {}) {
  if (discographyStatus.running) return discographyStatus;
  const pendientes = artistasPorActualizar({ onlyTracked, maxAgeDays, repartir });
  const ids = pendientes.map((p) => p.id);
  const seguido = new Set(pendientes.filter((p) => p.seguido).map((p) => p.id));

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
          await enrichArtistDiscography(id, { maxAge: seguido.has(id) ? FRESCURA.seguidos : FRESCURA.resto });
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
export function artistCompleteness(artistId) {
  const ficha = db.prepare('SELECT id, name, mbid FROM artists WHERE id = ?').get(artistId);
  const artistName = ficha?.name || '';
  // Completismo del cajón de recopilatorios: ninguno. Enseñar «0 de 27.139» era una broma
  // pesada, y encima sacaba esos discos en «te faltan».
  if (isVariousArtists(ficha))
    return {
      stats: { studio_total: 0, studio_owned: 0, missing: 0, upcoming: 0 },
      pct: null,
      missing: [],
      missingEps: [],
      missingSingles: [],
      upcoming: [],
      all: [],
      is_various: true,
    };
  const rgs = db
    .prepare('SELECT * FROM release_groups WHERE artist_id = ? ORDER BY first_release, title')
    .all(artistId)
    .map((r) => ({ ...r, secondary_types: r.secondary_types ? JSON.parse(r.secondary_types) : [] }));

  // Propiedad EN VIVO: ¿tienes ya este release-group? Por rg_mbid, o por artista+título
  // (matchKey). Antes se leía el flag is_owned guardado al enriquecer la discografía, que
  // quedaba obsoleto: un disco recién importado seguía en "faltan" hasta re-enriquecer
  // (exigía reescanear). Ahora se cruza en vivo con tu biblioteca.
  const ownedRows = db
    .prepare(
      `SELECT rg_mbid, album_artist, title FROM albums
       WHERE match_state != 'dismissed'
         AND (artist_id = @id OR id IN (SELECT album_id FROM album_artists WHERE artist_id = @id))`
    )
    .all({ id: artistId });
  const ownedRg = new Set(ownedRows.filter((o) => o.rg_mbid).map((o) => o.rg_mbid));
  // Se indexa el título CON LAS DOS grafías del artista: la de la etiqueta (album_artist) y el
  // nombre canónico de la ficha. Si no, un disco cuyas etiquetas dicen «Go-Betweens» en una ficha
  // llamada «The Go-Betweens» salía como que te falta aunque estuviera ahí mismo en la colección
  // (se ve sobre todo al fundir dos fichas). Es lo que ya hace ownedMatcher() en discover.js.
  const ownedKey = new Set();
  for (const o of ownedRows) {
    ownedKey.add(matchKey(o.album_artist || artistName, o.title));
    ownedKey.add(matchKey(artistName, o.title));
  }
  const isOwned = (r) => (r.rg_mbid && ownedRg.has(r.rg_mbid)) || ownedKey.has(matchKey(artistName, r.title));

  // "Por estrenar" se decide por FECHA en vivo, no por el flag is_upcoming guardado.
  const today = new Date().toISOString().slice(0, 10);
  const isUpcoming = (r) => r.first_release && r.first_release > today;
  const noSecondary = (r) => !r.secondary_types || r.secondary_types.length === 0;
  const missingOf = (type) => rgs.filter((r) => r.primary_type === type && noSecondary(r) && !isOwned(r) && !isUpcoming(r));

  const missing = rgs.filter((r) => isStudioAlbum(r.primary_type, r.secondary_types) && !isOwned(r) && !isUpcoming(r));
  const missingEps = missingOf('EP');
  const missingSingles = missingOf('Single');
  const upcoming = rgs.filter(isUpcoming);

  // Estadísticas EN VIVO para la barra y los contadores (no el snapshot de artist_stats,
  // que envejece): así el % y los "faltan / por estrenar" reflejan lo que tienes ahora.
  const studioRgs = rgs.filter((r) => isStudioAlbum(r.primary_type, r.secondary_types));
  const studioOwned = studioRgs.filter(isOwned).length;
  const stats = {
    studio_total: studioRgs.length,
    studio_owned: studioOwned,
    missing: missing.length,
    upcoming: upcoming.length,
  };
  const pct = studioRgs.length ? Math.round((studioOwned / studioRgs.length) * 100) : null;
  // ¿Se ha cruzado ya con MusicBrainz, y cuándo? Sin esto la ficha decía «aún no se ha
  // calculado» de cualquier artista SIN álbumes de estudio (solo EP y singles), aunque sí.
  const visto = db.prepare('SELECT fetched_at FROM artist_stats WHERE artist_id = ?').get(artistId)?.fetched_at || null;
  return { stats, pct, missing, missingEps, missingSingles, upcoming, all: rgs, calculada: visto != null || rgs.length > 0, visto };
}
