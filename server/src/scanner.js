import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFile } from 'music-metadata';
import { db, getSetting, setSetting } from './db.js';

// El escáner es la espina dorsal: TUS FICHEROS MANDAN. Recorre la raíz de música,
// agrupa por carpeta (una carpeta = un álbum, el caso normal), lee las etiquetas
// de cada pista y vuelca artistas/álbumes/pistas a SQLite. No consulta ninguna
// base externa: eso es identificación, y va después (identify.js). Un álbum sin
// MBID existe igual; las maquetas nunca desaparecen.
//
// Es INCREMENTAL y REANUDABLE: se salta las carpetas ya escaneadas que no han
// cambiado (por fecha de modificación), así una pasada interrumpida (actualización
// del contenedor, reinicio) no empieza de cero — cada pasada avanza. Clave para
// bibliotecas enormes por red, donde un escaneo completo tarda mucho.

const AUDIO_EXT = new Set([
  '.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.oga', '.wav', '.wv', '.ape',
  '.alac', '.aiff', '.aif', '.dsf', '.dff', '.mpc', '.tak', '.tta', '.wma',
]);
const COVER_NAMES = ['cover', 'folder', 'front', 'albumart', 'album'];

export const scanStatus = {
  running: false,
  phase: 'idle', // idle | walking | reading | done | error
  foldersFound: 0,
  albumsDone: 0,
  tracksDone: 0,
  skipped: 0, // carpetas sin cambios que nos saltamos
  current: null,
  startedAt: null,
  finishedAt: null,
  error: null,
};

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const isAudio = (f) => AUDIO_EXT.has(path.extname(f).toLowerCase());
const isLossless = (fmt) => /flac|alac|wav|ape|wavpack|aiff|pcm/i.test(fmt || '');

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && isAudio(e.name)) files.push(full);
  }
  if (files.length) out.push({ dir, files });
  return out;
}

function findCover(dir, files) {
  try {
    for (const f of fs.readdirSync(dir)) {
      const ext = path.extname(f).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
      const base = path.basename(f, ext).toLowerCase();
      if (COVER_NAMES.some((n) => base.includes(n))) return path.join(dir, f);
    }
  } catch {
    /* noop */
  }
  return null;
}

const upsertArtist = db.prepare(
  `INSERT INTO artists (name, sort_name) VALUES (?, ?)
   ON CONFLICT DO NOTHING`
);
const findArtistByName = db.prepare('SELECT id FROM artists WHERE name = ? COLLATE NOCASE LIMIT 1');
const findArtistByMbid = db.prepare('SELECT id FROM artists WHERE mbid = ? LIMIT 1');
const setArtistMbid = db.prepare('UPDATE artists SET mbid = ? WHERE id = ? AND mbid IS NULL');

function resolveLocalArtist(name, mbid) {
  if (mbid) {
    const byMbid = findArtistByMbid.get(mbid);
    if (byMbid) return byMbid.id;
  }
  if (!name) name = 'Artista desconocido';
  const existing = findArtistByName.get(name);
  if (existing) {
    if (mbid) setArtistMbid.run(mbid, existing.id);
    return existing.id;
  }
  const info = upsertArtist.run(name, name);
  const row = findArtistByName.get(name);
  if (mbid && row) setArtistMbid.run(mbid, row.id);
  return row ? row.id : Number(info.lastInsertRowid);
}

