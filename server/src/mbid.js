// IDENTIFICADORES DE MUSICBRAINZ QUE NO LO SON.
//
// Lo que traen las etiquetas en «MusicBrainz Artist Id» se guardaba tal cual. Y hay
// etiquetadores que meten ahí cualquier cosa: dos MBID pegados con un espacio (una
// colaboración), un número de Discogs («476414») o un id de Spotify
// («1jzmHk0SLhAJjEw6NqvaLs»). Con eso guardado como MBID del artista, cada refresco le
// pedía a MusicBrainz la discografía de algo que no existe: error 400, todas las noches, y
// ese artista sin discografía ni completismo para siempre.

export const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUELTO = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const esMbid = (v) => typeof v === 'string' && MBID_RE.test(v);

// El primer MBID de verdad que haya en un valor de etiqueta (cadena o lista), o null.
// «uuid uuid» → el primero; «476414» → null.
export function unMbid(v) {
  const primero = Array.isArray(v) ? v[0] : v;
  if (primero == null) return null;
  const m = String(primero).match(SUELTO);
  return m ? m[0].toLowerCase() : null;
}

// Limpia lo que ya se guardó mal. Artistas: fuera el MBID que no lo es (no se le pone el
// primero de «uuid uuid»: ese es de UNO de los dos, que tendrá su propia ficha). Discos y
// pistas: se rescata el MBID válido si lo hay dentro; si no, a NULL. Devuelve los recuentos.
export function limpiarMbidInvalidos(db) {
  const r = { artistas: 0, albumes: 0, pistas: 0 };
  db.transaction(() => {
    const quitar = db.prepare('UPDATE artists SET mbid = NULL WHERE id = ?');
    for (const a of db.prepare('SELECT id, mbid FROM artists WHERE mbid IS NOT NULL').all()) {
      if (!esMbid(a.mbid)) {
        quitar.run(a.id);
        r.artistas++;
      }
    }
    const ponerRg = db.prepare('UPDATE albums SET rg_mbid = ? WHERE id = ?');
    const ponerRel = db.prepare('UPDATE albums SET release_mbid = ? WHERE id = ?');
    for (const a of db
      .prepare('SELECT id, rg_mbid, release_mbid FROM albums WHERE (rg_mbid IS NOT NULL AND length(rg_mbid) != 36) OR (release_mbid IS NOT NULL AND length(release_mbid) != 36)')
      .all()) {
      if (a.rg_mbid && !esMbid(a.rg_mbid)) ponerRg.run(unMbid(a.rg_mbid), a.id);
      if (a.release_mbid && !esMbid(a.release_mbid)) ponerRel.run(unMbid(a.release_mbid), a.id);
      r.albumes++;
    }
    const ponerRec = db.prepare('UPDATE tracks SET mb_recording_id = ? WHERE id = ?');
    for (const t of db.prepare('SELECT id, mb_recording_id FROM tracks WHERE mb_recording_id IS NOT NULL AND length(mb_recording_id) != 36').all()) {
      ponerRec.run(unMbid(t.mb_recording_id), t.id);
      r.pistas++;
    }
  })();
  return r;
}
