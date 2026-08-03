import { cacheRead, cacheWrite, getSetting } from './db.js';
import { CACHE_MAX_AGE } from './cache-versions.js';

// Discogs es muy superior a MusicBrainz en autoediciones, prensajes raros y
// bootlegs físicos. Aquí se usa como red de seguridad de la identificación y,
// más adelante (fase 4), para listar ediciones de un disco. Límite: 60 pet/min
// autenticado; se serializa con un hueco de 1100 ms, igual que MusicBrainz.
const UA = 'Liderarr/0.1.0 +https://github.com/probertoj/Liderarrr';
const BASE = 'https://api.discogs.com';
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

export function discogsConfigured() {
  return !!getSetting('discogs_token');
}

async function dcFetch(pathAndQuery) {
  const token = getSetting('discogs_token');
  if (!token) throw new Error('Discogs no configurado');
  const url = `${BASE}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Discogs ${res.status}`);
  return res.json();
}

async function dcCached(key, pathAndQuery, maxAge = CACHE_MAX_AGE.dc) {
  const cacheKey = `dc:${key}`;
  const hit = cacheRead(cacheKey, maxAge);
  if (hit) return hit;
  const data = await schedule(() => dcFetch(pathAndQuery));
  cacheWrite(cacheKey, data);
  return data;
}

const enc = encodeURIComponent;

// Busca un release por artista + álbum. Devuelve el mejor candidato o null.
export async function searchRelease(artist, title) {
  if (!discogsConfigured() || !title) return null;
  const qs = `type=release&artist=${enc(artist || '')}&release_title=${enc(title)}&per_page=5`;
  const data = await dcCached(`search:${artist || ''}:${title}`.toLowerCase(), `/database/search?${qs}`);
  const r = (data.results || [])[0];
  if (!r) return null;
  return {
    discogs_id: r.id,
    title: r.title,
    year: Number(r.year) || null,
    label: (r.label || [])[0] || null,
    country: r.country || null,
    formats: r.format || [],
    thumb: r.thumb || null,
  };
}

export async function discogsTest() {
  const data = await schedule(() => dcFetch('/database/search?q=nevermind&type=release&per_page=1'));
  return { ok: true, results: data.pagination?.items ?? 0 };
}
