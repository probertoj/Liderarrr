import { db } from './db.js';

// Artist-credit de un álbum local (varios artistas por etiqueta: splits, singles
// compartidos, colaboraciones). Fuente de la verdad = tabla `album_artists`, que solo
// se llena cuando hay 2+ artistas; con uno basta `albums.artist_id` (el PRINCIPAL,
// posición 0). Nunca toca ficheros: es metadato interno, como corregir el artista.

// Resuelve un artista LOCAL para un credit de MB: por MBID, si no por nombre (sin
// distinguir mayúsculas), y si no existe lo crea. Si trae MBID y la fila local no lo
// tenía, se lo pone (desbloquea su completismo). Devuelve el id local.
function resolveArtistId({ name, mbid }) {
  const clean = String(name || '').trim();
  if (mbid) {
    const byMbid = db.prepare('SELECT id FROM artists WHERE mbid = ? LIMIT 1').get(mbid);
    if (byMbid) return byMbid.id;
  }
  if (clean) {
    const byName = db.prepare('SELECT id, mbid FROM artists WHERE name = ? COLLATE NOCASE').get(clean);
    if (byName) {
      if (mbid && !byName.mbid) db.prepare('UPDATE artists SET mbid = ? WHERE id = ?').run(mbid, byName.id);
      return byName.id;
    }
  }
  if (!clean) return null;
  const r = db.prepare('INSERT INTO artists (name, sort_name, mbid) VALUES (?,?,?)').run(clean, clean, mbid || null);
  return Number(r.lastInsertRowid);
}

// Ensambla el texto del credit ("A / B", "A & B feat. C") a partir de los nexos de MB.
// Si un credit no trae nexo (entrada manual), usa " / " entre artistas y nada tras el
// último.
export function assembleCreditString(credits) {
  return credits
    .map((c, i) => {
      const nm = c.credit_name || c.name || '';
      const jp = c.joinphrase != null ? c.joinphrase : i < credits.length - 1 ? ' / ' : '';
      return nm + jp;
    })
    .join('')
    .trim();
}

// Escribe el artist-credit de un álbum. `credits` = [{name, mbid?, credit_name?, joinphrase?}].
// - 2+ artistas: llena album_artists, fija artist_id=principal, album_artist=texto ensamblado
//   y marca artist_manual=1 (para que un reescaneo no lo pise con la etiqueta de un solo
//   artista del fichero, y para que el display multi-artista sea estable en todas las vistas).
// - 0/1 artista: borra album_artists (vuelve a mono-artista) y apunta al único.
export function writeAlbumCredits(albumId, credits, { manual = true } = {}) {
  const album = db.prepare('SELECT id FROM albums WHERE id = ?').get(albumId);
  if (!album) throw new Error('Álbum no encontrado');
  const resolved = (credits || [])
    .map((c) => ({ ...c, artist_id: resolveArtistId(c) }))
    .filter((c) => c.artist_id != null);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM album_artists WHERE album_id = ?').run(albumId);
    if (resolved.length >= 2) {
      const ins = db.prepare(
        'INSERT OR IGNORE INTO album_artists (album_id, artist_id, position, join_phrase, credit_name) VALUES (?,?,?,?,?)'
      );
      resolved.forEach((c, i) =>
        ins.run(albumId, c.artist_id, i, c.joinphrase != null ? c.joinphrase : i < resolved.length - 1 ? ' / ' : '', c.credit_name || c.name || null)
      );
      db.prepare('UPDATE albums SET artist_id = ?, album_artist = ?, artist_manual = 1 WHERE id = ?')
        .run(resolved[0].artist_id, assembleCreditString(resolved), albumId);
    } else if (resolved.length === 1) {
      const c = resolved[0];
      const name = c.credit_name || c.name || db.prepare('SELECT name FROM artists WHERE id = ?').get(c.artist_id)?.name || '';
      db.prepare(`UPDATE albums SET artist_id = ?, album_artist = ?${manual ? ', artist_manual = 1' : ''} WHERE id = ?`)
        .run(c.artist_id, name, albumId);
    }
    // resolved.length === 0: no se toca nada (credits vacío = sin cambios)
  });
  tx();
  return albumCredits(albumId);
}

// Auto-población desde el artist-credit de MusicBrainz al identificar. Solo actúa si hay
// 2+ artistas, el álbum no está ya curado a mano (artist_manual) y no tiene ya un credit
// escrito. Así el caso normal (un artista) no cambia y no pisa correcciones manuales.
export function syncAlbumCreditsFromMb(albumId, credits) {
  if (!Array.isArray(credits) || credits.length < 2) return null;
  const a = db.prepare('SELECT artist_manual FROM albums WHERE id = ?').get(albumId);
  if (!a || a.artist_manual) return null;
  const existing = db.prepare('SELECT 1 FROM album_artists WHERE album_id = ? LIMIT 1').get(albumId);
  if (existing) return null;
  try {
    return writeAlbumCredits(albumId, credits, { manual: false });
  } catch {
    return null;
  }
}

// Lee el artist-credit de un álbum para la ficha. Si no hay filas en album_artists (lo
// normal, un solo artista) devuelve el principal desde albums/artists.
export function albumCredits(albumId) {
  const rows = db
    .prepare(
      `SELECT aa.artist_id, aa.position, aa.join_phrase, aa.credit_name, ar.name, ar.mbid
       FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id
       WHERE aa.album_id = ? ORDER BY aa.position`
    )
    .all(albumId);
  if (rows.length) {
    return rows.map((r) => ({
      artist_id: r.artist_id,
      name: r.name,
      credit_name: r.credit_name || r.name,
      mbid: r.mbid,
      join_phrase: r.join_phrase || '',
    }));
  }
  const a = db
    .prepare('SELECT a.artist_id, a.album_artist, ar.name, ar.mbid FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id WHERE a.id = ?')
    .get(albumId);
  if (!a) return [];
  return [{ artist_id: a.artist_id, name: a.name || a.album_artist, credit_name: a.album_artist || a.name, mbid: a.mbid, join_phrase: '' }];
}
