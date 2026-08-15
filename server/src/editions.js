import { db } from './db.js';
import { releaseEditions, discogsConfigured } from './discogs.js';
import { isJunkLabel } from './libkey.js';
import { searchLabel, labelReleaseGroups, releaseLabels, releaseGroupLabels, releaseGroupReleases } from './musicbrainz.js';
import { normalizeForDup, libScore } from './queries.js';
import { normName } from './matchkey.js';

// Ediciones y upgrades: el equivalente (mejor) de JustWatch. Para un álbum tuyo,
// Discogs lista todas sus ediciones —remaster, deluxe, vinilo con bonus— así
// sabes si de ese MP3 que tienes existe algo mejor. De paso, cada consulta captura
// el sello, que alimenta la vista de Sellos (que crece según exploras).

// Clave de fusión SUAVE de sellos: une solo variantes por acentos/mayúsculas/puntuación
// de las MISMAS palabras («Jabalina Música» = «Jabalina Musica»). NO toca sub-sellos:
// «Warner» y «Warner Spain» dan claves distintas y no se fusionan.
const labelKey = (name) =>
  String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const insLabel = db.prepare("INSERT INTO tags (type, name) VALUES ('label', ?) ON CONFLICT DO NOTHING");
const getLabel = db.prepare("SELECT id FROM tags WHERE type='label' AND name=?");
const linkLabel = db.prepare('INSERT INTO album_tags (album_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING');

function captureLabel(albumId, label) {
  if (!label) return;
  insLabel.run(label);
  const id = getLabel.get(label)?.id;
  if (id) linkLabel.run(albumId, id);
}

// Versiones de un álbum (bajo demanda desde su ficha): unifica las RELEASES oficiales
// de MusicBrainz (lista canónica de ediciones del release-group) con las ediciones de
// Discogs (prensajes/remasters y radar de upgrades). Cada fuente es opcional: MB necesita
// el álbum identificado (rg_mbid), Discogs necesita token.
export async function albumEditions(albumId) {
  const a = db.prepare('SELECT id, album_artist, title, rg_mbid FROM albums WHERE id = ?').get(albumId);
  if (!a) throw new Error('Álbum no encontrado');

  let mbVersions = [];
  if (a.rg_mbid) mbVersions = await releaseGroupReleases(a.rg_mbid).catch(() => []);

  let discogs = { configured: discogsConfigured() };
  if (discogs.configured) {
    const res = await releaseEditions(a.album_artist, a.title);
    if (res) {
      captureLabel(albumId, res.label);
      discogs = { ...discogs, found: true, ...res };
    } else {
      discogs = { ...discogs, found: false };
    }
  }
  return { mbVersions, discogs };
}

// Resuelve el sello de un álbum IDENTIFICADO desde MusicBrainz (bajo demanda desde la
// ficha, cuando los ficheros no traían la etiqueta de sello). Si ya se conoce, lo
// devuelve sin llamar a MB. Lo que encuentra se captura como tag 'label' para que
// persista y alimente la vista de Sellos. Cacheado en MB.
export async function resolveAlbumLabel(albumId) {
  const a = db.prepare('SELECT id, release_mbid, rg_mbid FROM albums WHERE id = ?').get(albumId);
  if (!a) throw new Error('Álbum no encontrado');
  const existing = db
    .prepare("SELECT t.name FROM album_tags at JOIN tags t ON t.id=at.tag_id AND t.type='label' WHERE at.album_id=?")
    .all(albumId)
    .map((r) => r.name)
    .filter((n) => !isJunkLabel(n));
  if (existing.length) return { labels: existing, cached: true };

  let labels = [];
  if (a.release_mbid) labels = await releaseLabels(a.release_mbid);
  if (!labels.length && a.rg_mbid) labels = await releaseGroupLabels(a.rg_mbid);
  labels = labels.filter((n) => !isJunkLabel(n));
  for (const l of labels) captureLabel(albumId, l);
  return { labels };
}

