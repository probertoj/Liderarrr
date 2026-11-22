import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting } from './db.js';
import { splitRoots, albumKey } from './libkey.js';
import { renderPath } from './importer.js';

// RE-UBICAR EN DISCO. Mueve la carpeta de un álbum QUE YA ESTÁ en la biblioteca a la
// estructura configurada ({artist}/{album} ({year}), la misma del importador), para
// limpiar material antiguo mal archivado (típico tras corregir el artista a mano).
// Guardarraíles fuertes, en el espíritu de "tus ficheros mandan":
//  - exige confirm === true,
//  - SOLO dentro de music_dirs (nunca torrents ni nada fuera),
//  - usa rename: en el MISMO volumen conserva los inodos, así el seeding sobrevive
//    (el torrent sigue sembrando desde torrents/, que comparte inodo). Si el destino
//    cae en otro sistema de ficheros (EXDEV), ABORTA en vez de copiar (romper el
//    hardlink duplicaría espacio y desligaría el seeding),
//  - no sobrescribe: si el destino ya existe, aborta,
//  - no toca cajas multidisco (mover un solo disco rompería la caja).
// Tras mover, actualiza en la BD la ruta, el local_key (la ruta RELATIVA cambia, y es
// la identidad del álbum), las rutas de las pistas y la carátula.

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

export function refileAlbum(albumId, { confirm } = {}) {
  if (confirm !== true) throw new Error('Movimiento no confirmado');
  const a = db.prepare('SELECT id, path, album_artist, title, year, cover, disc_group FROM albums WHERE id = ?').get(albumId);
  if (!a) throw new Error('Álbum no encontrado');
  if (!a.path) throw new Error('El álbum no tiene carpeta conocida en disco');
  if (a.disc_group) throw new Error('Es un disco de una caja multidisco; muévelo a mano para no romper la caja');

  const roots = splitRoots(getSetting('music_dirs')).map(norm).filter(Boolean);
  if (!roots.length) throw new Error('No hay biblioteca de música configurada (Ajustes → music_dirs)');
  const cur = norm(a.path);
  const root = roots.find((r) => cur === r || cur.startsWith(r + '/'));
  if (!root) throw new Error('La carpeta del álbum está fuera de la biblioteca; no se mueve');

  const rel = renderPath(getSetting('import_naming'), {
    artist: a.album_artist || 'Artista desconocido',
    album: a.title || path.basename(cur),
    year: a.year || null,
  }).replace(/\\/g, '/');
  const destDir = norm(`${root}/${rel}`);

  if (destDir === cur) return { ok: true, moved: false, path: cur, message: 'El álbum ya está en su carpeta' };
  if (fs.existsSync(destDir)) throw new Error(`Ya existe una carpeta en el destino: ${destDir}`);

  // Se mueve la carpeta ENTERA. Si dentro viven otros discos (el típico: pistas sueltas en
  // la carpeta del artista y, al lado, subcarpetas con sus otros álbumes) se irían detrás,
  // y esos discos quedarían apuntando a rutas que ya no existen.
  const dentro = db
    .prepare('SELECT title, path FROM albums WHERE id != ?')
    .all(albumId)
    .filter((o) => norm(o.path).startsWith(cur + '/'));
  if (dentro.length) {
    throw new Error(
      `Dentro de esta carpeta hay ${dentro.length} disco(s) más (p. ej. «${dentro[0].title}»): moverla se los llevaría detrás. Sepáralos primero o mueve este a mano.`
    );
  }

  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  try {
    fs.renameSync(cur, destDir);
  } catch (e) {
    if (e.code === 'EXDEV')
      throw new Error('El destino está en otro sistema de ficheros: mover rompería los hardlinks. Abortado, no se ha tocado nada.');
    throw new Error(`No se pudo mover la carpeta: ${e.message}`);
  }

  try {
    return applyMove(albumId, a, cur, destDir, roots);
  } catch (e) {
    // La base no aceptó el cambio (otra ficha ya ocupa esa ruta, por ejemplo). La carpeta
    // ya está movida: se devuelve a su sitio para que disco y base sigan diciendo lo mismo.
    try {
      fs.renameSync(destDir, cur);
    } catch (e2) {
      throw new Error(
        `La carpeta se movió a ${destDir}, la base no se pudo actualizar (${e.message}) y tampoco se pudo devolver a su sitio (${e2.message}). Reescanea la biblioteca.`
      );
    }
    throw new Error(`No se pudo actualizar la base (${e.message}). La carpeta se ha devuelto a su sitio: no ha cambiado nada.`);
  }
}

