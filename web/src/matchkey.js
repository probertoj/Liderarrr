// Portado de server/src/matchkey.js — DEBE mantenerse idéntico para que el matchKey del
// cliente (pertenencia a retos) case con el del servidor. Si cambias uno, cambia el otro.

const EDITION_RE =
  /(deluxe|expanded|remaster|anniversary|edition|reissue|re-?master|mono|stereo|bonus|special|version|explicit|flac|mp3|vinyl|\d{2,3}\s*bit|\d{2,3}(\.\d)?\s*khz|hi-?res|24-?96|16-?44)/i;

export function normName(s) {
  return String(s || '')
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function cleanTitleForMatch(title) {
  let t = String(title || '').trim();
  for (;;) {
    const m = t.match(/[[(]([^\])]*)[)\]]\s*$/);
    if (!m || (!/\d{4}/.test(m[1]) && !EDITION_RE.test(m[1]))) break;
    t = t.slice(0, m.index).trim();
  }
  t = t.replace(/\s+[-–—]\s*\d{4}\s*$/, '').trim();
  return normName(t);
}

export function matchKey(artist, title) {
  return `${normName(artist)}::${cleanTitleForMatch(title)}`;
}
