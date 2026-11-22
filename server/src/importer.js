import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { db, getSetting } from './db.js';
import { normalizeForDup } from './queries.js';
import { reconcileImported } from './downloads.js';
import { qbCompletedTorrents } from './qbittorrent.js';
import { pathMappings, remapPath, norm } from './pathmap.js';
import { isJunkEntry } from './libkey.js';

// Importador estilo TRaSH: lo que bajas por Prowlarr a la carpeta de torrents lo
// HARDLINKEA a la biblioteca organizada media/music/<Artista>/<Álbum (Año)>. Mismo
// inodo → 0 espacio extra y sigues sembrando desde torrents. Es lo que hace Lidarr
// al importar, pero SIN su veto de metadatos. Reglas duras:
//   - NUNCA borra ni modifica el origen (la descarga sigue intacta, sembrando).
//   - NUNCA copia: si el hardlink no es posible (otro sistema de ficheros), avisa.
//   - Opt-in: requiere allow_import='1' y la biblioteca montada en escritura.

const AUDIO_EXT = new Set(['.flac', '.mp3', '.m4a', '.ogg', '.opus', '.wav', '.ape', '.wv', '.aac', '.aiff', '.wma']);
const KEEP_EXT = new Set([...AUDIO_EXT, '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.cue', '.log', '.m3u', '.m3u8']);

// ¿`hijo` está dentro de `raiz`? Con frontera de carpeta: «torrents-x» no está dentro de
// «torrents», cosa que un startsWith a secas daba por buena.
function dentroDe(hijo, raiz) {
  const h = path.resolve(hijo);
  const r = path.resolve(raiz);
  return h === r || h.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

// Un dato de artista/álbum que sirve: ni vacío ni las palabras «undefined»/«null», que es
// lo que llega cuando alguien convierte a texto un valor que no existe. Así nació una
// carpeta llamada literalmente «undefined» en la biblioteca.
const vale = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && !/^(undefined|null|nan)$/i.test(s) ? s : null;
};

// «Artista - Álbum (2016) [FLAC]» → { artist, album, year }. Es como llegan nombradas casi
// todas las descargas; se usa SOLO cuando las etiquetas no dicen el artista.
export function deducirDeCarpeta(nombre) {
  let t = String(nombre || '').trim();
  let year = null;
  for (;;) {
    const m = t.match(/\s*[[(]([^\])]*)[)\]]\s*$/);
    if (!m) break;
    const y = m[1].match(/\b(19|20)\d{2}\b/);
    if (y && !year) year = Number(y[0]);
    t = t.slice(0, m.index).trim();
  }
  const fin = t.match(/\s+[-–—]\s*((?:19|20)\d{2})\s*$/);
  if (fin) {
    if (!year) year = Number(fin[1]);
    t = t.slice(0, fin.index).trim();
  }
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!m) return { artist: null, album: t || null, year };
  // «2016 - Álbum»: lo primero es el año, no un artista
  if (/^(19|20)\d{2}$/.test(m[1].trim())) return { artist: null, album: m[2].trim(), year: year || Number(m[1]) };
  return { artist: m[1].trim(), album: m[2].trim(), year };
}

// De dónde sale cada dato del destino, por orden: lo que diga quien llama (el registro de
// descargas o lo que tecleaste) → las etiquetas → el nombre de la carpeta → la carpeta de
// encima. Un dato vacío NO pisa al siguiente: antes un pedido registrado sin artista
// borraba el de las etiquetas y el disco acababa en «Artista desconocido».
export function resolverMeta(tags = {}, override = {}, carpeta = '', carpetaPadre = null) {
  const deCarpeta = deducirDeCarpeta(carpeta);
  const artist = vale(override.artist) || vale(tags.artist) || deCarpeta.artist || vale(carpetaPadre);
  const album = vale(override.album) || vale(tags.album) || deCarpeta.album || vale(carpeta);
  const year = Number(override.year) || Number(tags.year) || deCarpeta.year || null;
  return { artist: artist || null, album: album || null, year };
}

