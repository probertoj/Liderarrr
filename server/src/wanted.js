import { db, getSetting, setSetting } from './db.js';
import { matchKey } from './matchkey.js';
import { searchAndGrabBest } from './autograb.js';
import { sendNotification } from './notify.js';

// «LO QUIERO»: lista de deseos VIGILADA. Marcas un disco donde lo veas (búsqueda,
// calendario, radar, brecha de streaming…) y Liderarr lo busca por ti en tus indexers una
// y otra vez hasta que aparezca. Es la diferencia entre «tengo que acordarme de buscarlo
// el viernes» y encontrártelo ya descargado el sábado por la mañana.
//
// Se apoya en piezas que ya existen: searchAndGrabBest (elegir la mejor release y
// agarrarla), el ledger de `downloads` (no re-pedir lo ya pedido) y el auto-import
// (hardlink a la biblioteca). Aquí solo está la LISTA y la CADENCIA de reintento.

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// ADELANTO sobre la fecha de estreno. Un disco que sale el VIERNES suele aparecer en los
// indexers el jueves por la mañana (hora europea): sale antes en Australia/Nueva Zelanda, y
// las promos se filtran. Si esperásemos a la medianoche del viernes llegaríamos medio día
// tarde, justo cuando se reparte. Por defecto 16 h: para un estreno del viernes la vigilancia
// arranca el jueves a las 08:00, con margen de sobra antes de las 11:00 típicas.
const leadHours = () => {
  const raw = getSetting('wanted_lead_hours');
  if (raw == null || raw === '') return 16;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 16;
};

// Medianoche LOCAL del día de estreno (la fecha viene como YYYY-MM-DD, sin hora).
function releaseInstant(dateStr) {
  const t = new Date(`${dateStr}T00:00:00`).getTime();
  return Number.isNaN(t) ? null : t;
}

// Cuándo se abre la vigilancia de este deseo: el adelanto sobre su estreno o, si lo marcaste
// después (un disco viejo que quieres hoy), el momento en que lo marcaste. Es el ancla de la
// cadencia: así un disco de 1996 marcado hoy también se busca a menudo los primeros días.
function windowStart(w) {
  const rel = w.release_date ? releaseInstant(w.release_date) : null;
  const open = rel == null ? 0 : rel - leadHours() * HOUR;
  return Math.max(open, w.added_at || 0);
}

// Cadencia de reintento, medida desde que se abrió la ventana (NO por número de intentos: así
// no se degrada por haber empezado a mirar antes del estreno). Sin freno, un deseo que nunca
// aparece machacaría los indexers para siempre.
//   primeras 48 h → cada 1 h   (la ventana caliente: el reparto del jueves/viernes)
//   primera semana → cada 3 h
//   después        → cada 12 h (vigilancia de fondo, indefinida)
function retryDelay(w) {
  const age = Date.now() - windowStart(w);
  if (age < 2 * DAY) return 1 * HOUR;
  if (age < 7 * DAY) return 3 * HOUR;
  return 12 * HOUR;
}

export function wantedConfig() {
  return {
    // Vigilancia ACTIVADA por defecto: marcar «Lo quiero» y que no pase nada sería absurdo.
    // Solo hace algo si hay lista y buscador (Prowlarr/Jackett) configurado.
    enabled: getSetting('wanted_watch_enabled') !== '0',
    intervalMin: Math.max(10, Number(getSetting('wanted_watch_interval_min')) || 60),
    perRun: Math.max(1, Number(getSetting('wanted_watch_per_run')) || 12),
    lastRun: Number(getSetting('wanted_last_run') || 0) || null,
  };
}

export const wantedStatus = {
  running: false,
  lastRun: Number(getSetting('wanted_last_run') || 0) || null,
  checked: 0,
  grabbed: 0,
  error: null,
  log: [],
};

// --- lista ------------------------------------------------------------------

const insert = db.prepare(
  `INSERT INTO wanted_albums (match_key, artist, title, rg_mbid, year, release_date, cover, origin, status, tries, added_at, updated_at)
   VALUES (@match_key, @artist, @title, @rg_mbid, @year, @release_date, @cover, @origin, 'watching', 0, @now, @now)
   ON CONFLICT(match_key) DO UPDATE SET
     rg_mbid = COALESCE(excluded.rg_mbid, wanted_albums.rg_mbid),
     release_date = COALESCE(excluded.release_date, wanted_albums.release_date),
     cover = COALESCE(excluded.cover, wanted_albums.cover),
     updated_at = excluded.updated_at`
);

