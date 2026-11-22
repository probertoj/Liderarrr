import { db } from './db.js';

// LISTADOS DE CALIDAD: qué ÁLBUMES están a 44,1 kHz, a 48 kHz, sin ReplayGain o sin imagen
// en su carpeta. La página de Calidad daba los totales; esto da los nombres, para poder
// hacer algo con ellos. Solo LEE lo que el escáner ya guardó (tracks.sample_rate,
// tracks.has_replaygain, albums.cover): nada que reescanear.
//
// Viene del fork de tinker-net (github.com/tinker-net/Liderarrr), portado tal cual.

const LIVE = "a.match_state != 'dismissed'"; // mismo criterio «descriptivo» que queries.js
const ORDER = 'ORDER BY a.album_artist COLLATE NOCASE, a.year, a.title COLLATE NOCASE';

// Contadores de las pestañas: cuántos ÁLBUMES (no pistas) hay en cada lista.
export function qualityListsSummary() {
  const sampleRates = db
    .prepare(
      `SELECT t.sample_rate AS rate, COUNT(DISTINCT t.album_id) AS albums
       FROM tracks t JOIN albums a ON a.id = t.album_id
       WHERE ${LIVE} AND t.sample_rate IS NOT NULL
       GROUP BY t.sample_rate ORDER BY albums DESC`
    )
    .all();
  const noReplaygain = db
    .prepare(
      `SELECT COUNT(DISTINCT t.album_id) AS n
       FROM tracks t JOIN albums a ON a.id = t.album_id
       WHERE ${LIVE} AND t.has_replaygain = 0`
    )
    .get().n;
  // misma definición que qualityOverview().noCover: el número de la tarjeta y el de esta
  // lista tienen que cuadrar.
  const noCover = db.prepare(`SELECT COUNT(*) AS n FROM albums a WHERE ${LIVE} AND (a.cover IS NULL OR a.cover = '')`).get().n;
  return { sampleRates, noReplaygain, noCover };
}

// Álbumes con AL MENOS una pista a esa frecuencia. Si un álbum mezcla frecuencias (44,1 y
// 48) sale en las dos listas y lleva `rates` con todas, para que no se esconda nada.
export function albumsAtSampleRate(rate) {
  const hz = Math.round(Number(rate));
  if (!Number.isFinite(hz) || hz <= 0) throw new Error('Frecuencia de muestreo no válida');
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.path, a.track_file_count,
        COUNT(t.id) AS at_rate,
        (SELECT GROUP_CONCAT(DISTINCT t2.sample_rate) FROM tracks t2
          WHERE t2.album_id = a.id AND t2.sample_rate IS NOT NULL) AS rates
       FROM albums a JOIN tracks t ON t.album_id = a.id AND t.sample_rate = @hz
       WHERE ${LIVE}
       GROUP BY a.id ${ORDER}`
    )
    .all({ hz });
  return rows.map((r) => ({
    ...r,
    rates: String(r.rates || '')
      .split(',')
      .map(Number)
      .filter(Boolean)
      .sort((x, y) => x - y),
  }));
}

// Álbumes con alguna pista sin ReplayGain, con cuántas pistas de cuántas.
export function albumsWithoutReplaygain() {
  return db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.path,
        COUNT(t.id) AS total,
        SUM(CASE WHEN t.has_replaygain = 0 THEN 1 ELSE 0 END) AS without
       FROM albums a JOIN tracks t ON t.album_id = a.id
       WHERE ${LIVE}
       GROUP BY a.id HAVING without > 0 ${ORDER}`
    )
    .all();
}

export function albumsWithoutCover() {
  return db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.path, a.track_file_count
       FROM albums a
       WHERE ${LIVE} AND (a.cover IS NULL OR a.cover = '')
       ${ORDER}`
    )
    .all();
}

export function registerQualityLists(app) {
  app.get('/api/quality/lists', async () => qualityListsSummary());
  app.get('/api/quality/list', async (req, reply) => {
    const { kind, rate } = req.query || {};
    try {
      let albums;
      if (kind === 'samplerate') albums = albumsAtSampleRate(rate);
      else if (kind === 'replaygain') albums = albumsWithoutReplaygain();
      else if (kind === 'cover') albums = albumsWithoutCover();
      else return reply.code(400).send({ error: 'Lista desconocida' });
      return { kind, total: albums.length, albums };
    } catch (err) {
      return reply.code(400).send({ error: String(err.message || err) });
    }
  });
}
