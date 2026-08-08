import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting } from './db.js';
import { splitRoots } from './libkey.js';

// BORRADO DE DISCO. Rompe el principio "nunca borra musica", asi que es una accion
// explicita, con guardarrailes fuertes:
//  - exige confirm === true (la UI confirma antes con dialogo duro),
//  - SOLO borra rutas DENTRO de la biblioteca (music_dirs). Nunca toca torrents/ ni
//    nada fuera: por eso el seeding sobrevive (qBittorrent seedea desde torrents/, y
//    si es un hardlink, borrar la copia de media solo quita UN enlace),
//  - si algun fichero no se puede borrar (biblioteca en solo lectura, permisos),
//    NO toca la base de datos y devuelve el error: nada de estados mentira.
// Borra los ficheros de pista, limpia la carpeta (sidecars: caratula, .nfo, .lrc...)
// y la elimina si queda vacia, y por ultimo quita el album de la BD (sin Papelera:
// no hay nada que restaurar). No borra subcarpetas (no arrasa contenido anidado).

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

export function deleteAlbumFromDisk(albumId, { confirm } = {}) {
  if (confirm !== true) throw new Error('Borrado no confirmado');
  const album = db.prepare('SELECT id, path, title, album_artist FROM albums WHERE id = ?').get(albumId);
  if (!album) throw new Error('Album no encontrado');

  const roots = splitRoots(getSetting('music_dirs')).map(norm).filter(Boolean);
  if (!roots.length) throw new Error('No hay biblioteca de musica configurada');
  const within = (p) => {
    const np = norm(p);
    return !!np && roots.some((r) => np === r || np.startsWith(r + '/'));
  };

  const trackPaths = db
    .prepare('SELECT path FROM tracks WHERE album_id = ?')
    .all(albumId)
    .map((t) => t.path)
    .filter(Boolean);
  const dir = album.path || null;

  // GUARDARRAIL: todo lo que se vaya a tocar DEBE estar dentro de la biblioteca.
  for (const t of trackPaths) if (!within(t)) throw new Error(`Ruta fuera de la biblioteca, abortado: ${t}`);
  if (dir && !within(dir)) throw new Error(`Carpeta fuera de la biblioteca, abortado: ${dir}`);
  if (!trackPaths.length && !dir) throw new Error('El album no tiene rutas conocidas; no se borra nada');

  // 1) borra los ficheros de pista
  for (const t of trackPaths) {
    try {
      fs.rmSync(t, { force: true });
    } catch {
      /* se comprueba abajo por existencia real */
    }
  }
  const remaining = trackPaths.filter((t) => {
    try {
      return fs.existsSync(t);
    } catch {
      return false;
    }
  });
  if (remaining.length) {
    throw new Error(
      `No se pudieron borrar ${remaining.length} de ${trackPaths.length} ficheros (¿biblioteca montada en solo lectura?). No se ha cambiado nada.`
    );
  }

  // 2) limpia la carpeta del album: borra ficheros sueltos restantes (caratula, .nfo,
  //    .lrc, .cue, .log...), NUNCA subcarpetas; y elimina la carpeta si queda vacia.
  if (dir && within(dir)) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let hasSubdir = false;
      for (const e of entries) {
        if (e.isDirectory()) {
          hasSubdir = true;
          continue;
        }
        try {
          fs.rmSync(path.posix.join(norm(dir), e.name), { force: true });
        } catch {
          /* deja el resto */
        }
      }
      if (!hasSubdir) fs.rmdirSync(dir);
    } catch {
      /* si la carpeta no se puede limpiar, no es fatal: los ficheros ya no estan */
    }
  }

  // 3) fuera de la base de datos (album + pistas + etiquetas). Sin Papelera: los
  //    ficheros ya no existen, no hay nada que restaurar.
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM tracks WHERE album_id = ?').run(albumId);
    db.prepare('DELETE FROM album_tags WHERE album_id = ?').run(albumId);
    db.prepare('DELETE FROM albums WHERE id = ?').run(albumId);
  });
  tx();

  console.warn(`[delete] borrado del disco: "${album.album_artist} - ${album.title}" (${trackPaths.length} ficheros)`);
  return { ok: true, deleted: trackPaths.length };
}
