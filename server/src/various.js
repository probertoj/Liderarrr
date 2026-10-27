import { db } from './db.js';

// «Various Artists» no es un artista: es el cajón donde MusicBrainz acredita los
// recopilatorios. Tratarlo como a cualquier otro salía carísimo y además mentía: su
// «discografía» son decenas de miles de release groups (27.139 en una biblioteca real),
// así que el refresco nocturno le pedía a MusicBrainz 272 páginas, el calendario se
// llenaba de recopilatorios ajenos y su ficha enseñaba un completismo del 0 % sobre
// discos que nadie va a tener nunca. Aquí se decide, en un solo sitio, quién es el cajón.
export const VA_MBID = '89ad4ac3-39f7-470e-963a-56509c546377';

// Los comodines que usan las etiquetas para lo mismo. Hacen falta además del MBID porque
// la ficha que crea el escaneo aún no está identificada.
export const VA_ARTIST_RE =
  /^\s*(various\s*artists?|various|varios(\s+artistas)?|artistas?\s+varios|v\.?\s*a\.?|v\/a|aa\.?\s*vv\.?|compilation|recopilatorio)\s*$/i;

export function isVariousArtists(artist) {
  if (!artist) return false;
  if (String(artist.mbid || '').toLowerCase() === VA_MBID) return true;
  return VA_ARTIST_RE.test(String(artist.name || ''));
}

// Los ids del cajón en esta base (normalmente uno, pero puede haber varias grafías sin
// identificar). El LIKE es solo un filtro barato para no leer la tabla entera: quien
// decide de verdad es isVariousArtists.
export function variousArtistIds() {
  const filas = db
    .prepare(
      `SELECT id, name, mbid FROM artists
        WHERE mbid = @va
           OR name LIKE 'v%' OR name LIKE 'aa%' OR name LIKE 'artistas%'
           OR name LIKE 'compilation%' OR name LIKE 'recopilat%'`
    )
    .all({ va: VA_MBID });
  return new Set(filas.filter(isVariousArtists).map((r) => r.id));
}

// Trozo de SQL para dejar el cajón fuera de una consulta sobre release_groups. Los ids
// salen de la propia base y son enteros, así que interpolarlos no abre ninguna puerta.
export function excludeVariousSql(columna = 'rg.artist_id') {
  const ids = [...variousArtistIds()];
  return ids.length ? `AND ${columna} NOT IN (${ids.join(',')})` : '';
}

// Limpieza de lo que se guardó antes de que existiera esta regla: la discografía
// descargada del cajón, su resumen y, si alguien llegó a seguirlo, el seguimiento.
// NO toca ni la ficha ni tus discos: los recopilatorios siguen en tu biblioteca.
export function purgeVariousArtists() {
  const ids = [...variousArtistIds()];
  if (!ids.length) return { rgs: 0, tracked: 0, ext: 0, artists: 0 };
  const marcas = ids.map(() => '?').join(',');
  const borra = (tabla) => db.prepare(`DELETE FROM ${tabla} WHERE artist_id IN (${marcas})`).run(...ids).changes;
  let rgs = 0;
  let tracked = 0;
  let ext = 0;
  db.transaction(() => {
    rgs = borra('release_groups');
    tracked = borra('tracked_artists');
    ext = borra('external_releases');
    borra('artist_stats');
  })();
  return { rgs, tracked, ext, artists: ids.length };
}
