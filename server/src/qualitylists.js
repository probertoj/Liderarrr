import { db } from './db.js';

// LISTADOS DE CALIDAD: la página de Calidad daba los totales; esto da los nombres, para
// poder hacer algo con ellos. Solo LEE lo que el escáner ya guardó (tracks.sample_rate,
// tracks.bit_depth, tracks.has_replaygain, albums.cover): nada que reescanear.
//
// La idea y la primera versión vienen del fork de tinker-net
// (github.com/tinker-net/Liderarrr), que hacía una lista por cada frecuencia de muestreo.
// Con una biblioteca real eso daba trece pestañas: «44,1 kHz» con casi todos los discos (es
// la norma, no una lista), frecuencias con un solo álbum, y la profundidad de bits sin
// mirar, cuando un disco a 24 bits y 44,1 kHz es alta resolución. Ahora se agrupa por lo
// que uno quiere saber:
//
//   · alta resolución   sin pérdida a más de 16 bits o a más de 48 kHz
//   · por debajo de CD  alguna pista a menos de 44,1 kHz (lo más claro de sustituir)
//   · mezclan           pistas a distinta frecuencia dentro del mismo disco
//   · sin ReplayGain    · sin imagen en la carpeta
//
// La «calidad CD» (16 bits, 44,1 o 48 kHz) no tiene lista: es casi todo. Y lo que tiene
// pérdida ya tiene su página (Candidatos a upgrade).

const LIVE = "a.match_state != 'dismissed'"; // mismo criterio «descriptivo» que queries.js
const ORDER = 'ORDER BY a.album_artist COLLATE NOCASE, a.year, a.title COLLATE NOCASE';

const ES_ALTA = 't.lossless = 1 AND (t.sample_rate > 48000 OR t.bit_depth > 16)';
const ES_BAJA = 't.sample_rate < 44100';

// Contadores de las pestañas: cuántos ÁLBUMES (no pistas) hay en cada lista. De una sola
// pasada por las pistas: son cientos de miles y cada recuento por separado se nota.
export function qualityListsSummary() {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(alta), 0) AS hiRes, COALESCE(SUM(baja), 0) AS belowCd,
              COALESCE(SUM(mezcla), 0) AS mixed, COALESCE(SUM(sinrg), 0) AS noReplaygain
       FROM (
         SELECT MAX(CASE WHEN ${ES_ALTA} THEN 1 ELSE 0 END) AS alta,
                MAX(CASE WHEN ${ES_BAJA} THEN 1 ELSE 0 END) AS baja,
                CASE WHEN COUNT(DISTINCT t.sample_rate) > 1 THEN 1 ELSE 0 END AS mezcla,
                MAX(CASE WHEN t.has_replaygain = 0 THEN 1 ELSE 0 END) AS sinrg
         FROM albums a JOIN tracks t ON t.album_id = a.id
         WHERE ${LIVE} GROUP BY a.id
       )`
    )
    .get();
  // misma definición que qualityOverview().noCover: el número de la tarjeta y el de esta
  // lista tienen que cuadrar.
  const noCover = db.prepare(`SELECT COUNT(*) AS n FROM albums a WHERE ${LIVE} AND (a.cover IS NULL OR a.cover = '')`).get().n;
  return { ...r, noCover };
}

const numeros = (txt) =>
  String(txt || '')
    .split(',')
    .map(Number)
    .filter(Boolean)
    .sort((x, y) => x - y);

// Álbumes que cumplen `having`, cada uno con TODAS sus frecuencias, profundidades y
// formatos: así la fila dice «24 bits · 96 kHz» o «44,1 + 48 kHz» sin esconder nada.
function albumesCon(having) {
  return db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.path, a.track_file_count,
              GROUP_CONCAT(DISTINCT t.sample_rate) AS rates,
              GROUP_CONCAT(DISTINCT t.bit_depth) AS bits,
              GROUP_CONCAT(DISTINCT t.format) AS formats
       FROM albums a JOIN tracks t ON t.album_id = a.id
       WHERE ${LIVE}
       GROUP BY a.id HAVING ${having} ${ORDER}`
    )
    .all()
    .map((r) => ({
      ...r,
      rates: numeros(r.rates),
      bits: numeros(r.bits),
      formats: String(r.formats || '').split(',').filter(Boolean).sort(),
    }));
}

export const albumsHiRes = () => albumesCon(`MAX(CASE WHEN ${ES_ALTA} THEN 1 ELSE 0 END) = 1`);
export const albumsBelowCd = () => albumesCon(`MAX(CASE WHEN ${ES_BAJA} THEN 1 ELSE 0 END) = 1`);
export const albumsMixedRates = () => albumesCon('COUNT(DISTINCT t.sample_rate) > 1');

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

const LISTAS = {
  hires: albumsHiRes,
  belowcd: albumsBelowCd,
  mixed: albumsMixedRates,
  replaygain: albumsWithoutReplaygain,
  cover: albumsWithoutCover,
};

export function registerQualityLists(app) {
  app.get('/api/quality/lists', async () => qualityListsSummary());
  app.get('/api/quality/list', async (req, reply) => {
    const kind = String(req.query?.kind || '');
    if (!Object.hasOwn(LISTAS, kind)) return reply.code(400).send({ error: 'Lista desconocida' });
    try {
      const albums = LISTAS[kind]();
      return { kind, total: albums.length, albums };
    } catch (err) {
      return reply.code(400).send({ error: String(err.message || err) });
    }
  });
}
