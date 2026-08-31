import { getSetting } from './db.js';
import { runScan, scanStatus } from './scanner.js';
import { runIdentify, identifyStatus } from './identify.js';
import { lidarrSync } from './lidarr.js';
import { enrichAllDiscographies, discographyStatus } from './discography.js';
import { runAutoLidarr, autoLidarrStatus, autoLidarrConfig } from './automation.js';
import { importListens, scrobbleStatus, scrobblesConfigured } from './scrobbles.js';
import { refreshAllLabels } from './followlabels.js';
import { refreshAllCurators } from './radar.js';
import { runAutoImport, autoImportEnabled, autoImportStatus } from './autoimport.js';
import { runAutoGrab, autoGrabConfig, autoGrabStatus } from './autograb.js';
import { refreshExternalReleases } from './newreleases.js';
import { refreshGlobalReleases } from './globalradar.js';
import { spotifyConfigured } from './spotify.js';
import { refreshSpotifyLibrary, spotifyUserConnected } from './spotifyuser.js';
import { refreshArtistSuggestions } from './suggest.js';
import { lastfmConfigured } from './lastfm.js';
import { sendNotification } from './notify.js';
import { db } from './db.js';

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
      key: 'autoimport',
      label: 'Auto-importar descargas terminadas (qBittorrent)',
      enabled: () => autoImportEnabled(),
      run: async () => {
        await runAutoImport();
        return `${autoImportStatus.imported} importadas · ${autoImportStatus.errors.length} con error`;
      },
    },
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
      label: 'Importar escuchas (Last.fm / ListenBrainz)',
      enabled: () => scrobblesConfigured(),
      run: async () => {
        const r = await importListens({ full: false });
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
      key: 'labels',
      label: 'Actualizar catálogo de sellos seguidos',
      enabled: () => !!db.prepare('SELECT 1 FROM tracked_labels LIMIT 1').get(),
      run: async () => {
        const r = await refreshAllLabels();
        return `${r.done} sellos al día de ${r.total}`;
      },
    },
    {
      key: 'radar',
      label: 'Actualizar radar de curadores (Bandcamp)',
      enabled: () => !!db.prepare('SELECT 1 FROM curators LIMIT 1').get(),
      run: async () => {
        const r = await refreshAllCurators();
        return `${r.done}/${r.total} curadores · ${r.added} novedades`;
      },
    },
    {
      key: 'newreleases',
      // barre estrenos/singles de TODA la colección (seguidos + artistas con álbumes), por
      // rotación; se activa si sigues a alguien O si tienes algún artista en la biblioteca.
      label: 'Novedades y singles de tu colección (Deezer/Spotify)',
      enabled: () =>
        !!db.prepare("SELECT 1 FROM tracked_artists WHERE facet = 'artist' LIMIT 1").get() ||
        !!db.prepare("SELECT 1 FROM albums WHERE match_state != 'dismissed' LIMIT 1").get(),
      run: async () => {
        const r = await refreshExternalReleases();
        // aviso solo en el ciclo nocturno (en el manual el usuario ya está delante), DETALLADO:
        // enumera qué estrenos entraron (Artista — Álbum), con «…y N más» si son muchos.
        if (r.added > 0 && refreshStatus.trigger === 'nightly') {
          const items = (r.addedItems || []).slice(0, 15);
          const lines = items.map((it) => `• ${it.artist} — ${it.title}`);
          if (r.added > items.length) lines.push(`…y ${r.added - items.length} más`);
          const header =
            r.added === 1 ? 'Nueva novedad de tu colección en «Lanzamientos»:' : `${r.added} novedades nuevas en «Lanzamientos»:`;
          sendNotification('Liderarr', `${header}\n${lines.join('\n')}`).catch(() => {});
        }
        return `${r.count} novedades (${r.added} nuevas) de ${r.seeds} artistas`;
      },
    },
    {
      // solo trae y guarda el feed global; la afinidad se calcula EN VIVO al leer (usa tu
      // colección y las sugerencias «similares» del momento), así que el orden aquí da igual.
      key: 'globalradar',
      label: 'Radar de descubrimiento (estrenos de artistas similares + Spotify)',
      // fuente principal: estrenos de tus similares (artist_suggestions) vía Deezer; Spotify
      // es suplemento. Se activa si hay similares O Spotify configurado.
      enabled: () =>
        !!db.prepare('SELECT 1 FROM artist_suggestions WHERE dismissed = 0 LIMIT 1').get() || spotifyConfigured(),
      run: async () => {
        const r = await refreshGlobalReleases();
        return `${r.count} novedades globales (${r.added} nuevas)${r.spotify && r.spotify !== 'ok' ? ` · Spotify: ${r.spotify}` : ''}`;
      },
    },
    {
      key: 'spotify-library',
      label: 'Sincronizar tu biblioteca guardada de Spotify',
      enabled: () => spotifyUserConnected(),
      run: async () => {
        const r = await refreshSpotifyLibrary();
        if (r.skipped) return r.skipped;
        return `${r.count} álbumes guardados en Spotify`;
      },
    },
    {
      key: 'suggestions',
      label: 'Sugerir artistas para seguir (similares de Last.fm)',
      enabled: () => lastfmConfigured(),
      run: async () => {
        const r = await refreshArtistSuggestions();
        return r.skipped ? r.skipped : `${r.count} sugerencias de ${r.seeds} semillas`;
      },
    },
    {
      key: 'auto-grab',
      label: 'Auto-descargar estrenos de artistas seguidos (nativo)',
      enabled: () => autoGrabConfig().enabled,
      run: async () => {
        const r = await runAutoGrab();
        if (r.error) throw new Error(r.error);
        return `${autoGrabStatus.grabbed} agarrados de ${autoGrabStatus.considered} candidatos`;
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
