import { db, getSetting, setSetting } from './db.js';
import { matchKey, normName, cleanTitleForMatch } from './matchkey.js';

// Integración con la BIBLIOTECA del usuario en Spotify (no el catálogo). Usa OAuth de usuario
// (Authorization Code): el usuario aprueba una vez y guardamos su refresh_token para leer sus
// «álbumes guardados» (/me/albums, scope user-library-read). Solo LECTURA. Con eso cruzamos su
// biblioteca de streaming contra su colección local: la brecha «tienes en disco / en streaming».
//
// OJO redirect URI: desde 2025 Spotify exige HTTPS o loopback (http://127.0.0.1:puerto); una IP
// de LAN por http NO vale. Por eso el flujo por defecto es «pega el código»: el usuario aprueba,
// Spotify redirige a 127.0.0.1 (no carga, es normal) y pega el `code` de la barra aquí.

const UA = 'Liderarrr ( https://github.com/probertoj/Liderarrr )';
// Lectura de la biblioteca + escritura (para «Guardar en Spotify» de un clic). Si un usuario
// conectó antes solo con lectura, al guardar recibirá 403 y se le pedirá reconectar.
const SCOPES = 'user-library-read user-library-modify';
const DEFAULT_REDIRECT = 'http://127.0.0.1:3861/callback';

export function spotifyRedirectUri() {
  return getSetting('spotify_redirect_uri') || DEFAULT_REDIRECT;
}
function clientId() {
  return getSetting('spotify_client_id');
}
function clientSecret() {
  return getSetting('spotify_client_secret');
}
export function spotifyClientConfigured() {
  return !!(clientId() && clientSecret());
}
export function spotifyUserConnected() {
  return !!getSetting('spotify_refresh_token');
}
function basicAuth() {
  return 'Basic ' + Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
}

// URL a la que mandar al usuario para que apruebe el acceso a su biblioteca.
export function spotifyAuthUrl(state = '') {
  if (!spotifyClientConfigured()) throw new Error('Faltan client id/secret de Spotify en Ajustes');
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    scope: SCOPES,
    redirect_uri: spotifyRedirectUri(),
    state: state || Math.random().toString(36).slice(2),
    show_dialog: 'false',
  });
  return `https://accounts.spotify.com/authorize?${p.toString()}`;
}

// Extrae el `code` tanto si el usuario pega el código pelado como la URL entera de redirección.
function parseCode(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s) || s.includes('code=')) {
    try {
      const u = new URL(s.startsWith('http') ? s : `http://x/?${s.replace(/^\?/, '')}`);
      return u.searchParams.get('code');
    } catch {
      const m = s.match(/[?&]code=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    }
  }
  return s; // código pelado
}

// Mensaje claro para los errores que Spotify puede devolver en el redirect (en vez de un code).
function authErrorHint(err, desc) {
  const e = String(err || '').toLowerCase();
  if (e === 'access_denied') return 'Rechazaste el acceso en Spotify. Vuelve a intentarlo y pulsa «Aceptar».';
  if (e === 'server_error') {
    return (
      'Spotify devolvió «server_error» en la autorización. Casi siempre es porque tu app está en ' +
      'MODO DESARROLLO y la cuenta con la que inicias sesión NO está añadida a la lista de usuarios: ' +
      've a developer.spotify.com/dashboard → tu app → «User Management» y añade tu cuenta (nombre + email). ' +
      'Comprueba también que el Redirect URI está guardado EXACTAMENTE, y reintenta (a veces es temporal).' +
      (desc ? ` [detalle: ${desc}]` : '')
    );
  }
  return `Spotify devolvió un error en la autorización: ${err}${desc ? ` (${desc})` : ''}.`;
}

