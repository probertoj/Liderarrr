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

// «Sellos» que no son sellos: firmas de grupos de scene (PMEDIA), placeholders
// ([no label], not on label) y basura similar en el tag PUBLISHER. Se descartan al
// escanear y en la vista de Sellos. Normaliza quitando puntuación para cazar
// variantes (P.M.E.D.I.A, PMEDIA, [no label], etc.).
const JUNK_LABELS = new Set(['pmedia', 'nolabel', 'label', 'notonlabel', 'unknown', 'none', 'na']);
export function isJunkLabel(name) {
  const n = String(name || '')
    .toLowerCase()
    .replace(/[.\s[\]()_/-]/g, '');
  return !n || JUNK_LABELS.has(n);
}

// Basura del sistema de ficheros: NO es música, pero lo parece. Un Mac que toque la
// biblioteca (por red o por USB) siembra cada carpeta de `._loquesea.flac` —AppleDouble, la
// «otra mitad» del fichero, con la MISMA extensión que el original— y de `.DS_Store`,
// `.Trashes` o `.Spotlight-V100`; Synology deja `@eaDir` con sus miniaturas y Windows
// `$RECYCLE.BIN`. Si se escanea, un disco de 10 pistas sale con 20 —la mitad sin etiquetas ni
// número— y la carátula puede acabar siendo un `._cover.jpg`, que no es una imagen.
//
// Basta el punto inicial para casi todo, con UNA excepción: los nombres que empiezan por DOS
// puntos o más son títulos de verdad, no ocultos («...And Justice for All»). La lista cubre
// la basura que no lleva punto.
//
// OJO: se juzgan los nombres de DENTRO de la biblioteca, nunca la raíz — una biblioteca en
// /volumen/.musica es legítima y tiene que escanearse igual.
const JUNK_NAMES = new Set(['__macosx', '@eadir', '$recycle.bin', 'system volume information', 'lost+found']);

export function isJunkEntry(name) {
  const n = String(name || '');
  return (n.startsWith('.') && !n.startsWith('..')) || JUNK_NAMES.has(n.toLowerCase());
}

// Trozos de una ruta, con la barra que sea (la base guarda las rutas del NAS con / y las de
// Windows con \).
export const pathSegments = (p) =>
  String(p || '')
    .split(/[/\\]+/)
    .filter(Boolean);
