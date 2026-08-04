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

export async function albumCover(albumId) {
  const a = getAlbum.get(albumId);
  if (!a) return null;

  // 1. fichero de carátula con nombre reconocido (del escaneo)
  if (a.cover && fs.existsSync(a.cover)) return { path: a.cover, contentType: mimeByExt(a.cover) };

  // 2. imagen ya cacheada (incrustada u online)
  if (fs.existsSync(cachedImg(albumId)) && fs.existsSync(mimeFile(albumId))) {
    return { path: cachedImg(albumId), contentType: fs.readFileSync(mimeFile(albumId), 'utf8') };
  }

  // 3. cualquier imagen de la carpeta (nombres no convencionales)
  if (a.path) {
    const img = biggestImage(a.path);
    if (img) return { path: img, contentType: mimeByExt(img) };
  }

  // ya intentamos lo caro (incrustada + online) y no había nada
  if (fs.existsSync(noneFile(albumId))) return null;

  // 4 y 5 (caro): incrustada y online, tras la puerta de concurrencia
  await acquire();
  try {
    // re-comprobar la caché por si otra petición la resolvió mientras esperábamos
    if (fs.existsSync(cachedImg(albumId)) && fs.existsSync(mimeFile(albumId)))
      return { path: cachedImg(albumId), contentType: fs.readFileSync(mimeFile(albumId), 'utf8') };

    const t = firstTrack.get(albumId);
    if (t) {
      try {
        const mm = await Promise.race([
          parseFile(t.path, { duration: false }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
        ]);
        const pic = mm.common.picture?.[0];
        if (pic?.data) return cacheAndServe(albumId, Buffer.from(pic.data), pic.format?.includes('/') ? pic.format : 'image/jpeg');
      } catch {
        // error transitorio: NO lo marcamos como 'sin carátula' (se reintenta)
      }
    }

    const online = await onlineCover(a);
    if (online) return cacheAndServe(albumId, online.buf, online.mime);

    // nada en ningún sitio: se marca (reintentable). Al identificarse el álbum se
    // borra esta marca (ver clearNone), para volver a probar el Cover Art Archive.
    fs.writeFileSync(noneFile(albumId), '');
    return null;
  } finally {
    release();
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

// Reintentar todas las que faltan: borra las marcas "sin carátula" para que se
// vuelvan a resolver (útil tras identificar la biblioteca).
export function retryMissingCovers() {
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
