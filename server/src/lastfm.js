import { cacheRead, cacheWrite, getSetting } from './db.js';
import { CACHE_MAX_AGE } from './cache-versions.js';

// Last.fm: su catálogo nace de scrobbles, así que tiene una cola larguísima de
// cosas oscuras que MusicBrainz no cataloga. Los datos son pobres (ni fechas ni
// créditos fiables), pero es excelente para RESOLVER un nombre y, en fase 3,
// para traer tu historial de escuchas (que es justo lo que usas).
const BASE = 'https://ws.audioscrobbler.com/2.0/';

export function lastfmConfigured() {
  return !!getSetting('lastfm_key');
}

async function lfFetch(params) {
  const key = getSetting('lastfm_key');
  if (!key) throw new Error('Last.fm no configurado');
  const qs = new URLSearchParams({ ...params, api_key: key, format: 'json' });
  const res = await fetch(`${BASE}?${qs}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Last.fm ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Last.fm: ${data.message || data.error}`);
  return data;
}

async function lfCached(key, params, maxAge = CACHE_MAX_AGE.lf) {
  const cacheKey = `lf:${key}`;
  const hit = cacheRead(cacheKey, maxAge);
  if (hit) return hit;
  const data = await lfFetch(params);
  cacheWrite(cacheKey, data);
  return data;
}

// Confirma que un par artista+álbum existe y devuelve su MBID de release si
// Last.fm lo conoce (a menudo lo tiene). Sirve para desatascar identificaciones.
export async function albumInfo(artist, album) {
  if (!lastfmConfigured() || !artist || !album) return null;
  try {
    const data = await lfCached(`album:${artist}:${album}`.toLowerCase(), {
      method: 'album.getInfo',
      artist,
      album,
      autocorrect: '1',
    });
    const a = data.album;
    if (!a) return null;
    return {
      name: a.name,
      artist: a.artist,
      mbid: a.mbid || null,
      listeners: Number(a.listeners) || 0,
      playcount: Number(a.playcount) || 0,
      url: a.url || null,
      wiki: cleanWiki(a.wiki?.content || a.wiki?.summary),
    };
  } catch {
    return null;
  }
}

// Limpia el texto de la wiki de Last.fm: quita el enlace «Read more on Last.fm» y las
// etiquetas HTML, deja texto plano. Last.fm publica estos textos con licencia CC-BY-SA.
function cleanWiki(html) {
  if (!html) return null;
  const t = String(html)
    .replace(/<a\b[^>]*>.*?<\/a>/gis, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\.\s*\./g, '.') // el enlace «Read more» solía dejar un doble punto
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n/g, '\n')
    .trim();
  return t || null;
}

// Popularidad de un artista: oyentes y reproducciones globales. Señal de "cómo
// de conocido es" para ordenar candidatos y, luego, la brecha escucha↔propiedad.
export async function artistInfo(name) {
  if (!lastfmConfigured() || !name) return null;
  try {
    const data = await lfCached(`artist:${name}`.toLowerCase(), {
      method: 'artist.getInfo',
      artist: name,
      autocorrect: '1',
    });
    const a = data.artist;
    if (!a) return null;
    return {
      name: a.name,
      mbid: a.mbid || null,
      listeners: Number(a.stats?.listeners) || 0,
      playcount: Number(a.stats?.playcount) || 0,
      url: a.url || null,
      bio: cleanWiki(a.bio?.content || a.bio?.summary),
    };
  } catch {
    return null;
  }
}

// Scrobbles recientes de un usuario. NO se cachea: es historial vivo. Devuelve
// una página cruda de user.getRecentTracks (200 por página, más nuevos primero).
export async function recentTracks(user, { from = 0, page = 1, limit = 200 } = {}) {
  const params = { method: 'user.getRecentTracks', user, limit: String(limit), page: String(page), extended: '0' };
  if (from) params.from = String(from);
  const data = await lfFetch(params);
  const rt = data.recenttracks || {};
  const tracks = Array.isArray(rt.track) ? rt.track : rt.track ? [rt.track] : [];
  return {
    tracks: tracks
      // descarta "sonando ahora" (sin fecha): aún no es un scrobble
      .filter((t) => t.date?.uts)
      .map((t) => ({
        artist: t.artist?.['#text'] || t.artist?.name || '',
        album: t.album?.['#text'] || '',
        track: t.name || '',
        ts: Number(t.date.uts) * 1000,
        mbid: t.mbid || t.artist?.mbid || null,
      })),
    totalPages: Number(rt['@attr']?.totalPages) || 1,
    total: Number(rt['@attr']?.total) || 0,
  };
}

export async function lastfmTest() {
  const data = await lfFetch({ method: 'artist.getInfo', artist: 'Radiohead' });
  return { ok: true, artist: data.artist?.name };
}
