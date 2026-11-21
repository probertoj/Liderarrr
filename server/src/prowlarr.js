import { getSetting } from './db.js';
import { cleanSearchQuery } from './searchquery.js';
import { acquire } from './ratelimit.js';

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

async function prowlarrFetch(path, { method = 'GET', body, limited = true } = {}) {
  const { url, key } = prowlarrConfig();
  if (!url || !key) throw new Error('Prowlarr no configurado (URL o API key vacíos)');
  // Freno de peticiones AQUÍ, no en quien llama: cada búsqueda y cada «grab» acaba siendo una
  // petición al tracker, y los trackers privados tienen un tope (RED: 10 cada 10 s). Poniéndolo
  // en el cuello de botella, ninguna función nueva puede saltárselo por descuido. Las consultas
  // a Prowlarr que NO salen al tracker (estado, lista de clientes) van sin freno.
  if (limited) await acquire('indexer');
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
  const list = await prowlarrFetch('/downloadclient', { limited: false });
  return Array.isArray(list) ? list : [];
}

export async function prowlarrTest() {
  const status = await prowlarrFetch('/system/status', { limited: false });
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
  // Y los indexers: es donde se pierden los resultados sin que nadie avise.
  let detalles = [];
  let indexersMsg = '';
  try {
    detalles = await prowlarrIndexers();
    const conProblemas = detalles.filter((d) => d.estado !== 'ok').length;
    indexersMsg = !detalles.length
      ? ' · ⚠️ sin indexers en Prowlarr'
      : ` · ${detalles.length} indexers${conProblemas ? `, ${conProblemas} con algo que mirar` : ', todos bien'}`;
  } catch (e) {
    indexersMsg = ` · (no se pudieron leer los indexers: ${String(e.message || e)})`;
  }
  return { ok: true, name: `Prowlarr ${status.version} · ${clientMsg}${indexersMsg}`, version: status.version, detalles };
}

// --- salud de los indexers ---------------------------------------------------
// Una búsqueda de Prowlarr es un agregado: si un indexer no contesta, la respuesta llega
// igual con lo de los demás y NADIE avisa. Leído en su código: un indexer apartado por
// fallos se salta con un log de depuración, uno con el cupo de consultas agotado devuelve
// vacío sin log, y en Redacted «Freeload Only» o «Use Freeleech Tokens: Required» descartan
// resultados uno a uno. Desde Liderarrr solo se veía «Redacted no trae nada». Esto le
// pregunta a Prowlarr por su propia configuración —no sale al tracker— y lo dice.

const campo = (ix, sufijo) =>
  (Array.isArray(ix?.fields) ? ix.fields : []).find((c) => String(c?.name || '').toLowerCase().endsWith(sufijo))?.value;

// ¿Declara alguna categoría de música (3000-3999)? null si Prowlarr no manda las categorías:
// sin dato no se acusa a nadie.
function declaraAudio(ix) {
  const cats = ix?.capabilities?.categories;
  if (!Array.isArray(cats) || !cats.length) return null;
  const esAudio = (c) => Number(c?.id) >= 3000 && Number(c?.id) < 4000;
  return cats.some((c) => esAudio(c) || (Array.isArray(c?.subCategories) && c.subCategories.some(esAudio)));
}

const cuando = (iso) =>
  new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Qué le pasa a UN indexer, a partir de lo que devuelve Prowlarr en /indexer y /indexerstatus.
 * Devuelve { nombre, estado: 'ok' | 'aviso' | 'mal', texto }. Pura: se prueba con ejemplos.
 */
export function diagnosticarIndexer(ix, st, ahora = Date.now()) {
  const graves = [];
  const avisos = [];

  if (ix.enable === false) graves.push('está desactivado en Prowlarr');
  if (ix.supportsSearch === false) graves.push('no admite búsquedas (solo RSS)');

  const hasta = st?.disabledTill ? new Date(st.disabledTill).getTime() : 0;
  if (hasta > ahora) {
    graves.push(`Prowlarr lo ha apartado por fallos hasta el ${cuando(st.disabledTill)}: mientras tanto no lo consulta`);
  } else if (st?.mostRecentFailure) {
    avisos.push(`falló hace poco (${cuando(st.mostRecentFailure)}); mira System → Logs en Prowlarr`);
  }

  if (declaraAudio(ix) === false) graves.push('no declara la categoría de música (3000), así que estas búsquedas no lo consultan');

  if (campo(ix, 'freeloadonly') === true) {
    graves.push('tiene «Freeload Only» activado: descarta todo lo que no sea freeload, o sea casi todo');
  }
  if (Number(campo(ix, 'usefreeleechtoken')) === 2) {
    avisos.push('«Use Freeleech Tokens» está en Required: se salta cada torrent en el que no puedas gastar token');
  }
  const tope = Number(campo(ix, 'querylimit'));
  if (tope > 0) {
    const unidad = Number(campo(ix, 'limitsunit')) === 1 ? 'hora' : 'día';
    avisos.push(`tiene un tope de ${tope} consultas por ${unidad}: al llegar devuelve vacío sin avisar`);
  }

  const estado = graves.length ? 'mal' : avisos.length ? 'aviso' : 'ok';
  const texto = [...graves, ...avisos].join('; ') || 'activo y sin nada raro';
  return { nombre: ix.name || ix.definitionName || `indexer ${ix.id}`, estado, texto };
}

// Los indexers de Prowlarr con su diagnóstico, lo peor primero. NO sale al tracker: son
// dos consultas a la base del propio Prowlarr, así que van sin freno.
export async function prowlarrIndexers() {
  const [lista, estados] = await Promise.all([
    prowlarrFetch('/indexer', { limited: false }),
    prowlarrFetch('/indexerstatus', { limited: false }).catch(() => []),
  ]);
  const porId = new Map((Array.isArray(estados) ? estados : []).map((e) => [e.indexerId, e]));
  const orden = { mal: 0, aviso: 1, ok: 2 };
  return (Array.isArray(lista) ? lista : [])
    .map((ix) => diagnosticarIndexer(ix, porId.get(ix.id) || ix.status || null))
    .sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre));
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
  const q = cleanSearchQuery(query);
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
