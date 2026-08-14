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
let session = { url: null, cookie: null, at: 0 };
let lastDiag = null; // diagnostico del ultimo login (sin el token), para el 403
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
  const rawList =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')]
        : [];
  // qBittorrent 5.x cambio el nombre de la cookie de sesion (ya no siempre es SID) y el
  // login puede responder 204. Capturamos el primer par nombre=valor sea cual sea y lo
  // reenviamos tal cual: agnostico a la version.
  const cookiePair = (rawList[0] || '').split(';')[0].trim();
  const cookie = cookiePair.includes('=') ? cookiePair : null;
  lastDiag = {
    status: res.status,
    body: body.slice(0, 12),
    setCookieCount: rawList.length,
    cookieName: cookie ? cookie.split('=')[0] : '(ninguna)',
    headers: [...res.headers.keys()].join(','),
  };
  session = { url, cookie, at: Date.now() };
  return session;
}

async function ensureSession() {
  const { url } = qbConfig();
  if (session.url === url && session.cookie && Date.now() - session.at < SID_TTL) return session;
  return login();
}

async function qbFetch(path, { method = 'GET', body } = {}) {
  const { url } = qbConfig();
  // Referer + Origin: qBittorrent los valida (CSRF) aunque la sesion sea valida.
  const attempt = async () => {
    const s = await ensureSession();
    const headers = { Referer: url, Origin: url };
    if (s.cookie) headers.Cookie = s.cookie;
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return fetch(`${url}${path}`, { method, headers, body, signal: AbortSignal.timeout(20000) });
  };
  let res = await attempt();
  if (res.status === 403) {
    // sesion caducada o no aceptada: reintenta una vez con login fresco
    session = { url: null, cookie: null, at: 0 };
    res = await attempt();
  }
  if (res.status === 403) throw new Error(CSRF_HINT);
  if (!res.ok) throw new Error(`qBittorrent ${res.status} en ${path}`);
  return res.text();
}

export async function qbTest() {
  // login explicito para saber si llega la cookie de sesion (diagnostico del 403)
  await login();
  const gotCookie = !!session.cookie;
  try {
    const version = (await qbFetch('/api/v2/app/version')).trim();
    return { ok: true, name: `qBittorrent ${version}` };
  } catch (e) {
    if (/\b403\b/.test(String(e.message)) || String(e.message) === CSRF_HINT) {
      throw new Error(
        gotCookie
          ? 'Login OK y cookie de sesion recibida, pero la llamada dio 403: es la validacion de la WebUI. ' +
            'Prueba a DESMARCAR «Enable Host header validation» en qBittorrent → Opciones → WebUI → Security (y pulsa Guardar).'
          : 'Login OK pero qBittorrent NO envio cookie de sesion. Casi siempre es «Enable cookie Secure flag» todavia ' +
            'activa (o no guardaste): desmarcala en Opciones → WebUI → Security y pulsa GUARDAR en qBittorrent. ' +
            (lastDiag
              ? `[diag: status=${lastDiag.status}, body="${lastDiag.body}", set-cookie=${lastDiag.setCookieCount}, cookie=${lastDiag.cookieName}, cabeceras=${lastDiag.headers}]`
              : '')
      );
    }
    throw e;
  }
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

// Torrents COMPLETADOS (para el auto-import: cerrar el bucle de descargas). Si hay una
// categoria configurada, filtra por ella (solo lo que manda Liderarr). content_path es
// la raiz del contenido (carpeta en multi-fichero, fichero en single).
export async function qbCompletedTorrents() {
  const cat = getSetting('qbittorrent_category') || '';
  let path = '/api/v2/torrents/info?filter=completed';
  if (cat) path += `&category=${encodeURIComponent(cat)}`;
  const txt = await qbFetch(path);
  let list = [];
  try {
    list = JSON.parse(txt || '[]');
  } catch {
    list = [];
  }
  return list.map((t) => ({
    hash: String(t.hash || '').toLowerCase(),
    name: t.name || '',
    contentPath: t.content_path || t.save_path || '',
    savePath: t.save_path || '',
    category: t.category || '',
    progress: t.progress,
    state: t.state || '',
    completedOn: t.completion_on || 0,
  }));
}
