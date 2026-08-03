import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { db, DATA_DIR } from './db.js';

// Resolución de carátulas. Prioridad: (1) fichero de imagen en la carpeta del
// álbum (cover.jpg, folder.png…), (2) carátula INCRUSTADA en las etiquetas de la
// primera pista. La incrustada se extrae una vez y se cachea en /data/img, así
// que solo se paga el parseo la primera vez que se pide.
const CACHE_DIR = path.join(DATA_DIR, 'img', 'embedded');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const getAlbum = db.prepare('SELECT cover FROM albums WHERE id = ?');
const firstTrack = db.prepare(
  'SELECT path FROM tracks WHERE album_id = ? AND path IS NOT NULL ORDER BY disc, num LIMIT 1'
);

export async function albumCover(albumId) {
  const a = getAlbum.get(albumId);
  if (!a) return null;

  // 1. carátula como fichero en la carpeta
  if (a.cover && fs.existsSync(a.cover)) {
    const ext = path.extname(a.cover).slice(1).toLowerCase();
    return { path: a.cover, contentType: `image/${ext === 'jpg' ? 'jpeg' : ext || 'jpeg'}` };
  }

  // 2. carátula incrustada (cacheada). El .type guarda el mime, o "none" si ya
  //    comprobamos que no hay (para no reparsear el fichero en cada petición).
  const cached = path.join(CACHE_DIR, `${albumId}.img`);
  const typeFile = path.join(CACHE_DIR, `${albumId}.type`);
  if (fs.existsSync(typeFile)) {
    const ct = fs.readFileSync(typeFile, 'utf8');
    if (ct === 'none') return null;
    if (fs.existsSync(cached)) return { path: cached, contentType: ct };
  }

  const t = firstTrack.get(albumId);
  if (!t) {
    fs.writeFileSync(typeFile, 'none');
    return null;
  }
  try {
    const mm = await parseFile(t.path, { duration: false });
    const pic = mm.common.picture?.[0];
    if (pic?.data) {
      fs.writeFileSync(cached, Buffer.from(pic.data));
      const ct = pic.format && pic.format.includes('/') ? pic.format : 'image/jpeg';
      fs.writeFileSync(typeFile, ct);
      return { path: cached, contentType: ct };
    }
  } catch {
    /* fichero ilegible */
  }
  fs.writeFileSync(typeFile, 'none');
  return null;
}

// Para invalidar la caché de una carátula si el álbum se re-escanea (opcional).
export function clearCoverCache(albumId) {
  for (const f of [`${albumId}.img`, `${albumId}.type`]) {
    try {
      fs.unlinkSync(path.join(CACHE_DIR, f));
    } catch {
      /* no existía */
    }
  }
}
