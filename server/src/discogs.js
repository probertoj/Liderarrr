import { cacheRead, cacheWrite, getSetting } from './db.js';
import { CACHE_MAX_AGE } from './cache-versions.js';

// Discogs es muy superior a MusicBrainz en autoediciones, prensajes raros y
// bootlegs físicos. Aquí se usa como red de seguridad de la identificación y,
// más adelante (fase 4), para listar ediciones de un disco. Límite: 60 pet/min
// autenticado; se serializa con un hueco de 1100 ms, igual que MusicBrainz.
const UA = 'Liderarrr/0.1.0 +https://github.com/probertoj/Liderarrr';
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

// El token se recorta: un espacio o salto de línea al pegarlo era la causa más
// típica de un 401.
function discogsToken() {
  return (getSetting('discogs_token') || '').trim();
}

export function discogsConfigured() {
  return !!discogsToken();
}

async function dcFetch(pathAndQuery) {
  const token = discogsToken();
  if (!token) throw new Error('Discogs no configurado');
  // El token va en la cabecera Authorization (lo que recomienda Discogs), no en
  // la URL: más robusto y no se queda escrito en logs ni en la caché de la ruta.
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Authorization: `Discogs token=${token}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      if (j?.message) detail = ` — ${j.message}`;
    } catch {
      /* sin cuerpo */
    }
    throw new Error(`Discogs ${res.status}${detail}`);
  }
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

// Todas las ediciones de un álbum: el equivalente (mejor) de JustWatch. Discogs
// lista cada prensaje/edición de un "master": remasters, deluxe, vinilo con
// bonus, ediciones por país. Con esto sabes si de ese disco que tienes en MP3
// existe algo mejor ahí fuera. Devuelve las ediciones y el sello principal.
export async function releaseEditions(artist, title) {
  if (!discogsConfigured() || !title) return null;
  const hit = await searchRelease(artist, title);
  if (!hit) return null;
  // el resultado de búsqueda trae master_id cuando pertenece a un master
  let masterId = null;
  let mainLabel = hit.label || null;
  let catno = null;
  try {
    const rel = await dcCached(`release:${hit.discogs_id}`, `/releases/${hit.discogs_id}`);
    masterId = rel.master_id || null;
    mainLabel = (rel.labels || [])[0]?.name || mainLabel;
    catno = (rel.labels || [])[0]?.catno || null;
  } catch {
    /* nos quedamos con el sello del resultado de búsqueda */
  }

  let versions = [];
  if (masterId) {
    try {
      const data = await dcCached(`master-versions:${masterId}`, `/masters/${masterId}/versions?per_page=100`);
      versions = (data.versions || []).map((v) => ({
        title: v.title,
        year: Number(v.released) || null,
        country: v.country || null,
        format: v.format || v.major_formats?.join(', ') || '',
        label: v.label || null,
        descriptions: v.major_formats || [],
        thumb: v.thumb || null,
        url: v.resource_url ? `https://www.discogs.com/release/${v.id}` : null,
      }));
    } catch {
      /* sin versiones: al menos devolvemos la que encontramos */
    }
  }
  if (!versions.length) {
    versions = [{ title: hit.title, year: hit.year, country: hit.country, format: (hit.formats || []).join(', '), label: mainLabel }];
  }

  // marca posibles upgrades: ediciones con pistas de más / vinilo / hi-res / remaster
  const upgradeHints = versions.filter((v) =>
    /deluxe|remaster|expanded|anniversary|hi-?res|24-?bit|vinyl|super audio|SACD|bonus/i.test(
      `${v.format} ${v.title} ${(v.descriptions || []).join(' ')}`
    )
  );

  return {
    discogsUrl: masterId ? `https://www.discogs.com/master/${masterId}` : `https://www.discogs.com/release/${hit.discogs_id}`,
    label: mainLabel,
    catno,
    editions: versions,
    upgradeHints: upgradeHints.slice(0, 8),
  };
}

// Valoración de la comunidad de Discogs para un álbum (media sobre 5 + nº de votos).
// Reusa la caché del release (misma clave que las ediciones).
export async function releaseRating(artist, title) {
  if (!discogsConfigured() || !title) return null;
  const hit = await searchRelease(artist, title);
  if (!hit) return null;
  const url = `https://www.discogs.com/release/${hit.discogs_id}`;
  try {
    const rel = await dcCached(`release:${hit.discogs_id}`, `/releases/${hit.discogs_id}`);
    const r = rel.community?.rating;
    return { average: r?.average || null, count: r?.count || 0, url };
  } catch {
    return { average: null, count: 0, url };
  }
}

export async function discogsTest() {
  const data = await schedule(() => dcFetch('/database/search?q=nevermind&type=release&per_page=1'));
  return { ok: true, results: data.pagination?.items ?? 0 };
}
