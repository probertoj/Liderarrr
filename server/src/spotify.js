import { getSetting } from './db.js';

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
