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

export async function prowlarrTest() {
  const status = await prowlarrFetch('/system/status');
  return { ok: true, version: status.version, name: status.appName || 'Prowlarr' };
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
