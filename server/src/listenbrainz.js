import { db, getSetting, setSetting } from './db.js';

// ListenBrainz: alternativa (o complemento) abierta a Last.fm, alineada con MusicBrainz.
// Importa tu historial de escuchas a la tabla `listens` con source='listenbrainz'. Solo
// requiere tu usuario (el histórico es público); el token es opcional (para cuentas
// privadas). Incremental: guarda el ts más reciente y luego pide solo lo posterior.

const API = 'https://api.listenbrainz.org/1';

export function lbConfigured() {
  return !!getSetting('listenbrainz_user');
}

function lbHeaders() {
  const token = getSetting('listenbrainz_token');
  return token ? { Authorization: `Token ${token}` } : {};
}

export async function lbTest() {
  const user = getSetting('listenbrainz_user');
  if (!user) throw new Error('Falta el usuario de ListenBrainz (Ajustes)');
  const res = await fetch(`${API}/user/${encodeURIComponent(user)}/listen-count`, {
    headers: lbHeaders(),
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 404) throw new Error('ListenBrainz: usuario no encontrado');
  if (!res.ok) throw new Error(`ListenBrainz devolvió ${res.status}`);
  const data = await res.json();
  const n = data.payload?.count;
  return { ok: true, name: `ListenBrainz${n != null ? ` (${n.toLocaleString('es-ES')} escuchas)` : ''}` };
}

const insertLB = db.prepare(
  `INSERT OR IGNORE INTO listens (artist, album, track, ts, source, mbid)
   VALUES (@artist, @album, @track, @ts, 'listenbrainz', @mbid)`
);

// Importa las escuchas de ListenBrainz. Pagina hacia atrás con max_ts hasta alcanzar lo ya
// conocido (incremental) o el tope de seguridad (full). Devuelve cuántas nuevas entraron.
export async function importListenBrainz({ full = false } = {}) {
  const user = getSetting('listenbrainz_user');
  if (!user) throw new Error('Falta el usuario de ListenBrainz');
  const lastTs = full ? 0 : Number(getSetting('lb_last_listen') || 0);
  let imported = 0;
  let maxTs = lastTs;
  let before = null; // max_ts (segundos) para la siguiente página, hacia atrás
  for (let guard = 0; guard < 300; guard++) {
    const url = new URL(`${API}/user/${encodeURIComponent(user)}/listens`);
    url.searchParams.set('count', '100');
    if (before) url.searchParams.set('max_ts', String(before));
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url, { headers: lbHeaders(), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`ListenBrainz devolvió ${res.status}`);
    // eslint-disable-next-line no-await-in-loop
    const data = await res.json();
    const listens = data.payload?.listens || [];
    if (!listens.length) break;
    const tx = db.transaction((rows) => {
      for (const l of rows) {
        const ts = Number(l.listened_at) * 1000;
        const m = l.track_metadata || {};
        const rec = {
          artist: m.artist_name || '',
          album: m.release_name || '',
          track: m.track_name || '',
          ts,
          mbid: m.mbid_mapping?.recording_mbid || m.additional_info?.recording_mbid || null,
        };
        if (rec.artist && rec.track && insertLB.run(rec).changes) imported++;
        if (ts > maxTs) maxTs = ts;
      }
    });
    tx(listens);
    const oldest = Math.min(...listens.map((l) => Number(l.listened_at)));
    if (!full && oldest * 1000 <= lastTs) break; // alcanzamos lo ya importado
    if (listens.length < 100) break; // última página
    before = oldest - 1;
  }
  if (maxTs > lastTs) setSetting('lb_last_listen', String(maxTs));
  return { imported };
}