export function addWanted({ artist, title, rg_mbid, year, release_date, cover, origin } = {}) {
  if (!artist || !title) throw new Error('Faltan artista y título');
  const key = matchKey(artist, title);
  insert.run({
    match_key: key,
    artist: String(artist).trim(),
    title: String(title).trim(),
    rg_mbid: rg_mbid || null,
    year: year ? Number(year) || null : null,
    release_date: release_date || null,
    cover: cover || null,
    origin: origin || null,
    now: Date.now(),
  });
  return { ok: true, match_key: key, ...wantedByKey(key) };
}

export function wantedByKey(key) {
  return db.prepare('SELECT * FROM wanted_albums WHERE match_key = ?').get(key) || null;
}

export function removeWanted({ id, artist, title } = {}) {
  if (id) return { removed: db.prepare('DELETE FROM wanted_albums WHERE id = ?').run(Number(id)).changes };
  if (artist && title)
    return { removed: db.prepare('DELETE FROM wanted_albums WHERE match_key = ?').run(matchKey(artist, title)).changes };
  throw new Error('Falta el disco a quitar');
}

// Mapa para la UI: match_key → {id, status}. Lo comparten TODOS los botones «Lo quiero»
// de una página con una sola petición (igual que la pertenencia a retos).
export function wantedKeys() {
  const map = {};
  for (const r of db.prepare('SELECT id, match_key, status FROM wanted_albums').all()) {
    map[r.match_key] = { id: r.id, status: r.status };
  }
  return map;
}

export function wantedList() {
  return db
    .prepare('SELECT * FROM wanted_albums ORDER BY (status = \'watching\') DESC, COALESCE(release_date, \'\') DESC, added_at DESC')
    .all()
    .map((w) => ({ ...w, due: isDue(w), pending: pendingReason(w) }));
}

// --- vigilancia -------------------------------------------------------------

// ¿Ya lo tienes en la biblioteca? Cruce por rg_mbid y por matchKey (artista+título), la
// misma vara que usa el resto de la app.
function ownedIndex() {
  const rg = new Set(
    db.prepare("SELECT DISTINCT rg_mbid FROM albums WHERE rg_mbid IS NOT NULL AND match_state != 'dismissed'").all().map((r) => r.rg_mbid)
  );
  const keys = new Set(
    db.prepare("SELECT album_artist, title FROM albums WHERE match_state != 'dismissed'").all().map((r) => matchKey(r.album_artist, r.title))
  );
  return (w) => (w.rg_mbid && rg.has(w.rg_mbid)) || keys.has(w.match_key);
}

// ¿Hay ya un pedido vivo para este disco? Evita pedir dos veces lo mismo cuando el
// auto-grab de artistas seguidos, o tú a mano, ya lo agarrasteis.
function requestedIndex() {
  const rows = db
    .prepare("SELECT rg_mbid, artist, album FROM downloads WHERE status IN ('requested','importing')")
    .all();
  const rg = new Set(rows.map((r) => r.rg_mbid).filter(Boolean));
  const keys = new Set(rows.filter((r) => r.artist && r.album).map((r) => matchKey(r.artist, r.album)));
  return (w) => (w.rg_mbid && rg.has(w.rg_mbid)) || keys.has(w.match_key);
}

// ¿Está abierta ya la vigilancia? Buscar un disco días antes de que exista es gastar llamadas
// al indexer para nada; buscarlo solo a partir de su fecha oficial llega tarde (aparecen el día
// antes). El adelanto de leadHours() es el punto medio.
function windowOpen(w) {
  return Date.now() >= windowStart(w);
}

// ¿Toca buscar este deseo ahora? Ventana abierta y cadencia de reintento cumplida.
function isDue(w) {
  if (w.status !== 'watching' || !windowOpen(w)) return false;
  if (!w.last_try_at) return true;
  return Date.now() - w.last_try_at >= retryDelay(w);
}

// Texto para la UI: por qué este deseo aún no se ha buscado / qué pasó la última vez.
function pendingReason(w) {
  if (w.status === 'owned') return 'ya en tu disco';
  if (w.status === 'grabbed') return w.release_title ? `pedido: ${w.release_title}` : 'pedido';
  if (!windowOpen(w)) {
    const desde = new Date(windowStart(w));
    const cuando = desde.toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `sale el ${w.release_date} · empieza a buscar el ${cuando}`;
  }
  if (!w.last_try_at) return 'en cola para buscar';
  return w.last_reason || 'buscando';
}

const markTry = db.prepare(
  'UPDATE wanted_albums SET tries = tries + 1, last_try_at = @now, last_reason = @reason, updated_at = @now WHERE id = @id'
);
const markGrabbed = db.prepare(
  "UPDATE wanted_albums SET status = 'grabbed', release_title = @release, last_try_at = @now, last_reason = NULL, updated_at = @now WHERE id = @id"
);

