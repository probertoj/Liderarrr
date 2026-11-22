import fs from 'node:fs';
import { db, getSetting } from './db.js';
import { splitRoots, isJunkEntry } from './libkey.js';
import { isAudio } from './scanner.js';

// DISCOS CUYA CARPETA YA NO ESTÁ.
//
// El escáner solo apunta lo que encuentra: si renombras o mueves una carpeta con otra
// herramienta (Picard, beets, a mano), aparece un disco nuevo y el viejo se queda en la
// base para siempre, contando como tuyo y apuntando a una ruta que no existe. Eso da
// discos repetidos, «lo tienes» que no es verdad y auto-descargas que no se lanzan.
//
// Aquí SOLO se marca (albums.missing_since). No se borra nada por cuenta propia: un NAS
// que tarda en montar un volumen haría «desaparecer» media biblioteca, y dar eso por bueno
// dispararía la re-descarga de todo. Quitar un disco de la app lo decides tú, y solo de
// la base: aquí no se toca ni un fichero.
//
// La forma de decidir si un disco «falta» viene del fork de tinker-net (su libsync.js),
// que lo resolvía mejor que la primera versión de este módulo en tres cosas: distinguir «no
// existe» de «no lo puedo leer», ver la carpeta que sigue ahí pero ya sin audio, y dar una
// raíz por viva solo si conserva audio conocido (no si simplemente no está vacía).

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

// ¿Sigue el disco en su carpeta? 'esta' · 'falta' · 'duda'.
//
// Solo ENOENT/ENOTDIR prueban que no existe. Un EACCES, un EIO o un corte de la red NO
// prueban nada: es 'duda', y con la duda no se marca ni se desmarca.
//
// Con `aFondo` se abre la carpeta y se exige que quede audio dentro. Sin él vale un atajo:
// si la carpeta no ha cambiado desde el último escaneo, dentro hay lo que la base ya sabe.
// Si cambió, el escáner la habrá releído SALVO que se haya quedado sin audio (una carpeta
// sin audio no se visita): ese es justo el caso que hay que mirar aquí.
export function estadoDeCarpeta(album, { aFondo = false } = {}) {
  let st;
  try {
    st = fs.statSync(album.path);
  } catch (e) {
    return e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? 'falta' : 'duda';
  }
  if (!st.isDirectory()) return 'duda';
  if (!aFondo && album.scanned_at && st.mtimeMs <= album.scanned_at) return 'esta';
  let entradas;
  try {
    entradas = fs.readdirSync(album.path, { withFileTypes: true });
  } catch {
    return 'duda';
  }
  return entradas.some((e) => e.isFile() && !isJunkEntry(e.name) && isAudio(e.name)) ? 'esta' : 'falta';
}

// Una raíz «viva»: al menos UNO de sus discos conocidos sigue teniendo audio. Que la
// carpeta exista y no esté vacía no basta: detrás de un montaje caído puede quedar un
// directorio con restos (un @eaDir, un .DS_Store) que no es tu música.
function raizViva(suyos, estado) {
  for (const a of suyos) if (estado(a, { aFondo: true }) === 'esta') return true;
  return false;
}

// Si de golpe falta más de esto en una raíz, lo que falla es la raíz, no los discos.
export const UMBRAL_SOSPECHA = 0.2;

// Repasa todas las rutas y marca/desmarca. Devuelve { faltan, nuevos, recuperados, dudas, dudosas }.
export function marcarDesaparecidos(ahora = Date.now(), estado = estadoDeCarpeta) {
  const roots = splitRoots(getSetting('music_dirs')).map(norm).filter(Boolean);
  const filas = db.prepare('SELECT id, path, scanned_at, missing_since FROM albums WHERE path IS NOT NULL').all();
  const marcar = db.prepare('UPDATE albums SET missing_since = ? WHERE id = ? AND missing_since IS NULL');
  const desmarcar = db.prepare('UPDATE albums SET missing_since = NULL WHERE id = ?');
  const r = { faltan: 0, nuevos: 0, recuperados: 0, dudas: 0, dudosas: [] };
  for (const raiz of roots) {
    const suyos = filas.filter((f) => norm(f.path) === raiz || norm(f.path).startsWith(raiz + '/'));
    if (!suyos.length) continue;
    if (!raizViva(suyos, estado)) {
      r.dudosas.push(raiz);
      continue;
    }
    const como = new Map(suyos.map((f) => [f.id, estado(f)]));
    const ausentes = suyos.filter((f) => como.get(f.id) === 'falta');
    r.dudas += suyos.filter((f) => como.get(f.id) === 'duda').length;
    // demasiados de golpe (y no es que ya estuvieran marcados): no se toca nada de esta raíz
    const nuevosAusentes = ausentes.filter((f) => !f.missing_since);
    if (nuevosAusentes.length > Math.max(20, suyos.length * UMBRAL_SOSPECHA)) {
      r.dudosas.push(raiz);
      console.warn(
        `[desaparecidos] ${nuevosAusentes.length} de ${suyos.length} discos de ${raiz} no aparecen de golpe: parece un problema del volumen, no se marca nada.`
      );
      continue;
    }
    db.transaction(() => {
      for (const f of suyos) {
        const e = como.get(f.id);
        if (e === 'falta') {
          if (!f.missing_since) {
            marcar.run(ahora, f.id);
            r.nuevos++;
          }
        } else if (e === 'esta' && f.missing_since) {
          desmarcar.run(f.id);
          r.recuperados++;
        }
        // 'duda': se queda como estuviera
      }
    })();
    r.faltan += ausentes.length;
  }
  if (r.nuevos || r.recuperados) console.log(`[desaparecidos] ${r.nuevos} carpeta(s) que ya no están · ${r.recuperados} han vuelto`);
  return r;
}

