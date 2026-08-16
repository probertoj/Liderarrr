import { getSetting } from './db.js';

// Prowlarr agrega TODOS tus indexers (RED, OPS, lo de Jackett) y expone una API de
// búsqueda y de "grab" (agarrar) que empuja la release a su cliente de descarga.
// Liderarr lo usa para pedir un disco SIN pasar por el filtro de metadatos de
// Lidarr: ves todas las opciones de los trackers y eliges la que quieras. Es la
// pieza que convierte a Lidarr en opcional en vez de en obstáculo.

export function prowlarrConfig() {
  const url = (getSetting('prowlarr_url') || '').replace(/\/+$/, '');
  const key = getSetting('prowlarr_key') || '';
  return { url, key };
}

async function prowlarrFetch(path, { method = 'GET', body } = {}) {
  const { url, key } = prowlarrConfig();
  if (!url || !key) throw new Error('Prowlarr no configurado (URL o API key vacíos)');
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${url}/api/v1${path}`, {
      method,
      headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      // la búsqueda consulta los indexers EN VIVO: puede tardar bastante
      signal: AbortSignal.timeout(90000),
    });
  } catch (err) {
    const ms = Date.now() - t0;
    const why =
      err?.name === 'TimeoutError' || /aborted/i.test(String(err?.message))
        ? `timeout tras ${ms}ms`
        : String(err?.message || err);
    console.warn(`[prowlarr] ✗ ${method} ${path} — ${why}`);
    throw new Error(`No se pudo contactar con Prowlarr (${method} ${path}): ${why}`);
  }
  const ms = Date.now() - t0;
  if (ms > 5000) console.warn(`[prowlarr] ⏱ ${method} ${path} tardó ${ms}ms (${res.status})`);
  if (!res.ok) {
    let detail = '';
    try {
      const t = await res.text();
      if (t) {
        try {
          const j = JSON.parse(t);
          const msg = Array.isArray(j)
            ? j.map((e) => e.errorMessage || e.message).filter(Boolean).join('; ')
            : j.message || j.error;
          detail = msg ? ` — ${msg}` : ` — ${t.slice(0, 300)}`;
        } catch {
          detail = ` — ${t.slice(0, 300)}`;
        }
      }
    } catch {
      /* sin cuerpo */
    }
    throw new Error(`Prowlarr ${res.status} en ${path}${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

// Clientes de descarga configurados EN Prowlarr (Settings → Download Clients). Es a
// donde Prowlarr empuja lo que agarra: si no hay ninguno, un «grab» no descarga nada.
export async function prowlarrDownloadClients() {
  const list = await prowlarrFetch('/downloadclient');
  return Array.isArray(list) ? list : [];
}

export async function prowlarrTest() {
  const status = await prowlarrFetch('/system/status');
  // CLAVE sin Lidarr: Liderarr NO habla con qBittorrent en el flujo Prowlarr; le pide a
  // Prowlarr que agarre, y Prowlarr empuja a SU cliente de descarga. En un montaje *Arr
  // clásico ese cliente vive en Lidarr, no en Prowlarr, así que al «liberar de Lidarr» es
  // fácil quedarse sin cliente en Prowlarr y que los grabs no descarguen nada. Lo avisamos.
  let clientMsg;
  try {
    const clients = await prowlarrDownloadClients();
    const enabled = clients.filter((c) => c.enable);
    if (!clients.length) {
      clientMsg = '⚠️ SIN cliente de descarga en Prowlarr → los «grab» no descargarán. Añade qBittorrent en Prowlarr → Settings → Download Clients.';
    } else if (!enabled.length) {
      clientMsg = `⚠️ ${clients.length} cliente(s) de descarga pero ninguno ACTIVADO en Prowlarr.`;
    } else {
      clientMsg = `cliente de descarga OK: ${enabled.map((c) => c.name || c.implementation).join(', ')}`;
    }
  } catch (e) {
    clientMsg = `(no se pudo comprobar el cliente de descarga: ${String(e.message || e)})`;
  }
  return { ok: true, name: `Prowlarr ${status.version} · ${clientMsg}`, version: status.version };
}

function mapRelease(r) {
  return {
    guid: r.guid,
    indexerId: r.indexerId,
    indexer: r.indexer || '',
    title: r.title || '',
    size: r.size || 0,
    seeders: typeof r.seeders === 'number' ? r.seeders : null,
    leechers: typeof r.leechers === 'number' ? r.leechers : null,
    grabs: typeof r.grabs === 'number' ? r.grabs : null,
    protocol: r.protocol || '', // torrent | usenet
    publishDate: r.publishDate || null,
    infoUrl: r.infoUrl || null,
    // freeleech: downloadVolumeFactor=0 significa que la descarga NO cuenta para el ratio.
    // null si el indexer no lo informa (se trata como "no freeleech" al filtrar).
    downloadFactor: typeof r.downloadVolumeFactor === 'number' ? r.downloadVolumeFactor : null,
    freeleech: typeof r.downloadVolumeFactor === 'number' ? r.downloadVolumeFactor === 0 : null,
    // Prowlarr no parsea la calidad de audio: el formato va en el TÍTULO del tracker
    // (p. ej. "[FLAC / 24bit Lossless]"). Se muestra el título tal cual.
  };
}

// Busca en todos los indexers (categoría Audio = 3000). Devuelve una lista para que
// el usuario elija. Consulta los trackers en vivo, así que puede tardar.
export async function prowlarrSearch(query, { limit = 100 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const results = await prowlarrFetch(
    `/search?query=${encodeURIComponent(q)}&type=search&categories=3000&limit=${limit}`
  );
  const list = (results || []).map(mapRelease);
  // más semillas primero (más disponible)
  list.sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1));
  return list;
}

// Agarra (grab) una release: Prowlarr la descarga y la empuja a su cliente de
// descarga (el que tengas en Prowlarr → Settings → Download Clients).
export async function prowlarrGrab({ guid, indexerId }) {
  if (!guid || indexerId == null) throw new Error('Release inválida (falta guid o indexerId)');
  await prowlarrFetch('/search', { method: 'POST', body: { guid, indexerId } });
  return { ok: true };
}
