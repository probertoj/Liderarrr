import { db } from './db.js';
import { recentListenedAlbums } from './listening.js';
import { albumCredits, writeAlbumCredits } from './credits.js';

// Todas las consultas que alimentan las secciones. Regla de oro del diseño:
//  - Lo DESCRIPTIVO (totales, disco, formatos, escuchas) incluye TODO, también
//    las rarezas (orphan) y bootlegs: están en tu disco, ocupan y suenan.
//  - Lo COMPARATIVO (% de discografía, retos, huecos) excluye orphan/bootleg/unmatched:
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
  // cuenta igual que la página de incompletos: cajas multidisco colapsadas
  const incomplete = incompleteGroups().length;
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

  // cruce en memoria (ver listening.js): evita el GROUP BY caro sobre ~128k filas
  const recentlyListened = recentListenedAlbums(14);

  return { recentlyAdded, recentlyListened };
}

// representante de un grupo de duplicados en una parrilla (rápido, sin tocar tracks):
// manda la completitud, luego nº de pistas y tamaño. Compartido (Discoteca, sellos).
export function libScore(a) {
  const complete = a.track_count ? a.track_file_count / a.track_count : 1;
  return complete * 1e12 + (a.track_file_count || 0) * 1e6 + (a.size_bytes || 0);
}

// Cuentas de una caja multidisco a partir de sus discos. have = suma de ficheros. total =
// el total de caja «contaminado» (MÁX: si todos los discos declaran el MISMO track_count y
// es mayor que sus ficheros) o, si no, la SUMA de las cuentas (discos limpios, cada uno con
// la suya, o combinación manual). Compartido por la Discoteca y los incompletos.
export function discBoxCounts(copies) {
  const have = copies.reduce((s, c) => s + (c.track_file_count || 0), 0);
  const t0 = copies[0].track_count || 0;
  const contaminated = copies.every((c) => (c.track_count || 0) === t0) && t0 > (copies[0].track_file_count || 0);
  const total = contaminated ? t0 : copies.reduce((s, c) => s + (c.track_count || 0), 0);
  return { track_file_count: have, track_count: total };
}
function librarySort(sort) {
  const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base' });
  switch (sort) {
    case 'title':
      return byTitle;
    case 'artist':
      return (a, b) =>
        String(a.album_artist || '').localeCompare(String(b.album_artist || ''), 'es', { sensitivity: 'base' }) ||
        byTitle(a, b);
    case 'year':
      return (a, b) => (b.year || 0) - (a.year || 0);
    case 'size':
      return (a, b) => (b.size_bytes || 0) - (a.size_bytes || 0);
    case 'random':
      return () => Math.random() - 0.5;
    default:
      return (a, b) => (b.added_at || 0) - (a.added_at || 0);
  }
}