// Dónde enlazar sin mezclar. Si la carpeta de destino ya tiene OTROS ficheros de audio
// (lo típico: tenías el MP3 y ahora llega el FLAC), enlazar dentro dejaba un solo disco
// con las dos tandas de pistas. Se va a una carpeta hermana con el formato en el nombre:
// quedan como dos copias del mismo disco, que es lo que la app ya sabe gestionar.
export function destinoLibre(destDir, relFiles) {
  const clave = (r) => r.split(path.sep).join('/').toLowerCase();
  const mios = new Set(relFiles.map(clave));
  const tieneAjenos = (dir) =>
    fs.existsSync(dir) && walkKeep(dir).some((r) => AUDIO_EXT.has(path.extname(r).toLowerCase()) && !mios.has(clave(r)));
  if (!tieneAjenos(destDir)) return destDir;
  const primero = relFiles.find((r) => AUDIO_EXT.has(path.extname(r).toLowerCase())) || '';
  const fmt = path.extname(primero).slice(1).toUpperCase() || 'COPIA';
  for (let i = 1; i <= 20; i++) {
    const cand = `${destDir} [${fmt}${i > 1 ? ` ${i}` : ''}]`;
    if (!tieneAjenos(cand)) return cand;
  }
  throw new Error(`Ya existe «${destDir}» con otros ficheros de audio dentro y no se pudo elegir una carpeta aparte.`);
}

export function importConfig() {
  return {
    enabled: getSetting('allow_import') === '1',
    source: (getSetting('import_source_dir') || '').replace(/[/\\]+$/, ''),
    dest: (getSetting('import_dest_dir') || '').replace(/[/\\]+$/, ''),
  };
}

const importedSet = () => new Set(db.prepare('SELECT source_dir FROM imports').all().map((r) => r.source_dir));
const recordImport = db.prepare('INSERT OR IGNORE INTO imports (source_dir, dest_dir, imported_at) VALUES (?,?,?)');

// Carpetas ocultadas por el usuario («ya la tengo» / no me interesa): ni se listan ni las
// coge el auto-import. Se guardan y comparan por ruta resuelta (igual que `imports`).
const ignoredSet = () => new Set(db.prepare('SELECT source_dir FROM import_ignored').all().map((r) => r.source_dir));
export function isIgnoredImport(sourceDir) {
  return !!db.prepare('SELECT 1 FROM import_ignored WHERE source_dir = ?').get(path.resolve(sourceDir));
}
export function ignoreImport(sourceDir) {
  db.prepare('INSERT OR IGNORE INTO import_ignored (source_dir, ignored_at) VALUES (?,?)').run(path.resolve(sourceDir), Date.now());
  return { ignored: true };
}
export function unignoreImport(sourceDir) {
  db.prepare('DELETE FROM import_ignored WHERE source_dir = ?').run(path.resolve(sourceDir));
  return { ignored: false };
}

// Construye la ruta de destino desde una plantilla CONFIGURABLE con tokens
// {artist} {album} {year}. Las '/' de la plantilla son separadores de carpeta; cada
// segmento se sanea (fuera caracteres ilegales). Si no hay año, se limpian los
// restos de un año ausente ("()", "[]", guiones sueltos). Ejemplos:
//   {artist}/{album} ({year})     -> Radiohead/Kid A (2000)
//   {artist}/{year} - {album}     -> Radiohead/2000 - Kid A
//   {artist} - {album} ({year})   -> Radiohead - Kid A (2000)   (carpeta única)
export function renderPath(template, { artist, album, year }) {
  const tpl = String(template || '').trim() || '{artist}/{album} ({year})';
  const yr = year != null && year !== '' ? String(year) : '';
  const segs = [];
  for (let seg of tpl.split('/')) {
    seg = seg
      .replace(/\{artist\}/gi, artist || '')
      .replace(/\{album\}/gi, album || '')
      .replace(/\{year\}/gi, yr);
    if (!yr) seg = seg.replace(/[([]\s*[)\]]/g, ''); // quita "()" / "[]" del año ausente
    seg = seg
      .replace(/[/\\:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–—_]+|[\s\-–—_]+$/g, '')
      .trim();
    // Un segmento «.» o «..» (de una etiqueta rara) subiría de carpeta: fuera. Y un punto
    // inicial suelto hace la carpeta oculta —el escáner no la vería nunca—, salvo que sea
    // punto + cifra («.38 Special»), que es un nombre de verdad.
    if (seg === '.' || seg === '..') seg = '';
    else if (/^\.[^.\d]/.test(seg)) seg = seg.slice(1).trim();
    if (seg) segs.push(seg);
  }
  if (!segs.length) segs.push('Desconocido');
  return path.join(...segs);
}

