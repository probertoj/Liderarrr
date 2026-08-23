import { db } from './db.js';
import { matchKey } from './matchkey.js';
import { lidarrConfig } from './lidarr.js';
import { activeRequestRgs } from './downloads.js';

// «en Lidarr» solo vale si Lidarr sigue conectado (si no, su tabla queda vieja tras
// «liberar de Lidarr»). El estado nativo «pedido» sale del registro de descargas.
const lidarrConnected = () => {
  const { url, key } = lidarrConfig();
  return !!(url && key);
};

// Huecos y próximos lanzamientos, ambos leídos de release_groups (que llena
// discography.js). Excluye lo que ya está en el snapshot de Lidarr ("ya
// encargado") y lo que el usuario descartó.

// Propiedad EN VIVO: ¿tienes ya este release-group? Por rg_mbid o por artista+título
// (matchKey). Se cruza contra la biblioteca en el momento, NO contra el flag guardado
// rg.is_owned (que envejece: un disco recién importado seguía saliendo como "no lo
// tienes" en el calendario hasta re-enriquecer la discografía, y así se pedía dos veces).
export function ownedMatcher() {
  const rows = db
    .prepare(
      `SELECT a.rg_mbid, a.album_artist, a.title, ar.name AS artist_name
       FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id
       WHERE a.match_state != 'dismissed'`
    )
    .all();
  const ownedRg = new Set(rows.filter((o) => o.rg_mbid).map((o) => o.rg_mbid));
  // clave por título + artista, indexando TANTO el album_artist guardado COMO el nombre
  // canónico del artista: así casa aunque el release-group use uno y tu álbum el otro (la
  // desincronización que hacía salir como «no lo tienes» algo que sí tienes).
  const ownedKey = new Set();
  for (const o of rows) {
    ownedKey.add(matchKey(o.album_artist, o.title));
    if (o.artist_name) ownedKey.add(matchKey(o.artist_name, o.title));
  }
  return (rgMbid, artist, title) => (rgMbid && ownedRg.has(rgMbid)) || ownedKey.has(matchKey(artist, title));
}

// Álbumes de estudio estrenados que MB conoce de tus artistas y que NO tienes.
// onlyTracked = solo de los que sigues; si no, de todos los artistas con MBID.
export function gaps({ onlyTracked = true } = {}) {
  const trackedJoin = onlyTracked
    ? 'JOIN tracked_artists t ON t.artist_id = rg.artist_id'
    : '';
  const rows = db
    .prepare(
      `SELECT rg.rg_mbid, rg.title, rg.first_release, rg.artist_id, rg.artist_mbid,
        ar.name AS artist,
        (SELECT 1 FROM lidarr_albums la WHERE la.rg_mbid = rg.rg_mbid) AS in_lidarr
       FROM release_groups rg
       JOIN artists ar ON ar.id = rg.artist_id
       ${trackedJoin}
       WHERE rg.is_upcoming = 0
         AND rg.primary_type = 'Album'
         AND (rg.secondary_types IS NULL OR rg.secondary_types = '[]')
         AND rg.rg_mbid NOT IN (SELECT rg_mbid FROM dismissed_albums)
       ORDER BY ar.name COLLATE NOCASE, rg.first_release`
    )
    .all();
  // filtra en vivo los que YA tienes (no el flag guardado is_owned, que envejece)
  const isOwned = ownedMatcher();
  const lid = lidarrConnected();
  const reqs = activeRequestRgs();
  // agrupar por artista para la UI
  const byArtist = new Map();
  for (const r of rows) {
    if (isOwned(r.rg_mbid, r.artist, r.title)) continue;
    if (!byArtist.has(r.artist_id)) byArtist.set(r.artist_id, { artist_id: r.artist_id, artist: r.artist, artist_mbid: r.artist_mbid, missing: [] });
    byArtist.get(r.artist_id).missing.push({
      rg_mbid: r.rg_mbid,
      title: r.title,
      year: r.first_release ? Number(String(r.first_release).slice(0, 4)) : null,
      in_lidarr: lid && !!r.in_lidarr,
      requested: reqs.has(r.rg_mbid),
    });
  }
  const artists = [...byArtist.values()];
  const total = artists.reduce((s, a) => s + a.missing.length, 0);
  return { total, artists };
}

