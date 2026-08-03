import { db } from './db.js';

// Todas las consultas que alimentan las secciones. Regla de oro del diseño:
//  - Lo DESCRIPTIVO (totales, disco, formatos, escuchas) incluye TODO, también
//    las rarezas (orphan): están en tu disco, ocupan y suenan.
//  - Lo COMPARATIVO (% de discografía, retos, huecos) excluye orphan/unmatched:
//    no puedes completar contra algo que la referencia no conoce.
const DESCRIPTIVE = "match_state != 'dismissed'";

export function overview() {
  const a = db.prepare(`SELECT
    COUNT(*) AS albums,
    COALESCE(SUM(track_file_count),0) AS tracks,
    COALESCE(SUM(size_bytes),0) AS size,
    COALESCE(SUM(duration_ms),0) AS duration
    FROM albums WHERE ${DESCRIPTIVE}`).get();
  // artistas con AL MENOS un álbum no descartado (mismo criterio que la página
  // de Artistas, para que los recuentos no se contradigan)
  const artists = db
    .prepare(`SELECT COUNT(DISTINCT a.artist_id) AS n FROM albums a WHERE ${DESCRIPTIVE}`)
    .get().n;
  const states = Object.fromEntries(
    db.prepare('SELECT match_state, COUNT(*) AS n FROM albums GROUP BY match_state').all().map((r) => [r.match_state, r.n])
  );
  const lossless = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN lossless=1 THEN 1 ELSE 0 END),0) AS lossless,
    COUNT(*) AS total FROM tracks`).get();
  const incomplete = db.prepare(
    `SELECT COUNT(*) AS n FROM albums WHERE ${DESCRIPTIVE} AND track_file_count < track_count`
  ).get().n;
  return {
    albums: a.albums,
    tracks: a.tracks,
    artists,
    sizeBytes: a.size,
    durationMs: a.duration,
    losslessPct: lossless.total ? Math.round((lossless.lossless / lossless.total) * 100) : 0,
    incomplete,
    states,
  };
}

export function charts() {
  const byDecade = db.prepare(`
    SELECT (year/10)*10 AS decade, COUNT(*) AS n FROM albums
    WHERE ${DESCRIPTIVE} AND year IS NOT NULL GROUP BY decade ORDER BY decade`).all();
  const byGenre = db.prepare(`
    SELECT t.name AS name, COUNT(*) AS n FROM album_tags at
    JOIN tags t ON t.id = at.tag_id AND t.type='genre'
    JOIN albums a ON a.id = at.album_id AND a.${DESCRIPTIVE}
    GROUP BY t.name ORDER BY n DESC LIMIT 15`).all();
  const byFormat = db.prepare(`
    SELECT format AS name, COUNT(*) AS n FROM tracks
    WHERE format IS NOT NULL AND format<>'' GROUP BY format ORDER BY n DESC`).all();
  const topArtists = db.prepare(`
    SELECT ar.id, ar.name, COUNT(a.id) AS albums, COALESCE(SUM(a.track_file_count),0) AS tracks
    FROM artists ar JOIN albums a ON a.artist_id = ar.id AND a.${DESCRIPTIVE}
    GROUP BY ar.id ORDER BY albums DESC, tracks DESC LIMIT 20`).all();
  // crecimiento de la colección: álbumes añadidos por mes (added_at es ms)
  const addedByMonth = db.prepare(`
    SELECT strftime('%Y-%m', added_at/1000, 'unixepoch') AS month, COUNT(*) AS n
    FROM albums WHERE ${DESCRIPTIVE} AND added_at IS NOT NULL
    GROUP BY month ORDER BY month`).all();
  return { byDecade, byGenre, byFormat, topArtists, addedByMonth };
}

// Actividad reciente para el dashboard: últimas añadidas (con carátula), últimas
// escuchas (Last.fm, con carátula si están en tu biblioteca) y últimas en Lidarr.
export function recent() {
  const recentlyAdded = db
    .prepare(
      `SELECT id, title, album_artist, year, added_at, cover FROM albums
       WHERE ${DESCRIPTIVE} ORDER BY added_at DESC LIMIT 14`
    )
    .all();

  const recentlyListened = db
    .prepare(
      `SELECT l.artist, l.album, MAX(l.ts) AS ts,
        (SELECT a.id FROM albums a JOIN artists ar ON ar.id=a.artist_id
          WHERE ar.name = l.artist COLLATE NOCASE AND a.title = l.album COLLATE NOCASE
          AND a.${DESCRIPTIVE} LIMIT 1) AS album_id
       FROM listens l WHERE l.source='lastfm' AND l.album <> ''
       GROUP BY l.artist COLLATE NOCASE, l.album COLLATE NOCASE
       ORDER BY ts DESC LIMIT 14`
    )
    .all();

  const lidarrRecent = db
    .prepare(
      `SELECT rg_mbid, title, artist, has_file, monitored, added FROM lidarr_albums
       ORDER BY COALESCE(added, '') DESC LIMIT 12`
    )
    .all();

  return { recentlyAdded, recentlyListened, lidarrRecent };
}

// Discoteca: parrilla filtrable. Filtros básicos de la fase 1.
export function library({ q, genre, decade, format, state, lossless, sort, limit = 500, offset = 0 } = {}) {
  const where = [DESCRIPTIVE];
  const args = {};
  if (q) {
    where.push('(a.title LIKE @q OR a.album_artist LIKE @q)');
    args.q = `%${q}%`;
  }
  if (decade) {
    where.push('a.year >= @d0 AND a.year < @d1');
    args.d0 = Number(decade);
    args.d1 = Number(decade) + 10;
  }
  if (state) {
    where.push('a.match_state = @state');
    args.state = state;
  }
  if (lossless === '1') where.push("EXISTS (SELECT 1 FROM tracks t WHERE t.album_id=a.id AND t.lossless=1)");
  if (lossless === '0') where.push("NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id=a.id AND t.lossless=1)");
  if (genre) {
    where.push(`EXISTS (SELECT 1 FROM album_tags at JOIN tags t ON t.id=at.tag_id
      WHERE at.album_id=a.id AND t.type='genre' AND t.name=@genre)`);
    args.genre = genre;
  }
  if (format) {
    where.push('EXISTS (SELECT 1 FROM tracks t WHERE t.album_id=a.id AND t.format=@format)');
    args.format = format;
  }
  const order =
    { title: 'a.title COLLATE NOCASE', artist: 'a.album_artist COLLATE NOCASE', year: 'a.year DESC', added: 'a.added_at DESC', size: 'a.size_bytes DESC', random: 'RANDOM()' }[
      sort
    ] || 'a.added_at DESC';
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.artist_id, a.match_state, a.cover,
        a.track_file_count, a.track_count, a.size_bytes, a.rg_mbid
       FROM albums a WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT @limit OFFSET @offset`
    )
    .all({ ...args, limit, offset });
  const total = db.prepare(`SELECT COUNT(*) AS n FROM albums a WHERE ${where.join(' AND ')}`).get(args).n;
  return { total, albums: rows };
}

