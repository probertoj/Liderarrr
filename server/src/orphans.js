import { db } from './db.js';

// El esquema no tiene claves ajenas, así que SQLite no impide que un borrado deje atrás las
// filas que colgaban de él: las pistas de un álbum que ya no está, el resumen de un artista
// fusionado, la discografía de una ficha borrada. No es teórico: un puntero a un álbum que
// ya no existe hace que un disco cuente como «lo tienes» cuando no lo tienes.
//
// Esta barrida lo recoge. Es CONSERVADORA a propósito: solo mira filas cuyo padre ya no
// existe, y nunca toca `albums` ni `artists` —ahí están tus ficheros y tus fichas; si algo
// queda raro ahí, se avisa y lo arreglas tú—.

// accion:
//   'borrar' → la fila no significa nada sin su padre (una pista sin álbum).
//   'soltar' → la fila sigue valiendo; lo que sobra es el puntero (un lanzamiento que
//              apuntaba a una copia tuya ya borrada: el lanzamiento existe, tuyo ya no es).
//   'avisar' → ni se toca: solo se cuenta, porque borrarlo sería perder algo tuyo.
export const RELACIONES = [
  { hija: 'tracks', col: 'album_id', padre: 'albums', accion: 'borrar', que: 'pistas de álbumes que ya no están' },
  { hija: 'album_tags', col: 'album_id', padre: 'albums', accion: 'borrar', que: 'etiquetas de álbumes que ya no están' },
  { hija: 'album_tags', col: 'tag_id', padre: 'tags', accion: 'borrar', que: 'etiquetas que apuntan a un género borrado' },
  { hija: 'album_artists', col: 'album_id', padre: 'albums', accion: 'borrar', que: 'créditos de álbumes que ya no están' },
  { hija: 'album_artists', col: 'artist_id', padre: 'artists', accion: 'borrar', que: 'créditos de artistas que ya no están' },
  { hija: 'album_labels', col: 'album_id', padre: 'albums', accion: 'borrar', que: 'sellos de álbumes que ya no están' },
  { hija: 'album_labels', col: 'label_id', padre: 'labels', accion: 'borrar', que: 'sellos borrados' },
  { hija: 'artist_stats', col: 'artist_id', padre: 'artists', accion: 'borrar', que: 'resúmenes de artistas que ya no están' },
  { hija: 'release_groups', col: 'artist_id', padre: 'artists', accion: 'borrar', que: 'discografías de artistas que ya no están' },
  { hija: 'tracked_artists', col: 'artist_id', padre: 'artists', accion: 'borrar', que: 'seguimientos de artistas que ya no están' },
  { hija: 'external_releases', col: 'artist_id', padre: 'artists', accion: 'borrar', que: 'novedades de artistas que ya no están' },
  { hija: 'challenge_items', col: 'challenge_id', padre: 'challenges', accion: 'borrar', que: 'discos de retos borrados' },
  { hija: 'lyrics', col: 'track_id', padre: 'tracks', accion: 'borrar', que: 'letras de pistas que ya no están' },
  { hija: 'radar_items', col: 'curator_id', padre: 'curators', accion: 'borrar', que: 'novedades de curadores borrados' },

  // Punteros a una copia tuya que ya no existe. Ojo con `release_groups`: ahí `is_owned` se
  // va con el puntero, porque si no el disco seguiría contando como tuyo y ni el completismo
  // ni la auto-descarga volverían a pedirlo.
  { hija: 'release_groups', col: 'owned_album_id', padre: 'albums', accion: 'soltar', ademas: 'is_owned = 0', que: 'lanzamientos marcados como tuyos por una copia borrada' },
  { hija: 'challenge_items', col: 'owned_album_id', padre: 'albums', accion: 'soltar', que: 'discos de retos que apuntaban a una copia borrada' },
  { hija: 'downloads', col: 'album_id', padre: 'albums', accion: 'soltar', que: 'descargas que apuntaban a un álbum borrado' },

  // Un álbum TUYO cuya ficha de artista desapareció. No se borra: son tus ficheros.
  { hija: 'albums', col: 'artist_id', padre: 'artists', accion: 'avisar', que: 'álbumes tuyos sin ficha de artista' },
];

const donde = (r) =>
  `${r.col} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${r.padre} p WHERE p.id = ${r.hija}.${r.col})`;

/** Cuenta sin tocar nada. Devuelve [{…relación, n}] solo de las que tienen algo. */
export function contarHuerfanos() {
  const out = [];
  for (const r of RELACIONES) {
    let n = 0;
    try {
      n = db.prepare(`SELECT COUNT(*) AS n FROM ${r.hija} WHERE ${donde(r)}`).get().n;
    } catch {
      continue; // una tabla que aún no exista en una base vieja no es motivo de nada
    }
    if (n) out.push({ ...r, n });
  }
  return out;
}

/**
 * Barre lo que encuentre. Todo en una transacción: o queda limpio o no se toca nada.
 * Devuelve { borrados, soltados, avisados, detalle: [{hija, col, accion, n, que}] }.
 */
export function barrerHuerfanos() {
  const encontrados = contarHuerfanos();
  const detalle = encontrados.map(({ hija, col, accion, n, que }) => ({ hija, col, accion, n, que }));
  const aplicar = db.transaction(() => {
    for (const r of encontrados) {
      if (r.accion === 'avisar') continue;
      const sql =
        r.accion === 'borrar'
          ? `DELETE FROM ${r.hija} WHERE ${donde(r)}`
          : `UPDATE ${r.hija} SET ${r.col} = NULL${r.ademas ? `, ${r.ademas}` : ''} WHERE ${donde(r)}`;
      db.prepare(sql).run();
    }
  });
  aplicar();

  const suma = (accion) => detalle.filter((d) => d.accion === accion).reduce((s, d) => s + d.n, 0);
  return { borrados: suma('borrar'), soltados: suma('soltar'), avisados: suma('avisar'), detalle };
}

/** Una línea para el log (y por tanto para Diagnóstico), o null si no había nada. */
export function resumenHuerfanos(r) {
  if (!r.borrados && !r.soltados && !r.avisados) return null;
  const partes = [];
  if (r.borrados) partes.push(`${r.borrados} filas sueltas borradas`);
  if (r.soltados) partes.push(`${r.soltados} punteros a copias borradas`);
  if (r.avisados) partes.push(`${r.avisados} álbumes tuyos sin ficha de artista (no se tocan)`);
  const porQue = r.detalle.map((d) => `${d.n} ${d.que}`).join('; ');
  return `${partes.join(' · ')} — ${porQue}`;
}
