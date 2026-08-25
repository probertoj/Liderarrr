import { getSetting, cacheRead, cacheWrite } from './db.js';
import { matchKey, normName, cleanTitleForMatch } from './matchkey.js';

// Spotify (solo lectura de catálogo: discografías y novedades) con el flujo
// «client credentials» — NO requiere login de usuario, solo un client id + secret de una
// app de Spotify (https://developer.spotify.com/dashboard). Se usa para adelantarse a
// MusicBrainz en estrenos (newreleases.js). Si no hay credenciales, todo se salta en silencio.

const UA = 'Liderarrr ( https://github.com/probertoj/Liderarrr )';

export function spotifyConfigured() {
  return !!(getSetting('spotify_client_id') && getSetting('spotify_client_secret'));
}

let token = { value: null, exp: 0 };
async function getToken() {
  if (token.value && Date.now() < token.exp - 30000) return token.value;
  const id = getSetting('spotify_client_id');
  const secret = getSetting('spotify_client_secret');
  if (!id || !secret) throw new Error('Spotify no configurado (faltan client id/secret)');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Spotify auth ${res.status}`);
  const data = await res.json();
  token = { value: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return token.value;
}

async function spFetch(path) {
  const t = await getToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${t}`, 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) {
    token = { value: null, exp: 0 }; // token caducado: fuerza refresco una vez
    const t2 = await getToken();
    const r2 = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${t2}`, 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!r2.ok) throw new Error(`Spotify ${r2.status} en ${path}`);
    return r2.json();
  }
  if (!res.ok) throw new Error(`Spotify ${res.status} en ${path}`);
  return res.json();
}

export async function spotifyTest() {
  await getToken();
  return { ok: true, name: 'Spotify (client credentials)' };
}

// Mejor artista para un nombre (por popularidad/seguidores): { id, name }.
async function findArtist(name) {
  const data = await spFetch(`/search?q=${encodeURIComponent(name)}&type=artist&limit=5`);
  const items = data.artists?.items || [];
  if (!items.length) return null;
  items.sort((a, b) => (b.followers?.total || 0) - (a.followers?.total || 0));
  return { id: items[0].id, name: items[0].name };
}

// URL del álbum CONCRETO en Spotify (para enlazar directo desde la ficha, en vez de al
// buscador). Busca por «artista título», elige la mejor coincidencia (artista + título
// normalizados) y cachea el resultado —también los fallos— 30 días para no repetir la
// búsqueda. Devuelve la URL o null (si no está configurado o no hay coincidencia).
const ALBUM_TTL = 30 * 24 * 3600 * 1000;
export async function spotifyAlbumUrl(artist, title) {
  if (!artist || !title || !spotifyConfigured()) return null;
  const key = `spotify:album:${matchKey(artist, title)}`;
  const cached = cacheRead(key, ALBUM_TTL);
  if (cached !== null) return cached.url || null; // incluye fallos cacheados ({url:null})
  let out = { url: null };
  try {
    const data = await spFetch(`/search?q=${encodeURIComponent(`${artist} ${title}`)}&type=album&limit=8`);
    const items = data.albums?.items || [];
    const wantArtist = normName(artist);
    const wantTitle = cleanTitleForMatch(title);
    const byArtist = (al) => (al.artists || []).some((a) => normName(a.name) === wantArtist);
    let best = items.find((al) => byArtist(al) && cleanTitleForMatch(al.name) === wantTitle) || items.find(byArtist);
    if (best) out = { url: best.external_urls?.spotify || null, id: best.id };
  } catch {
    out = { url: null };
  }
  cacheWrite(key, out);
  return out.url || null;
}

// NOVEDADES GLOBALES (radar de descubrimiento): el feed editorial «New Releases» de Spotify,
// de CUALQUIER artista (no solo los tuyos). Álbumes y singles con fecha, carátula, enlace y
// TODOS los artistas acreditados (para cruzar afinidad). Pagina hasta `pages` × 50. País por
// defecto España; si Spotify lo rechaza, reintenta sin país. Vacío si no está configurado.
export async function spotifyNewReleases({ pages = 5, country = 'ES' } = {}) {
  if (!spotifyConfigured()) return [];
  const out = [];
  const seen = new Set();
  const q = (offset) => `/browse/new-releases?limit=50&offset=${offset}${country ? `&country=${country}` : ''}`;
  for (let i = 0; i < pages; i++) {
    let data;
    try {
      // eslint-disable-next-line no-await-in-loop
      data = await spFetch(q(i * 50));
    } catch {
      if (country && i === 0) {
        // algunos tokens rechazan el país: reintenta el feed sin país una vez
        country = '';
        i--;
        continue;
      }
      break;
    }
    const items = data.albums?.items || [];
    if (!items.length) break;
    for (const al of items) {
      if (!al?.id || seen.has(al.id)) continue;
      seen.add(al.id);
      out.push({
        source: 'spotify',
        title: al.name,
        artists: (al.artists || []).map((a) => a.name).filter(Boolean),
        release_date: al.release_date || null, // YYYY | YYYY-MM | YYYY-MM-DD
        record_type: al.album_type || 'album', // album | single | compilation
        cover: al.images?.[0]?.url || null,
        url: al.external_urls?.spotify || null,
      });
    }
    if (!data.albums?.next) break;
  }
  return out;
}

// Discografía reciente de un artista (por nombre). Devuelve álbumes/EP/singles con fecha,
// carátula y enlace. Vacío si no está configurado o no se encuentra.
export async function spotifyArtistAlbums(name) {
  if (!spotifyConfigured()) return [];
  try {
    const a = await findArtist(name);
    if (!a) return [];
    const data = await spFetch(`/artists/${a.id}/albums?include_groups=album,single&limit=50`);
    return (data.items || []).map((al) => ({
      source: 'spotify',
      title: al.name,
      release_date: al.release_date || null, // puede ser YYYY, YYYY-MM o YYYY-MM-DD
      record_type: al.album_type || 'album', // album | single | compilation
      cover: al.images?.[0]?.url || null,
      url: al.external_urls?.spotify || null,
      artistName: a.name,
    }));
  } catch {
    return [];
  }
}
