import { db } from './db.js';
import { releaseEditions, discogsConfigured } from './discogs.js';

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
  return db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.cover, a.size_bytes,
        (SELECT MAX(t.bitrate) FROM tracks t WHERE t.album_id=a.id) AS max_bitrate,
        (SELECT GROUP_CONCAT(DISTINCT t.format) FROM tracks t WHERE t.album_id=a.id) AS formats
       FROM albums a
       WHERE a.match_state NOT IN ('dismissed')
         AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id=a.id AND t.lossless=1)
       ORDER BY a.size_bytes DESC`
    )
    .all()
    .map((r) => ({ ...r, max_kbps: r.max_bitrate ? Math.round(r.max_bitrate / 1000) : null }));
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
    .all();
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
