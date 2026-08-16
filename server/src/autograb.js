import { db, getSetting, setSetting } from './db.js';
import { jackettSearch } from './jackett.js';
import { prowlarrSearch, prowlarrGrab } from './prowlarr.js';
import { qbAdd } from './qbittorrent.js';
import { recordGrab, magnetHash, activeRequestRgs } from './downloads.js';
import { normName } from './matchkey.js';

// AUTO-DESCARGA NATIVA (independencia de Lidarr, pasos ③+④). Reemplaza al auto-Lidarr:
// para los huecos/estrenos de tus artistas seguidos, busca en tus indexers (Jackett/
// Prowlarr), elige la MEJOR release con una heurística propia y la agarra. El ledger de
// descargas + el auto-import cierran el bucle (hardlink a la biblioteca). Sin Lidarr.

const DAY = 24 * 3600 * 1000;

// ③ Puntuación de formato/calidad a partir del título de la release. No es el motor de
// quality profiles de Lidarr, pero cubre el criterio habitual: sin pérdida primero.
function formatRank(title) {
  const t = String(title || '').toLowerCase();
  if (/\b(flac|lossless|ape|wav|alac)\b/.test(t)) return 100;
  if (/\b320\b/.test(t)) return 70;
  if (/\bv0\b|vbr/.test(t)) return 65;
  if (/\b256\b/.test(t)) return 50;
  if (/\b(mp3|aac|m4a|192|128)\b/.test(t)) return 40;
  return 30; // desconocido
}

