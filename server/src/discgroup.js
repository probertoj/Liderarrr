import path from 'node:path';
import { db } from './db.js';
import { sha1 } from './libkey.js';

// Multidiscos. Una CAJA (box-set, deluxe, antologia) suele venir como una carpeta
// por disco (CD 1, CD 2...). Como la identidad de album es la carpeta, cada disco se
// registra como un album aparte, y como sus etiquetas llevan el total de la CAJA
// (p. ej. "pista 7 de 92"), cada disco parece un incompleto brutal (7/92). Esto
// marca esos discos con un `disc_group` comun para que las vistas los cuenten como
// un solo album.
//
// SOLO LECTURA sobre tus ficheros: trabaja unicamente con lo que el escaner ya
// guardo (ruta, artista, cuentas). No abre, mueve ni reescribe nada. Idempotente.

// Normaliza artista para comparar (acentos/mayusculas/puntuacion fuera).
// ̀-ͯ = marcas diacriticas combinantes que deja NFKD (los acentos).
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Un nombre de carpeta parece un DISCO de una caja? "CD 1", "Disc 2", "Disco 3",
// "CD1", o un prefijo numerico corto de disco ("01 ...", "1 - ..."). NO casa
// "1979 - Before Hollywood" (ano de 4 digitos) ni nombres de album normales.
function isDiscFolder(name) {
  const b = String(name || '').trim();
  if (/(?:^|[^a-z])(?:cd|disco|dis[ck])\s*\.?\s*\d+/i.test(b)) return true;
  if (/^\d{1,2}[\s.\-_]/.test(b)) return true;
  return false;
}

// Recalcula los `disc_group` de toda la biblioteca. Senal de caja (robusta y sin
// depender de MBID, que estas cajas no traen): subcarpetas HERMANAS bajo un mismo
// padre que comparten album_artist y el MISMO track_count "de caja" que SUPERA sus
// ficheros (total contaminado), y con nombre de disco. Se excluyen las auto-completas
// (track_count == ficheros): son cajas cuyos discos vienen como albumes propios y
// completos, y se respetan como albumes separados.
export function regroupDiscs() {
  const rows = db
    .prepare(
      `SELECT id, path, album_artist, track_count, track_file_count, disc_count, disc_group
       FROM albums WHERE match_state != 'dismissed' AND path IS NOT NULL AND path <> ''`
    )
    .all();

  // agrupa candidatos por (carpeta padre + artista + total de caja)
  const buckets = new Map();
  for (const a of rows) {
    const p = String(a.path).replace(/\\/g, '/');
    const base = path.posix.basename(p);
    const parent = path.posix.dirname(p);
    const total = a.track_count || 0;
    const files = a.track_file_count || 0;
    const looksDisc = total > files && (isDiscFolder(base) || (a.disc_count || 1) > 1);
    if (!looksDisc) continue;
    const key = [parent, norm(a.album_artist), total].join(' ');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(a);
  }

  // disc_group deseado por id (null = album normal). Un grupo necesita 2+ hermanas.
  const desired = new Map();
  for (const a of rows) desired.set(a.id, null);
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const g = sha1(key);
    for (const m of members) desired.set(m.id, g);
  }

  // aplica solo los cambios (idempotente)
  const setGroup = db.prepare('UPDATE albums SET disc_group = ? WHERE id = ?');
  const tx = db.transaction(() => {
    let changed = 0;
    for (const a of rows) {
      const want = desired.get(a.id) ?? null;
      if ((a.disc_group || null) !== want) {
        setGroup.run(want, a.id);
        changed++;
      }
    }
    return changed;
  });
  const changed = tx();
  const groups = new Set([...desired.values()].filter(Boolean)).size;
  console.log(`[discgroup] cajas multidisco: ${groups} grupos - ${changed} filas actualizadas`);
  return { groups, changed };
}