// Cierra los deseos cuyo disco YA está en tu biblioteca. Se llama también desde el
// refresco nocturno: es la fuente de verdad real (lo tienes o no lo tienes).
export function reconcileWanted() {
  const owned = ownedIndex();
  let closed = 0;
  for (const w of db.prepare("SELECT * FROM wanted_albums WHERE status != 'owned'").all()) {
    if (!owned(w)) continue;
    db.prepare("UPDATE wanted_albums SET status = 'owned', last_reason = NULL, updated_at = ? WHERE id = ?").run(Date.now(), w.id);
    closed++;
  }
  return closed;
}

// Barrido: busca en tus indexers los deseos que tocan y agarra la mejor release. Tope por
// tanda (cada búsqueda consulta indexers en vivo y es lenta). Un fallo en uno no tumba al
// resto. Es lo que corre cada hora y en el refresco nocturno.
export async function runWantedWatch({ limit, force = false } = {}) {
  if (wantedStatus.running) return wantedStatus;
  const cfg = wantedConfig();
  const cap = limit ?? cfg.perRun;
  Object.assign(wantedStatus, { running: true, error: null, checked: 0, grabbed: 0, log: [] });
  try {
    const closed = reconcileWanted();
    if (closed) wantedStatus.log.push(`· ${closed} deseo(s) cerrados: ya están en tu disco`);
    const requested = requestedIndex();
    const candidates = db
      .prepare("SELECT * FROM wanted_albums WHERE status = 'watching' ORDER BY COALESCE(last_try_at, 0)")
      .all()
      .filter((w) => (force ? windowOpen(w) : isDue(w))); // force salta la cadencia, NO la ventana de estreno

    const grabbedNow = [];
    for (const w of candidates) {
      if (wantedStatus.checked >= cap) break;
      if (requested(w)) {
        markTry.run({ id: w.id, now: Date.now(), reason: 'ya lo tienes pedido' });
        continue;
      }
      wantedStatus.checked++;
      try {
        const res = await searchAndGrabBest(`${w.artist} ${w.title}`, {
          rg_mbid: w.rg_mbid,
          artist: w.artist,
          album: w.title,
          year: w.year,
        });
        if (res.grabbed) {
          markGrabbed.run({ id: w.id, release: res.release, now: Date.now() });
          wantedStatus.grabbed++;
          grabbedNow.push(`${w.artist} — ${w.title}`);
          wantedStatus.log.push(`✓ ${w.artist} — ${w.title} · ${res.release} (${res.seeders ?? '?'} seeders)`);
        } else {
          markTry.run({ id: w.id, now: Date.now(), reason: res.reason });
          wantedStatus.log.push(`· ${w.artist} — ${w.title}: ${res.reason}`);
        }
      } catch (e) {
        const msg = String(e.message || e);
        // Sin buscador configurado no hay nada que hacer: abortamos la tanda entera sin
        // quemar un intento por deseo (si no, cada hora sumarían intentos para nada).
        if (/no configurado/i.test(msg)) {
          wantedStatus.checked--;
          wantedStatus.error = msg;
          wantedStatus.log.push(`⚠️ ${msg}: configura Prowlarr o Jackett en Ajustes.`);
          break;
        }
        markTry.run({ id: w.id, now: Date.now(), reason: msg });
        wantedStatus.log.push(`⚠️ ${w.artist} — ${w.title}: ${msg}`);
      }
    }

    // Aviso: lo que esperabas ya está descargándose. Es media feature: de nada sirve que
    // lo pille de madrugada si te enteras tres días después.
    if (grabbedNow.length) {
      const lista = grabbedNow.slice(0, 10).map((t) => `• ${t}`).join('\n');
      const mas = grabbedNow.length > 10 ? `\n…y ${grabbedNow.length - 10} más` : '';
      sendNotification(
        `🎯 ${grabbedNow.length} disco(s) de «Lo quiero» en camino`,
        `${lista}${mas}`
      ).catch(() => {});
    }

    wantedStatus.log = wantedStatus.log.slice(0, 100);
    wantedStatus.lastRun = Date.now();
    setSetting('wanted_last_run', String(Date.now()));
  } catch (e) {
    wantedStatus.error = String(e.message || e);
  } finally {
    wantedStatus.running = false;
  }
  return wantedStatus;
}

// Cuántos deseos hay y en qué estado (para la pestaña y el panel de ajustes).
export function wantedCounts() {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM wanted_albums GROUP BY status').all();
  const out = { watching: 0, grabbed: 0, owned: 0, total: 0 };
  for (const r of rows) {
    out[r.status] = r.n;
    out.total += r.n;
  }
  return out;
}
