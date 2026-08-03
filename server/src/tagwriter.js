import fs from 'node:fs';
import { parseFile } from 'music-metadata';
import taglib from 'node-taglib-sharp';
import { db, getSetting } from './db.js';

const { File } = taglib;

// Escritura de etiquetas: la ÚNICA parte de Liderarrr que toca tus ficheros, y por
// eso la más blindada. Reglas, todas obligatorias:
//   1. Opt-in: solo si el ajuste allow_tag_writing está activo.
//   2. Solo sobre álbumes 'matched' (identificados con confianza). NUNCA sobre
//      rarezas (orphan), sin identificar ni descartados: son justo los ficheros
//      sin dato canónico, donde una "corrección" sería lo más dañino.
//   3. Solo escribe IDENTIFICADORES de MusicBrainz (los MBID), nada subjetivo
//      (género, carátula, título…). Es el dato del que estamos 100% seguros y el
//      que hace instantánea la próxima identificación.
//   4. Nunca borra: solo escribe un campo si tenemos valor y difiere del actual.
//   5. Siempre con preview + confirmación desde la interfaz.

// Reúne los MBID que conocemos de un álbum identificado.
function albumMbids(albumId) {
  const a = db
    .prepare(
      `SELECT al.id, al.title, al.match_state, al.rg_mbid, al.release_mbid, ar.mbid AS artist_mbid
       FROM albums al LEFT JOIN artists ar ON ar.id = al.artist_id WHERE al.id = ?`
    )
    .get(albumId);
  if (!a) throw new Error('Álbum no encontrado');
  return a;
}

// Lo que escribiríamos en un fichero, comparado con lo que ya tiene. Devuelve solo
// los cambios reales (campo, de, a). Lee el estado actual con music-metadata (el
// mismo lector del escáner), así el diff es exactamente lo que verá el próximo escaneo.
async function fileDiff(trackPath, desired, trackRecordingId) {
  let cur = {};
  try {
    const mm = await parseFile(trackPath, { duration: false, skipCovers: true });
    cur = mm.common || {};
  } catch {
    /* fichero ilegible: se reporta como no escribible más abajo */
  }
  const first = (v) => (Array.isArray(v) ? v[0] : v) || null;
  // El Album Artist Id se ESCRIBE igual (interoperabilidad con Picard y demás),
  // pero no se muestra en el diff: no todos los formatos lo exponen al releer, y
  // saldría como un cambio "pendiente" perpetuo. Su valor es el mismo que el del
  // Artist Id, que sí mostramos.
  const fields = [
    { key: 'releaseGroup', label: 'MusicBrainz Release Group Id', now: cur.musicbrainz_releasegroupid, next: desired.rg_mbid },
    { key: 'release', label: 'MusicBrainz Album Id', now: cur.musicbrainz_albumid, next: desired.release_mbid },
    { key: 'artist', label: 'MusicBrainz Artist Id', now: first(cur.musicbrainz_artistid), next: desired.artist_mbid },
    { key: 'recording', label: 'MusicBrainz Recording Id', now: cur.musicbrainz_recordingid, next: trackRecordingId },
  ];
  const changes = [];
  for (const f of fields) {
    if (f.next && f.next !== f.now) changes.push({ field: f.label, from: f.now || null, to: f.next });
  }
  return changes;
}

function writable(p) {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Previsualiza los cambios de etiquetas para un álbum, pista a pista.
export async function previewAlbumTags(albumId) {
  const a = albumMbids(albumId);
  const enabled = getSetting('allow_tag_writing') === '1';
  if (a.match_state !== 'matched') {
    return { eligible: false, reason: 'Solo se escriben etiquetas en álbumes identificados con confianza.', writingEnabled: enabled };
  }
  const desired = { rg_mbid: a.rg_mbid, release_mbid: a.release_mbid, artist_mbid: a.artist_mbid };
  if (!desired.rg_mbid && !desired.release_mbid && !desired.artist_mbid) {
    return { eligible: false, reason: 'No tenemos ningún MBID que escribir para este álbum.', writingEnabled: enabled };
  }
  const tracks = db.prepare('SELECT id, path, format, mb_recording_id FROM tracks WHERE album_id = ? ORDER BY disc, num').all(albumId);
  const out = [];
  let total = 0;
  for (const t of tracks) {
    const changes = await fileDiff(t.path, desired, t.mb_recording_id);
    total += changes.length;
    out.push({ path: t.path, format: t.format, writable: writable(t.path), changes });
  }
  return {
    eligible: true,
    writingEnabled: enabled,
    album: a.title,
    values: desired,
    totalChanges: total,
    tracks: out,
  };
}

// Escribe los MBID en los ficheros. Doble candado: ajuste activo + álbum matched.
export async function writeAlbumTags(albumId) {
  if (getSetting('allow_tag_writing') !== '1') {
    throw new Error('La escritura de etiquetas está desactivada (actívala en Ajustes).');
  }
  const a = albumMbids(albumId);
  if (a.match_state !== 'matched') {
    throw new Error('Solo se escriben etiquetas en álbumes identificados (matched).');
  }
  const tracks = db.prepare('SELECT id, path, mb_recording_id FROM tracks WHERE album_id = ?').all(albumId);
  let written = 0;
  const errors = [];
  for (const t of tracks) {
    try {
      if (!writable(t.path)) throw new Error('fichero de solo lectura (¿está la música montada en :ro?)');
      const file = File.createFromPath(t.path);
      const tag = file.tag;
      // solo asignamos si tenemos valor: nunca borramos lo que ya haya
      if (a.rg_mbid) tag.musicBrainzReleaseGroupId = a.rg_mbid;
      if (a.release_mbid) tag.musicBrainzReleaseId = a.release_mbid;
      if (a.artist_mbid) {
        tag.musicBrainzArtistId = a.artist_mbid;
        tag.musicBrainzReleaseArtistId = a.artist_mbid;
      }
      if (t.mb_recording_id) tag.musicBrainzTrackId = t.mb_recording_id;
      file.save();
      file.dispose();
      written++;
    } catch (err) {
      errors.push({ path: t.path, error: String(err.message || err) });
    }
  }
  return { written, total: tracks.length, errors: errors.slice(0, 30) };
}
