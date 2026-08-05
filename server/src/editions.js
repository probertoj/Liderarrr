import { db } from './db.js';
import { releaseEditions, discogsConfigured } from './discogs.js';
import { isJunkLabel } from './libkey.js';
import { searchLabel, labelReleaseGroups } from './musicbrainz.js';
import { normalizeForDup } from './queries.js';

// Ediciones y upgrades: el equivalente (mejor) de JustWatch. Para un álbum tuyo,
// Discogs lista todas sus ediciones —remaster, deluxe, vinilo con bonus— así
// sabes si de ese MP3 que tienes existe algo mejor. De paso, cada consulta captura
// el sello, que alimenta la vista de Sellos (que crece según exploras).

const insLabel = db.prepare("INSERT INTO tags (type, name) VALUES ('label', ?) ON CONFLICT DO NOTHING");
const getLabel = db.prepare("SELECT id FROM tags WHERE type='label' AND name=?");
const linkLabel = db.prepare('INSERT INTO album_tags (album_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING');

function captureLabel(albumId, label) {
  if (!label) return;
  insLabel.run(label);
  const id = getLabel.get(label)?.id;
  if (id) linkLabel.run(albumId, id);
}

// Ediciones de un álbum concreto (bajo demanda desde su ficha).
export async function albumEditions(albumId) {
  if (!discogsConfigured()) return { configured: false };
  const a = db.prepare('SELECT id, album_artist, title FROM albums WHERE id = ?').get(albumId);
  if (!a) throw new Error('Álbum no encontrado');
  const res = await releaseEditions(a.album_artist, a.title);
  if (!res) return { configured: true, found: false };
  captureLabel(albumId, res.label);
  return { configured: true, found: true, ...res };
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
  return db
    .prepare(
      `SELECT t.name, COUNT(*) AS albums
       FROM album_tags at JOIN tags t ON t.id=at.tag_id AND t.type='label'
       JOIN albums a ON a.id=at.album_id AND a.match_state!='dismissed'
       GROUP BY t.name ORDER BY albums DESC, t.name`
    )
    .all()
    .filter((r) => !isJunkLabel(r.name));
}

export function labelAlbums(name) {
  return db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.cover, a.track_file_count, a.track_count, a.match_state
       FROM album_tags at JOIN tags t ON t.id=at.tag_id AND t.type='label' AND t.name=@name
       JOIN albums a ON a.id=at.album_id AND a.match_state!='dismissed'
       ORDER BY a.year, a.album_artist`
    )
    .all({ name });
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
