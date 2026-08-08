import { getSetting } from './db.js';

// Cliente de qBittorrent (WebUI API v2). Con Jackett, que SOLO busca (Torznab), es
// quien materializa la descarga: recibe el magnet/.torrent elegido y lo anade. Prowlarr
// no lo necesita (empuja a su propio cliente). Credenciales cifradas en db.js.
//
// Nota WebUI: qBittorrent exige la cabecera Referer igual al host (proteccion CSRF) o
// responde 403; se envia en cada peticion. La sesion es una cookie SID que se cachea.

export function qbConfig() {
  const url = (getSetting('qbittorrent_url') || '').replace(/\/+$/, '');
  const user = getSetting('qbittorrent_user') || '';
  const pass = getSetting('qbittorrent_pass') || '';
  return { url, user, pass };
}

// El 403 tipico de qBittorrent tras un login sin error es la proteccion CSRF /
// validacion de cabecera Host de la WebUI: la sesion no se acepta. Mensaje accionable.
const CSRF_HINT =
  'qBittorrent devolvió 403: la WebUI no aceptó la sesión. La causa más común por HTTP es ' +
  '«Enable cookie Secure flag (requires HTTPS or localhost connection)»: DESMÁRCALA en ' +
  'qBittorrent → Opciones → WebUI → Security (marca la cookie como Secure y solo vale por ' +
  'HTTPS/localhost, no por HTTP en la LAN). Si persiste, revisa «Host header validation» ' +
  '(Server domains) y confirma URL y credenciales.';
let session = { url: null, sid: null, at: 0 };
const SID_TTL = 25 * 60 * 1000;

async function login() {
  const { url, user, pass } = qbConfig();
  if (!url) throw new Error('qBittorrent no configurado (falta URL)');
  let res;
  try {
    res = await fetch(`${url}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, Origin: url },
      body: `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new Error(`No se pudo contactar con qBittorrent: ${String(err?.message || err)}`);
  }
  if (res.status === 403) throw new Error(CSRF_HINT);
  const body = (await res.text()).trim();
  if (!res.ok || /^fails\.?$/i.test(body)) throw new Error('Login de qBittorrent fallido: usuario o contrasena incorrectos.');
  // captura la cookie SID (si la WebUI tiene "bypass para localhost" puede no venir)
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie().join('; ') : res.headers.get('set-cookie') || '';
  const m = setCookie.match(/SID=([^;]+)/);
  session = { url, sid: m ? m[1] : null, at: Date.now() };
  return session;
}

async function ensureSession() {
  const { url } = qbConfig();
  if (session.url === url && session.sid && Date.now() - session.at < SID_TTL) return session;
  return login();
}

async function qbFetch(path, { method = 'GET', body } = {}) {
  const { url } = qbConfig();
  // Referer + Origin: qBittorrent los valida (CSRF) aunque la sesion sea valida.
  const attempt = async () => {
    const s = await ensureSession();
    const headers = { Referer: url, Origin: url };
    if (s.sid) headers.Cookie = `SID=${s.sid}`;
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return fetch(`${url}${path}`, { method, headers, body, signal: AbortSignal.timeout(20000) });
  };
  let res = await attempt();
  if (res.status === 403) {
    // sesion caducada o no aceptada: reintenta una vez con login fresco
    session = { url: null, sid: null, at: 0 };
    res = await attempt();
  }
  if (res.status === 403) throw new Error(CSRF_HINT);
  if (!res.ok) throw new Error(`qBittorrent ${res.status} en ${path}`);
  return res.text();
}

export async function qbTest() {
  const version = (await qbFetch('/api/v2/app/version')).trim();
  return { ok: true, name: `qBittorrent ${version}` };
}

// Anade una descarga por URL (magnet o .torrent). Categoria opcional (para separar en
// qBittorrent lo que manda Liderarr). Devuelve ok; qBittorrent responde "Ok." al anadir.
export async function qbAdd({ url: dl, category } = {}) {
  if (!dl) throw new Error('Falta el enlace de descarga (magnet o .torrent)');
  const cat = category || getSetting('qbittorrent_category') || '';
  let form = `urls=${encodeURIComponent(dl)}`;
  if (cat) form += `&category=${encodeURIComponent(cat)}`;
  const r = (await qbFetch('/api/v2/torrents/add', { method: 'POST', body: form })).trim();
  if (/^fails\.?$/i.test(r)) throw new Error('qBittorrent no acepto el enlace (Fails.).');
  return { ok: true };
}