// Discoteca: parrilla filtrable. Colapsa duplicados (rg_mbid, o artista+título
// normalizado) a un representante con badge ×N, como la página de artista.
export function library({ q, genre, decade, year, format, state, lossless, sort, dupesOnly, flat, limit = 500, offset = 0 } = {}) {
  const where = [DESCRIPTIVE];
  const args = {};
  if (q) {
    where.push('(a.title LIKE @q OR a.album_artist LIKE @q)');
    args.q = `%${q}%`;
  }
  // el año (más específico) manda sobre la década si se pasan ambos
  if (year) {
    where.push('a.year = @year');
    args.year = Number(year);
  } else if (decade) {
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
  // trae TODO el conjunto filtrado (sin paginar) para poder colapsar los duplicados
  // que cruzan la frontera de página.
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.year, a.artist_id, a.match_state, a.cover,
        a.track_file_count, a.track_count, a.size_bytes, a.rg_mbid, a.disc_group, a.added_at
       FROM albums a WHERE ${where.join(' AND ')}`
    )
    .all(args);

  // modo PLANO (para el modo selección de la Discoteca al combinar multidiscos): sin
  // colapsar nada, para poder elegir cada disco individual (aunque compartan título).
  if (flat) {
    rows.sort(librarySort(sort));
    return { total: rows.length, albums: rows.slice(offset, offset + limit) };
  }

  const groups = new Map();
  for (const a of rows) {
    // Caja multidisco aparte; el resto se colapsa por EDICION (artista + titulo base +
    // numero de pistas), no por release-group: asi el badge xN son copias de la MISMA
    // edicion, y ediciones distintas del disco (original vs deluxe) salen por separado.
    const key = a.disc_group ? `dg:${a.disc_group}` : `ed:${String(a.album_artist || '').toLowerCase().trim()}|${editionKey(a)}`;
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
  }
  const collapsed = [];
  for (const copies of groups.values()) {
    if (copies.length === 1) {
      collapsed.push(copies[0]);
      continue;
    }
    let best = copies[0];
    for (const c of copies) if (libScore(c) > libScore(best)) best = c;
    // ¿caja multidisco? entonces NO son duplicados: agrega las cuentas de todos los
    // discos y márcala como caja. Si no, es duplicado difuso (badge ×N).
    if (copies[0].disc_group && copies.every((c) => c.disc_group === copies[0].disc_group)) {
      // Total de la caja según el CONTENIDO: si todos los discos declaran el MISMO
      // track_count y es mayor que sus ficheros (etiquetas con el total de la caja
      // «contaminado»), el total es ese valor (MÁX). Si no —discos limpios con su propia
      // cuenta, o combinación manual—, el total es la SUMA. «have» siempre es la suma de
      // ficheros. Así una caja limpia (p. ej. Seamonsters CD1/CD2/CD3) sale 53/53, no 53/19.
      best = { ...best, ...discBoxCounts(copies), discs: copies.length };
    } else {
      best.dup = { copies: copies.length };
    }
    collapsed.push(best);
  }
  // filtro "solo con duplicados": los que tienen copias difusas (badge ×N). Las cajas
  // multidisco no cuentan (llevan .discs, no .dup), que es justo lo que se quiere.
  const result = dupesOnly ? collapsed.filter((a) => a.dup) : collapsed;
  result.sort(librarySort(sort));
  return { total: result.length, albums: result.slice(offset, offset + limit) };
}

// Grupo de duplicados de UN álbum (para el panel al pinchar la carátula ×N en la
// Discoteca): todas las copias que comparten identidad, con detalle por copia. Mismo
// formato que artistDetail.duplicateGroups[i], para reutilizar el panel.
// Clave de EDICIÓN dentro de un mismo álbum: título base (normalizeForDup quita
// «Deluxe/Expanded/Remastered…») + el nº total de pistas que declara la edición. Así el
// box deluxe (36) y la original (10) del mismo disco tienen claves distintas —son
// ediciones—, mientras que dos rips de la MISMA edición coinciden y son copias. Funciona
// aunque MusicBrainz les dé el mismo release-group (caso Pinkerton).
const editionKey = (c) => `${normalizeForDup(c.title)}|${c.track_count || c.track_file_count || 0}`;

// Discos de tu colección que son EL MISMO álbum que `a`: mismo release-group
// (identificados) o mismo artista + mismo título base. Enriquecidos con formato/lossless.
function sameAlbumRows(a) {
  const target = normalizeForDup(a.title);
  const artistKey = String(a.album_artist || '').toLowerCase().trim();
  const rows = db
    .prepare(
      `SELECT id, title, year, rg_mbid, album_artist, track_file_count, track_count, size_bytes, path,
        (SELECT format FROM tracks WHERE album_id=albums.id AND format IS NOT NULL AND format<>'' GROUP BY format ORDER BY COUNT(*) DESC LIMIT 1) AS format,
        (SELECT CASE WHEN COUNT(*)>0 AND MIN(lossless)=1 THEN 1 ELSE 0 END FROM tracks WHERE album_id=albums.id) AS lossless
       FROM albums
       WHERE match_state != 'dismissed' AND (rg_mbid = @rg OR LOWER(album_artist) = @artist)`
    )
    .all({ rg: a.rg_mbid || ' ', artist: artistKey });
  return rows.filter(
    (c) => (a.rg_mbid && c.rg_mbid === a.rg_mbid) || (String(c.album_artist || '').toLowerCase().trim() === artistKey && normalizeForDup(c.title) === target)
  );
}

export function albumDupGroup(albumId) {
  const a = db.prepare('SELECT id, rg_mbid, album_artist, title, track_count, track_file_count FROM albums WHERE id = ?').get(albumId);
  if (!a) return null;
  const key = editionKey(a);
  // Copias = SOLO la misma edición (misma clave). Antes agrupaba por rg_mbid y metía la
  // original junto a la deluxe como si fueran duplicados a borrar.
  const copies = sameAlbumRows(a).filter((c) => editionKey(c) === key);
  if (copies.length < 2) return { title: a.title, copies: [] };
  let best = copies[0];
  for (const c of copies) if (copyScore(c) > copyScore(best)) best = c;
  return {
    title: best.title,
    copies: copies
      .map((c) => ({
        id: c.id,
        title: c.title,
        year: c.year,
        track_file_count: c.track_file_count,
        track_count: c.track_count,
        size_bytes: c.size_bytes,
        path: c.path,
        format: c.format,
        lossless: !!c.lossless,
        matched: !!c.rg_mbid,
        best: c.id === best.id,
      }))
      .sort((x, y) => Number(y.best) - Number(x.best)),
  };
}

// Otras EDICIONES del mismo álbum que tienes (deluxe/expandida/remaster/original…), cada
// una con su propia ficha. Se distinguen por editionKey (título base + nº de pistas), así
// que funciona aunque compartan release-group (Pinkerton: original 10 vs deluxe 36) o lo
// tengan distinto (Sign o' the Times original vs Expanded Edition). Una entrada por edición
// (la mejor copia). NO son copias a limpiar; complementan a «Copias de este disco».
export function ownedEditions(albumId) {
  const a = db.prepare('SELECT id, rg_mbid, album_artist, title, track_count, track_file_count FROM albums WHERE id = ?').get(albumId);
  if (!a) return [];
  if (!String(a.album_artist || '').trim()) return [];
  const key = editionKey(a);
  const others = sameAlbumRows(a).filter((c) => c.id !== a.id && editionKey(c) !== key);
  const byEd = new Map();
  for (const c of others) {
    const k = editionKey(c);
    const cur = byEd.get(k);
    if (!cur || copyScore(c) > copyScore(cur)) byEd.set(k, c);
  }
  return [...byEd.values()]
    .sort((x, y) => (x.year || 0) - (y.year || 0))
    .map((c) => ({ id: c.id, title: c.title, year: c.year, format: c.format, lossless: !!c.lossless, tracks: c.track_count || c.track_file_count || null }));
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
  album.labels = db
    .prepare("SELECT t.name FROM album_tags at JOIN tags t ON t.id=at.tag_id AND t.type='label' WHERE at.album_id=?")
    .all(id)
    .map((r) => r.name);
  album.artist = db.prepare('SELECT id, name, mbid FROM artists WHERE id = ?').get(album.artist_id);
  // artist-credit completo (varios artistas por etiqueta: splits/colaboraciones). Con un
  // solo artista devuelve el principal; con varios, la lista enlazable con sus nexos.
  album.artists = albumCredits(id);
  // caja multidisco: si pertenece a una, los discos hermanos (para gestionarla en la ficha)
  if (album.disc_group) {
    album.discMembers = db
      .prepare(
        "SELECT id, title, track_file_count, track_count, path FROM albums WHERE disc_group = ? AND match_state != 'dismissed' ORDER BY path"
      )
      .all(album.disc_group);
  }
  return album;
}

export function filterOptions() {
  return {
    genres: db
      .prepare(`SELECT t.name, COUNT(*) AS n FROM album_tags at JOIN tags t ON t.id=at.tag_id AND t.type='genre'
        GROUP BY t.name ORDER BY n DESC`)
      .all(),
    decades: db.prepare(`SELECT DISTINCT (year/10)*10 AS decade FROM albums WHERE year IS NOT NULL ORDER BY decade DESC`).all().map((r) => r.decade),
    years: db.prepare(`SELECT DISTINCT year FROM albums WHERE year IS NOT NULL ORDER BY year DESC`).all().map((r) => r.year),
    formats: db.prepare("SELECT DISTINCT format FROM tracks WHERE format IS NOT NULL AND format<>'' ORDER BY format").all().map((r) => r.format),
  };
}

// Filtros COMBINABLES: `q` (texto), `tracked` (solo seguidos) y `missing` (solo artistas
// de los que faltan discos, según artist_stats.missing del último cruce de discografía).
// Se pasan como querystring; cualquier valor no vacío distinto de "0"/"false" activa.
const flagOn = (v) => v != null && v !== '' && v !== '0' && v !== 'false' && v !== false;
export function artists({ q, sort, limit = 5000, tracked, missing } = {}) {
  const where = ['1=1'];
  const args = {};
  if (q) {
    where.push('ar.name LIKE @q');
    args.q = `%${q}%`;
  }
  if (flagOn(tracked)) where.push("EXISTS (SELECT 1 FROM tracked_artists t WHERE t.artist_id=ar.id AND t.facet='artist')");
  if (flagOn(missing)) where.push('EXISTS (SELECT 1 FROM artist_stats s WHERE s.artist_id=ar.id AND s.missing > 0)');
  const order =
    {
      albums: 'albums DESC',
      tracks: 'tracks DESC',
      missing: 'missing DESC, albums DESC',
      name: 'ar.name COLLATE NOCASE',
      name_desc: 'ar.name COLLATE NOCASE DESC',
      added: 'last_added DESC',
      tracked: 'tracked DESC, albums DESC',
      random: 'RANDOM()',
    }[sort] || 'albums DESC';
  return db
    .prepare(
      `SELECT ar.id, ar.name, ar.mbid, ar.country, ar.type,
        COUNT(a.id) AS albums, COALESCE(SUM(a.track_file_count),0) AS tracks,
        MAX(a.added_at) AS last_added,
        (SELECT 1 FROM tracked_artists t WHERE t.artist_id=ar.id AND t.facet='artist') AS tracked,
        (SELECT s.missing FROM artist_stats s WHERE s.artist_id=ar.id) AS missing,
        (SELECT a2.id FROM albums a2 WHERE a2.artist_id=ar.id AND a2.${DESCRIPTIVE}
          ORDER BY (a2.cover IS NULL), a2.added_at DESC LIMIT 1) AS cover_album_id
       FROM artists ar LEFT JOIN albums a ON a.artist_id=ar.id AND a.${DESCRIPTIVE}
       WHERE ${where.join(' AND ')} GROUP BY ar.id HAVING albums > 0 ORDER BY ${order} LIMIT @limit`
    )
    .all({ ...args, limit });
}

// Normaliza un título para detectar duplicados difusos: quita paréntesis/corchetes
// ((Deluxe Edition), [UK CD], [2021]…), palabras de edición/versión/disco, y toda
// la puntuación. Así "Philophobia", "Philophobia (Deluxe Version)" y "Philophobia
// (Deluxe Edition) CD2" caen en el mismo grupo.
const DUP_STRIP = /\b(deluxe|remaster(ed)?|expanded|anniversary|edition|version|reissue|mono|stereo|bonus|remix(es|ed)?|disc\s*\d+|cd\s*\d+)\b/gi;
export function normalizeForDup(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(DUP_STRIP, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Puntúa una copia para recomendar cuál CONSERVAR (mayor = mejor): manda la
// completitud (pistas que tienes vs las que debería), luego lossless, luego nº de
// pistas y por último el tamaño. Es una heurística; el usuario decide al final.
function copyScore(a) {
  const complete = a.track_count ? a.track_file_count / a.track_count : 1;
  return complete * 1e12 + (a.lossless ? 1e9 : 0) + (a.track_file_count || 0) * 1e6 + (a.size_bytes || 0);
}

export function artistDetail(id) {
  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(id);
  if (!artist) return null;
  const albums = db
    .prepare(
      `SELECT a.id, a.title, a.year, a.cover, a.match_state, a.track_file_count, a.track_count, a.rg_mbid,
        a.size_bytes, a.path, a.primary_type, a.secondary_types,
        (SELECT format FROM tracks WHERE album_id=a.id AND format IS NOT NULL AND format<>''
          GROUP BY format ORDER BY COUNT(*) DESC LIMIT 1) AS format,
        (SELECT CASE WHEN COUNT(*)>0 AND MIN(lossless)=1 THEN 1 ELSE 0 END FROM tracks WHERE album_id=a.id) AS lossless
       FROM albums a
       WHERE a.match_state != 'dismissed'
         AND (a.artist_id = @id OR a.id IN (SELECT album_id FROM album_artists WHERE artist_id = @id))
       ORDER BY a.year, a.title`
    )
    .all({ id });

  // Agrupa duplicados: por release group (identificados) o por título normalizado
  // (sin identificar). Solo los grupos con más de una copia se marcan.
  const groups = new Map();
  for (const a of albums) {
    const key = a.rg_mbid ? `mb:${a.rg_mbid}` : `t:${normalizeForDup(a.title) || String(a.title || '').toLowerCase().trim()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const duplicateGroups = [];
  for (const [key, copies] of groups) {
    if (copies.length < 2) continue;
    let best = copies[0];
    for (const c of copies) if (copyScore(c) > copyScore(best)) best = c;
    // marca cada copia con su grupo y si es la representante (la mejor): la rejilla
    // muestra solo la representante con el badge ×N y despliega el grupo al pinchar.
    for (const c of copies) c.dup = { copies: copies.length, key, best: c.id === best.id };
    duplicateGroups.push({
      key,
      title: best.title,
      copies: copies
        .map((c) => ({
          id: c.id,
          title: c.title,
          year: c.year,
          track_file_count: c.track_file_count,
          track_count: c.track_count,
          size_bytes: c.size_bytes,
          path: c.path,
          format: c.format,
          lossless: !!c.lossless,
          matched: !!c.rg_mbid,
          best: c.id === best.id,
        }))
        .sort((x, y) => Number(y.best) - Number(x.best)),
    });
  }
  duplicateGroups.sort((x, y) => y.copies.length - x.copies.length);

  artist.albums = albums;
  artist.duplicateGroups = duplicateGroups;
  return artist;
}

// Corrige el artista de un álbum desde la UI (típico para lo que llega sin etiquetar
// y no identifica). Reusa un artista local si el nombre ya existe (sin distinguir
// mayúsculas) o crea uno nuevo, apunta el álbum a él y marca artist_manual para que un
// reescaneo no lo pise. NO toca los ficheros (es metadato interno). Tras esto conviene
// reidentificar el álbum: ya con el artista bueno, la cadena suele casar.
export function setAlbumArtist(albumId, name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Falta el nombre del artista');
  const exists = db.prepare('SELECT id FROM albums WHERE id = ?').get(albumId);
  if (!exists) throw new Error('Álbum no encontrado');
  let row = db.prepare('SELECT id FROM artists WHERE name = ? COLLATE NOCASE').get(clean);
  if (!row) {
    const r = db.prepare('INSERT INTO artists (name, sort_name) VALUES (?, ?)').run(clean, clean);
    row = { id: Number(r.lastInsertRowid) };
  }
  db.prepare('UPDATE albums SET artist_id = ?, album_artist = ?, artist_manual = 1 WHERE id = ?').run(row.id, clean, albumId);
  return { ok: true, artist_id: row.id, album_artist: clean };
}

// Fija el artist-credit COMPLETO de un álbum (varios artistas: splits/colaboraciones).
// `artists` = [{name, mbid?}] en orden; el primero es el principal. Delega en credits.js
// (resuelve/crea cada artista, escribe album_artists, ensambla el texto "A / B"). Es la
// versión multi-artista de setAlbumArtist. No toca ficheros.
export function setAlbumArtists(albumId, artists) {
  const list = (Array.isArray(artists) ? artists : [])
    .map((a) => ({ name: String(a?.name || '').trim(), mbid: a?.mbid || null }))
    .filter((a) => a.name);
  if (!list.length) throw new Error('Hace falta al menos un artista');
  writeAlbumCredits(albumId, list, { manual: true });
  return { ok: true, artists: albumCredits(albumId) };
}

// Corrige el título de un álbum desde la UI (para discos mal nombrados que no casan
// con MusicBrainz). Marca title_manual para que el reescaneo no lo pise. No toca
// ficheros. Tras esto conviene reidentificar.
export function setAlbumTitle(albumId, title) {
  const clean = String(title || '').trim();
  if (!clean) throw new Error('Falta el título');
  const exists = db.prepare('SELECT id FROM albums WHERE id = ?').get(albumId);
  if (!exists) throw new Error('Álbum no encontrado');
  db.prepare('UPDATE albums SET title = ?, title_manual = 1 WHERE id = ?').run(clean, albumId);
  return { ok: true, title: clean };
}

// Nombres de artistas de tu biblioteca, para sugerir (datalist) al corregir a mano.
export function artistNames() {
  return db.prepare('SELECT name FROM artists ORDER BY name COLLATE NOCASE').all().map((r) => r.name);
}

// Ámbito de completismo del artista: 'albums' (solo álbumes de estudio) o 'all'
// (además EPs y singles). Decisión consciente por artista.
export function setArtistScope(id, scope) {
  const s = scope === 'all' ? 'all' : 'albums';
  db.prepare('UPDATE artists SET completism_scope = ? WHERE id = ?').run(s, id);
  return { ok: true, scope: s };
}

// Fija a mano el MBID de un artista de MusicBrainz. Necesario cuando la cadena de
// identificación no lo pilla (duplicados, mayúsculas/minúsculas… p. ej. «Florence +
// the Machine»): sin MBID no hay discografía ni completismo. Queda pegado: la cadena
// automática solo escribe el MBID cuando está a NULL, así que no lo pisa un reescaneo.
// Tras esto conviene recalcular la discografía (la ruta lo hace). No toca ficheros.
const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function setArtistMbid(id, mbid) {
  const clean = String(mbid || '').trim().toLowerCase();
  if (!MBID_RE.test(clean)) throw new Error('MBID no válido (debe ser un UUID de MusicBrainz)');
  const artist = db.prepare('SELECT id FROM artists WHERE id = ?').get(id);
  if (!artist) throw new Error('Artista no encontrado');
  db.prepare('UPDATE artists SET mbid = ? WHERE id = ?').run(clean, id);
  return { ok: true, mbid: clean };
}

// Álbumes incompletos: la feature estrella. Faltan pistas frente a lo que
// deberían tener. Ordenados por cuántas faltan. Excluye orphan/bootleg (una maqueta o
// un directo no oficial no "están incompletos": son lo que son).
// Álbumes incompletos, COLAPSANDO cajas multidisco: los discos de una misma caja
// (mismo disc_group) cuentan como un solo álbum, con have = suma de ficheros y total
// = total de la caja. Así una caja completa desaparece de aquí (aunque cada disco
// suelto tenga menos pistas que el total), y una incompleta sale UNA vez, no N.
export function incompleteGroups() {
  const rows = db
    .prepare(
      `SELECT id, title, album_artist, year, cover, track_file_count, track_count,
        disc_group, match_state
       FROM albums
       WHERE ${DESCRIPTIVE} AND match_state NOT IN ('orphan','bootleg')
         AND (track_file_count < track_count OR disc_group IS NOT NULL)`
    )
    .all();

  const boxes = new Map();
  const out = [];
  for (const a of rows) {
    if (a.disc_group) {
      const g = boxes.get(a.disc_group);
      if (g) g.push(a);
      else boxes.set(a.disc_group, [a]);
    } else if (a.track_file_count < a.track_count) {
      out.push({ ...a, missing: a.track_count - a.track_file_count, discs: 1 });
    }
  }
  for (const members of boxes.values()) {
    const { track_file_count: have, track_count: total } = discBoxCounts(members);
    if (have >= total) continue; // caja completa: fuera de incompletos
    const rep = members.reduce((a, b) => (a.id <= b.id ? a : b));
    out.push({
      id: rep.id,
      title: rep.title,
      album_artist: rep.album_artist,
      year: rep.year,
      cover: rep.cover,
      match_state: rep.match_state,
      track_file_count: have,
      track_count: total,
      missing: total - have,
      discs: members.length,
    });
  }
  out.sort((a, b) => b.missing - a.missing || String(a.album_artist || '').localeCompare(String(b.album_artist || '')));
  return out;
}

export function incomplete() {
  return incompleteGroups();
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
    FROM albums WHERE ${DESCRIPTIVE} AND disc_group IS NULL
    GROUP BY LOWER(album_artist), LOWER(title) HAVING copies > 1 ORDER BY copies DESC`).all();
}

// Papelera: álbumes descartados (normalmente copias duplicadas). Siguen en disco;
// se pueden restaurar. Descartar nunca borra el fichero.
export function dismissedAlbums() {
  return db
    .prepare(
      `SELECT a.id, a.title, a.year, a.album_artist, a.track_file_count, a.track_count,
        a.size_bytes, a.path, a.rg_mbid,
        (SELECT format FROM tracks WHERE album_id=a.id AND format IS NOT NULL AND format<>''
          GROUP BY format ORDER BY COUNT(*) DESC LIMIT 1) AS format
       FROM albums a WHERE a.match_state='dismissed' ORDER BY a.album_artist, a.title`
    )
    .all();
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

// Rarezas e inéditos: los orphan (demos, maquetas, tomas perdidas), material que en
// otras herramientas se pierde.
export function rarities() {
  return db
    .prepare(
      `SELECT id, title, album_artist, year, cover, track_file_count, path
       FROM albums WHERE match_state = 'orphan' ORDER BY album_artist, year, title`
    )
    .all();
}

// Bootlegs: directos no oficiales, sesiones de radio, ROIOs. Como las rarezas, cuentan
// en lo descriptivo pero no en el completismo; aquí tienen su propia sección.
export function bootlegs() {
  return db
    .prepare(
      `SELECT id, title, album_artist, year, cover, track_file_count, path
       FROM albums WHERE match_state = 'bootleg' ORDER BY album_artist, year, title`
    )
    .all();
}