// Prioridad de trackers configurada (ajuste `tracker_priority`): un nombre por línea, el
// preferido arriba, en minúsculas. Vacío = todos igual.
export function trackerPriorityList() {
  return String(getSetting('tracker_priority') || '')
    .split(/[\n;,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Posición del tracker de una release en la lista de prioridad (menor = más prioritario;
// no listado = detrás de todos). Casa por igualdad o inclusión, para tolerar sufijos del
// nombre del indexer ("Redacted (API)" ~ "redacted").
function trackerRank(indexer, priority) {
  if (!priority.length) return 0;
  const n = String(indexer || '').toLowerCase().trim();
  if (!n) return priority.length;
  const i = priority.findIndex((p) => n === p || n.includes(p) || p.includes(n));
  return i === -1 ? priority.length : i;
}

// ③ Elige la mejor release de una lista de resultados para {artist, album}:
//  - descarta las MUERTAS (0 seeders) — justo el caso que dejaba descargas paradas;
//  - exige coincidencia mínima con el álbum (evita agarrar algo ajeno);
//  - ordena por CALIDAD (formato + bonus de artista), luego por PRIORIDAD DE TRACKER (a
//    igual calidad, el disco del tracker que prefieras) y por último por seeders.
export function pickBestRelease(results, { artist, album, minSeeders = 1, freeleechOnly = false, trackerPriority = [] } = {}) {
  const na = normName(artist);
  const nal = normName(album);
  const scored = [];
  for (const r of results || []) {
    if (typeof r.seeders === 'number' && r.seeders < minSeeders) continue; // muerta
    // freeleech-only: solo releases CONFIRMADAS freeleech (protege el ratio). Si el
    // indexer no informa el factor (freeleech null), se descarta por seguridad.
    if (freeleechOnly && r.freeleech !== true) continue;
    const nt = normName(r.title);
    if (nal && !nt.includes(nal)) continue; // no parece ser ese álbum
    // Calidad/relevancia SIN seeders: así, a igual calidad, manda la prioridad de tracker
    // y solo después los seeders (antes los seeders entraban en el score y colaban).
    const score = formatRank(r.title) + (na && nt.includes(na) ? 10 : 0);
    scored.push({ r, score, rank: trackerRank(r.indexer, trackerPriority) });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.rank - b.rank || (b.r.seeders || 0) - (a.r.seeders || 0));
  return scored[0].r;
}

// Busca y agarra la mejor release para una consulta, registrando el pedido (ledger) con
// el contexto del álbum para que el auto-import lo lleve a su carpeta. Agnóstico al motor.
export async function searchAndGrabBest(query, context = {}) {
  const engine = getSetting('search_engine') || 'prowlarr';
  const minSeeders = Number(getSetting('auto_grab_min_seeders')) || 1;
  const freeleechOnly = getSetting('auto_grab_freeleech_only') === '1';
  const trackerPriority = trackerPriorityList();
  const results = engine === 'jackett' ? await jackettSearch(query) : await prowlarrSearch(query);
  const best = pickBestRelease(results, { artist: context.artist, album: context.album, minSeeders, freeleechOnly, trackerPriority });
  if (!best)
    return {
      grabbed: false,
      reason: freeleechOnly ? 'sin release freeleech válida (o 0 seeders / sin coincidencia)' : 'sin release válida (0 seeders o sin coincidencia)',
    };
  if (engine === 'jackett') await qbAdd({ url: best.downloadUrl });
  else await prowlarrGrab({ guid: best.guid, indexerId: best.indexerId });
  recordGrab({ ...context, release_title: best.title, infohash: magnetHash(best.downloadUrl), source: engine });
  return { grabbed: true, release: best.title, seeders: best.seeders ?? null };
}

// ④ Estado del bucle (persistente entre reinicios en un ajuste, como auto-Lidarr).
export const autoGrabStatus = {
  running: false,
  lastRun: Number(getSetting('auto_grab_last_run') || 0) || null,
  considered: 0,
  grabbed: 0,
  error: null,
  log: [],
};

export function autoGrabConfig() {
  return {
    enabled: getSetting('auto_grab_enabled') === '1',
    months: Number(getSetting('auto_grab_months')) || 6,
    lookbackDays: Number(getSetting('auto_grab_lookback_days')) || 30,
    minSeeders: Number(getSetting('auto_grab_min_seeders')) || 1,
    limit: Number(getSetting('auto_grab_limit')) || 20,
    freeleechOnly: getSetting('auto_grab_freeleech_only') === '1',
    lastRun: Number(getSetting('auto_grab_last_run') || 0) || null,
  };
}

// ④ Recorre huecos/estrenos de artistas seguidos y agarra la mejor release de cada uno.
// Salta lo que ya tienes, lo ya pedido (ledger) y lo descartado. Tope por tanda (los
// indexers se consultan en vivo y es lento). Un fallo en uno no tumba a los demás.
export async function runAutoGrab({ months, lookbackDays, limit, dryRun = false } = {}) {
  if (autoGrabStatus.running) return autoGrabStatus;
  const cfg = autoGrabConfig();
  const m = months ?? cfg.months;
  const lb = lookbackDays ?? cfg.lookbackDays;
  const cap = limit ?? cfg.limit;
  Object.assign(autoGrabStatus, { running: true, error: null, considered: 0, grabbed: 0, log: [] });
  try {
    const floor = new Date(Date.now() - lb * DAY).toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + m * 30 * DAY).toISOString().slice(0, 10);
    const requested = activeRequestRgs();
    const candidates = db
      .prepare(
        `SELECT rg.rg_mbid, rg.title, rg.first_release, ar.name AS artist
         FROM release_groups rg
         JOIN tracked_artists t ON t.artist_id = rg.artist_id AND t.facet = 'artist'
         JOIN artists ar ON ar.id = rg.artist_id
         WHERE rg.is_owned = 0
           AND rg.primary_type = 'Album'
           AND (rg.secondary_types IS NULL OR rg.secondary_types = '[]')
           AND rg.first_release IS NOT NULL
           AND rg.first_release >= ? AND rg.first_release <= ?
           AND rg.rg_mbid NOT IN (SELECT rg_mbid FROM dismissed_albums)
         ORDER BY rg.first_release`
      )
      .all(floor, horizon)
      .filter((c) => !requested.has(c.rg_mbid));
    autoGrabStatus.considered = candidates.length;

    let n = 0;
    for (const c of candidates) {
      if (n >= cap) break;
      if (dryRun) {
        autoGrabStatus.log.push(`(simulado) ${c.artist} — ${c.title} · ${c.first_release}`);
        n++;
        continue;
      }
      try {
        const res = await searchAndGrabBest(`${c.artist} ${c.title}`, {
          rg_mbid: c.rg_mbid,
          artist: c.artist,
          album: c.title,
        });
        if (res.grabbed) {
          autoGrabStatus.grabbed++;
          n++;
          autoGrabStatus.log.push(`✓ ${c.artist} — ${c.title} · ${res.release} (${res.seeders ?? '?'} seeders)`);
        } else {
          autoGrabStatus.log.push(`· ${c.artist} — ${c.title}: ${res.reason}`);
        }
      } catch (e) {
        autoGrabStatus.log.push(`⚠️ ${c.title}: ${String(e.message || e)}`);
      }
    }
    autoGrabStatus.log = autoGrabStatus.log.slice(0, 100);
    autoGrabStatus.lastRun = Date.now();
    setSetting('auto_grab_last_run', String(Date.now()));
  } catch (e) {
    autoGrabStatus.error = String(e.message || e);
  } finally {
    autoGrabStatus.running = false;
  }
  return autoGrabStatus;
}