export function albumDetail(id) {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(id);
  if (!album) return null;
  album.secondary_types = album.secondary_types ? JSON.parse(album.secondary_types) : [];
  album.tracks = db.prepare('SELECT * FROM tracks WHERE album_id = ? ORDER BY disc, num').all(id);
  album.genres = db
    .prepare("SELECT t.name FROM album_tags at JOIN tags t ON t.id=at.tag_id AND t.type='genre' WHERE at.album_id=?")
    .all(id)
    .map((r) => r.name);
  album.artist = db.prepare('SELECT id, name, mbid FROM artists WHERE id = ?').get(album.artist_id);
  return album;
}

export function filterOptions() {
  return {
    genres: db
      .prepare(`SELECT t.name, COUNT(*) AS n FROM album_tags at JOIN tags t ON t.id=at.tag_id AND t.type='genre'
        GROUP BY t.name ORDER BY n DESC`)
      .all(),
    decades: db.prepare(`SELECT DISTINCT (year/10)*10 AS decade FROM albums WHERE year IS NOT NULL ORDER BY decade DESC`).all().map((r) => r.decade),
    formats: db.prepare("SELECT DISTINCT format FROM tracks WHERE format IS NOT NULL AND format<>'' ORDER BY format").all().map((r) => r.format),
  };
}

