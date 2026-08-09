import { db } from './db.js';
import * as mb from './musicbrainz.js';

// Sellos seguidos (0.6 fase 2). Sigues un sello por su MBID de MusicBrainz y la app
// resalta sus estrenos aunque no sigas al artista. El catálogo de cada sello se
// cachea en label_release_groups (lo llena refreshLabel vía mb.labelReleaseGroups) y
// se refresca en el ciclo "Actualizar todo". Regla de diseño: MB anota, esto solo
// muestra; nunca crea artistas locales ni toca la biblioteca.

const insLabel = db.prepare(
  `INSERT INTO tracked_labels (label_mbid, name, disambiguation, country, added_at, refreshed_at, too_big)
   VALUES (@label_mbid, @name, @disambiguation, @country, @added_at, NULL, 0)
   ON CONFLICT(label_mbid) DO UPDATE SET name=excluded.name,
     disambiguation=excluded.disambiguation, country=excluded.country`
);
const upsertRg = db.prepare(
  `INSERT INTO label_release_groups (rg_mbid, label_mbid, title, artist_credit, artist_mbid, first_release, fetched_at)
   VALUES (@rg_mbid, @label_mbid, @title, @artist_credit, @artist_mbid, @first_release, @fetched_at)
   ON CONFLICT(rg_mbid, label_mbid) DO UPDATE SET title=excluded.title,
     artist_credit=excluded.artist_credit, artist_mbid=excluded.artist_mbid,
     first_release=excluded.first_release, fetched_at=excluded.fetched_at`
);

// Sigue un sello y trae su catálogo en segundo plano (labelReleaseGroups es lento).
export async function followLabel({ mbid, name, disambiguation, country } = {}) {
  if (!mbid) throw new Error('Falta el MBID del sello');
  insLabel.run({
    label_mbid: mbid,
    name: name || null,
    disambiguation: disambiguation || null,
    country: country || null,
    added_at: Date.now(),
  });
  refreshLabel(mbid).catch(() => {});
  return { ok: true, label_mbid: mbid };
}

export function unfollowLabel(mbid) {
  db.prepare('DELETE FROM tracked_labels WHERE label_mbid = ?').run(mbid);
  db.prepare('DELETE FROM label_release_groups WHERE label_mbid = ?').run(mbid);
  return { ok: true };
}

// Recalcula el catálogo de un sello desde MusicBrainz y lo vuelca a la caché.
// Un major que supera el tope se marca too_big (sin catálogo, como en el completismo).
export async function refreshLabel(mbid) {
  if (!mbid) return { ok: false };
  const res = await mb.labelReleaseGroups(mbid);
  const now = Date.now();
  if (res.tooBig) {
    db.prepare('UPDATE tracked_labels SET refreshed_at = ?, too_big = 1 WHERE label_mbid = ?').run(now, mbid);
    return { ok: true, too_big: true, total: res.total };
  }
  const tx = db.transaction((rgs) => {
    // reemplaza el catálogo del sello (borra lo que ya no editan, evita huérfanos)
    db.prepare('DELETE FROM label_release_groups WHERE label_mbid = ?').run(mbid);
    for (const rg of rgs) {
      upsertRg.run({
        rg_mbid: rg.rg_mbid,
        label_mbid: mbid,
        title: rg.title || null,
        artist_credit: rg.artist || null,
        artist_mbid: rg.artist_mbid || null,
        first_release: rg.first_release || null,
        fetched_at: now,
      });
    }
    db.prepare('UPDATE tracked_labels SET refreshed_at = ?, too_big = 0 WHERE label_mbid = ?').run(now, mbid);
  });
  tx(res.releaseGroups || []);
  return { ok: true, too_big: false, count: (res.releaseGroups || []).length };
}

// Refresca todos los sellos seguidos (paso del ciclo "Actualizar todo").
export async function refreshAllLabels() {
  const labels = db.prepare('SELECT label_mbid FROM tracked_labels').all();
  let done = 0;
  for (const l of labels) {
    try {
      await refreshLabel(l.label_mbid);
      done++;
    } catch {
      /* un sello que tropieza no tumba a los demás */
    }
  }
  return { total: labels.length, done };
}

// Lista de sellos seguidos con el tamaño de su catálogo cacheado.
export function trackedLabelsList() {
  return db
    .prepare(
      `SELECT tl.label_mbid, tl.name, tl.disambiguation, tl.country, tl.added_at, tl.refreshed_at, tl.too_big,
        (SELECT COUNT(*) FROM label_release_groups lrg WHERE lrg.label_mbid = tl.label_mbid) AS catalog
       FROM tracked_labels tl
       ORDER BY tl.name COLLATE NOCASE`
    )
    .all()
    .map((r) => ({ ...r, too_big: !!r.too_big }));
}

export function isFollowedLabel(mbid) {
  return !!db.prepare('SELECT 1 FROM tracked_labels WHERE label_mbid = ?').get(mbid);
}

// Estrenos de tus sellos seguidos dentro de la ventana [since, ...] (incluye futuros).
// Deduplica por RG (un disco puede salir en varios sellos seguidos) y marca lo que ya
// tienes, lo encargado en Lidarr y si sigues al artista.
export function labelReleases({ since = null } = {}) {
  const cutoff = since || `${new Date().getFullYear()}-01-01`;
  const today = new Date().toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT lrg.rg_mbid, lrg.title, lrg.artist_credit AS artist, lrg.artist_mbid, lrg.first_release,
        GROUP_CONCAT(DISTINCT tl.name) AS labels,
        (SELECT ar.id FROM artists ar WHERE ar.mbid = lrg.artist_mbid) AS artist_id,
        (SELECT 1 FROM albums a WHERE a.rg_mbid = lrg.rg_mbid) AS is_owned,
        (SELECT 1 FROM lidarr_albums la WHERE la.rg_mbid = lrg.rg_mbid) AS in_lidarr,
        (SELECT 1 FROM artists ar JOIN tracked_artists ta ON ta.artist_id = ar.id
          WHERE ar.mbid = lrg.artist_mbid) AS tracked
       FROM label_release_groups lrg
       JOIN tracked_labels tl ON tl.label_mbid = lrg.label_mbid
       WHERE lrg.first_release IS NOT NULL AND lrg.first_release >= @cutoff
         AND lrg.rg_mbid NOT IN (SELECT rg_mbid FROM dismissed_albums)
       GROUP BY lrg.rg_mbid
       ORDER BY lrg.first_release DESC, lrg.artist_credit COLLATE NOCASE`
    )
    .all({ cutoff })
    .map((r) => ({
      ...r,
      is_owned: !!r.is_owned,
      in_lidarr: !!r.in_lidarr,
      tracked: !!r.tracked,
      is_upcoming: r.first_release > today,
      primary_type: 'Album',
    }));
}
