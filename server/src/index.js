import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, DATA_DIR, getAllSettings, getSetting, setSetting } from './db.js';
import { runScan, scanStatus } from './scanner.js';
import { regroupDiscs } from './discgroup.js';
import { runIdentify, identifyOne, identifyStatus, setMatchState, restoreAlbum, manualMatch } from './identify.js';
import { runFullRefresh, refreshStatus } from './refresh.js';
import { lidarrTest, lidarrProfiles, lidarrSync, lidarrAdd, lidarrOwnedIds, lidarrReleases, lidarrGrab, enqueueLidarrAdd, lidarrAddStatus, resumeAddQueue } from './lidarr.js';
import { prowlarrTest, prowlarrSearch, prowlarrGrab } from './prowlarr.js';
import { jackettTest, jackettSearch } from './jackett.js';
import { qbTest, qbAdd } from './qbittorrent.js';
import { deleteAlbumFromDisk } from './albumdelete.js';
import { pendingImports, importFolder } from './importer.js';
import { mbTest, searchReleaseGroup, searchReleaseGroups, searchArtists, runBackground } from './musicbrainz.js';
import { acoustidTest } from './acoustid.js';
import { discogsTest, searchRelease } from './discogs.js';
import { lastfmTest } from './lastfm.js';
import {
  enrichAllDiscographies,
  enrichArtistDiscography,
  discographyStatus,
  artistCompleteness,
} from './discography.js';
import {
  followArtist,
  unfollowArtist,
  followByMbid,
  trackedList,
  isTracked,
  suggestedArtists,
} from './tracked.js';
import { gaps, upcoming, dismissGap, undismissGap, dismissedList } from './discover.js';
import { runAutoLidarr, autoLidarrStatus, autoLidarrConfig } from './automation.js';
import { importScrobbles, scrobbleStatus, scrobblesConfigured } from './scrobbles.js';
import { listeningOverview, ownershipGap, ownedUnplayed, hasScrobbles } from './listening.js';
import { addChallenge, listChallenges, challengeDetail, deleteChallenge, challengeMissing } from './challenges.js';
import { importListFromUrl } from './listimport.js';
import { artistRelations } from './relations.js';
import { albumEditions, upgradeCandidates, labelsOverview, labelAlbums, labelCompletism } from './editions.js';
import { previewAlbumTags, writeAlbumTags } from './tagwriter.js';
import { coverFast, resolveCoverSlow, retryMissingCovers } from './covers.js';
import { diagnostics, pushEvent } from './diag.js';
import * as q from './queries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const app = Fastify({ logger: { level: 'info' }, bodyLimit: 20 * 1024 * 1024 });

// --- autenticación básica opcional (idéntica en espíritu a PowaFlex) --------
const AUTH_OPEN_PATHS = new Set(['/api/version']);
if (process.env.LIDERARRR_AUTH) {
  const raw = process.env.LIDERARRR_AUTH.includes(':') ? process.env.LIDERARRR_AUTH : `liderarrr:${process.env.LIDERARRR_AUTH}`;
  const digest = (v) => crypto.createHash('sha256').update(v || '', 'utf-8').digest();
  const expected = digest(`Basic ${Buffer.from(raw, 'utf-8').toString('base64')}`);
  const FAILS_MAX = 10;
  const FAILS_WINDOW = 5 * 60 * 1000;
  const fails = new Map();
  const tooManyFails = (ip) => {
    const hits = (fails.get(ip) || []).filter((t) => Date.now() - t < FAILS_WINDOW);
    if (hits.length) fails.set(ip, hits);
    else fails.delete(ip);
    return hits.length >= FAILS_MAX;
  };
  app.addHook('onRequest', async (req, reply) => {
    if (AUTH_OPEN_PATHS.has((req.raw.url || '').split('?')[0])) return;
    const ip = req.ip || 'desconocida';
    if (crypto.timingSafeEqual(digest(req.headers.authorization), expected)) {
      fails.delete(ip);
      return;
    }
    if (tooManyFails(ip)) {
      reply.header('Retry-After', '300');
      return reply.code(429).send({ error: 'Demasiados intentos, prueba en unos minutos' });
    }
    fails.set(ip, [...(fails.get(ip) || []), Date.now()]);
    reply.header('WWW-Authenticate', 'Basic realm="Liderarrr", charset="UTF-8"');
    return reply.code(401).send({ error: 'No autorizado' });
  });
  console.log('[Liderarrr] Autenticación básica activada (LIDERARRR_AUTH)');
} else {
  console.warn(
    '[Liderarrr] SIN autenticación: cualquiera que alcance este puerto puede leer y CAMBIAR tus\n' +
    '           ajustes. Define LIDERARRR_AUTH="usuario:contraseña" si esto no está solo en tu red de casa.'
  );
}

