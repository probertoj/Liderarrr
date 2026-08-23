import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, cacheRead, cacheWrite } from './db.js';
import { matchKey } from './matchkey.js';
import * as lastfm from './lastfm.js';

// Fotos de artista, en paralelo a las carátulas (covers.js): resolución automática
// desde Deezer (por nombre, sin API key) y edición manual (buscar candidatos o subir).
// Cacheado en /data/img/artist/{id}. NUNCA bloquea: la resolución cara va en segundo
// plano y la UI reintenta. Los artistas no tienen carpeta propia → solo caché (no se
// escribe a disco de música como las carátulas).

const ART_DIR = path.join(DATA_DIR, 'img', 'artist');
fs.mkdirSync(ART_DIR, { recursive: true });
const UA = 'Liderarrr/0.1.0 ( https://github.com/probertoj/Liderarrr )';

const getArtist = db.prepare('SELECT id, name FROM artists WHERE id = ?');
const cachedImg = (id) => path.join(ART_DIR, String(id));
const mimeFile = (id) => path.join(ART_DIR, `${id}.mime`);
const noneFile = (id) => path.join(ART_DIR, `${id}.none`);

// --- puerta de concurrencia (máx. 4 resoluciones caras a la vez) -------------
let active = 0;
const waiters = [];
function acquire() {
  if (active < 4) {
    active++;
    return Promise.resolve();
  }
  return new Promise((res) => waiters.push(res)).then(() => {
    active++;
  });
}
function release() {
  active--;
  const next = waiters.shift();
  if (next) next();
}

async function fetchImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? { buf, mime: ct.split(';')[0] } : null;
  } catch {
    return null;
  }
}

function cacheAndServe(id, buf, mime) {
  fs.writeFileSync(cachedImg(id), buf);
  fs.writeFileSync(mimeFile(id), mime);
  try {
    fs.unlinkSync(noneFile(id));
  } catch {
    /* no existía */
  }
  return { path: cachedImg(id), contentType: mime };
}

// Deezer: buscar artistas por texto. Sin API key. Devuelve candidatos con su foto.
async function deezerSearch(term, limit = 12) {
  try {
    const res = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(term)}&limit=${limit}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || [])
      .map((a) => ({
        source: 'deezer',
        id: a.id,
        name: a.name,
        url: a.picture_xl || a.picture_big || '',
        thumb: a.picture_medium || a.picture_small || a.picture_big || '',
        nb_fan: a.nb_fan || 0,
      }))
      // descarta el placeholder de Deezer (artistas sin foto: URL con «/artist//» = id vacío)
      .filter((c) => c.url && !c.url.includes('/artist//'));
  } catch {
    return [];
  }
}

// Mejor artista de Deezer para un nombre (por nº de fans): { id, name, image }. Útil para
// resolver la discografía (deezer.js) y la foto de una sugerencia externa (suggest.js).
export async function deezerFindArtist(name) {
  const hits = await deezerSearch(name, 5);
  if (!hits.length) return null;
  hits.sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));
  const best = hits[0];
  return { id: best.id, name: best.name, image: best.url || best.thumb || null };
}

// Carátula de un álbum por Deezer (sin API key), para pintar portadas de discos que NO
// tienes en la biblioteca (p. ej. el mosaico del Resumen). Cacheada 30 días —también los
// fallos— para no repetir la búsqueda.
const ALBUM_COVER_TTL = 30 * 24 * 3600 * 1000;
export async function deezerAlbumCover(artist, title) {
  if (!artist || !title) return null;
  const key = `deezer:albumcover:${matchKey(artist, title)}`;
  const cached = cacheRead(key, ALBUM_COVER_TTL);
  if (cached !== null) return cached.url || null;
  let out = { url: null };
  try {
    const res = await fetch(
      `https://api.deezer.com/search/album?q=${encodeURIComponent(`${artist} ${title}`)}&limit=1`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) }
    );
    if (res.ok) {
      const data = await res.json();
      const al = data.data?.[0];
      if (al) out = { url: al.cover_medium || al.cover_big || al.cover || null };
    }
  } catch {
    /* sin portada */
  }
  cacheWrite(key, out);
  return out.url || null;
}

