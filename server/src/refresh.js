import { getSetting } from './db.js';
import { runScan, scanStatus } from './scanner.js';
import { runIdentify, identifyStatus } from './identify.js';
import { lidarrSync } from './lidarr.js';
import { enrichAllDiscographies, discographyStatus } from './discography.js';
import { runAutoLidarr, autoLidarrStatus, autoLidarrConfig } from './automation.js';
import { importScrobbles, scrobbleStatus, scrobblesConfigured } from './scrobbles.js';

// La rutina "poner Liderarrr al día", en orden de dependencias: primero el disco
// (escáner), luego lo que lee de él (identificación), luego el snapshot de
// Lidarr. Una sola implementación compartida por el cron nocturno y el botón
// "Actualizar todo", para que no puedan divergir. Cada paso es opcional y aislado:
// si su integración no está configurada se salta, y si falla se anota y NO tumba
// a los demás (un tropiezo de MusicBrainz no debe costarte el escaneo).
export const refreshStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  step: null,
  stepIndex: 0,
  totalSteps: 0,
  steps: [],
  lastError: null,
  trigger: null,
};

const has = (...keys) => keys.every((k) => !!getSetting(k));

function buildSteps() {
  return [
    {
      key: 'scan',
      label: 'Escanear la biblioteca del disco',
      enabled: () => !!getSetting('music_dirs'),
      run: async () => {
        const r = await runScan();
        if (r.error) throw new Error(r.error);
        return `${scanStatus.albumsDone} álbumes · ${scanStatus.tracksDone} pistas`;
      },
    },
    {
      key: 'identify',
      label: 'Identificar álbumes pendientes',
      enabled: () => true, // siempre útil; usa lo que haya configurado
      run: async () => {
        const r = await runIdentify({ force: false });
        if (r.error) throw new Error(r.error);
        return `${identifyStatus.matched} identificados · ${identifyStatus.unmatched} sin coincidencia`;
      },
    },
    {
      key: 'scrobbles',
      label: 'Importar escuchas de Last.fm',
      enabled: () => scrobblesConfigured(),
      run: async () => {
        const r = await importScrobbles({ full: false });
        if (r.error) throw new Error(r.error);
        return `${scrobbleStatus.imported} escuchas nuevas`;
      },
    },
    {
      key: 'lidarr',
      label: 'Sincronizar snapshot de Lidarr',
      enabled: () => has('lidarr_url', 'lidarr_key'),
      run: async () => {
        const r = await lidarrSync();
        return `${r.count} álbumes en Lidarr`;
      },
    },
    {
      // discografías DESPUÉS de Lidarr: así el cruce con "ya encargado" está fresco
      key: 'discography',
      label: 'Calcular discografías y completismo',
      enabled: () => true,
      run: async () => {
        const r = await enrichAllDiscographies({ onlyTracked: false });
        if (r.error) throw new Error(r.error);
        return `${discographyStatus.done} artistas al día`;
      },
    },
    {
      key: 'auto-lidarr',
      label: 'Auto-Lidarr: encargar estrenos de artistas seguidos',
      enabled: () => autoLidarrConfig().enabled && has('lidarr_url', 'lidarr_key'),
      run: async () => {
        const cfg = autoLidarrConfig();
        const r = await runAutoLidarr({ months: cfg.months, lookbackDays: cfg.lookbackDays });
        if (r.error) throw new Error(r.error);
        return `${autoLidarrStatus.added} encargados de ${autoLidarrStatus.considered} candidatos`;
      },
    },
  ];
}

export async function runFullRefresh(trigger = 'manual') {
  if (refreshStatus.running) return refreshStatus;
  const steps = buildSteps();
  Object.assign(refreshStatus, {
    running: true,
    startedAt: Date.now(),
    finishedAt: null,
    step: null,
    stepIndex: 0,
    totalSteps: steps.length,
    steps: steps.map((s) => ({ key: s.key, label: s.label, state: 'pending', detail: null, ms: 0 })),
    lastError: null,
    trigger,
  });
  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const slot = refreshStatus.steps[i];
      refreshStatus.step = s.label;
      refreshStatus.stepIndex = i;
      if (!s.enabled()) {
        slot.state = 'skipped';
        continue;
      }
      slot.state = 'running';
      const t0 = Date.now();
      try {
        slot.detail = await s.run();
        slot.state = 'done';
      } catch (err) {
        slot.state = 'error';
        slot.detail = String(err.message || err);
        refreshStatus.lastError = slot.detail;
      } finally {
        slot.ms = Date.now() - t0;
      }
    }
  } finally {
    refreshStatus.running = false;
    refreshStatus.finishedAt = Date.now();
    refreshStatus.step = null;
  }
  return refreshStatus;
}
