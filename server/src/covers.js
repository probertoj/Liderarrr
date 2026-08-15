import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { db, DATA_DIR } from './db.js';

// Resolución de carátulas, en orden de preferencia:
//   1. fichero de imagen con nombre reconocido en la carpeta (del escaneo)
//   2. CUALQUIER imagen de la carpeta (la más grande) — caza carátulas con nombres
//      raros que el escaneo no reconoció
//   3. carátula INCRUSTADA en las etiquetas de la primera pista
//   4. ONLINE: Cover Art Archive (por MBID, oficial) y, si no, iTunes (por texto)
// Todo lo caro (incrustada + online) pasa por una PUERTA de concurrencia para que
// la Discoteca (cientos de carátulas a la vez) no sature el servidor ni la red, y
// se cachea en /data/img/art para descargar/extraer una sola vez.

const ART_DIR = path.join(DATA_DIR, 'img', 'art');
fs.mkdirSync(ART_DIR, { recursive: true });

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const UA = 'Liderarrr/0.1.0 ( https://github.com/probertoj/Liderarrr )';

const getAlbum = db.prepare('SELECT cover, path, rg_mbid, release_mbid, album_artist, title FROM albums WHERE id = ?');
const firstTrack = db.prepare('SELECT path FROM tracks WHERE album_id = ? AND path IS NOT NULL ORDER BY disc, num LIMIT 1');

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

const mimeByExt = (file) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  return `image/${ext === 'jpg' ? 'jpeg' : ext || 'jpeg'}`;
};
const cachedImg = (id) => path.join(ART_DIR, String(id));
const mimeFile = (id) => path.join(ART_DIR, `${id}.mime`);
const noneFile = (id) => path.join(ART_DIR, `${id}.none`);

function biggestImage(dir) {
  let best = null;
  let bestSize = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of entries) {
    if (!IMG_EXT.has(path.extname(f).toLowerCase())) continue;
    try {
      const s = fs.statSync(path.join(dir, f));
      if (s.size > bestSize) {
        bestSize = s.size;
        best = path.join(dir, f);
      }
    } catch {
      /* noop */
    }
  }
  return best;
}

// Caché en memoria del ESCANEO de carpeta (biggestImage): sin ella, coverFast hacía un
// readdirSync + statSync por cada petición de carátula. En la Discoteca (cientos de
// carátulas, y encima re-pedidas al navegar) eso bloqueaba el hilo principal síncrono y
// ralentizaba TODO. Aquí se recuerda el resultado por álbum (ruta o null = no hay imagen
// en la carpeta), así las siguientes peticiones son O(1). Se invalida al cachear/aplicar
// una carátula nueva (cacheAndServe) y al reintentar las que faltan.
const folderImgCache = new Map();

function cacheAndServe(id, buf, mime) {
  fs.writeFileSync(cachedImg(id), buf);
  fs.writeFileSync(mimeFile(id), mime);
  folderImgCache.delete(id);
  try {
    fs.unlinkSync(noneFile(id));
  } catch {
    /* no existía */
  }
  return { path: cachedImg(id), contentType: mime };
}

// Descarga una imagen; devuelve Buffer o null. Sigue redirecciones (CAA redirige
// a archive.org). Rechaza lo que no sea imagen.
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

async function itunesArt(artist, title) {
  try {
    const term = encodeURIComponent(`${artist} ${title}`);
    const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=1`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const art = data.results?.[0]?.artworkUrl100;
    // sube la resolución: iTunes sirve 100x100, pero acepta cualquier tamaño en la URL
    return art ? art.replace('100x100bb', '600x600bb') : null;
  } catch {
    return null;
  }
}

async function onlineCover(a) {
  // 1. Cover Art Archive (oficial, por MBID). Prefiere release; si no, release-group.
  const targets = [];
  if (a.release_mbid) targets.push(['release', a.release_mbid]);
  if (a.rg_mbid) targets.push(['release-group', a.rg_mbid]);
  for (const [kind, mbid] of targets) {
    const img = await fetchImage(`https://coverartarchive.org/${kind}/${mbid}/front-500`);
    if (img) return img;
  }
  // 2. iTunes (por texto: funciona aunque el álbum aún no esté identificado)
  if (a.album_artist && a.title) {
    const url = await itunesArt(a.album_artist, a.title);
    if (url) {
      const img = await fetchImage(url);
      if (img) return img;
    }
  }
  return null;
}

// Resolución RÁPIDA (sin red, sin leer el fichero de audio): carátula local, en
// caché, o cualquier imagen de la carpeta. Devuelve {status:'ok',path,contentType}
// si la tiene ya, 'none' si se sabe que no hay, 'pending' si haría falta la
// resolución cara, o 'notfound' si el álbum no existe. NUNCA bloquea.
export function coverFast(albumId) {
  const a = getAlbum.get(albumId);
  if (!a) return { status: 'notfound' };
  if (a.cover && fs.existsSync(a.cover)) return { status: 'ok', path: a.cover, contentType: mimeByExt(a.cover) };
  if (fs.existsSync(cachedImg(albumId)) && fs.existsSync(mimeFile(albumId)))
    return { status: 'ok', path: cachedImg(albumId), contentType: fs.readFileSync(mimeFile(albumId), 'utf8') };
  if (a.path) {
    // O(1): reusa el escaneo de carpeta cacheado (una sola stat para validar la ruta),
    // en vez de readdirSync + statSync por fichero en CADA petición.
    let img = folderImgCache.get(albumId);
    if (img === undefined || (img && !fs.existsSync(img))) {
      img = biggestImage(a.path);
      folderImgCache.set(albumId, img);
    }
    if (img) return { status: 'ok', path: img, contentType: mimeByExt(img) };
  }
  if (fs.existsSync(noneFile(albumId))) return { status: 'none' };
  return { status: 'pending' };
}

