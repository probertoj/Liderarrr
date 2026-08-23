import { db, getSetting } from './db.js';

// Exporta una lista de reproducción M3U (extendida) a partir de álbumes que TIENES: para
// escuchar un reto, tus «no escuchados», etc. en tu reproductor. Las rutas son las que ve
// el servidor; si tu reproductor monta la música en otra ruta, define la sustitución en
// Ajustes (`playlist_path_map`: «rutaServidor => rutaReproductor», una sola línea).

function pathMapper() {
  const raw = String(getSetting('playlist_path_map') || '').trim();
  const m = raw.split(/\s*(?:=>|->|\|)\s*/);
  if (m.length !== 2 || !m[0].trim() || !m[1].trim()) return (p) => p;
  const from = m[0].trim().replace(/\\/g, '/');
  const to = m[1].trim();
  return (p) => {
    const np = String(p || '').replace(/\\/g, '/');
    return np === from || np.startsWith(from) ? to + np.slice(from.length) : p;
  };
}

export const sanitizePlaylistName = (s) =>
  String(s || 'liderarr').replace(/[/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'liderarr';

export function buildM3U(albumIds) {
  const ids = [...new Set((albumIds || []).map(Number).filter(Boolean))];
  const map = pathMapper();
  const q = db.prepare(
    `SELECT t.path, t.title, t.artist, t.duration_ms, a.album_artist
     FROM tracks t JOIN albums a ON a.id = t.album_id
     WHERE t.album_id = ? AND t.path IS NOT NULL ORDER BY t.disc, t.num`
  );
  const lines = ['#EXTM3U'];
  for (const id of ids) {
    for (const t of q.all(id)) {
      const secs = t.duration_ms ? Math.round(t.duration_ms / 1000) : -1;
      const label = `${(t.artist || t.album_artist || '').trim()} - ${(t.title || '').trim()}`.trim();
      lines.push(`#EXTINF:${secs},${label}`);
      lines.push(map(t.path));
    }
  }
  return lines.join('\n') + '\n';
}

// M3U de los álbumes de un reto que YA tienes, en el orden del reto.
export function challengeM3U(challengeId) {
  const ids = db
    .prepare('SELECT owned_album_id FROM challenge_items WHERE challenge_id = ? AND owned_album_id IS NOT NULL ORDER BY position')
    .all(challengeId)
    .map((r) => r.owned_album_id);
  return buildM3U(ids);
}