// Cola de upgrades: álbumes que tienes SIN NINGUNA pista sin pérdida (todo MP3/AAC),
// candidatos naturales a buscar una edición mejor. Ordenados por lo que más pesa
// (los más grandes en lossy suelen ser los que más ganarías reencodeando/sustituyendo).
export function upgradeCandidates() {
  const owned = new Set(db.prepare('SELECT rg_mbid FROM lidarr_albums').all().map((r) => r.rg_mbid));
  return db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.cover, a.size_bytes, a.rg_mbid,
        ar.mbid AS artist_mbid,
        (SELECT MAX(t.bitrate) FROM tracks t WHERE t.album_id=a.id) AS max_bitrate,
        (SELECT GROUP_CONCAT(DISTINCT t.format) FROM tracks t WHERE t.album_id=a.id) AS formats
       FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id
       WHERE a.match_state NOT IN ('dismissed')
         AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id=a.id AND t.lossless=1)
       ORDER BY a.size_bytes DESC`
    )
    .all()
    .map((r) => ({
      ...r,
      max_kbps: r.max_bitrate ? Math.round(r.max_bitrate / 1000) : null,
      // se puede pedir upgrade a Lidarr solo si el álbum está identificado (tiene rg_mbid)
      can_upgrade: !!r.rg_mbid,
      in_lidarr: r.rg_mbid ? owned.has(r.rg_mbid) : false,
    }));
}

// Sellos de tu colección (según lo capturado de Discogs al explorar ediciones, y
// lo que traigan las etiquetas). Crece a medida que usas la app.
export function labelsOverview() {
  const rows = db
    .prepare(
      `SELECT t.name, COUNT(*) AS albums
       FROM album_tags at JOIN tags t ON t.id=at.tag_id AND t.type='label'
       JOIN albums a ON a.id=at.album_id AND a.match_state!='dismissed'
       GROUP BY t.name`
    )
    .all()
    .filter((r) => !isJunkLabel(r.name));
  // fusión suave: variantes por acentos/mayúsculas bajo el nombre más frecuente
  const groups = new Map();
  for (const r of rows) {
    const key = labelKey(r.name);
    const g = groups.get(key);
    if (g) {
      g.albums += r.albums;
      g._variants.push(r.name);
      if (r.albums > g._top) {
        g._top = r.albums;
        g.name = r.name;
      }
    } else {
      groups.set(key, { name: r.name, albums: r.albums, _top: r.albums, _variants: [r.name] });
    }
  }
  return [...groups.values()]
    .map((g) => ({ name: g.name, albums: g.albums, variants: g._variants.length > 1 ? g._variants.length : undefined }))
    .sort((a, b) => b.albums - a.albums || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

export function labelAlbums(name) {
  // resuelve TODAS las variantes del sello (acentos/mayúsculas) y trae sus álbumes
  const key = labelKey(name);
  const names = db
    .prepare("SELECT DISTINCT name FROM tags WHERE type='label'")
    .all()
    .map((r) => r.name)
    .filter((n) => labelKey(n) === key);
  if (!names.length) names.push(name);
  const ph = names.map(() => '?').join(',');
  const raw = db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.cover, a.track_file_count, a.track_count, a.match_state,
        a.size_bytes, a.rg_mbid
       FROM album_tags at JOIN tags t ON t.id=at.tag_id AND t.type='label' AND t.name IN (${ph})
       JOIN albums a ON a.id=at.album_id AND a.match_state!='dismissed'`
    )
    .all(...names);
  // un álbum puede tener dos variantes del sello: dedup por id antes de colapsar
  const seen = new Set();
  const rows = [];
  for (const a of raw) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      rows.push(a);
    }
  }
  // colapsa duplicados a un representante con ×N (coherente con la Discoteca y el artista)
  const groups = new Map();
  for (const a of rows) {
    const key = a.rg_mbid
      ? `mb:${a.rg_mbid}`
      : `t:${String(a.album_artist || '').toLowerCase().trim()} ${normalizeForDup(a.title)}`;
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
  }
  const out = [];
  for (const copies of groups.values()) {
    if (copies.length === 1) {
      out.push(copies[0]);
      continue;
    }
    let best = copies[0];
    for (const c of copies) if (libScore(c) > libScore(best)) best = c;
    best.dup = { copies: copies.length };
    out.push(best);
  }
  out.sort(
    (a, b) =>
      (a.year || 0) - (b.year || 0) ||
      String(a.album_artist || '').localeCompare(String(b.album_artist || ''), 'es', { sensitivity: 'base' })
  );
  return out;
}

// Completismo de un sello contra MusicBrainz (bajo demanda): resuelve el nombre del
// sello a un sello de MB, trae su catálogo de álbumes de estudio y lo cruza con lo
// que TIENES (por rg_mbid y por artista+título normalizado, para los no
// identificados). Para sellos enormes (majors) devuelve {tooBig}: ahí el % no aplica.
export async function labelCompletism(labelName) {
  const label = await searchLabel(labelName);
  if (!label) return { found: false };
  const cat = await labelReleaseGroups(label.mbid);
  if (cat.tooBig) return { found: true, label, tooBig: true, total: cat.total };

  const owned = db.prepare("SELECT rg_mbid, album_artist, title FROM albums WHERE match_state != 'dismissed'").all();
  const ownedRg = new Set(owned.filter((o) => o.rg_mbid).map((o) => o.rg_mbid));
  const nkey = (artist, title) => `${String(artist || '').toLowerCase().trim()} ${normalizeForDup(title)}`;
  const ownedName = new Set(owned.map((o) => nkey(o.album_artist, o.title)));

  let ownedCount = 0;
  const missing = [];
  for (const rg of cat.releaseGroups) {
    if (ownedRg.has(rg.rg_mbid) || ownedName.has(nkey(rg.artist, rg.title))) ownedCount++;
    else missing.push(rg);
  }
  missing.sort((a, b) => (a.year || 0) - (b.year || 0) || String(a.artist || '').localeCompare(String(b.artist || '')));
  // resuelve el artista LOCAL de cada hueco (para enlazar a su ficha en la UI): por
  // MBID y, si no, por nombre normalizado. Si no lo tienes en local, queda null y la
  // UI enlaza a MusicBrainz por artist_mbid.
  const byMbid = new Map(db.prepare('SELECT id, mbid FROM artists WHERE mbid IS NOT NULL').all().map((a) => [a.mbid, a.id]));
  const byName = new Map(db.prepare('SELECT id, name FROM artists').all().map((a) => [normName(a.name), a.id]));
  for (const m of missing) {
    m.artist_id = (m.artist_mbid && byMbid.get(m.artist_mbid)) || byName.get(normName(m.artist)) || null;
  }
  const total = cat.releaseGroups.length;
  return {
    found: true,
    label,
    total,
    owned: ownedCount,
    pct: total ? Math.round((ownedCount / total) * 100) : null,
    missing,
  };
}