const upsertAlbum = db.prepare(`
INSERT INTO albums (local_key, path, artist_id, album_artist, title, year, rg_mbid, release_mbid,
  track_count, track_file_count, disc_count, size_bytes, duration_ms, added_at, scanned_at, cover, match_state)
VALUES (@local_key, @path, @artist_id, @album_artist, @title, @year, @rg_mbid, @release_mbid,
  @track_count, @track_file_count, @disc_count, @size_bytes, @duration_ms, @added_at, @scanned_at, @cover,
  COALESCE((SELECT match_state FROM albums WHERE local_key = @local_key), 'pending'))
ON CONFLICT(local_key) DO UPDATE SET
  path=excluded.path, artist_id=excluded.artist_id, album_artist=excluded.album_artist,
  title=excluded.title, year=excluded.year,
  rg_mbid=COALESCE(albums.rg_mbid, excluded.rg_mbid),
  release_mbid=COALESCE(albums.release_mbid, excluded.release_mbid),
  track_count=excluded.track_count, track_file_count=excluded.track_file_count,
  disc_count=excluded.disc_count, size_bytes=excluded.size_bytes, duration_ms=excluded.duration_ms,
  scanned_at=excluded.scanned_at, cover=excluded.cover
`);
const getAlbumId = db.prepare('SELECT id FROM albums WHERE local_key = ?');
const clearTracks = db.prepare('DELETE FROM tracks WHERE album_id = ?');
const insertTrack = db.prepare(`
INSERT INTO tracks (album_id, disc, num, title, artist, duration_ms, path, format, codec,
  bitrate, sample_rate, bit_depth, channels, size_bytes, lossless, has_replaygain, mb_recording_id)
VALUES (@album_id, @disc, @num, @title, @artist, @duration_ms, @path, @format, @codec,
  @bitrate, @sample_rate, @bit_depth, @channels, @size_bytes, @lossless, @has_replaygain, @mb_recording_id)
`);
const insertGenre = db.prepare("INSERT INTO tags (type, name) VALUES ('genre', ?) ON CONFLICT DO NOTHING");
const getGenreId = db.prepare("SELECT id FROM tags WHERE type = 'genre' AND name = ?");
const linkTag = db.prepare('INSERT INTO album_tags (album_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING');

async function ingestFolder({ dir, files }) {
  const tracks = [];
  let totalSize = 0;
  let totalDur = 0;
  const genres = new Set();
  let albumMeta = { album: null, albumArtist: null, artist: null, year: null, rgMbid: null, relMbid: null, artistMbid: null, totalTracks: null, discs: 1 };

  for (const file of files) {
    let meta;
    try {
      meta = await parseFile(file, { duration: true, skipCovers: true });
    } catch {
      meta = { common: {}, format: {} };
    }
    const c = meta.common || {};
    const f = meta.format || {};
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      /* noop */
    }
    totalSize += size;
    totalDur += (f.duration || 0) * 1000;
    for (const g of c.genre || []) genres.add(g);

    const fmt = (path.extname(file).slice(1) || f.container || '').toUpperCase();
    tracks.push({
      disc: c.disk?.no || 1,
      num: c.track?.no || null,
      title: c.title || path.basename(file, path.extname(file)),
      artist: (c.artists && c.artists.join(', ')) || c.artist || null,
      duration_ms: Math.round((f.duration || 0) * 1000),
      path: file,
      format: fmt,
      codec: f.codec || f.container || null,
      bitrate: f.bitrate ? Math.round(f.bitrate) : null,
      sample_rate: f.sampleRate || null,
      bit_depth: f.bitsPerSample || null,
      channels: f.numberOfChannels || null,
      size_bytes: size,
      lossless: f.lossless || isLossless(f.codec || fmt) ? 1 : 0,
      has_replaygain: c.replaygain_track_gain != null || c.replaygain_album_gain != null ? 1 : 0,
      mb_recording_id: c.musicbrainz_recordingid || null,
    });

    // metadatos de álbum: se toman del primer fichero que los tenga
    albumMeta.album ||= c.album;
    albumMeta.albumArtist ||= c.albumartist || c.artist;
    albumMeta.artist ||= c.artist;
    albumMeta.year ||= c.year || (c.date ? Number(String(c.date).slice(0, 4)) : null);
    albumMeta.rgMbid ||= c.musicbrainz_releasegroupid || null;
    albumMeta.relMbid ||= c.musicbrainz_albumid || null;
    albumMeta.artistMbid ||= c.musicbrainz_albumartistid || c.musicbrainz_artistid || null;
    albumMeta.totalTracks ||= c.track?.of || null;
    if ((c.disk?.of || 1) > albumMeta.discs) albumMeta.discs = c.disk.of;
  }

  if (!tracks.length) return;
  tracks.sort((a, b) => (a.disc - b.disc) || ((a.num || 0) - (b.num || 0)));

  const localKey = sha1(dir);
  const albumTitle = albumMeta.album || path.basename(dir);
  const albumArtistName = albumMeta.albumArtist || albumMeta.artist || 'Artista desconocido';
  const artistId = resolveLocalArtist(albumArtistName, albumMeta.artistMbid);
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    stat = { mtimeMs: Date.now() };
  }

  const trackFileCount = tracks.length;
  // lo que "debería" tener: el máximo entre lo que dicen las etiquetas y lo que hay
  const trackCount = Math.max(albumMeta.totalTracks || 0, trackFileCount);

  upsertAlbum.run({
    local_key: localKey,
    path: dir,
    artist_id: artistId,
    album_artist: albumArtistName,
    title: albumTitle,
    year: albumMeta.year || null,
    rg_mbid: albumMeta.rgMbid,
    release_mbid: albumMeta.relMbid,
    track_count: trackCount,
    track_file_count: trackFileCount,
    disc_count: albumMeta.discs || 1,
    size_bytes: totalSize,
    duration_ms: Math.round(totalDur),
    added_at: Math.round(stat.mtimeMs),
    scanned_at: Date.now(),
    cover: findCover(dir, files),
  });

  const albumId = getAlbumId.get(localKey).id;
  clearTracks.run(albumId);
  const tx = db.transaction((rows) => {
    for (const t of rows) insertTrack.run({ ...t, album_id: albumId });
  });
  tx(tracks);

  for (const g of genres) {
    insertGenre.run(g);
    const gid = getGenreId.get(g)?.id;
    if (gid) linkTag.run(albumId, gid);
  }

  scanStatus.albumsDone++;
  scanStatus.tracksDone += trackFileCount;
}