// registra en el diagnóstico las peticiones lentas (>1.5s), para cazar cuellos de
// botella sin bucear en los logs. Se ignora el sondeo de estado del escaneo.
app.addHook('onResponse', async (req, reply) => {
  const rt = reply.elapsedTime || 0;
  const url = req.raw.url || '';
  if (rt > 1500 && url.startsWith('/api/') && !url.includes('/status')) {
    pushEvent('slow', `${req.method} ${url} — ${Math.round(rt)}ms`);
  }
});

// --- meta -------------------------------------------------------------------
app.get('/api/version', async () => ({ name: 'Liderarrr', version: pkg.version }));
app.get('/api/diag', async () => diagnostics());

app.get('/api/setup-state', async () => {
  const s = getAllSettings();
  return {
    music: !!s.music_dirs,
    lidarr: !!(s.lidarr_url && s.lidarr_key),
    prowlarr: !!(s.prowlarr_url && s.prowlarr_key),
    acoustid: !!s.acoustid_key,
    lastfm: !!s.lastfm_key,
    discogs: !!s.discogs_token,
    scanned: db.prepare('SELECT COUNT(*) AS n FROM albums').get().n > 0,
  };
});

// --- ajustes ----------------------------------------------------------------
const SECRET_KEYS = new Set(['lidarr_key', 'prowlarr_key', 'jackett_key', 'qbittorrent_pass', 'lastfm_key', 'lastfm_secret', 'acoustid_key', 'discogs_token', 'plex_token']);
app.get('/api/settings', async () => {
  const raw = getAllSettings();
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    // no devolvemos secretos en claro: solo si están puestos
    out[k] = SECRET_KEYS.has(k) ? (v ? '••••••••' : '') : v;
  }
  return out;
});

app.put('/api/settings', async (req) => {
  const body = req.body || {};
  for (const [k, v] of Object.entries(body)) {
    if (SECRET_KEYS.has(k) && v === '••••••••') continue; // no sobrescribas con el placeholder
    setSetting(k, v === '' ? null : v);
  }
  return { ok: true };
});

