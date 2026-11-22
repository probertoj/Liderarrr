import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db, getSetting } from './db.js';
import { acquire, servicio } from './ratelimit.js';

const UA = `Liderarrr/${process.env.npm_package_version || '1.1.0'} ( https://github.com/probertoj/Liderarrr )`;

const execFileP = promisify(execFile);

// AcoustID identifica por la HUELLA del audio real, no por las etiquetas: caza
// una carpeta mal nombrada que ninguna búsqueda por texto encontraría. Necesita
// dos cosas: el binario `fpcalc` (Chromaprint, va en la imagen Docker) para
// sacar la huella, y una API key gratuita de acoustid.org para resolverla.
//
// Las huellas son inmutables: se calculan una vez y se guardan para siempre en
// acoustid_cache (el audio no cambia; recalcular es caro).

const FPCALC = process.env.FPCALC_PATH || 'fpcalc';
const API = 'https://api.acoustid.org/v2/lookup';

let fpcalcOk = null; // null = sin comprobar

export async function fpcalcAvailable() {
  if (fpcalcOk !== null) return fpcalcOk;
  try {
    await execFileP(FPCALC, ['-version'], { timeout: 5000 });
    fpcalcOk = true;
  } catch {
    fpcalcOk = false;
  }
  return fpcalcOk;
}

const getFp = db.prepare('SELECT fingerprint, duration, acoustid, mb_recording_id FROM acoustid_cache WHERE path = ?');
const setFp = db.prepare(
  `INSERT INTO acoustid_cache (path, fingerprint, duration, acoustid, mb_recording_id, computed_at)
   VALUES (@path, @fingerprint, @duration, @acoustid, @mb_recording_id, @computed_at)
   ON CONFLICT(path) DO UPDATE SET fingerprint=excluded.fingerprint, duration=excluded.duration,
     acoustid=excluded.acoustid, mb_recording_id=excluded.mb_recording_id, computed_at=excluded.computed_at`
);

// Huella de un fichero (cacheada). Devuelve { fingerprint, duration } o null.
export async function fingerprint(filePath) {
  const cached = getFp.get(filePath);
  if (cached?.fingerprint) return { fingerprint: cached.fingerprint, duration: cached.duration };
  if (!(await fpcalcAvailable())) return null;
  try {
    const { stdout } = await execFileP(FPCALC, ['-json', filePath], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const j = JSON.parse(stdout);
    if (!j.fingerprint) return null;
    setFp.run({
      path: filePath,
      fingerprint: j.fingerprint,
      duration: Math.round(j.duration || 0),
      acoustid: null,
      mb_recording_id: null,
      computed_at: Date.now(),
    });
    return { fingerprint: j.fingerprint, duration: Math.round(j.duration || 0) };
  } catch {
    return null;
  }
}

// Resuelve una huella contra la API de AcoustID. Devuelve el mejor recording
// Por qué rechaza AcoustID las consultas, para que se vea en Diagnóstico. Se avisa una vez
// por motivo distinto, no una por pista.
export const acoustidEstado = { rechazos: 0, ultimoMotivo: null };
function apuntarRechazo(motivo) {
  acoustidEstado.rechazos++;
  if (acoustidEstado.ultimoMotivo !== motivo) {
    acoustidEstado.ultimoMotivo = motivo;
    console.warn(`[acoustid] AcoustID rechaza las consultas: ${motivo}`);
  }
}

// MBID con su score, o null. Guarda el resultado en la caché de la huella.
export async function lookup(filePath) {
  const key = getSetting('acoustid_key');
  if (!key) return null;
  const cached = getFp.get(filePath);
  if (cached?.mb_recording_id) return { mb_recording_id: cached.mb_recording_id, acoustid: cached.acoustid, score: 1 };

  const fp = await fingerprint(filePath);
  if (!fp) return null;

  const params = new URLSearchParams({
    client: key,
    duration: String(fp.duration),
    fingerprint: fp.fingerprint,
    meta: 'recordingids',
  });
  let data;
  try {
    // AcoustID pide no pasar de 3 peticiones por segundo, y la identificación por huella va
    // en bucle sobre todos los discos pendientes (y con varias pistas por disco).
    await acquire('acoustid', servicio('acoustid'));
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: params,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      // AcoustID contesta 400 con el motivo en JSON (clave mala, huella mala…). Antes se
      // tiraba sin mirar: con una clave rechazada, todo salía «sin reconocer» y nada lo decía.
      let motivo = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error?.message) motivo = `${j.error.message} (código ${j.error.code})`;
      } catch {
        /* sin cuerpo legible: vale el código HTTP */
      }
      apuntarRechazo(motivo);
      return null;
    }
    data = await res.json();
  } catch {
    return null;
  }
  if (data.status !== 'ok') {
    apuntarRechazo(data?.error?.message || 'respuesta sin «status: ok»');
    return null;
  }

  let best = null;
  for (const r of data.results || []) {
    const rec = (r.recordings || [])[0];
    if (rec && (!best || r.score > best.score)) {
      best = { acoustid: r.id, mb_recording_id: rec.id, score: r.score };
    }
  }
  if (best) {
    setFp.run({
      path: filePath,
      fingerprint: fp.fingerprint,
      duration: fp.duration,
      acoustid: best.acoustid,
      mb_recording_id: best.mb_recording_id,
      computed_at: Date.now(),
    });
  }
  return best;
}

// Prueba de verdad: además de mirar que haya clave y fpcalc, le hace a AcoustID una
// consulta con una huella que no vale. Si la clave es mala contesta «invalid API key»; si
// es buena, se queja de la huella. Así se distingue una clave rechazada de una que funciona.
export async function acoustidTest() {
  const fpcalc = await fpcalcAvailable();
  const key = getSetting('acoustid_key');
  if (!key) {
    return { ok: false, fpcalc, key: false, error: `Falta la API key de AcoustID${fpcalc ? '' : ' y no se encuentra fpcalc (Chromaprint)'}` };
  }
  if (!fpcalc) {
    return { ok: false, fpcalc, key: true, error: 'No se encuentra fpcalc (Chromaprint): sin él no se pueden calcular las huellas' };
  }
  try {
    await acquire('acoustid', servicio('acoustid'));
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: new URLSearchParams({ client: key, duration: '120', fingerprint: 'AQAAAA' }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => null);
    const msg = String(j?.error?.message || '');
    if (j?.error?.code === 4 || /api key/i.test(msg)) {
      return {
        ok: false,
        fpcalc,
        key: true,
        error: `AcoustID rechaza la clave («${msg || 'invalid API key'}»). Tiene que ser la clave de APLICACIÓN (acoustid.org → «Register your application»), no la de usuario.`,
      };
    }
  } catch (e) {
    return { ok: false, fpcalc, key: true, error: `No se pudo contactar con AcoustID (${String(e.message || e)})` };
  }
  return { ok: true, fpcalc, key: true, name: 'AcoustID acepta la clave y fpcalc está instalado' };
}