// scanned_at de un álbum ya en BD por su carpeta, para el salto incremental.
const scannedAtOf = db.prepare('SELECT scanned_at FROM albums WHERE local_key = ?');

// Recorre la biblioteca. `opts.roots` sobrescribe music_dirs; `opts.force` reescanea
// TODO (ignora el salto incremental).
export async function runScan(opts = {}) {
  if (scanStatus.running) return scanStatus;
  const { roots: rootsArg, force = false } = typeof opts === 'string' ? { roots: opts } : opts;
  const roots = (rootsArg || getSetting('music_dirs') || '')
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  Object.assign(scanStatus, {
    running: true,
    phase: 'walking',
    foldersFound: 0,
    albumsDone: 0,
    tracksDone: 0,
    skipped: 0,
    current: null,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  });
  const started = Date.now();
  try {
    if (!roots.length) throw new Error('No hay carpetas de música configuradas (Ajustes → carpetas)');
    const folders = [];
    for (const root of roots) {
      if (!fs.existsSync(root)) {
        scanStatus.error = `No existe la carpeta: ${root}`;
        continue;
      }
      walk(root, folders);
    }
    scanStatus.foldersFound = folders.length;
    scanStatus.phase = 'reading';
    console.log(`[scan] ${folders.length} carpetas con audio encontradas${force ? ' (reescaneo completo)' : ''}`);

    let processed = 0;
    for (const folder of folders) {
      scanStatus.current = folder.dir;
      // salto incremental: si ya lo escaneamos y la carpeta no ha cambiado, fuera
      if (!force) {
        const existing = scannedAtOf.get(sha1(folder.dir));
        if (existing?.scanned_at) {
          let mtime = 0;
          try {
            mtime = fs.statSync(folder.dir).mtimeMs;
          } catch {
            /* si no se puede leer el mtime, mejor reescanear */
          }
          if (mtime && mtime <= existing.scanned_at) {
            scanStatus.skipped++;
            processed++;
            continue;
          }
        }
      }
      await ingestFolder(folder);
      processed++;
      if (processed % 500 === 0)
        console.log(`[scan] ${processed}/${folders.length} · ${scanStatus.albumsDone} nuevas · ${scanStatus.skipped} sin cambios`);
    }
    scanStatus.phase = 'done';
    console.log(`[scan] fin: ${scanStatus.albumsDone} álbumes escaneados, ${scanStatus.skipped} sin cambios, ${folders.length} carpetas`);
  } catch (err) {
    scanStatus.phase = 'error';
    scanStatus.error = String(err.message || err);
    console.error('[scan] error:', scanStatus.error);
  } finally {
    scanStatus.running = false;
    scanStatus.finishedAt = Date.now();
    // resumen persistente, para que el estado sobreviva a un reinicio
    setSetting(
      'last_scan',
      JSON.stringify({
        at: Date.now(),
        folders: scanStatus.foldersFound,
        albums: scanStatus.albumsDone,
        skipped: scanStatus.skipped,
        phase: scanStatus.phase,
        error: scanStatus.error,
      })
    );
    db.prepare('INSERT INTO sync_log (started_at, finished_at, status, detail) VALUES (?, ?, ?, ?)').run(
      started,
      Date.now(),
      scanStatus.error ? 'error' : 'ok',
      `${scanStatus.albumsDone} nuevas · ${scanStatus.skipped} sin cambios · ${scanStatus.foldersFound} carpetas`
    );
  }
  return scanStatus;
}
