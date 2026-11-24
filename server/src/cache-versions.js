// Versionado de la caché de servicios externos. Cuando cambian las reglas con
// las que se pidió o interpretó algo (p. ej. qué campos pedimos a MusicBrainz),
// se sube el número y las entradas viejas se tiran solas al arrancar (ver db.js).
//
// La clave de cada entrada de `ext_cache` empieza por un prefijo de servicio:
//   mb:...      MusicBrainz
//   dc:...      Discogs
//   lf:...      Last.fm
//   ac:...      AcoustID (huellas: NUNCA caducan, una huella es para siempre)
export const CACHE_VERSIONS = {
  mb: 3,
  dc: 1,
  lf: 1,
};

// Edad máxima por servicio antes de refrescar (ms). AcoustID no está: sus
// entradas son inmutables y se guardan aparte, en acoustid_cache.
const DAY = 24 * 3600 * 1000;
export const CACHE_MAX_AGE = {
  mb: 30 * DAY,
  dc: 30 * DAY,
  lf: 7 * DAY,
};

// Los 30 días de arriba valen para lo que no cambia (los créditos de un disco, las ediciones
// de un álbum de 1994). Para LO QUE SALE NUEVO no: la lista de discos de un artista o de un
// sello se guardaba 30 días y ni el botón «Discografía» la volvía a pedir, así que un disco
// recién publicado tardaba hasta cinco semanas en aparecer, pulsaras lo que pulsaras.
// Quien pide esas listas dice cuánto se fía de la copia:
const HORA = 3600 * 1000;
export const FRESCURA = {
  // has pulsado el botón: se pregunta de verdad (un minuto de margen contra el doble clic)
  boton: 60 * 1000,
  // artistas que sigues: el refresco de cada noche vuelve a preguntar
  seguidos: 12 * HORA,
  // el resto de tu colección: una vez por semana, repartido entre las noches
  resto: 6 * 24 * HORA,
  // catálogo de un sello seguido: son muchas páginas, cada tres noches
  sellos: 60 * HORA,
};

// SQL que selecciona las filas de ext_cache ya superadas: o son de una versión
// vieja del prefijo, o han caducado por edad.
export function staleCacheSql() {
  const clauses = [];
  for (const [prefix, ver] of Object.entries(CACHE_VERSIONS)) {
    const maxAge = CACHE_MAX_AGE[prefix] ?? 30 * DAY;
    clauses.push(
      `(key LIKE '${prefix}:%' AND (version < ${ver} OR fetched_at < ${Date.now() - maxAge}))`
    );
  }
  return clauses.join(' OR ');
}

export function versionFor(key) {
  const prefix = String(key).split(':')[0];
  return CACHE_VERSIONS[prefix] ?? 0;
}
