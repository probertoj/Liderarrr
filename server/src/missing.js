import fs from 'node:fs';
import { db, getSetting } from './db.js';
import { splitRoots } from './libkey.js';

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

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

// Una raíz «viva»: existe y tiene algo dentro. Si no, no se juzga nada de lo que cuelga.
function raizViva(r) {
  try {
    return fs.readdirSync(r).length > 0;
  } catch {
    return false;
  }
}

// Si de golpe falta más de esto en una raíz, lo que falla es la raíz, no los discos.
export const UMBRAL_SOSPECHA = 0.2;

// Repasa todas las rutas y marca/desmarca. Devuelve { faltan, nuevos, recuperados, dudosas }.
export function marcarDesaparecidos(ahora = Date.now(), existe = fs.existsSync) {
  const roots = splitRoots(getSetting('music_dirs')).map(norm).filter(Boolean);
  const filas = db.prepare('SELECT id, path, missing_since FROM albums WHERE path IS NOT NULL').all();
  const marcar = db.prepare('UPDATE albums SET missing_since = ? WHERE id = ? AND missing_since IS NULL');
  const desmarcar = db.prepare('UPDATE albums SET missing_since = NULL WHERE id = ?');
  const r = { faltan: 0, nuevos: 0, recuperados: 0, dudosas: [] };
  for (const raiz of roots) {
    const suyos = filas.filter((f) => norm(f.path) === raiz || norm(f.path).startsWith(raiz + '/'));
    if (!suyos.length) continue;
    if (!raizViva(raiz)) {
      r.dudosas.push(raiz);
      continue;
    }
    const ausentes = suyos.filter((f) => !existe(f.path));
    // demasiados de golpe (y no es que ya estuvieran marcados): no se toca nada de esta raíz
    const nuevosAusentes = ausentes.filter((f) => !f.missing_since);
    if (nuevosAusentes.length > Math.max(20, suyos.length * UMBRAL_SOSPECHA)) {
      r.dudosas.push(raiz);
      console.warn(
        `[desaparecidos] ${nuevosAusentes.length} de ${suyos.length} discos de ${raiz} no aparecen de golpe: parece un problema del volumen, no se marca nada.`
      );
      continue;
    }
    const ausenteId = new Set(ausentes.map((f) => f.id));
    db.transaction(() => {
      for (const f of suyos) {
        if (ausenteId.has(f.id)) {
          if (!f.missing_since) {
            marcar.run(ahora, f.id);
            r.nuevos++;
          }
        } else if (f.missing_since) {
          desmarcar.run(f.id);
          r.recuperados++;
        }
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
      `SELECT id, title, album_artist, year, path, missing_since, track_file_count, match_state
       FROM albums WHERE missing_since IS NOT NULL ORDER BY album_artist COLLATE NOCASE, year, title`
    )
    .all();
}

export function cuantosDesaparecidos() {
  return db.prepare('SELECT count(*) n FROM albums WHERE missing_since IS NOT NULL').get().n;
}

const borrarFila = db.transaction((id) => {
  db.prepare('DELETE FROM tracks WHERE album_id = ?').run(id);
  db.prepare('DELETE FROM album_tags WHERE album_id = ?').run(id);
  db.prepare('DELETE FROM albums WHERE id = ?').run(id);
});

// Quita de la app UN disco marcado. Solo filas. Se vuelve a mirar el disco en el momento:
// si la carpeta ha vuelto, no se quita (y se desmarca).
export function olvidarDisco(id, { confirm } = {}, existe = fs.existsSync) {
  if (confirm !== true) throw new Error('Sin confirmar: no se quita nada');
  const a = db.prepare('SELECT id, title, path, missing_since FROM albums WHERE id = ?').get(id);
  if (!a) throw new Error('Ese disco ya no está en la app');
  if (!a.missing_since) throw new Error('Ese disco no está marcado como desaparecido');
  if (a.path && existe(a.path)) {
    db.prepare('UPDATE albums SET missing_since = NULL WHERE id = ?').run(id);
    throw new Error('La carpeta ha vuelto a aparecer: el disco se queda');
  }
  borrarFila(id);
  return { ok: true, id, title: a.title };
}

// Quita todos los marcados que SIGAN sin carpeta. Devuelve cuántos quitó y cuántos volvieron.
export function olvidarTodos({ confirm } = {}, existe = fs.existsSync) {
  if (confirm !== true) throw new Error('Sin confirmar: no se quita nada');
  let quitados = 0;
  let vueltos = 0;
  for (const a of discosDesaparecidos()) {
    if (a.path && existe(a.path)) {
      db.prepare('UPDATE albums SET missing_since = NULL WHERE id = ?').run(a.id);
      vueltos++;
    } else {
      borrarFila(a.id);
      quitados++;
    }
  }
  return { ok: true, quitados, vueltos };
}