// Resolución CARA (lee el fichero para la carátula incrustada y consulta online),
// tras la puerta de concurrencia. Cachea el resultado (o marca 'none'); no devuelve
// nada — la siguiente petición lo sirve ya desde coverFast. Deduplica por álbum para
// no lanzar la misma resolución dos veces a la vez.
const resolving = new Set();
export async function resolveCoverSlow(albumId) {
  if (resolving.has(albumId)) return;
  resolving.add(albumId);
  try {
    await acquire();
    try {
      if (fs.existsSync(cachedImg(albumId)) && fs.existsSync(mimeFile(albumId))) return;
      const a = getAlbum.get(albumId);
      if (!a) return;
      const t = firstTrack.get(albumId);
      if (t) {
        try {
          const mm = await Promise.race([
            parseFile(t.path, { duration: false }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
          ]);
          const pic = mm.common.picture?.[0];
          if (pic?.data) {
            cacheAndServe(albumId, Buffer.from(pic.data), pic.format?.includes('/') ? pic.format : 'image/jpeg');
            return;
          }
        } catch {
          // error transitorio: NO se marca 'none' (se reintentará)
        }
      }
      const online = await onlineCover(a);
      if (online) {
        cacheAndServe(albumId, online.buf, online.mime);
        return;
      }
      // nada en ningún sitio: se marca (reintentable). Al identificar el álbum se
      // borra esta marca (ver clearNone), para reintentar el Cover Art Archive.
      fs.writeFileSync(noneFile(albumId), '');
    } finally {
      release();
    }
  } finally {
    resolving.delete(albumId);
  }
}

// Borra la marca "sin carátula" de un álbum: se llama al identificarlo (ya tiene
// MBID → el Cover Art Archive puede tener su portada) y desde "reintentar carátulas".
export function clearNone(albumId) {
  try {
    fs.unlinkSync(noneFile(albumId));
  } catch {
    /* no existía */
  }
}

// --- añadir carátula a mano -------------------------------------------------
// Candidatos de portada para elegir en la ficha: Cover Art Archive (oficial, por
// MBID, vía su API JSON para no ofrecer enlaces rotos) + iTunes (por texto, funciona
// aunque el álbum no esté identificado). `q` permite refinar la búsqueda de texto.
async function caaCandidates(kind, mbid) {
  try {
    const res = await fetch(`https://coverartarchive.org/${kind}/${encodeURIComponent(mbid)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.images || []).map((im) => ({
      source: 'caa',
      front: !!im.front,
      thumb: im.thumbnails?.small || im.thumbnails?.['250'] || im.thumbnails?.large || im.image,
      url: im.thumbnails?.large || im.thumbnails?.['500'] || im.image,
    }));
  } catch {
    return [];
  }
}

async function itunesCandidates(term, limit = 10) {
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=${limit}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || [])
      .filter((r) => r.artworkUrl100)
      .map((r) => ({
        source: 'itunes',
        artist: r.artistName || null,
        title: r.collectionName || null,
        year: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) || null : null,
        thumb: r.artworkUrl100,
        // iTunes sirve 100x100 pero acepta cualquier tamaño en la URL
        url: r.artworkUrl100.replace('100x100bb', '600x600bb'),
      }));
  } catch {
    return [];
  }
}

export async function coverCandidates(albumId, q) {
  const a = getAlbum.get(albumId);
  if (!a) throw new Error('Álbum no encontrado');
  const term = (q && String(q).trim()) || [a.album_artist, a.title].filter(Boolean).join(' ');
  const jobs = [];
  if (a.release_mbid) jobs.push(caaCandidates('release', a.release_mbid));
  if (a.rg_mbid) jobs.push(caaCandidates('release-group', a.rg_mbid));
  if (term) jobs.push(itunesCandidates(term));
  const groups = await Promise.all(jobs);
  const out = [];
  const seen = new Set();
  for (const g of groups)
    for (const c of g) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      out.push(c);
    }
  // las oficiales de portada (front) primero
  out.sort((x, y) => Number(y.front || 0) - Number(x.front || 0));
  return { query: term, candidates: out.slice(0, 24) };
}

// Aplica una carátula elegida (por URL online) o subida (dataURL base64). Por decisión
// del usuario se escribe `cover.jpg` en la CARPETA del álbum: permanente, viaja con los
// ficheros y sobrevive a reescaneos (solo AÑADE un fichero; no toca el audio). Si la
// carpeta no es escribible, cae a la caché de la app. Siempre cachea para servir al
// instante y borra la marca "sin carátula".
export async function applyCover(albumId, { url, dataUrl } = {}) {
  const a = getAlbum.get(albumId);
  if (!a) throw new Error('Álbum no encontrado');
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

  let savedToFolder = false;
  let coverPath = null;
  if (a.path) {
    try {
      if (fs.statSync(a.path).isDirectory()) {
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
        coverPath = path.join(a.path, `cover.${ext}`);
        fs.writeFileSync(coverPath, buf);
        db.prepare('UPDATE albums SET cover = ? WHERE id = ?').run(coverPath, albumId);
        savedToFolder = true;
      }
    } catch {
      // carpeta inaccesible o de solo lectura: nos quedamos con la caché
      coverPath = null;
    }
  }
  // siempre cachea (sirve al instante y respalda si no se pudo escribir a la carpeta)
  cacheAndServe(albumId, buf, mime);
  clearNone(albumId);
  return { ok: true, savedToFolder, cover: coverPath };
}

// Reintentar todas las que faltan: borra las marcas "sin carátula" para que se
// vuelvan a resolver (útil tras identificar la biblioteca).
export function retryMissingCovers() {
  folderImgCache.clear();
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
