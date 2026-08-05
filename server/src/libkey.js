import crypto from 'node:crypto';

export const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

// Parte music_dirs (varias carpetas por ; o salto de línea) en rutas normalizadas
// (sin barra final).
export const splitRoots = (s) =>
  String(s || '')
    .split(/[\n;]+/)
    .map((x) => x.trim().replace(/[/\\]+$/, ''))
    .filter(Boolean);

// Identidad ESTABLE de un álbum entre montajes: hash de su ruta RELATIVA al root que
// la contiene. Así /music/Artista/Álbum y /data/media/music/Artista/Álbum comparten
// identidad — cambiar el montaje (necesario para los hardlinks del layout TRaSH) no
// reescanea la biblioteca ni pierde la identificación. El prefijo 'lk:' versiona el
// esquema de clave. Si la ruta no cuelga de ningún root, cae a la ruta completa.
export function albumKey(dir, roots) {
  const d = String(dir).replace(/[/\\]+$/, '');
  for (const r of roots) {
    if (d === r) return sha1('lk:');
    if (d.startsWith(`${r}/`)) return sha1(`lk:${d.slice(r.length + 1)}`);
  }
  return sha1(`lk:${d}`);
}