export function discosDesaparecidos() {
  return db
    .prepare(
      `SELECT id, title, album_artist, year, path, scanned_at, missing_since, track_file_count, match_state
       FROM albums WHERE missing_since IS NOT NULL ORDER BY album_artist COLLATE NOCASE, year, title`
    )
    .all();
}

export function cuantosDesaparecidos() {
  return db.prepare('SELECT count(*) n FROM albums WHERE missing_since IS NOT NULL').get().n;
}

// Quita la ficha y deja atado lo que colgaba de ella. Si tienes OTRA copia del mismo disco
// (lo normal cuando la carpeta se renombró: el escáner ya creó la ficha nueva), la
// discografía y los retos pasan a apuntar a esa copia en vez de quedarse «sin disco» hasta
// la limpieza de la noche.
const borrarFila = db.transaction((id) => {
  const a = db.prepare('SELECT id, rg_mbid, album_artist, title FROM albums WHERE id = ?').get(id);
  if (!a) return;
  const viva = "id != @id AND match_state != 'dismissed' AND missing_since IS NULL";
  const otra =
    (a.rg_mbid && db.prepare(`SELECT id FROM albums WHERE ${viva} AND rg_mbid = @rg ORDER BY id LIMIT 1`).get({ id, rg: a.rg_mbid })) ||
    db
      .prepare(`SELECT id FROM albums WHERE ${viva} AND album_artist = @artista COLLATE NOCASE AND title = @titulo COLLATE NOCASE ORDER BY id LIMIT 1`)
      .get({ id, artista: a.album_artist || '', titulo: a.title || '' });
  const otraId = otra?.id ?? null;
  db.prepare('UPDATE release_groups SET owned_album_id = ?, is_owned = ? WHERE owned_album_id = ?').run(otraId, otraId ? 1 : 0, id);
  db.prepare('UPDATE challenge_items SET owned_album_id = ? WHERE owned_album_id = ?').run(otraId, id);
  db.prepare('UPDATE downloads SET album_id = NULL WHERE album_id = ?').run(id);
  db.prepare('DELETE FROM lyrics WHERE track_id IN (SELECT id FROM tracks WHERE album_id = ?)').run(id);
  for (const t of ['tracks', 'album_tags', 'album_labels', 'album_artists']) db.prepare(`DELETE FROM ${t} WHERE album_id = ?`).run(id);
  db.prepare('DELETE FROM albums WHERE id = ?').run(id);
});

// Quita de la app UN disco marcado. Solo filas. Se vuelve a mirar el disco en el momento, a
// fondo: si la carpeta ha vuelto, no se quita (y se desmarca); si no se puede saber, tampoco.
export function olvidarDisco(id, { confirm } = {}, estado = estadoDeCarpeta) {
  if (confirm !== true) throw new Error('Sin confirmar: no se quita nada');
  const a = db.prepare('SELECT id, title, path, scanned_at, missing_since FROM albums WHERE id = ?').get(id);
  if (!a) throw new Error('Ese disco ya no está en la app');
  if (!a.missing_since) throw new Error('Ese disco no está marcado como desaparecido');
  const e = a.path ? estado(a, { aFondo: true }) : 'falta';
  if (e === 'esta') {
    db.prepare('UPDATE albums SET missing_since = NULL WHERE id = ?').run(id);
    throw new Error('La carpeta ha vuelto a aparecer: el disco se queda');
  }
  if (e === 'duda') throw new Error('Ahora mismo no se puede comprobar esa carpeta (¿el volumen no responde?): no se quita nada');
  borrarFila(id);
  return { ok: true, id, title: a.title };
}

// Quita todos los marcados que SIGAN sin carpeta. Devuelve cuántos quitó, cuántos volvieron
// y cuántos no se pudieron comprobar (esos se quedan).
export function olvidarTodos({ confirm } = {}, estado = estadoDeCarpeta) {
  if (confirm !== true) throw new Error('Sin confirmar: no se quita nada');
  let quitados = 0;
  let vueltos = 0;
  let dudas = 0;
  for (const a of discosDesaparecidos()) {
    const e = a.path ? estado(a, { aFondo: true }) : 'falta';
    if (e === 'esta') {
      db.prepare('UPDATE albums SET missing_since = NULL WHERE id = ?').run(a.id);
      vueltos++;
    } else if (e === 'duda') {
      dudas++;
    } else {
      borrarFila(a.id);
      quitados++;
    }
  }
  return { ok: true, quitados, vueltos, dudas };
}
