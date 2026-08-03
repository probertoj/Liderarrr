import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, DATA_DIR, getAllSettings, getSetting, setSetting } from './db.js';
import { runScan, scanStatus } from './scanner.js';
import { runIdentify, identifyStatus, setMatchState, manualMatch } from './identify.js';
import { runFullRefresh, refreshStatus } from './refresh.js';
import { lidarrTest, lidarrProfiles, lidarrSync, lidarrAdd, lidarrOwnedIds } from './lidarr.js';
import { mbTest, searchReleaseGroup, searchArtists } from './musicbrainz.js';
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
import { artistRelations } from './relations.js';
import { albumEditions, upgradeCandidates, labelsOverview, labelAlbums } from './editions.js';
import { previewAlbumTags, writeAlbumTags } from './tagwriter.js';
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

// --- meta -------------------------------------------------------------------
app.get('/api/version', async () => ({ name: 'Liderarrr', version: pkg.version }));

app.get('/api/setup-state', async () => {
  const s = getAllSettings();
  return {
    music: !!s.music_dirs,
    lidarr: !!(s.lidarr_url && s.lidarr_key),
    acoustid: !!s.acoustid_key,
    lastfm: !!s.lastfm_key,
    discogs: !!s.discogs_token,
    scanned: db.prepare('SELECT COUNT(*) AS n FROM albums').get().n > 0,
  };
});

// --- ajustes ----------------------------------------------------------------
const SECRET_KEYS = new Set(['lidarr_key', 'lastfm_key', 'lastfm_secret', 'acoustid_key', 'discogs_token', 'plex_token']);
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
app.post('/api/scan', async () => {
  runScan().catch((e) => console.error('scan', e));
  return { started: true };
});
app.get('/api/scan/status', async () => scanStatus);

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
app.get('/api/challenges/:id', async (req, reply) => {
  const c = challengeDetail(Number(req.params.id));
  if (!c) return reply.code(404).send({ error: 'No encontrado' });
  return c;
});
app.delete('/api/challenges/:id', async (req) => deleteChallenge(Number(req.params.id)));
// resuelve los que faltan contra MusicBrainz y los manda a Lidarr en bloque
app.post('/api/challenges/:id/radarr', async (req, reply) => {
  try {
    const missing = challengeMissing(Number(req.params.id));
    let added = 0;
    const errors = [];
    for (const m of missing) {
      try {
        const rg = await searchReleaseGroup(m.artist, m.album);
        if (rg && rg.score >= 80) {
          await lidarrAdd(rg.rg_mbid, rg.artist_mbid);
          added++;
        } else {
          errors.push({ item: `${m.artist} — ${m.album}`, error: 'sin coincidencia fiable en MusicBrainz' });
        }
      } catch (err) {
        errors.push({ item: `${m.artist} — ${m.album}`, error: String(err.message || err) });
      }
    }
    return { added, total: missing.length, errors: errors.slice(0, 20) };
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

// --- Lidarr (actuador) ------------------------------------------------------
app.post('/api/lidarr/sync', async (req, reply) => {
  try {
    return await lidarrSync();
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.post('/api/lidarr/add', async (req, reply) => {
  try {
    const { rg_mbid, artist_mbid } = req.body || {};
    if (!rg_mbid) return reply.code(400).send({ error: 'Falta rg_mbid' });
    return await lidarrAdd(rg_mbid, artist_mbid);
  } catch (err) {
    return reply.code(400).send({ error: String(err.message || err) });
  }
});
app.post('/api/lidarr/add-bulk', async (req, reply) => {
  const items = req.body?.items || [];
  if (!items.length) return reply.code(400).send({ error: 'Nada que añadir' });
  let added = 0;
  let pending = 0;
  const errors = [];
  for (const it of items) {
    try {
      const r = await lidarrAdd(it.rg_mbid, it.artist_mbid);
      if (r.pending) pending++;
      else added++;
    } catch (err) {
      errors.push({ rg_mbid: it.rg_mbid, error: String(err.message || err) });
    }
  }
  return { added, pending, total: items.length, errors };
});

// --- imágenes locales (carátulas) -------------------------------------------
app.get('/api/cover/:id', async (req, reply) => {
  const row = db.prepare('SELECT cover FROM albums WHERE id = ?').get(Number(req.params.id));
  if (!row?.cover || !fs.existsSync(row.cover)) return reply.code(404).send();
  const ext = path.extname(row.cover).slice(1).toLowerCase();
  reply.header('Content-Type', `image/${ext === 'jpg' ? 'jpeg' : ext}`);
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(fs.createReadStream(row.cover));
});

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

const PORT = Number(process.env.PORT) || 3861;
app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    console.log(`[Liderarrr] escuchando en http://0.0.0.0:${PORT}`);
    scheduleNightly();
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