// aplica el movimiento en BD (extraído para reutilizar): path, local_key (la ruta
// relativa cambia), rutas de pistas y carátula.
function applyMove(albumId, a, cur, destDir, roots) {
  const newKey = albumKey(destDir, roots);
  const tx = db.transaction(() => {
    db.prepare('UPDATE albums SET path = ?, local_key = ? WHERE id = ?').run(destDir, newKey, albumId);
    for (const t of db.prepare('SELECT id, path FROM tracks WHERE album_id = ?').all(albumId)) {
      const np = norm(t.path);
      if (np.startsWith(cur)) db.prepare('UPDATE tracks SET path = ? WHERE id = ?').run(destDir + np.slice(cur.length), t.id);
    }
    if (a.cover) {
      const nc = norm(a.cover);
      if (nc.startsWith(cur)) db.prepare('UPDATE albums SET cover = ? WHERE id = ?').run(destDir + nc.slice(cur.length), albumId);
    }
  });
  tx();
  return { ok: true, moved: true, from: cur, to: destDir };
}

// Álbumes corregidos a mano (artista o título) para la pestaña «Correcciones»: con su
// carpeta actual y el destino que tendrían en la estructura configurada, y si hace
// falta moverlos o hay algo que lo impide (fuera de la biblioteca, caja multidisco…).
export function correctedAlbums() {
  const roots = splitRoots(getSetting('music_dirs')).map(norm).filter(Boolean);
  const naming = getSetting('import_naming');
  const rows = db
    .prepare(
      `SELECT id, album_artist, title, year, path, artist_manual, title_manual, disc_group
       FROM albums WHERE (artist_manual = 1 OR title_manual = 1) AND match_state != 'dismissed'
       ORDER BY album_artist COLLATE NOCASE, title COLLATE NOCASE`
    )
    .all();
  return rows.map((a) => {
    const cur = norm(a.path);
    let target = null;
    let needsMove = false;
    let blocked = null;
    if (!a.path) blocked = 'sin carpeta conocida';
    else if (a.disc_group) blocked = 'caja multidisco';
    else if (!roots.length) blocked = 'sin biblioteca configurada';
    else {
      const root = roots.find((r) => cur === r || cur.startsWith(r + '/'));
      if (!root) blocked = 'fuera de la biblioteca';
      else {
        const rel = renderPath(naming, {
          artist: a.album_artist || 'Artista desconocido',
          album: a.title || path.basename(cur),
          year: a.year || null,
        }).replace(/\\/g, '/');
        target = norm(`${root}/${rel}`);
        needsMove = target !== cur;
      }
    }
    return {
      id: a.id,
      album_artist: a.album_artist,
      title: a.title,
      year: a.year,
      path: cur,
      target,
      needsMove,
      blocked,
      artist_manual: !!a.artist_manual,
      title_manual: !!a.title_manual,
    };
  });
}

// Mueve TODOS los corregidos que lo necesiten (y puedan). Un fallo en uno no tumba
// a los demás.
export function refileAll() {
  const list = correctedAlbums().filter((a) => a.needsMove && !a.blocked);
  let moved = 0;
  const errors = [];
  for (const a of list) {
    try {
      refileAlbum(a.id, { confirm: true });
      moved++;
    } catch (e) {
      errors.push({ id: a.id, title: a.title, error: String(e.message || e) });
    }
  }
  return { candidates: list.length, moved, errors };
}