app.post('/api/settings/test/:service', async (req, reply) => {
  try {
    const svc = req.params.service;
    const map = {
      lidarr: lidarrTest,
      prowlarr: prowlarrTest,
      jackett: jackettTest,
      qbittorrent: qbTest,
      musicbrainz: mbTest,
      acoustid: acoustidTest,
      discogs: discogsTest,
      lastfm: lastfmTest,
    };
    if (!map[svc]) return reply.code(404).send({ error: 'Servicio desconocido' });
    return await map[svc]();
  } catch (err) {
    return reply.code(400).send({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/lidarr/profiles', async (req, reply) => {
  try {
    return await lidarrProfiles();
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});

// --- escaneo / identificación / refresco ------------------------------------
app.post('/api/scan', async (req) => {
  runScan({ force: !!req.body?.force }).catch((e) => console.error('scan', e));
  return { started: true };
});
app.get('/api/scan/status', async () => {
  let lastScan = null;
  try {
    lastScan = JSON.parse(getSetting('last_scan') || 'null');
  } catch {
    /* ignore */
  }
  return {
    ...scanStatus,
    totalAlbums: db.prepare('SELECT COUNT(*) AS n FROM albums').get().n,
    totalArtists: db.prepare('SELECT COUNT(DISTINCT artist_id) AS n FROM albums').get().n,
    lastScan,
  };
});

app.post('/api/identify', async (req) => {
  const force = !!(req.body && req.body.force);
  runIdentify({ force }).catch((e) => console.error('identify', e));
  return { started: true };
});
app.get('/api/identify/status', async () => identifyStatus);

app.post('/api/refresh', async (req) => {
  runFullRefresh(req.body?.trigger || 'manual').catch((e) => console.error('refresh', e));
  return { started: true };
});
app.get('/api/refresh/status', async () => refreshStatus);

// --- estadísticas y secciones -----------------------------------------------
app.get('/api/stats/overview', async () => q.overview());
app.get('/api/stats/charts', async () => q.charts());
app.get('/api/stats/recent', async () => q.recent());

app.get('/api/library', async (req) => q.library(req.query || {}));
app.get('/api/library/filters', async () => q.filterOptions());
app.get('/api/albums/:id', async (req, reply) => {
  const a = q.albumDetail(Number(req.params.id));
  if (!a) return reply.code(404).send({ error: 'No encontrado' });
  const owned = lidarrOwnedIds();
  a.inLidarr = a.rg_mbid ? owned.has(a.rg_mbid) : false;
  return a;
});
// grupo de duplicados de un álbum (para el panel al pinchar ×N en la Discoteca)
app.get('/api/albums/:id/dup-group', async (req, reply) => {
  const g = q.albumDupGroup(Number(req.params.id));
  if (!g) return reply.code(404).send({ error: 'No encontrado' });
  return g;
});

app.get('/api/artists', async (req) => q.artists(req.query || {}));
app.get('/api/artists/:id', async (req, reply) => {
  const id = Number(req.params.id);
  const a = q.artistDetail(id);
  if (!a) return reply.code(404).send({ error: 'No encontrado' });
  a.tracked = isTracked(id);
  const comp = artistCompleteness(id);
  a.completeness = { pct: comp.pct, stats: comp.stats, missing: comp.missing, upcoming: comp.upcoming };
  const owned = lidarrOwnedIds();
  for (const m of a.completeness.missing) m.in_lidarr = owned.has(m.rg_mbid);
  return a;
});
// recalcular la discografía de un artista bajo demanda
app.post('/api/artists/:id/refresh-discography', async (req, reply) => {
  try {
    const r = await enrichArtistDiscography(Number(req.params.id));
    return r || { error: 'El artista no tiene MBID (no está en MusicBrainz)' };
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});

// --- seguidos (favoritos) ---------------------------------------------------
app.get('/api/tracked', async () => trackedList());
app.get('/api/tracked/suggestions', async () => suggestedArtists());
app.post('/api/tracked/:id', async (req) => followArtist(Number(req.params.id), req.body?.facet || 'artist'));
app.delete('/api/tracked/:id', async (req) => unfollowArtist(Number(req.params.id), req.query?.facet || 'artist'));
app.post('/api/tracked/by-mbid', async (req, reply) => {
  try {
    return await followByMbid(req.body?.mbid, req.body?.facet || 'artist');
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.get('/api/artists/search-mb', async (req, reply) => {
  try {
    return await searchArtists(req.query?.q, 8);
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});

// --- discografías / huecos / próximos ---------------------------------------
app.post('/api/discography/refresh', async (req) => {
  enrichAllDiscographies({ onlyTracked: !!req.body?.onlyTracked }).catch((e) => console.error('disco', e));
  return { started: true };
});
app.get('/api/discography/status', async () => discographyStatus);
app.get('/api/discover/gaps', async (req) => gaps({ onlyTracked: req.query?.all !== '1' }));
app.get('/api/discover/upcoming', async (req) => upcoming({ onlyTracked: req.query?.all !== '1' }));
app.get('/api/discover/dismissed', async () => dismissedList());
app.post('/api/discover/dismiss', async (req) => dismissGap(req.body?.rg_mbid, req.body?.title));
app.delete('/api/discover/dismiss/:rgMbid', async (req) => undismissGap(req.params.rgMbid));

// --- auto-Lidarr ------------------------------------------------------------
app.get('/api/lidarr/auto', async () => ({ ...autoLidarrConfig(), status: autoLidarrStatus }));
app.post('/api/lidarr/auto/run', async (req) => {
  const cfg = autoLidarrConfig();
  return runAutoLidarr({ months: cfg.months, lookbackDays: cfg.lookbackDays, dryRun: !!req.body?.dryRun });
});

// --- fase 4: relaciones, ediciones/upgrades, sellos -------------------------
app.get('/api/artists/:id/relations', async (req, reply) => {
  try {
    return await artistRelations(Number(req.params.id));
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.get('/api/albums/:id/editions', async (req, reply) => {
  try {
    return await albumEditions(Number(req.params.id));
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.get('/api/quality/upgrades', async () => upgradeCandidates());
app.get('/api/labels', async () => labelsOverview());
app.get('/api/labels/:name', async (req) => labelAlbums(req.params.name));
// completismo del sello contra MusicBrainz (bajo demanda; puede tardar)
app.get('/api/labels/:name/completism', async (req, reply) => {
  try {
    return await labelCompletism(req.params.name);
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});

// escritura de etiquetas (MBID) — opt-in, solo matched, con preview
app.get('/api/albums/:id/tag-preview', async (req, reply) => {
  try {
    return await previewAlbumTags(Number(req.params.id));
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.post('/api/albums/:id/write-tags', async (req, reply) => {
  try {
    return await writeAlbumTags(Number(req.params.id));
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});

// --- escuchas (Last.fm) -----------------------------------------------------
app.post('/api/scrobbles/import', async (req) => {
  importScrobbles({ full: !!req.body?.full }).catch((e) => console.error('scrobbles', e));
  return { started: true };
});
app.get('/api/scrobbles/status', async () => ({ ...scrobbleStatus, configured: scrobblesConfigured() }));
app.get('/api/listening/overview', async () => (hasScrobbles() ? listeningOverview() : { empty: true }));
app.get('/api/listening/gap', async (req) => ownershipGap({ minPlays: Number(req.query?.minPlays) || 15 }));
app.get('/api/listening/unplayed', async () => ownedUnplayed());

// --- retos ------------------------------------------------------------------
app.get('/api/challenges', async () => listChallenges());
app.post('/api/challenges', async (req, reply) => {
  try {
    return addChallenge(req.body?.name, req.body?.text);
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
// importar una lista por URL (AOTY y similares) vía lector que ejecuta JS
app.post('/api/challenges/import', async (req, reply) => {
  try {
    return await importListFromUrl(req.body?.url, req.body?.name);
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.get('/api/challenges/:id', async (req, reply) => {
  const c = challengeDetail(Number(req.params.id));
  if (!c) return reply.code(404).send({ error: 'No encontrado' });
  return c;
});
app.delete('/api/challenges/:id', async (req) => deleteChallenge(Number(req.params.id)));
// Resuelve los faltantes contra MusicBrainz y los encola a Lidarr EN SEGUNDO PLANO.
// Antes era bloqueante (resolución MB a 1 req/s + lidarrAdd de decenas de s por ítem
// dentro del request → un reto grande colgaba minutos). Ahora responde al instante y
// el progreso se ve en la cola de Lidarr (Diagnóstico / sondeo).
app.post('/api/challenges/:id/radarr', async (req, reply) => {
  try {
    const missing = challengeMissing(Number(req.params.id));
    runBackground(async () => {
      for (const m of missing) {
        try {
          const rg = await searchReleaseGroup(m.artist, m.album);
          if (rg && rg.score >= 80) enqueueLidarrAdd([{ rg_mbid: rg.rg_mbid, artist_mbid: rg.artist_mbid }]);
          else console.warn(`[reto] sin coincidencia MB fiable: ${m.artist} — ${m.album}`);
        } catch (e) {
          console.warn(`[reto] fallo resolviendo ${m.artist} — ${m.album}: ${String(e.message || e)}`);
        }
      }
    }).catch((e) => console.warn('[reto] resolución en 2º plano falló:', String(e.message || e)));
    return { queued: missing.length, background: true };
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
// Envío de UN ítem de reto (o cualquier artista+álbum) a Lidarr: resuelve en MB y
// encola (no bloqueante). Devuelve {ok:false} si MB no da coincidencia fiable.
app.post('/api/lidarr/add-by-name', async (req, reply) => {
  try {
    const { artist, album } = req.body || {};
    if (!album) return reply.code(400).send({ error: 'Falta el álbum' });
    const rg = await searchReleaseGroup(artist, album);
    if (!rg || rg.score < 80) return { ok: false, reason: 'sin coincidencia fiable en MusicBrainz' };
    enqueueLidarrAdd([{ rg_mbid: rg.rg_mbid, artist_mbid: rg.artist_mbid }]);
    return { ok: true, queued: 1, title: rg.title };
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});

app.get('/api/incomplete', async () => q.incomplete());
app.get('/api/quality/overview', async () => q.qualityOverview());
app.get('/api/quality/duplicates', async () => q.duplicates());
app.get('/api/unidentified', async () => q.unidentified());
app.get('/api/rarities', async () => q.rarities());

// marcar estado (rareza/orphan, descartar, devolver a pendiente)
app.post('/api/albums/:id/state', async (req, reply) => {
  try {
    return setMatchState(Number(req.params.id), req.body?.state);
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
// papelera: listar descartados y restaurar uno (deshacer un "Descartar")
app.get('/api/dismissed', async () => q.dismissedAlbums());
app.post('/api/albums/:id/restore', async (req, reply) => {
  try {
    return restoreAlbum(Number(req.params.id));
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
// BORRAR DEL DISCO (irreversible): exige confirm:true; solo borra dentro de la
// biblioteca; si no puede, no toca la BD. Ver albumdelete.js.
app.post('/api/albums/:id/delete', async (req, reply) => {
  try {
    return deleteAlbumFromDisk(Number(req.params.id), { confirm: req.body?.confirm === true });
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});

// resolución manual asistida: candidatos de MusicBrainz + Discogs
app.get('/api/albums/:id/candidates', async (req, reply) => {
  const a = q.albumDetail(Number(req.params.id));
  if (!a) return reply.code(404).send({ error: 'No encontrado' });
  try {
    const [mbHit, dcHit] = await Promise.all([
      searchReleaseGroup(a.album_artist, a.title).catch(() => null),
      searchRelease(a.album_artist, a.title).catch(() => null),
    ]);
    return { musicbrainz: mbHit, discogs: dcHit };
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.post('/api/albums/:id/match', async (req, reply) => {
  try {
    return await manualMatch(Number(req.params.id), req.body?.rg_mbid);
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
// búsqueda libre de release groups en MusicBrainz para "elegir a mano" (lista)
app.get('/api/mb/release-groups', async (req, reply) => {
  try {
    return await searchReleaseGroups(req.query?.q, req.query?.artist || null);
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
// identificar UN álbum bajo demanda (carril rápido, no el barrido)
app.post('/api/albums/:id/identify', async (req, reply) => {
  try {
    return await identifyOne(Number(req.params.id));
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
// búsqueda interactiva de Lidarr: releases de los indexers para este álbum
app.get('/api/albums/:id/lidarr-releases', async (req, reply) => {
  const a = q.albumDetail(Number(req.params.id));
  if (!a) return reply.code(404).send({ error: 'No encontrado' });
  if (!a.rg_mbid) return reply.code(400).send({ error: 'El álbum no está identificado (sin MBID)' });
  try {
    return await lidarrReleases(a.rg_mbid, a.artist?.mbid || null);
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});

// --- Lidarr (actuador) ------------------------------------------------------
app.post('/api/lidarr/sync', async (req, reply) => {
  try {
    return await lidarrSync();
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
// encola el envío (Lidarr es lento): responde al instante, se procesa en 2º plano
app.post('/api/lidarr/add', async (req, reply) => {
  const { rg_mbid, artist_mbid } = req.body || {};
  if (!rg_mbid) return reply.code(400).send({ error: 'Falta rg_mbid' });
  return enqueueLidarrAdd([{ rg_mbid, artist_mbid }]);
});
app.get('/api/lidarr/add/status', async () => lidarrAddStatus);
// descargar (grab) una release elegida en la búsqueda interactiva
app.post('/api/lidarr/grab', async (req, reply) => {
  try {
    const { guid, indexerId } = req.body || {};
    return await lidarrGrab({ guid, indexerId });
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});

// --- Prowlarr (buscar y descargar sin pasar por el filtro de Lidarr) ---------
app.get('/api/prowlarr/search', async (req, reply) => {
  try {
    return await prowlarrSearch(req.query?.q);
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.post('/api/prowlarr/grab', async (req, reply) => {
  try {
    const { guid, indexerId } = req.body || {};
    return await prowlarrGrab({ guid, indexerId });
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});

// --- Búsqueda unificada: usa el motor elegido en Ajustes (Prowlarr | Jackett) -----
// La UI no necesita saber el motor: pide /search y agarra con /search/grab, que enruta
// (Prowlarr empuja a su cliente; Jackett -> qBittorrent, que hace la descarga).
app.get('/api/search', async (req, reply) => {
  try {
    const engine = getSetting('search_engine') || 'prowlarr';
    const results = engine === 'jackett' ? await jackettSearch(req.query?.q) : await prowlarrSearch(req.query?.q);
    return { engine, results };
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.post('/api/search/grab', async (req, reply) => {
  try {
    const { engine, guid, indexerId, downloadUrl } = req.body || {};
    if (engine === 'jackett') {
      await qbAdd({ url: downloadUrl });
      return { ok: true, via: 'qbittorrent' };
    }
    await prowlarrGrab({ guid, indexerId });
    return { ok: true, via: 'prowlarr' };
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});

// --- Importar descargas (hardlink torrents/music -> media/music) -------------
app.get('/api/imports/pending', async (req, reply) => {
  try {
    return await pendingImports();
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.post('/api/imports/run', async (req, reply) => {
  try {
    const { sourceDir, artist, album, year } = req.body || {};
    const override = {};
    if (artist != null) override.artist = artist;
    if (album != null) override.album = album;
    if (year != null && year !== '') override.year = Number(year);
    return await importFolder(sourceDir, override);
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.post('/api/lidarr/add-bulk', async (req, reply) => {
  const items = req.body?.items || [];
  if (!items.length) return reply.code(400).send({ error: 'Nada que añadir' });
  return enqueueLidarrAdd(items);
});

// --- imágenes locales (carátulas: fichero o incrustada en etiquetas) --------
// Sirve al INSTANTE lo que está en local/caché; si hace falta la resolución cara
// (leer el fichero + Cover Art Archive/iTunes), la lanza en segundo plano y responde
// 404 ya — así navegar nunca se cuelga esperando carátulas online. Aparecerá al
// recargar (la UI reintenta sola los 404 tras un momento).
app.get('/api/cover/:id', async (req, reply) => {
  const id = Number(req.params.id);
  const r = coverFast(id);
  if (r.status === 'ok') {
    reply.header('Content-Type', r.contentType);
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(r.path));
  }
  if (r.status === 'pending') resolveCoverSlow(id).catch(() => {});
  return reply.code(404).send();
});

// vuelve a intentar las carátulas que no se encontraron (útil tras identificar)
app.post('/api/covers/retry-missing', async () => ({ retried: retryMissingCovers() }));

// --- copia de seguridad -----------------------------------------------------
app.get('/api/backup/database', async (req, reply) => {
  const file = path.join(DATA_DIR, 'liderarrr.db');
  reply.header('Content-Disposition', 'attachment; filename="liderarrr.db"');
  reply.header('Content-Type', 'application/octet-stream');
  return reply.send(fs.createReadStream(file));
});

// --- SPA estática -----------------------------------------------------------
const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'No encontrado' });
    return reply.sendFile('index.html');
  });
}

// --- cron nocturno (03:00) --------------------------------------------------
function scheduleNightly() {
  const check = () => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 0 && !refreshStatus.running) {
      console.log('[Liderarrr] Refresco nocturno');
      runFullRefresh('nightly').catch((e) => console.error('nightly', e));
    }
  };
  setInterval(check, 60 * 1000);
}

// Errores fatales: los logueamos para que se VEAN. Antes, un error no capturado
// tumbaba el proceso y en los logs solo aparecía el crash del destructor de
// better-sqlite3, ocultando la causa real. No salimos: preferimos seguir vivos.
process.on('uncaughtException', (e) => console.error('[fatal] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[fatal] unhandledRejection:', e));

// Cierre limpio al parar el contenedor: cierra la BD para que better-sqlite3 no
// pete con una aserción en su destructor durante el apagado.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    try {
      db.close();
    } catch {
      /* noop */
    }
    process.exit(0);
  });
}

const PORT = Number(process.env.PORT) || 3861;
app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    console.log(`[Liderarrr] escuchando en http://0.0.0.0:${PORT}`);
    scheduleNightly();
    // backfill de multidiscos: reagrupa cajas sobre lo ya escaneado, sin exigir un
    // reescaneo completo. Diferido para no retrasar el primer request. Solo lectura.
    setImmediate(() => {
      try {
        regroupDiscs();
      } catch (e) {
        console.warn('[discgroup] backfill al arrancar falló:', String(e.message || e));
      }
      try {
        resumeAddQueue(); // reanuda una tanda de envío a Lidarr que quedara a medias
      } catch (e) {
        console.warn('[lidarr] no se pudo reanudar la cola:', String(e.message || e));
      }
    });
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
