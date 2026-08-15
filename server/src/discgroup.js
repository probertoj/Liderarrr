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

// Nombre de carpeta EXPLÍCITAMENTE de disco: "CD 1", "Disc 2", "Disco 3", "CD1". Señal
// fuerte y segura: basta para agrupar discos hermanos aunque sus cuentas sean limpias
// (p. ej. Seamonsters: CD1 18/18, CD2 19/19, CD3 16/16). NO casa nombres de álbum normales.
function isExplicitDiscFolder(name) {
  return /(?:^|[^a-z])(?:cd|disco|dis[ck])\s*\.?\s*\d+/i.test(String(name || '').trim());
}

// Un nombre de carpeta parece un DISCO de una caja? Lo explícito (CD N) o un prefijo
// numerico corto ("01 ...", "1 - ..."). NO casa "1979 - Before Hollywood" (año de 4
// dígitos) ni nombres de album normales. El prefijo numérico es señal DÉBIL (podría ser
// álbumes numerados), así que solo cuenta con el total contaminado.
function isDiscFolder(name) {
  const b = String(name || '').trim();
  if (isExplicitDiscFolder(b)) return true;
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
      `SELECT id, path, album_artist, track_count, track_file_count, disc_count, disc_group, disc_group_manual
       FROM albums WHERE match_state != 'dismissed' AND path IS NOT NULL AND path <> ''`
    )
    .all();

  // agrupa candidatos. Los marcados a mano (disc_group_manual) NO participan. Dos señales:
  //  - EXPLÍCITA (carpeta "CD N"/"Disc N"): agrupa hermanas por (padre + artista), sin
  //    exigir total contaminado — así caza cajas ripeadas limpias (cada CD con su cuenta).
  //  - CONTAMINADA (total > ficheros, típico de cajas cuyas etiquetas traen el total de la
  //    caja): agrupa por (padre + artista + total), para no unir dos cajas distintas.
  const buckets = new Map();
  for (const a of rows) {
    if (a.disc_group_manual) continue;
    const p = String(a.path).replace(/\\/g, '/');
    const base = path.posix.basename(p);
    const parent = path.posix.dirname(p);
    const total = a.track_count || 0;
    const files = a.track_file_count || 0;
    const explicit = isExplicitDiscFolder(base);
    const contaminated = total > files && (isDiscFolder(base) || (a.disc_count || 1) > 1);
    if (!explicit && !contaminated) continue;
    const key = explicit ? [parent, norm(a.album_artist), 'disc'].join(' | ') : [parent, norm(a.album_artist), total].join(' | ');
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

  // aplica solo los cambios (idempotente). Respeta los grupos manuales (no se tocan).
  const setGroup = db.prepare('UPDATE albums SET disc_group = ? WHERE id = ?');
  const tx = db.transaction(() => {
    let changed = 0;
    for (const a of rows) {
      if (a.disc_group_manual) continue;
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

// --- combinar/separar multidiscos A MANO (estilo Plex/Roon) -------------------
// El usuario decide qué discos son una misma caja. Se marca disc_group_manual para que
// la heurística (regroupDiscs) no lo pise. Metadato interno: NO toca ficheros.

// Combina 2+ álbumes en una caja multidisco. Si alguno ya estaba en una caja (manual o
// no), todos sus miembros se absorben en el grupo nuevo. Devuelve el grupo y el nº de discos.
export function combineAlbums(ids) {
  const wanted = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (wanted.length < 2) throw new Error('Elige al menos dos discos para combinar');
  const rows = db
    .prepare(`SELECT id, disc_group FROM albums WHERE id IN (${wanted.map(() => '?').join(',')}) AND match_state != 'dismissed'`)
    .all(...wanted);
  if (rows.length < 2) throw new Error('No se encontraron los discos a combinar');

  // absorbe también a los que ya compartían disc_group con alguno de los elegidos
  const existingGroups = [...new Set(rows.map((r) => r.disc_group).filter(Boolean))];
  const memberIds = new Set(rows.map((r) => r.id));
  if (existingGroups.length) {
    for (const m of db
      .prepare(`SELECT id FROM albums WHERE disc_group IN (${existingGroups.map(() => '?').join(',')})`)
      .all(...existingGroups))
      memberIds.add(m.id);
  }

  const group = `manual:${sha1([...memberIds].sort((a, b) => a - b).join(','))}`;
  const set = db.prepare('UPDATE albums SET disc_group = ?, disc_group_manual = 1 WHERE id = ?');
  const tx = db.transaction(() => {
    for (const id of memberIds) set.run(group, id);
  });
  tx();
  return { group, discs: memberIds.size };
}

// Separa una caja: quita el disc_group a TODOS los discos del grupo del álbum dado y los
// marca como manual (para que la heurística no vuelva a agruparlos). Vuelven a ser álbumes
// independientes.
export function uncombineAlbum(albumId) {
  const a = db.prepare('SELECT id, disc_group FROM albums WHERE id = ?').get(Number(albumId));
  if (!a) throw new Error('Álbum no encontrado');
  if (!a.disc_group) return { separated: 0 };
  const r = db.prepare('UPDATE albums SET disc_group = NULL, disc_group_manual = 1 WHERE disc_group = ?').run(a.disc_group);
  return { separated: r.changes };
}

// Candidatos para «combinar con…» desde la ficha de un álbum: otros discos del MISMO
// artista o de la MISMA carpeta padre, que no estén ya en su caja. Para elegir a mano
// los discos de un doble/triple que la heurística no agrupó bien.
export function combineCandidates(albumId) {
  const a = db.prepare('SELECT id, artist_id, path, disc_group FROM albums WHERE id = ?').get(Number(albumId));
  if (!a) throw new Error('Álbum no encontrado');
  const parent = a.path ? String(a.path).replace(/\\/g, '/').replace(/\/[^/]*$/, '') : null;
  const rows = db
    .prepare(
      `SELECT id, title, album_artist, year, track_file_count, track_count, path, disc_group
       FROM albums
       WHERE id != @id AND match_state != 'dismissed'
         AND (disc_group IS NULL OR disc_group != @dg)
         AND (artist_id = @aid OR (@parent IS NOT NULL AND path LIKE @parentLike))
       ORDER BY path`
    )
    .all({ id: a.id, aid: a.artist_id, dg: a.disc_group || '', parent, parentLike: parent ? `${parent}/%` : null });
  // dedup y marca si el candidato ya está en otra caja
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    album_artist: r.album_artist,
    year: r.year,
    track_file_count: r.track_file_count,
    track_count: r.track_count,
    path: r.path,
    in_box: !!r.disc_group,
  }));
}