export function artists({ q, sort, limit = 5000 } = {}) {
  const where = ['1=1'];
  const args = {};
  if (q) {
    where.push('ar.name LIKE @q');
    args.q = `%${q}%`;
  }
  const order = { albums: 'albums DESC', tracks: 'tracks DESC', name: 'ar.name COLLATE NOCASE' }[sort] || 'albums DESC';
  return db
    .prepare(
      `SELECT ar.id, ar.name, ar.mbid, ar.country, ar.type,
        COUNT(a.id) AS albums, COALESCE(SUM(a.track_file_count),0) AS tracks,
        (SELECT a2.id FROM albums a2 WHERE a2.artist_id=ar.id AND a2.${DESCRIPTIVE}
          ORDER BY (a2.cover IS NULL), a2.added_at DESC LIMIT 1) AS cover_album_id
       FROM artists ar LEFT JOIN albums a ON a.artist_id=ar.id AND a.${DESCRIPTIVE}
       WHERE ${where.join(' AND ')} GROUP BY ar.id HAVING albums > 0 ORDER BY ${order} LIMIT @limit`
    )
    .all({ ...args, limit });
}

export function artistDetail(id) {
  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(id);
  if (!artist) return null;
  artist.albums = db
    .prepare(
      `SELECT id, title, year, cover, match_state, track_file_count, track_count, rg_mbid
       FROM albums WHERE artist_id = ? AND ${DESCRIPTIVE} ORDER BY year, title`
    )
    .all(id);
  return artist;
}

// Álbumes incompletos: la feature estrella. Faltan pistas frente a lo que
// deberían tener. Ordenados por cuántas faltan. Excluye orphan (una maqueta no
// "está incompleta": es lo que es).
export function incomplete() {
  return db
    .prepare(
      `SELECT id, title, album_artist, year, cover, track_file_count, track_count,
        (track_count - track_file_count) AS missing, match_state
       FROM albums
       WHERE ${DESCRIPTIVE} AND match_state NOT IN ('orphan')
         AND track_file_count < track_count
       ORDER BY missing DESC, album_artist`
    )
    .all();
}

export function qualityOverview() {
  const byFormat = db.prepare(`SELECT format AS name, COUNT(*) AS n,
    COALESCE(SUM(size_bytes),0) AS size FROM tracks WHERE format IS NOT NULL AND format<>''
    GROUP BY format ORDER BY n DESC`).all();
  const lossless = db.prepare(`SELECT
    SUM(CASE WHEN lossless=1 THEN 1 ELSE 0 END) AS lossless,
    SUM(CASE WHEN lossless=0 THEN 1 ELSE 0 END) AS lossy,
    COUNT(*) AS total FROM tracks`).get();
  const noReplaygain = db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE has_replaygain = 0').get().n;
  const noCover = db.prepare(`SELECT COUNT(*) AS n FROM albums WHERE ${DESCRIPTIVE} AND (cover IS NULL OR cover='')`).get().n;
  // álbumes con formatos mezclados dentro del mismo disco (FLAC + MP3)
  const mixed = db.prepare(`SELECT a.id, a.title, a.album_artist,
      GROUP_CONCAT(DISTINCT t.format) AS formats
    FROM albums a JOIN tracks t ON t.album_id=a.id
    WHERE a.${DESCRIPTIVE}
    GROUP BY a.id HAVING COUNT(DISTINCT t.format) > 1 ORDER BY a.album_artist`).all();
  const heaviest = db.prepare(`SELECT id, title, album_artist, size_bytes FROM albums
    WHERE ${DESCRIPTIVE} ORDER BY size_bytes DESC LIMIT 20`).all();
  return { byFormat, lossless, noReplaygain, noCover, mixed, heaviest };
}

// Duplicados: mismo artista+título en más de una carpeta.
export function duplicates() {
  return db.prepare(`SELECT album_artist, title, COUNT(*) AS copies,
      GROUP_CONCAT(id) AS ids, GROUP_CONCAT(path, '||') AS paths
    FROM albums WHERE ${DESCRIPTIVE}
    GROUP BY LOWER(album_artist), LOWER(title) HAVING copies > 1 ORDER BY copies DESC`).all();
}

// Cola de "Sin identificar": lo que la cadena no pudo resolver, para resolución
// manual. Incluye pistas para el usuario (nº de pistas, formatos).
export function unidentified() {
  return db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.cover, a.path, a.track_file_count,
        a.match_state
       FROM albums a WHERE a.match_state IN ('unmatched','pending')
       ORDER BY a.album_artist, a.title`
    )
    .all();
}

// Rarezas e inéditos: los orphan, material que en otras herramientas se pierde.
export function rarities() {
  return db
    .prepare(
      `SELECT id, title, album_artist, year, cover, track_file_count, path
       FROM albums WHERE match_state = 'orphan' ORDER BY album_artist, year, title`
    )
    .all();
}