// ficheros interesantes bajo una carpeta, con su ruta RELATIVA (para respetar
// subcarpetas de discos múltiples: CD1/, CD2/…)
function walkKeep(root, rel = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (isJunkEntry(e.name)) continue; // ocultos de Mac: no se enlazan a la biblioteca
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) out.push(...walkKeep(root, r));
    else if (e.isFile() && KEEP_EXT.has(path.extname(e.name).toLowerCase())) out.push(r);
  }
  return out;
}

// ficheros de audio de una carpeta (rutas relativas, ordenadas)
export function audioFiles(dir) {
  return walkKeep(dir).filter((r) => AUDIO_EXT.has(path.extname(r).toLowerCase())).sort();
}

// lee artista/álbum/año de las etiquetas de UNA pista (timeout corto: es la ruta del
// usuario y no debe colgar)
async function readTags(file) {
  try {
    const mm = await Promise.race([
      parseFile(file, { duration: false }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
    ]);
    const c = mm.common || {};
    return {
      artist: c.albumartist || c.artist || null,
      album: c.album || null,
      year: c.year || (c.originalyear ? Number(c.originalyear) : null),
    };
  } catch {
    return { artist: null, album: null, year: null };
  }
}

// ¿la carpeta parece un VERTEDERO de varios álbumes (o de artista) en vez de un álbum
// suelto? El auto-import trata cada carpeta como UN álbum (lee las etiquetas de la 1ª
// pista), así que un vertedero se importaría con metadatos erróneos. Heurística barata,
// solo con las rutas relativas del audio: si el audio cuelga de 2+ subcarpetas «de álbum»
// (ignorando CD1/CD2… de un multidisco), o hay audio en la raíz Y además en subcarpetas.
const DISC_RE = /^(cd|dis[ck]|disco|vol(?:ume|umen)?|part|parte)\s*\.?\s*\d+/i;
function albumStructure(relPaths) {
  const counts = new Map(); // subcarpeta «de álbum» -> nº de pistas
  let rootAudio = 0;
  for (const r of relPaths) {
    const parts = r.split(/[\\/]/);
    if (parts.length === 1) {
      rootAudio++;
      continue;
    }
    const top = parts[0];
    if (DISC_RE.test(top)) continue; // subcarpeta de disco de UN álbum (multidisco)
    counts.set(top, (counts.get(top) || 0) + 1);
  }
  const folders = [...counts.entries()]
    .map(([name, tracks]) => ({ name, tracks }))
    .sort((a, b) => b.tracks - a.tracks);
  // vertedero: 2+ subcarpetas de álbum, o audio suelto en la raíz Y además subcarpetas
  const multi = folders.length >= 2 || (folders.length >= 1 && rootAudio > 0);
  return { multi, folders, rootAudio };
}

// Motivo por el que una descarga sigue «sin importar» y/o no la coge el auto-import.
// `isTorrent`: true/false si qBittorrent la lista (o no) como torrent completado; null si
// no se pudo consultar qBittorrent. Devuelve un código + etiqueta corta + pista larga.
function classifyPending({ isTorrent, multiAlbum, inLibrary }) {
  if (multiAlbum)
    return {
      code: 'multi-album',
      label: 'Varios álbumes en una carpeta',
      hint:
        'Parece un vertedero de varios discos (o de artista). El auto-import trata cada carpeta como UN álbum, ' +
        'así que la importaría con datos erróneos. Revísala antes de importar a mano.',
    };
  if (inLibrary)
    return {
      code: 'in-library',
      label: 'Ya en tu biblioteca',
      hint:
        'Ya tienes este álbum, en otra copia sin enlazar a esta descarga. Importar creará una copia organizada aparte.',
    };
  if (isTorrent === false)
    return {
      code: 'not-torrent',
      label: 'El auto-import no la ve',
      hint:
        'qBittorrent no la lista como descarga terminada (la quitaste de qB, la añadiste a mano o viene de otro ' +
        'cliente). El auto-import solo recorre los torrents de qB: impórtala aquí a mano.',
    };
  if (isTorrent === true)
    return {
      code: 'torrent-pending',
      label: 'Pendiente del auto-import',
      hint:
        'Es un torrent terminado aún sin enlazar; el auto-import debería cogerla en la próxima pasada. Puedes ' +
        'adelantarte e importarla ya.',
    };
  return {
    code: 'ready',
    label: 'Lista para importar',
    hint: 'Descarga nueva sin enlazar a tu biblioteca. Pulsa Importar para enlazarla.',
  };
}

// Lista las descargas de la carpeta origen que aún no se han importado, con lo que
// sabemos de cada una (artista/álbum por etiquetas) para confirmar antes de enlazar.
export async function pendingImports() {
  const { source, dest, enabled } = importConfig();
  if (!source || !dest) return { configured: false, enabled, items: [] };
  let dirents;
  try {
    dirents = fs
      .readdirSync(source, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !isJunkEntry(e.name));
  } catch (e) {
    return { configured: true, enabled, error: `No se puede leer ${source}: ${e.message}`, items: [] };
  }
  const done = importedSet();
  const ignored = ignoredSet();
  // índice de la biblioteca (artista + título normalizado) para avisar de "ya lo
  // tienes" y no crear copias organizadas por descuido.
  const libKey = (artist, title) => `${String(artist || '').toLowerCase().trim()} ${normalizeForDup(title)}`;
  const libSet = new Set(
    db
      .prepare("SELECT album_artist, title FROM albums WHERE match_state != 'dismissed'")
      .all()
      .map((r) => libKey(r.album_artist, r.title))
  );
  // más recientes primero: las descargas nuevas están arriba
  const dirs = dirents
    .map((e) => {
      const full = path.join(source, e.name);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        /* noop */
      }
      return { name: e.name, full, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  // ¿qué carpetas reporta qBittorrent como torrents completados? (remapeadas al contenedor,
  // igual que el auto-import). Sirve para decir por ítem si el auto-import puede verla.
  // Best-effort: si qB no responde, torrentPaths = null y el diagnóstico omite ese dato.
  let torrentPaths = null;
  try {
    const maps = pathMappings();
    const ts = await qbCompletedTorrents();
    torrentPaths = new Set(ts.map((t) => remapPath(t.contentPath, maps)));
  } catch {
    torrentPaths = null;
  }

  const items = [];
  let scanned = 0;
  for (const d of dirs) {
    // cotas: no recorrer un pool de seeding enorme entero en una petición
    if (items.length >= 60 || scanned >= 300) break;
    if (done.has(d.full)) continue;
    if (ignored.has(path.resolve(d.full))) continue; // ocultada por el usuario
    const audio = audioFiles(d.full);
    if (!audio.length) continue; // sin audio: no es una descarga de música
    scanned++;
    // ¿ya está en la biblioteca? si su primer fichero tiene más de un enlace duro, ya
    // se importó (está hardlinkeado en media). nlink==1 => descarga nueva sin importar.
    // Esto salta baratísimo todo lo que ya importaron Liderarr o Lidarr, sin leer tags.
    let nlink = 1;
    try {
      nlink = fs.statSync(path.join(d.full, audio[0])).nlink;
    } catch {
      /* noop */
    }
    if (nlink > 1) continue;
    const tags = await readTags(path.join(d.full, audio[0]));
    const inLibrary = !!(tags.artist && tags.album && libSet.has(libKey(tags.artist, tags.album)));
    const struct = albumStructure(audio);
    const multiAlbum = struct.multi;
    const isTorrent = torrentPaths ? torrentPaths.has(norm(d.full)) : null;
    const diag = classifyPending({ isTorrent, multiAlbum, inLibrary });
    items.push({
      source_dir: d.full,
      name: d.name,
      tracks: audio.length,
      ...tags,
      inLibrary,
      isTorrent,
      multiAlbum,
      folders: struct.folders, // subcarpetas «de álbum» detectadas (para el aviso multiálbum)
      diag,
    });
  }
  return { configured: true, enabled, items };
}

// Lista las subcarpetas «de álbum» de una carpeta-vertedero (multiálbum) con sus etiquetas,
// para importarlas UNA A UNA como álbumes sueltos (cada subcarpeta → su {artista}/{álbum}).
// Es la salida a los vertederos: en vez de colapsar N discos en uno mal etiquetado, el
// usuario importa cada álbum por separado. Ignora subcarpetas de disco (CD1/CD2) — esas
// pertenecen a un mismo álbum y las resuelve importFolder al recorrer la subcarpeta padre.
export async function listAlbumSubfolders(sourceDir) {
  const { source } = importConfig();
  if (!source) throw new Error('Configura la carpeta de descargas en Ajustes.');
  const base = path.resolve(sourceDir);
  if (!dentroDe(base, source)) throw new Error('La carpeta está fuera de la carpeta de descargas.');
  let entries;
  try {
    entries = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !isJunkEntry(e.name));
  } catch (e) {
    throw new Error(`No se puede leer la carpeta: ${e.message}`);
  }
  const done = importedSet();
  const ignored = ignoredSet();
  const libKey = (artist, title) => `${String(artist || '').toLowerCase().trim()} ${normalizeForDup(title)}`;
  const libSet = new Set(
    db
      .prepare("SELECT album_artist, title FROM albums WHERE match_state != 'dismissed'")
      .all()
      .map((r) => libKey(r.album_artist, r.title))
  );
  const subfolders = [];
  for (const e of entries) {
    if (DISC_RE.test(e.name)) continue; // subcarpeta de disco de un álbum, no un álbum aparte
    const full = path.join(base, e.name);
    const audio = audioFiles(full);
    if (!audio.length) continue;
    const tags = await readTags(path.join(full, audio[0]));
    const inLibrary = !!(tags.artist && tags.album && libSet.has(libKey(tags.artist, tags.album)));
    subfolders.push({
      source_dir: full,
      name: e.name,
      tracks: audio.length,
      ...tags,
      inLibrary,
      alreadyImported: done.has(full) || ignored.has(path.resolve(full)),
    });
  }
  return { subfolders };
}

// Hardlinkea una descarga a media/music/<Artista>/<Álbum (Año)>. `override` permite
// corregir artista/álbum/año desde la UI. Devuelve el destino y cuántos ficheros
// enlazó. NUNCA borra el origen.
export async function importFolder(sourceDir, override = {}) {
  const { enabled, source, dest } = importConfig();
  if (!enabled) throw new Error('La importación está desactivada. Actívala en Ajustes → Importar descargas.');
  if (!source || !dest) throw new Error('Configura las carpetas de descargas y de biblioteca en Ajustes.');
  const norm = path.resolve(sourceDir);
  if (!dentroDe(norm, source)) throw new Error('La carpeta de origen está fuera de la carpeta de descargas.');
  if (!fs.existsSync(norm)) throw new Error('La carpeta de origen ya no existe.');

  const files = walkKeep(norm);
  const audio = files.filter((r) => AUDIO_EXT.has(path.extname(r).toLowerCase())).sort();
  if (!audio.length) throw new Error('La carpeta no tiene ficheros de audio que importar.');
  const tags = await readTags(path.join(norm, audio[0]));
  const padre = path.dirname(norm);
  const meta = resolverMeta(tags, override, path.basename(norm), path.resolve(padre) !== path.resolve(source) ? path.basename(padre) : null);
  const destPrevisto = path.join(
    dest,
    renderPath(getSetting('import_naming'), {
      artist: meta.artist || 'Artista desconocido',
      album: meta.album || path.basename(norm),
      year: meta.year || null,
    })
  );
  const destDir = destinoLibre(destPrevisto, files);

  // Si origen y biblioteca están en montajes distintos, el hardlink da EXDEV. Con
  // "copiar si no se puede enlazar" activo, se copia (ocupa el doble); si no, se avisa.
  const copyAllowed = getSetting('import_copy_fallback') === '1';

  let linked = 0;
  let method = 'hardlink';
  const errors = [];
  for (const rel of files) {
    const src = path.join(norm, rel);
    const target = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) {
      linked++;
      continue;
    }
    try {
      fs.linkSync(src, target);
      linked++;
    } catch (e) {
      if (e.code === 'EXDEV') {
        if (!copyAllowed) {
          throw new Error(
            'El origen y la biblioteca están en sistemas de ficheros distintos: el hardlink no es posible. Monta /data como un único volumen (guía TRaSH), o activa «Copiar si el hardlink no es posible» en Ajustes → Importar descargas (ocupará el doble de espacio).'
          );
        }
        try {
          fs.copyFileSync(src, target);
          linked++;
          method = 'copy';
        } catch (ce) {
          errors.push(`${rel}: ${ce.message}`);
        }
      } else {
        errors.push(`${rel}: ${e.message}`);
      }
    }
  }
  if (errors.length) {
    // Antes se apuntaba como importada igualmente: el pedido se cerraba, llegaba el aviso de
    // «disco importado» y en la biblioteca quedaba medio disco, o ninguno. Ahora no se da
    // por hecha; lo ya enlazado se queda y la próxima pasada completa lo que falte.
    throw new Error(
      `No se pudieron enlazar ${errors.length} de ${files.length} ficheros (${errors[0]}). No se da por importada.`
    );
  }
  recordImport.run(norm, destDir, Date.now());
  // cierra el pedido correspondiente en el registro de descargas (manual o auto): sin esto,
  // importar a mano dejaba la descarga en "pedido" para siempre.
  try {
    reconcileImported({ sourceName: path.basename(norm), artist: meta.artist, album: meta.album, dest: destDir });
  } catch {
    /* reconciliación best-effort: nunca debe tumbar una importación que ya enlazó */
  }
  return { dest: destDir, linked, method, errors, artist: meta.artist, album: meta.album, year: meta.year };
}

// Como importFolder pero para un ÚNICO fichero (torrents de un solo tema): lo enlaza a
// media/<Artista>/<Álbum>/<fichero>. Las descargas de un fichero suelto (singles, remixes)
// las saltaba el auto-import; ahora también entran. Lanza un error «no es de audio» si no
// lo es (el auto-import lo salta en silencio, igual que las carpetas sin música).
export async function importFile(sourceFile, override = {}) {
  const { enabled, source, dest } = importConfig();
  if (!enabled) throw new Error('La importación está desactivada. Actívala en Ajustes → Importar descargas.');
  if (!source || !dest) throw new Error('Configura las carpetas de descargas y de biblioteca en Ajustes.');
  const norm = path.resolve(sourceFile);
  if (!dentroDe(norm, source)) throw new Error('El fichero de origen está fuera de la carpeta de descargas.');
  if (!fs.existsSync(norm)) throw new Error('El fichero de origen ya no existe.');
  if (!AUDIO_EXT.has(path.extname(norm).toLowerCase())) throw new Error('El fichero no es de audio.');

  const tags = await readTags(norm);
  // de un fichero suelto no se deduce el artista por el nombre («01 - Tema» no es un artista);
  // sí vale la carpeta que lo contiene si no es la raíz de descargas
  const padre = path.dirname(norm);
  const meta = resolverMeta(tags, override, '', path.resolve(padre) !== path.resolve(source) ? path.basename(padre) : null);
  const base = path.basename(norm, path.extname(norm));
  const destDir = path.join(
    dest,
    renderPath(getSetting('import_naming'), {
      artist: meta.artist || 'Artista desconocido',
      album: meta.album || base,
      year: meta.year || null,
    })
  );
  const target = path.join(destDir, path.basename(norm));
  fs.mkdirSync(destDir, { recursive: true });
  const copyAllowed = getSetting('import_copy_fallback') === '1';
  let method = 'hardlink';
  if (!fs.existsSync(target)) {
    try {
      fs.linkSync(norm, target);
    } catch (e) {
      if (e.code === 'EXDEV') {
        if (!copyAllowed) {
          throw new Error(
            'El origen y la biblioteca están en sistemas de ficheros distintos: el hardlink no es posible. Monta /data como un único volumen (guía TRaSH), o activa «Copiar si el hardlink no es posible» en Ajustes → Importar descargas.'
          );
        }
        fs.copyFileSync(norm, target);
        method = 'copy';
      } else {
        throw e;
      }
    }
  }
  recordImport.run(norm, destDir, Date.now());
  try {
    reconcileImported({ sourceName: base, artist: meta.artist, album: meta.album, dest: destDir });
  } catch {
    /* best-effort */
  }
  return { dest: destDir, linked: 1, method, artist: meta.artist, album: meta.album, year: meta.year };
}
