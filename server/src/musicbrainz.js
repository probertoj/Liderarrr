import { cacheRead, cacheWrite } from './db.js';
import { CACHE_MAX_AGE } from './cache-versions.js';

// MusicBrainz exige: (1) máximo 1 petición por segundo y (2) un User-Agent que
// te identifique. Incumplir cualquiera de las dos te gana un bloqueo. Aquí se
// serializan TODAS las llamadas por una única cola con hueco de 1100 ms, y todo
// lo que vuelve se cachea en SQLite (ext_cache, prefijo mb:) para no repetir.
const UA = 'Liderarr/0.1.0 ( https://github.com/probertoj/Liderarrr )';
const BASE = 'https://musicbrainz.org/ws/2';
const GAP_MS = 1100;

let chain = Promise.resolve();
let lastAt = 0;

function schedule(fn) {
  const run = async () => {
    const wait = Math.max(0, lastAt + GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  };
  chain = chain.then(run, run);
  return chain;
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

// Busca un release group por artista + título. Devuelve el mejor candidato con
// su score (0-100), tipos y artista, o null.
export async function searchReleaseGroup(artist, title) {
  if (!title) return null;
  const q = artist
    ? `releasegroup:"${lucene(title)}" AND artist:"${lucene(artist)}"`
    : `releasegroup:"${lucene(title)}"`;
  const data = await mbCached(`rg-search:${artist || ''}:${title}`.toLowerCase(), `/release-group?query=${enc(q)}&limit=5`);
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