// Calendario de próximos: release groups por estrenar de tus artistas seguidos,
// ordenados por fecha. MusicBrainz sí tiene fechas futuras.
export function upcoming({ onlyTracked = true } = {}) {
  const trackedJoin = onlyTracked ? 'JOIN tracked_artists t ON t.artist_id = rg.artist_id' : '';
  const rows = db
    .prepare(
      `SELECT rg.rg_mbid, rg.title, rg.first_release, rg.primary_type, rg.artist_id, rg.artist_mbid,
        ar.name AS artist,
        (SELECT 1 FROM lidarr_albums la WHERE la.rg_mbid = rg.rg_mbid) AS in_lidarr,
        (SELECT 1 FROM tracked_artists ta WHERE ta.artist_id = rg.artist_id) AS tracked,
        (SELECT GROUP_CONCAT(DISTINCT tl.name) FROM label_release_groups lrg
          JOIN tracked_labels tl ON tl.label_mbid = lrg.label_mbid
          WHERE lrg.rg_mbid = rg.rg_mbid) AS labels
       FROM release_groups rg
       JOIN artists ar ON ar.id = rg.artist_id
       ${trackedJoin}
       WHERE rg.is_upcoming = 1
         AND rg.rg_mbid NOT IN (SELECT rg_mbid FROM dismissed_albums)
       ORDER BY rg.first_release`
    )
    .all();
  const isOwned = ownedMatcher();
  const lid = lidarrConnected();
  const reqs = activeRequestRgs();
  return rows.map((r) => ({ ...r, in_lidarr: lid && !!r.in_lidarr, requested: reqs.has(r.rg_mbid), tracked: !!r.tracked, is_owned: isOwned(r.rg_mbid, r.artist, r.title) }));
}

// Estrenados recientemente: álbumes de estudio de tus artistas con fecha ya pasada
// dentro de la ventana [since, hoy]. Por defecto since = 1 de enero de este año.
// Marca lo que ya tienes (is_owned), lo encargado en Lidarr y si sigues al artista.
export function recentlyReleased({ since = null, onlyTracked = false } = {}) {
  const cutoff = since || `${new Date().getFullYear()}-01-01`;
  const today = new Date().toISOString().slice(0, 10);
  const trackedJoin = onlyTracked ? 'JOIN tracked_artists t ON t.artist_id = rg.artist_id' : '';
  const rows = db
    .prepare(
      `SELECT rg.rg_mbid, rg.title, rg.first_release, rg.primary_type, rg.artist_id, rg.artist_mbid,
        ar.name AS artist, rg.owned_album_id,
        (SELECT 1 FROM lidarr_albums la WHERE la.rg_mbid = rg.rg_mbid) AS in_lidarr,
        (SELECT 1 FROM tracked_artists ta WHERE ta.artist_id = rg.artist_id) AS tracked,
        (SELECT GROUP_CONCAT(DISTINCT tl.name) FROM label_release_groups lrg
          JOIN tracked_labels tl ON tl.label_mbid = lrg.label_mbid
          WHERE lrg.rg_mbid = rg.rg_mbid) AS labels
       FROM release_groups rg
       JOIN artists ar ON ar.id = rg.artist_id
       ${trackedJoin}
       WHERE rg.is_upcoming = 0 AND rg.primary_type = 'Album'
         AND (rg.secondary_types IS NULL OR rg.secondary_types = '[]')
         AND rg.first_release >= @cutoff AND rg.first_release <= @today
         AND rg.rg_mbid NOT IN (SELECT rg_mbid FROM dismissed_albums)
       ORDER BY rg.first_release DESC, ar.name COLLATE NOCASE`
    )
    .all({ cutoff, today });
  const isOwned = ownedMatcher();
  const lid = lidarrConnected();
  const reqs = activeRequestRgs();
  return rows.map((r) => ({ ...r, in_lidarr: lid && !!r.in_lidarr, requested: reqs.has(r.rg_mbid), tracked: !!r.tracked, is_owned: isOwned(r.rg_mbid, r.artist, r.title) }));
}

export function dismissGap(rgMbid, title) {
  db.prepare('INSERT OR REPLACE INTO dismissed_albums (rg_mbid, title, at) VALUES (?, ?, ?)').run(
    rgMbid,
    title || null,
    Date.now()
  );
  return { ok: true };
}
export function undismissGap(rgMbid) {
  db.prepare('DELETE FROM dismissed_albums WHERE rg_mbid = ?').run(rgMbid);
  return { ok: true };
}
export function dismissedList() {
  return db.prepare('SELECT rg_mbid, title, at FROM dismissed_albums ORDER BY at DESC').all();
}