// Canjea el código de autorización por tokens y guarda el refresh_token.
export async function spotifyConnect(codeOrUrl) {
  if (!spotifyClientConfigured()) throw new Error('Faltan client id/secret de Spotify en Ajustes');
  const raw = String(codeOrUrl || '').trim();
  // ¿Spotify devolvió un error en vez de un code? (p. ej. …/callback?error=server_error)
  const em = raw.match(/[?&]error=([^&]+)/);
  if (em) {
    const dm = raw.match(/[?&]error_description=([^&]+)/);
    throw new Error(authErrorHint(decodeURIComponent(em[1]), dm ? decodeURIComponent(dm[1].replace(/\+/g, ' ')) : ''));
  }
  const code = parseCode(raw);
  if (!code) throw new Error('No encontré el código. Pega el `code=…` de la URL a la que te redirigió Spotify.');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth() },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: spotifyRedirectUri() }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) {
    const why = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Spotify rechazó el código (${why}). ¿Coincide el redirect URI registrado con ${spotifyRedirectUri()}?`);
  }
  setSetting('spotify_refresh_token', data.refresh_token);
  _userToken = { value: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return { ok: true };
}

export function spotifyDisconnect() {
  setSetting('spotify_refresh_token', null);
  _userToken = { value: null, exp: 0 };
  return { ok: true };
}

// Access token de usuario (cacheado), renovado con el refresh_token cuando caduca.
let _userToken = { value: null, exp: 0 };
async function userAccessToken() {
  if (_userToken.value && Date.now() < _userToken.exp - 30000) return _userToken.value;
  const refresh = getSetting('spotify_refresh_token');
  if (!refresh) throw new Error('Tu biblioteca de Spotify no está conectada (Ajustes → Conectar).');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth() },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    // token revocado o inválido: desconecta para que el usuario reconecte
    if (data.error === 'invalid_grant') setSetting('spotify_refresh_token', null);
    throw new Error(`No se pudo renovar el acceso a Spotify (${data.error_description || data.error || res.status}).`);
  }
  _userToken = { value: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  // Spotify a veces rota el refresh_token
  if (data.refresh_token) setSetting('spotify_refresh_token', data.refresh_token);
  return _userToken.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Petición autenticada a la API de usuario con reintentos: 401 → renueva token y reintenta;
// 429 → espera lo que diga Retry-After (acotado) y reintenta. Devuelve la Response.
async function spUserFetch(path, { method = 'GET', retries = 2 } = {}) {
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // eslint-disable-next-line no-await-in-loop
    const t = await userAccessToken();
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, 'User-Agent': UA },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return res;
    lastStatus = res.status;
    if (res.status === 401 && attempt < retries) {
      _userToken = { value: null, exp: 0 }; // fuerza renovación del token
      continue;
    }
    if (res.status === 429 && attempt < retries) {
      const wait = Math.min((Number(res.headers.get('retry-after')) || 2) + 1, 8);
      // eslint-disable-next-line no-await-in-loop
      await sleep(wait * 1000);
      continue;
    }
    return res; // otros errores: los gestiona quien llama
  }
  throw new Error(`Spotify ${lastStatus} (con reintentos agotados)`);
}

async function meFetch(path) {
  const res = await spUserFetch(path);
  if (!res.ok) throw new Error(`Spotify ${res.status} en ${path}`);
  return res.json();
}

export const spotifyLibStatus = {
  running: false,
  fetched: 0,
  total: 0,
  error: null,
  startedAt: null,
  finishedAt: null,
};

const upsertSaved = db.prepare(
  `INSERT INTO spotify_saved_albums (id, artist, title, match_key, album_type, release_date, cover, url, added_at, synced_at)
   VALUES (@id, @artist, @title, @match_key, @album_type, @release_date, @cover, @url, @added_at, @synced_at)
   ON CONFLICT(id) DO UPDATE SET artist=excluded.artist, title=excluded.title, match_key=excluded.match_key,
     album_type=excluded.album_type, release_date=excluded.release_date, cover=excluded.cover, url=excluded.url,
     added_at=excluded.added_at, synced_at=excluded.synced_at`
);

// Trae TODOS los álbumes guardados del usuario y refresca la tabla local. Snapshot: al final
// borra los que ya no están guardados (los que no se vieron en esta pasada).
export async function refreshSpotifyLibrary() {
  if (spotifyLibStatus.running) return { ...spotifyLibStatus, busy: true };
  if (!spotifyUserConnected()) return { skipped: 'no conectado' };
  const now = Date.now();
  Object.assign(spotifyLibStatus, { running: true, fetched: 0, total: 0, error: null, startedAt: now, finishedAt: null });
  const seen = new Set();
  try {
    let url = '/me/albums?limit=50';
    while (url) {
      // eslint-disable-next-line no-await-in-loop
      const data = await meFetch(url);
      spotifyLibStatus.total = data.total || spotifyLibStatus.total;
      for (const it of data.items || []) {
        const al = it.album || {};
        if (!al.id) continue;
        const artist = (al.artists && al.artists[0]?.name) || '';
        const row = {
          id: al.id,
          artist,
          title: al.name || '',
          match_key: matchKey(artist, al.name || ''),
          album_type: al.album_type || 'album',
          release_date: (al.release_date || '').slice(0, 10) || null,
          cover: al.images?.[0]?.url || null,
          url: al.external_urls?.spotify || null,
          added_at: it.added_at || null,
          synced_at: now,
        };
        upsertSaved.run(row);
        seen.add(al.id);
        spotifyLibStatus.fetched++;
      }
      // siguiente página: Spotify da la URL absoluta en data.next
      url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }
    // poda: fuera lo que ya no está guardado (no visto en esta sincronización)
    const stored = db.prepare('SELECT id FROM spotify_saved_albums').all();
    const del = db.prepare('DELETE FROM spotify_saved_albums WHERE id = ?');
    const prune = db.transaction(() => {
      for (const r of stored) if (!seen.has(r.id)) del.run(r.id);
    });
    prune();
    setSetting('spotify_lib_synced_at', String(now));
    return { count: spotifyLibStatus.fetched };
  } catch (err) {
    spotifyLibStatus.error = String(err.message || err);
    throw err;
  } finally {
    spotifyLibStatus.running = false;
    spotifyLibStatus.finishedAt = Date.now();
  }
}

export function spotifyUserStatus() {
  const connected = spotifyUserConnected();
  const syncedAt = Number(getSetting('spotify_lib_synced_at') || 0) || null;
  const count = connected ? db.prepare('SELECT COUNT(*) n FROM spotify_saved_albums').get().n : 0;
  return {
    clientConfigured: spotifyClientConfigured(),
    connected,
    redirectUri: spotifyRedirectUri(),
    savedCount: count,
    syncedAt,
  };
}

// «Guardar en Spotify» de un clic: busca el álbum en el catálogo de Spotify (por artista +
// título), y si hay coincidencia fiable lo AÑADE a tu biblioteca (PUT /me/albums). Requiere el
// scope user-library-modify (si conectaste solo con lectura, da 403 → reconectar). Al guardar,
// lo mete también en la tabla local para que desaparezca de la brecha al instante.
export async function spotifySaveAlbum(artist, title) {
  if (!artist || !title) throw new Error('Faltan artista o título.');
  const wantArtist = normName(artist);
  const wantTitle = cleanTitleForMatch(title);
  const search = async (q) => {
    const res = await spUserFetch(`/search?q=${encodeURIComponent(q)}&type=album&limit=10`);
    if (res.status === 429) throw new Error('Spotify está limitando las peticiones (429). Prueba de nuevo en un momento.');
    if (!res.ok) throw new Error(`Spotify ${res.status} al buscar`);
    const data = await res.json();
    return data.albums?.items || [];
  };
  // primero una búsqueda acotada; si no casa, otra más suelta
  let items = await search(`album:${title} artist:${artist}`);
  const pick = (list) =>
    list.find(
      (al) => (al.artists || []).some((a) => normName(a.name) === wantArtist) && cleanTitleForMatch(al.name) === wantTitle
    ) || list.find((al) => (al.artists || []).some((a) => normName(a.name) === wantArtist));
  let best = pick(items);
  if (!best) {
    items = await search(`${artist} ${title}`);
    best = pick(items);
  }
  if (!best) throw new Error(`No encontré «${artist} — ${title}» en Spotify con confianza. Ábrelo a mano y guárdalo.`);

  const put = await spUserFetch(`/me/albums?ids=${encodeURIComponent(best.id)}`, { method: 'PUT' });
  if (put.status === 403) {
    throw new Error(
      'Spotify no permite escribir: conectaste solo con lectura. Ve a Ajustes → Biblioteca de Spotify → Desconectar y vuelve a conectar para dar permiso de guardar.'
    );
  }
  if (put.status === 429) throw new Error('Spotify está limitando las peticiones (429). Prueba de nuevo en un momento.');
  if (!put.ok) throw new Error(`Spotify ${put.status} al guardar`);

  // refleja el cambio en la tabla local (desaparece de la brecha sin re-sincronizar)
  const a = (best.artists && best.artists[0]?.name) || artist;
  upsertSaved.run({
    id: best.id,
    artist: a,
    title: best.name || title,
    match_key: matchKey(a, best.name || title),
    album_type: best.album_type || 'album',
    release_date: (best.release_date || '').slice(0, 10) || null,
    cover: best.images?.[0]?.url || null,
    url: best.external_urls?.spotify || null,
    added_at: new Date().toISOString(),
    synced_at: Date.now(),
  });
  return { ok: true, url: best.external_urls?.spotify || null, name: best.name };
}

// LA BRECHA, calculada EN VIVO: cruza tu colección local con tu biblioteca de Spotify.
//  · onlyStreaming: guardado en Spotify pero NO en tu disco  → descargar.
//  · onlyLocal:     en tu disco pero NO guardado en Spotify  → abrir en Spotify para guardarlo.
export function spotifyGap() {
  // claves locales (por album_artist y, si existe, por el nombre canónico del artista)
  const localRows = db
    .prepare(
      `SELECT a.id, a.album_artist, a.title, a.year, a.artist_id, ar.name AS artist_name, a.primary_type
         FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id
        WHERE a.match_state != 'dismissed' AND a.title IS NOT NULL AND a.title != ''`
    )
    .all();
  const localKeys = new Set();
  const localByPrimary = new Map(); // matchKey principal → una fila (para dedup y para onlyLocal)
  for (const r of localRows) {
    const k1 = matchKey(r.album_artist, r.title);
    localKeys.add(k1);
    if (r.artist_name) localKeys.add(matchKey(r.artist_name, r.title));
    if (!localByPrimary.has(k1)) localByPrimary.set(k1, r);
  }

  const spotRows = db.prepare('SELECT * FROM spotify_saved_albums').all();
  const spotKeys = new Set(spotRows.map((r) => r.match_key));

  const onlyStreaming = spotRows
    .filter((r) => !localKeys.has(r.match_key))
    .map((r) => ({
      id: r.id,
      artist: r.artist,
      title: r.title,
      album_type: r.album_type,
      release_date: r.release_date,
      cover: r.cover,
      url: r.url,
      added_at: r.added_at,
    }))
    .sort((a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')));

  // onlyLocal puede ser ENORME (casi toda tu colección): payload mínimo por fila (el enlace de
  // búsqueda en Spotify se compone en el cliente) y el render va por lotes allí.
  const onlyLocal = [...localByPrimary.entries()]
    .filter(([k]) => !spotKeys.has(k))
    .map(([, r]) => ({
      album_id: r.id,
      artist_id: r.artist_id,
      artist: r.album_artist,
      title: r.title,
      year: r.year,
      primary_type: r.primary_type || null,
    }))
    .sort((a, b) => String(a.artist).localeCompare(String(b.artist)) || (a.year || 0) - (b.year || 0));

  return {
    onlyStreaming,
    onlyLocal,
    counts: {
      streaming: spotRows.length,
      local: localByPrimary.size,
      onlyStreaming: onlyStreaming.length,
      onlyLocal: onlyLocal.length,
      inBoth: spotRows.length - onlyStreaming.length,
    },
  };
}
