import path from 'node:path';
import { db } from './db.js';
import { sha1 } from './libkey.js';
import * as mb from './musicbrainz.js';

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

// Conjunto de discos COHERENTE para agrupar por tag: todos los números de disco son
// DISTINTOS (cada disco aparece una vez) y ≥1. Es la salvaguarda contra falsos positivos:
// dos «disc 1» son copias/duplicados (o dos copias de la misma caja), no una caja → no se
// agrupan. Un hueco (1,_,3) sí es válido: son discos distintos presentes.
export function isCleanDiscSet(discs) {
  const arr = (discs || []).map((d) => Number(d) || 0);
  if (arr.length < 2) return false;
  if (arr.some((d) => d < 1)) return false;
  return new Set(arr).size === arr.length;
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

  // 2ª pasada — POR TAG DISCNUMBER (independiente del nombre de carpeta): agrupa discos que
  // comparten padre + título + artista y traen DISCTOTAL>1, exigiendo números de disco
  // DISTINTOS (salvaguarda anti-duplicados). Captura lo que el nombre de carpeta no revela
  // («Coser i cantar (1)» + «(Disc 2)») y COMPLETA cajas ya formadas con su disco suelto
  // (el «(1)» de «Keep An Eye On The Sky» cuyos 2-4 ya estaban). No pisa lo ya agrupado.
  const discNo = new Map(); // album_id -> nº de disco representativo (moda de tracks.disc)
  for (const r of db.prepare('SELECT album_id, disc, COUNT(*) c FROM tracks GROUP BY album_id, disc').all()) {
    const cur = discNo.get(r.album_id);
    if (!cur || r.c > cur.c) discNo.set(r.album_id, { disc: r.disc || 1, c: r.c });
  }
  const folderDisc = (id) => discNo.get(id)?.disc || 1;

  const tagBuckets = new Map();
  for (const a of rows) {
    if (a.disc_group_manual) continue;
    if ((a.disc_count || 1) < 2) continue;
    const p = String(a.path).replace(/\\/g, '/');
    const key = [path.posix.dirname(p), norm(a.album_artist), norm(a.title)].join(' | ');
    if (!tagBuckets.has(key)) tagBuckets.set(key, []);
    tagBuckets.get(key).push(a);
  }
  for (const [key, members] of tagBuckets) {
    if (members.length < 2) continue;
    // grupos ya asignados a estos miembros (por la 1ª pasada): deben ser 0 o 1 (sin conflicto)
    const existing = [...new Set(members.map((m) => desired.get(m.id)).filter(Boolean))];
    if (existing.length > 1) continue; // ambiguo: miembros en cajas distintas → no tocar
    // conjunto de discos = strays de este bucket + los del grupo existente (si lo hay), y
    // debe ser LIMPIO (todos distintos). Así no se cuelan copias del mismo disco.
    const groupId = existing[0] || sha1('tag | ' + key);
    const groupMates = existing.length ? rows.filter((r) => desired.get(r.id) === existing[0]) : [];
    const union = new Map(); // id -> disc (dedup por id)
    for (const m of members) union.set(m.id, folderDisc(m.id));
    for (const m of groupMates) union.set(m.id, folderDisc(m.id));
    if (!isCleanDiscSet([...union.values()])) continue; // duplicados → conservador, no agrupar
    for (const id of union.keys()) desired.set(id, groupId);
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

// --- caja como una unidad de MusicBrainz (0.9.x fase 2) -----------------------
// Trata un disc_group como UN box set: lo identifica contra MB (un release-group / release
// con N medios) y mide el completismo a nivel de caja (discos presentes / disc_total).

// Nº de disco representativo de una carpeta (moda de tracks.disc).
function folderDiscNo(albumId) {
  const r = db.prepare('SELECT disc, COUNT(*) c FROM tracks WHERE album_id=? GROUP BY disc ORDER BY c DESC LIMIT 1').get(albumId);
  return r?.disc || 1;
}

// Info de caja para la ficha: discos presentes (números distintos), disc_total (del release
// de MB si está identificada, si no del DISCTOTAL de las etiquetas) y si está completa.
export function boxInfo(discGroup) {
  if (!discGroup) return null;
  const members = db
    .prepare("SELECT id, disc_count FROM albums WHERE disc_group = ? AND match_state != 'dismissed'")
    .all(discGroup);
  if (members.length < 2) return null;
  const present = new Set(members.map((m) => folderDiscNo(m.id))).size;
  const box = db.prepare('SELECT * FROM disc_boxes WHERE disc_group = ?').get(discGroup);
  const tagTotal = Math.max(present, ...members.map((m) => m.disc_count || 1));
  const total = box?.disc_total || tagTotal;
  return {
    identified: !!box?.rg_mbid,
    rg_mbid: box?.rg_mbid || null,
    release_mbid: box?.release_mbid || null,
    title: box?.title || null,
    artist: box?.artist || null,
    present,
    total,
    complete: present >= total,
  };
}

// Identifica la caja: busca en MB por el artista + título base (del disco con más pistas),
// y fija disc_total con el nº de medios de la edición de MB que cuadre (o el DISCTOTAL de las
// etiquetas). Guarda en disc_boxes. Cero falsos: exige score>=80 en la búsqueda del RG.
export async function identifyBox(discGroup) {
  const members = db
    .prepare("SELECT id, album_artist, title, disc_count, track_file_count FROM albums WHERE disc_group = ? AND match_state != 'dismissed'")
    .all(discGroup);
  if (members.length < 2) throw new Error('Este álbum no es una caja multidisco.');
  const artist = members.find((m) => String(m.album_artist || '').trim())?.album_artist || '';
  const rep = members.slice().sort((a, b) => (b.track_file_count || 0) - (a.track_file_count || 0))[0];
  const title = mb.cleanAlbumTitle(rep.title, artist);
  const rg = await mb.searchReleaseGroup(artist, title).catch(() => null);
  if (!rg || (rg.score || 0) < 80) throw new Error('No encontré esta caja en MusicBrainz con seguridad. Puedes fijarla a mano en cada disco.');

  const present = new Set(members.map((m) => folderDiscNo(m.id))).size;
  const tagTotal = Math.max(present, ...members.map((m) => m.disc_count || 1));
  // Entre las ediciones del RG, la que tenga tantos medios como discos declara la caja.
  const releases = await mb.releaseGroupReleases(rg.rg_mbid).catch(() => []);
  const match = releases.find((r) => r.discs === tagTotal) || releases.find((r) => r.discs >= present && r.discs > 1) || null;
  const discTotal = match?.discs || tagTotal;

  db.prepare(
    `INSERT INTO disc_boxes (disc_group, rg_mbid, release_mbid, disc_total, title, artist, identified_at)
     VALUES (@dg, @rg, @rel, @total, @title, @artist, @now)
     ON CONFLICT(disc_group) DO UPDATE SET rg_mbid=excluded.rg_mbid, release_mbid=excluded.release_mbid,
       disc_total=excluded.disc_total, title=excluded.title, artist=excluded.artist, identified_at=excluded.identified_at`
  ).run({ dg: discGroup, rg: rg.rg_mbid, rel: match?.mbid || null, total: discTotal, title: rg.title, artist: rg.artist, now: Date.now() });

  return boxInfo(discGroup);
}
