import { AsyncLocalStorage } from 'node:async_hooks';
import { cacheRead, cacheWrite } from './db.js';
import { CACHE_MAX_AGE } from './cache-versions.js';

// MusicBrainz exige: (1) máximo 1 petición por segundo y (2) un User-Agent que
// te identifique. Incumplir cualquiera de las dos te gana un bloqueo. Aquí se
// serializan TODAS las llamadas por una cola con hueco de 1100 ms, y todo
// lo que vuelve se cachea en SQLite (ext_cache, prefijo mb:) para no repetir.
//
// La cola tiene DOS carriles sobre ese mismo límite de 1,1 s: uno rápido para
// las peticiones interactivas (tus clics) y uno lento para el barrido de
// identificación en segundo plano. Sin esto, un clic quedaba encolado detrás de
// miles de llamadas del barrido y tardaba ~10 s. Con esto, lo interactivo
// adelanta al fondo; MB nunca se salta (el hueco global se respeta siempre).
const UA = 'Liderarrr/0.1.0 ( https://github.com/probertoj/Liderarrr )';
const BASE = 'https://musicbrainz.org/ws/2';
const GAP_MS = 1100;

// Contexto de prioridad: lo que corra dentro de runBackground() usa el carril
// lento. Se propaga a través de los await, así que basta envolver el bucle de
// identificación una vez (no hay que tocar cada sitio de llamada).
const priorityCtx = new AsyncLocalStorage();
export function runBackground(fn) {
  return priorityCtx.run({ background: true }, fn);
}

const fastQ = [];
const slowQ = [];
let lastAt = 0;
let pumping = false;

