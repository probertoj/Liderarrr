import { getSetting, setSetting } from './db.js';
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
import { runWantedWatch, wantedConfig, wantedStatus, wantedCounts } from './wanted.js';
import { refreshExternalReleases } from './newreleases.js';
import { refreshGlobalReleases } from './globalradar.js';
import { refreshSpotifyLibrary, spotifyUserConnected } from './spotifyuser.js';
import { refreshArtistSuggestions } from './suggest.js';
import { lastfmConfigured } from './lastfm.js';
import { sendNotification } from './notify.js';
import { barrerHuerfanos, resumenHuerfanos } from './orphans.js';
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

// Hora del refresco nocturno, configurable en Ajustes (0–23; de fábrica las 3 de la
// madrugada, cuando nadie está escuchando música). Se relee en cada comprobación, así que
// cambiarla en Ajustes aplica sin reiniciar.
export function nightlyConfig() {
  const crudo = getSetting('nightly_hour');
  const n = Number(crudo);
  // Cuidado: la medianoche es la hora 0, y `Number(null) || 3` la convertiría en las 3.
  // Hay que mirar si el ajuste está PUESTO, no si su valor es cero.
  const hour = crudo == null || crudo === '' || !Number.isFinite(n) ? 3 : Math.min(23, Math.max(0, Math.round(n)));
  return { hour, lastRun: Number(getSetting('nightly_last_run')) || null };
}

// ¿Toca la pasada nocturna? Antes esto exigía la hora Y el minuto en punto, así que un
// contenedor arrancado a las 03:00:30 se saltaba la pasada entera hasta el día siguiente.
// Ahora basta con acertar la HORA —una vez al día, por el guard de 20 h— y, si por lo que
// sea no se dio (app parada a esa hora, o la hora recién cambiada), a las 36 h se lanza
// igual. En una instalación nueva no hay pasada previa: espera a su hora en vez de ponerse
// a machacar MusicBrainz mientras el usuario aún está configurando.
export function tocaRefresco(ahora = new Date()) {
  const cfg = nightlyConfig();
  if (!cfg.lastRun) return ahora.getHours() === cfg.hour;
  const horas = (ahora.getTime() - cfg.lastRun) / 3600000;
  if (horas < 20) return false;
  return ahora.getHours() === cfg.hour || horas >= 36;
}

function buildSteps() {
  return [
    {
      key: 'autoimport',
      label: 'Auto-importar descargas terminadas',
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
        // reintentar: además de los nuevos, una tanda de los que fallaron hace tiempo. Antes
        // un disco que fallaba no se volvía a mirar nunca salvo que pulsaras el botón.
        const r = await runIdentify({ force: false, reintentar: true });
        if (r.error) throw new Error(r.error);
        const extra = identifyStatus.reintentos ? ` (${identifyStatus.reintentos} reintentos)` : '';
        return `${identifyStatus.matched} identificados · ${identifyStatus.unmatched} sin coincidencia${extra}`;
      },
    },
    {
      // Aquí y no al final: escanear e identificar son los pasos que BORRAN álbumes, y lo
      // que viene después (discografías, completismo) es justo quien lee si un disco es
      // tuyo. Barrer en medio evita que un puntero a una copia borrada cuente como tuya.
      key: 'limpieza',
      label: 'Recoger restos sueltos en la base',
      enabled: () => true,
      run: async () => {
        const r = barrerHuerfanos();
        const linea = resumenHuerfanos(r);
        // console.log pasa por diag.js: si algo se recogió, queda en Diagnóstico.
        if (linea) console.log(`[limpieza] ${linea}`);
        if (!linea) return 'nada suelto';
        return `${r.borrados} borradas · ${r.soltados} punteros soltados${r.avisados ? ` · ${r.avisados} por revisar` : ''}`;
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
      label: 'Discos y canciones nuevas de tu colección (Deezer)',
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
      label: 'Radar de descubrimiento (estrenos de artistas similares y de tus sellos)',
      // fuente: estrenos de tus similares (artist_suggestions) + artistas de tus sellos, vía
      // Deezer. Se activa si hay similares o sellos seguidos.
      enabled: () =>
        !!db.prepare('SELECT 1 FROM artist_suggestions WHERE dismissed = 0 LIMIT 1').get() ||
        !!db.prepare('SELECT 1 FROM label_release_groups LIMIT 1').get(),
      run: async () => {
        const r = await refreshGlobalReleases();
        return `${r.count} novedades globales (${r.added} nuevas)`;
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
      key: 'wanted',
      label: 'Buscar los discos de «Lo quiero»',
      enabled: () => wantedConfig().enabled && wantedCounts().watching > 0,
      run: async () => {
        // force: en la pasada nocturna se revisan TODOS los deseos, sin esperar a la
        // cadencia de reintento. Es la ronda grande del día.
        const r = await runWantedWatch({ force: true, limit: 60 });
        if (r.error) throw new Error(r.error);
        return `${wantedStatus.grabbed} agarrados de ${wantedStatus.checked} deseos revisados`;
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
  // Se apunta AL EMPEZAR, no al acabar: si la pasada muere a medias, que no se reintente
  // cada minuto el resto de la noche.
  if (trigger === 'nightly') setSetting('nightly_last_run', String(Date.now()));
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
