import { db, getSetting, setSetting } from './db.js';
import { lidarrAdd, lidarrOwnedIds } from './lidarr.js';

const DAY = 24 * 3600 * 1000;
const today = () => new Date().toISOString().slice(0, 10);

// Automatización diaria: para cada ARTISTA SEGUIDO, manda a Lidarr los álbumes de
// estudio que estrena (o ha estrenado hace poco) dentro de la ventana y que no
// tienes ni están ya encargados. Lee de release_groups, que discography.js
// mantiene al día. Equivalente al auto-Radarr de PowaFlex.
export const autoLidarrStatus = {
  running: false,
  lastRun: Number(getSetting('auto_lidarr_last_run') || 0) || null,
  considered: 0,
  added: 0,
  error: null,
  log: [],
};

export async function runAutoLidarr({ months = 6, lookbackDays = 30, dryRun = false } = {}) {
  if (autoLidarrStatus.running) return autoLidarrStatus;
  Object.assign(autoLidarrStatus, { running: true, error: null, considered: 0, added: 0, log: [] });
  try {
    const floor = new Date(Date.now() - lookbackDays * DAY).toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + months * 30 * DAY).toISOString().slice(0, 10);
    const owned = lidarrOwnedIds();

    // álbumes de estudio de artistas seguidos (faceta artist), no tuyos, con
    // fecha dentro de [floor, horizon]. Incluye estrenos futuros y recientes.
    const candidates = db
      .prepare(
        `SELECT rg.rg_mbid, rg.title, rg.first_release, rg.artist_mbid, ar.name AS artist
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
      .filter((c) => !owned.has(c.rg_mbid));

    autoLidarrStatus.considered = candidates.length;
    for (const c of candidates) {
      if (dryRun) {
        autoLidarrStatus.log.push(`(simulado) ${c.artist} — ${c.title} · ${c.first_release}`);
        continue;
      }
      try {
        await lidarrAdd(c.rg_mbid, c.artist_mbid);
        owned.add(c.rg_mbid);
        autoLidarrStatus.added++;
        autoLidarrStatus.log.push(`✓ ${c.artist} — ${c.title} (${c.first_release})`);
      } catch (err) {
        const msg = String(err.message || err);
        if (/already/i.test(msg)) continue;
        autoLidarrStatus.log.push(`⚠️ ${c.title}: ${msg}`);
      }
    }
    autoLidarrStatus.log = autoLidarrStatus.log.slice(0, 100);
    autoLidarrStatus.lastRun = Date.now();
    setSetting('auto_lidarr_last_run', String(Date.now()));
  } catch (err) {
    autoLidarrStatus.error = String(err.message || err);
  } finally {
    autoLidarrStatus.running = false;
  }
  return autoLidarrStatus;
}

export function autoLidarrConfig() {
  return {
    enabled: getSetting('auto_lidarr_enabled') === '1',
    months: Number(getSetting('auto_lidarr_months') || 6),
    lookbackDays: Number(getSetting('auto_lidarr_lookback_days') || 30),
    lastRun: Number(getSetting('auto_lidarr_last_run') || 0) || null,
  };
}
