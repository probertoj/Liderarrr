// Normalización compartida para cruzar "lo que TIENES" contra listas externas
// (retos, radar de curadores…). Objetivo: reducir FALSOS NEGATIVOS (no detectar algo
// que sí tienes) sin abrir la puerta a falsos positivos. Por eso solo se quita
// morralla INEQUÍVOCA del título —año, corchetes de formato, sufijo de edición—,
// nunca palabras del propio título. Antes cada módulo tenía su norm ad-hoc y no
// coincidían (p. ej. "Marquee Moon - 1977" de una lista vs "Marquee Moon" en disco,
// o "On the Beach (1974) [FLAC 16bit]" en la carpeta vs "On the Beach").

// Palabras/patrones que, entre paréntesis o corchetes al final, son ruido de edición
// o de formato de fichero, no parte del título.
const EDITION_RE =
  /(deluxe|expanded|remaster|anniversary|edition|reissue|re-?master|mono|stereo|bonus|special|version|explicit|flac|mp3|vinyl|\d{2,3}\s*bit|\d{2,3}(\.\d)?\s*khz|hi-?res|24-?96|16-?44)/i;

// Nombre (artista/sello) → minúsculas sin diacríticos ni signos.
export function normName(s) {
  return String(s || '')
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Título limpio para casar: quita corchetes/paréntesis FINALES que sean año o edición
// (repetido: puede haber varios, p. ej. "Album (1974) [FLAC 16bit]") y un sufijo
// " - 1977" (formato de muchas listas), luego normaliza como un nombre.
export function cleanTitleForMatch(title) {
  let t = String(title || '').trim();
  for (;;) {
    const m = t.match(/[[(]([^\])]*)[)\]]\s*$/);
    if (!m || (!/\d{4}/.test(m[1]) && !EDITION_RE.test(m[1]))) break;
    t = t.slice(0, m.index).trim();
  }
  t = t.replace(/\s+[-–—]\s*\d{4}\s*$/, '').trim(); // sufijo " - 1977"
  return normName(t);
}

// Clave de cruce artista+álbum. Misma forma en ambos lados (biblioteca y lista).
export function matchKey(artist, title) {
  return `${normName(artist)}::${cleanTitleForMatch(title)}`;
}