function schedule(fn) {
  const background = priorityCtx.getStore()?.background === true;
  return new Promise((resolve, reject) => {
    (background ? slowQ : fastQ).push({ fn, resolve, reject });
    pump();
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (fastQ.length || slowQ.length) {
      const wait = Math.max(0, lastAt + GAP_MS - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      // Reevaluar DESPUÉS de esperar: si llegó una interactiva mientras dormíamos
      // el hueco, sale ella primero. Así el fondo cede el paso hasta a mitad de gap.
      const item = fastQ.shift() || slowQ.shift();
      lastAt = Date.now();
      try {
        item.resolve(await item.fn());
      } catch (err) {
        item.reject(err);
      }
    }
  } finally {
    pumping = false;
  }
}

async function mbFetch(pathAndQuery) {
  const url = `${BASE}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}fmt=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 503) throw new Error('MusicBrainz saturado (503), reintenta luego');
  if (!res.ok) throw new Error(`MusicBrainz ${res.status} en ${pathAndQuery}`);
  return res.json();
}

// Petición cacheada. `key` es la clave de caché (sin prefijo); se le antepone
// mb: para el versionado. maxAge por defecto el del servicio.
async function mbCached(key, pathAndQuery, maxAge = CACHE_MAX_AGE.mb) {
  const cacheKey = `mb:${key}`;
  const hit = cacheRead(cacheKey, maxAge);
  if (hit) return hit;
  const data = await schedule(() => mbFetch(pathAndQuery));
  cacheWrite(cacheKey, data);
  return data;
}

const enc = encodeURIComponent;
// Escapa lo que rompe la sintaxis Lucene del buscador de MusicBrainz.
function lucene(s) {
  return String(s || '').replace(/[+\-!(){}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Palabras de edición que, entre paréntesis al final del título, son decoración y
// estorban la búsqueda (no forman parte del nombre real del álbum en MusicBrainz).
const EDITION_RE = /\b(remaster(ed)?|deluxe|expanded|anniversary|edition|reissue|mono|stereo|bonus|disc\s*\d+|cd\s*\d+)\b/i;

// Limpia el título para buscarlo en MusicBrainz. Dos ruidos de etiquetado rompen
// la búsqueda: (1) el nombre del artista repetido al principio ("Neil Young Archives
// Vol. II" en vez de "Archives Vol. II"), y (2) paréntesis/corchetes finales con
// año o edición ("(1972 - 1976)", "(Remastered)"). Ambos se quitan; se conservan
// subtítulos con significado como "(Live)". Si limpiar lo deja vacío, usa el original.
export function cleanAlbumTitle(title, artist) {
  let t = String(title || '').trim();
  if (!t) return t;
  const a = String(artist || '').trim();
  if (a) {
    const re = new RegExp('^' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—:]?\\s*', 'i');
    const stripped = t.replace(re, '').trim();
    if (stripped.length >= 2) t = stripped;
  }
  // quita paréntesis/corchetes finales que sean año o edición (repetido: puede haber
  // varios, p. ej. "Album (Deluxe) (2009)")
  for (;;) {
    const m = t.match(/[([]([^)\]]*)[)\]]\s*$/);
    if (!m || (!/\d{4}/.test(m[1]) && !EDITION_RE.test(m[1]))) break;
    t = t.slice(0, m.index).trim();
  }
  return t || String(title || '').trim();
}

// Busca un release group por artista + título. Devuelve el mejor candidato con
// su score (0-100), tipos y artista, o null.
export async function searchReleaseGroup(artist, title) {
  if (!title) return null;
  const clean = cleanAlbumTitle(title, artist);
  const q = artist
    ? `releasegroup:"${lucene(clean)}" AND artist:"${lucene(artist)}"`
    : `releasegroup:"${lucene(clean)}"`;
  const data = await mbCached(`rg-search:${artist || ''}:${clean}`.toLowerCase(), `/release-group?query=${enc(q)}&limit=5`);
  const rg = (data['release-groups'] || [])[0];
  if (!rg) return null;
  return {
    rg_mbid: rg.id,
    title: rg.title,
    primary_type: rg['primary-type'] || null,
    secondary_types: rg['secondary-types'] || [],
    first_release: rg['first-release-date'] || null,
    artist: (rg['artist-credit'] || []).map((a) => a.name).join(''),
    artist_mbid: (rg['artist-credit'] || [])[0]?.artist?.id || null,
    score: Number(rg.score) || 0,
  };
}

// Ficha de artista por MBID (país, tipo, fechas).
export async function artistByMbid(mbid) {
  if (!mbid) return null;
  const data = await mbCached(`artist:${mbid}`, `/artist/${enc(mbid)}`);
  return {
    mbid: data.id,
    name: data.name,
    sort_name: data['sort-name'],
    type: data.type || null,
    country: data.country || null,
    began: data['life-span']?.begin || null,
    ended: data['life-span']?.end || null,
    disambiguation: data.disambiguation || '',
  };
}

// Discografía completa (release groups) de un artista. Pagina de 100 en 100.
export async function artistReleaseGroups(mbid) {
  if (!mbid) return [];
  const out = [];
  let offset = 0;
  for (;;) {
    const data = await mbCached(
      `artist-rgs:${mbid}:${offset}`,
      `/release-group?artist=${enc(mbid)}&limit=100&offset=${offset}`
    );
    const page = data['release-groups'] || [];
    for (const rg of page) {
      out.push({
        rg_mbid: rg.id,
        title: rg.title,
        primary_type: rg['primary-type'] || null,
        secondary_types: rg['secondary-types'] || [],
        first_release: rg['first-release-date'] || null,
      });
    }
    offset += page.length;
    if (page.length < 100 || offset >= (data['release-group-count'] || 0)) break;
  }
  return out;
}

// Recording -> release groups en los que aparece (para resolver un AcoustID).
export async function recordingReleaseGroups(recordingMbid) {
  if (!recordingMbid) return [];
  const data = await mbCached(
    `rec-rgs:${recordingMbid}`,
    `/recording/${enc(recordingMbid)}?inc=release-groups+artist-credits`
  );
  const artist = (data['artist-credit'] || []).map((a) => a.name).join('');
  const rgs = [];
  for (const rel of data.releases || []) {
    const rg = rel['release-group'];
    if (rg && !rgs.some((x) => x.rg_mbid === rg.id)) {
      rgs.push({
        rg_mbid: rg.id,
        title: rg.title,
        primary_type: rg['primary-type'] || null,
        secondary_types: rg['secondary-types'] || [],
        first_release: rg['first-release-date'] || null,
      });
    }
  }
  return { artist, artist_mbid: (data['artist-credit'] || [])[0]?.artist?.id || null, releaseGroups: rgs };
}

// Grafo de relaciones de un artista: miembros de banda, bandas de las que forma
// parte, proyectos paralelos y colaboraciones. Esto es lo que la música gana al
// cine: MusicBrainz sabe quién toca con quién, no solo quién publicó qué.
export async function artistRelations(mbid) {
  if (!mbid) return [];
  const data = await mbCached(`artist-rels:${mbid}`, `/artist/${enc(mbid)}?inc=artist-rels`);
  const out = [];
  for (const rel of data.relations || []) {
    if (rel['target-type'] !== 'artist' || !rel.artist) continue;
    out.push({
      mbid: rel.artist.id,
      name: rel.artist.name,
      type: rel.type, // member of band | collaboration | founder | supporting musician...
      direction: rel.direction, // forward | backward
      attributes: rel.attributes || [], // p. ej. instrumentos
      begin: rel.begin || null,
      end: rel.end || null,
      ended: !!rel.ended,
    });
  }
  return out;
}

// Busca artistas por nombre (para seguir a alguien que aún no tienes en disco:
// artistas emergentes, justo para los que existe el auto-Lidarr).
export async function searchArtists(name, limit = 8) {
  if (!name) return [];
  const data = await mbCached(`artist-search:${name}`.toLowerCase(), `/artist?query=${enc(lucene(name))}&limit=${limit}`);
  return (data.artists || []).map((a) => ({
    mbid: a.id,
    name: a.name,
    sort_name: a['sort-name'],
    type: a.type || null,
    country: a.country || null,
    disambiguation: a.disambiguation || '',
    began: a['life-span']?.begin || null,
    ended: a['life-span']?.end || null,
    score: Number(a.score) || 0,
  }));
}

export async function mbTest() {
  const data = await schedule(() => mbFetch('/artist/83d91898-7763-47d7-b03b-b92132375c47')); // Pink Floyd
  return { ok: true, name: data.name };
}