// Carátula de un álbum con RESPALDOS: Deezer → Last.fm (imagen) → Cover Art Archive (por el
// MBID que Last.fm devuelva). Cacheada 30 días. Para el mosaico del Resumen: así casi ningún
// disco queda sin portada aunque Deezer no lo tenga.
export async function albumCoverUrl(artist, title) {
  if (!artist || !title) return null;
  const key = `albumcover:${matchKey(artist, title)}`;
  const cached = cacheRead(key, ALBUM_COVER_TTL);
  if (cached !== null) return cached.url || null;
  let url = await deezerAlbumCover(artist, title).catch(() => null);
  if (!url) {
    try {
      const info = await lastfm.albumInfo(artist, title);
      if (info?.image) url = info.image;
      else if (info?.mbid) url = `https://coverartarchive.org/release-group/${info.mbid}/front-500`;
    } catch {
      /* sin respaldo */
    }
  }
  cacheWrite(key, { url: url || null });
  return url || null;
}

// Resolución RÁPIDA (sin red): foto en caché. 'ok' | 'none' | 'pending' | 'notfound'.
export function artistPhotoFast(artistId) {
  const a = getArtist.get(artistId);
  if (!a) return { status: 'notfound' };
  if (fs.existsSync(cachedImg(artistId)) && fs.existsSync(mimeFile(artistId)))
    return { status: 'ok', path: cachedImg(artistId), contentType: fs.readFileSync(mimeFile(artistId), 'utf8') };
  if (fs.existsSync(noneFile(artistId))) return { status: 'none' };
  return { status: 'pending' };
}

// Resolución CARA (Deezer por nombre), tras la puerta de concurrencia. Cachea o marca
// 'none'. Deduplica por artista.
const resolving = new Set();
export async function resolveArtistPhotoSlow(artistId) {
  if (resolving.has(artistId)) return;
  resolving.add(artistId);
  try {
    await acquire();
    try {
      if (fs.existsSync(cachedImg(artistId)) && fs.existsSync(mimeFile(artistId))) return;
      const a = getArtist.get(artistId);
      if (!a?.name) return;
      const hits = await deezerSearch(a.name, 1);
      const url = hits[0]?.url;
      if (url) {
        const img = await fetchImage(url);
        if (img) {
          cacheAndServe(artistId, img.buf, img.mime);
          return;
        }
      }
      fs.writeFileSync(noneFile(artistId), '');
    } finally {
      release();
    }
  } finally {
    resolving.delete(artistId);
  }
}

// Candidatos para elegir a mano (Deezer). `q` permite refinar; por defecto, el nombre.
export async function artistPhotoCandidates(artistId, q) {
  const a = getArtist.get(artistId);
  if (!a) throw new Error('Artista no encontrado');
  const term = (q && String(q).trim()) || a.name || '';
  const candidates = term ? await deezerSearch(term) : [];
  return { query: term, candidates };
}

// Aplica una foto elegida (URL de Deezer) o subida (dataURL). Solo caché (los artistas
// no tienen carpeta). Borra la marca 'none'.
export async function applyArtistPhoto(artistId, { url, dataUrl } = {}) {
  const a = getArtist.get(artistId);
  if (!a) throw new Error('Artista no encontrado');
  let buf;
  let mime;
  if (dataUrl) {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl));
    if (!m) throw new Error('Imagen no válida');
    mime = m[1].toLowerCase();
    buf = Buffer.from(m[2], 'base64');
  } else if (url) {
    const img = await fetchImage(String(url));
    if (!img) throw new Error('No se pudo descargar la imagen de esa URL');
    buf = img.buf;
    mime = img.mime;
  } else {
    throw new Error('Falta la imagen (url o fichero)');
  }
  if (!buf?.length) throw new Error('La imagen está vacía');
  cacheAndServe(artistId, buf, mime);
  return { ok: true };
}

export function retryMissingArtistPhotos() {
  let n = 0;
  for (const f of fs.readdirSync(ART_DIR)) {
    if (f.endsWith('.none')) {
      try {
        fs.unlinkSync(path.join(ART_DIR, f));
        n++;
      } catch {
        /* noop */
      }
    }
  }
  return n;
}
