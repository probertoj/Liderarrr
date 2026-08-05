import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { db, getSetting } from './db.js';

// Importador estilo TRaSH: lo que bajas por Prowlarr a la carpeta de torrents lo
// HARDLINKEA a la biblioteca organizada media/music/<Artista>/<Álbum (Año)>. Mismo
// inodo → 0 espacio extra y sigues sembrando desde torrents. Es lo que hace Lidarr
// al importar, pero SIN su veto de metadatos. Reglas duras:
//   - NUNCA borra ni modifica el origen (la descarga sigue intacta, sembrando).
//   - NUNCA copia: si el hardlink no es posible (otro sistema de ficheros), avisa.
//   - Opt-in: requiere allow_import='1' y la biblioteca montada en escritura.

const AUDIO_EXT = new Set(['.flac', '.mp3', '.m4a', '.ogg', '.opus', '.wav', '.ape', '.wv', '.aac', '.aiff', '.wma']);
const KEEP_EXT = new Set([...AUDIO_EXT, '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.cue', '.log', '.m3u', '.m3u8']);

function importConfig() {
  return {
    enabled: getSetting('allow_import') === '1',
    source: (getSetting('import_source_dir') || '').replace(/[/\\]+$/, ''),
    dest: (getSetting('import_dest_dir') || '').replace(/[/\\]+$/, ''),
  };
}

const importedSet = () => new Set(db.prepare('SELECT source_dir FROM imports').all().map((r) => r.source_dir));
const recordImport = db.prepare('INSERT OR IGNORE INTO imports (source_dir, dest_dir, imported_at) VALUES (?,?,?)');

// Construye la ruta de destino desde una plantilla CONFIGURABLE con tokens
// {artist} {album} {year}. Las '/' de la plantilla son separadores de carpeta; cada
// segmento se sanea (fuera caracteres ilegales). Si no hay año, se limpian los
// restos de un año ausente ("()", "[]", guiones sueltos). Ejemplos:
//   {artist}/{album} ({year})     -> Radiohead/Kid A (2000)
//   {artist}/{year} - {album}     -> Radiohead/2000 - Kid A
//   {artist} - {album} ({year})   -> Radiohead - Kid A (2000)   (carpeta única)
function renderPath(template, { artist, album, year }) {
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
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) out.push(...walkKeep(root, r));
    else if (e.isFile() && KEEP_EXT.has(path.extname(e.name).toLowerCase())) out.push(r);
  }
  return out;
}

// ficheros de audio de una carpeta (rutas relativas, ordenadas)
function audioFiles(dir) {
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

// Lista las descargas de la carpeta origen que aún no se han importado, con lo que
// sabemos de cada una (artista/álbum por etiquetas) para confirmar antes de enlazar.
export async function pendingImports() {
  const { source, dest, enabled } = importConfig();
  if (!source || !dest) return { configured: false, enabled, items: [] };
  let dirents;
  try {
    dirents = fs.readdirSync(source, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (e) {
    return { configured: true, enabled, error: `No se puede leer ${source}: ${e.message}`, items: [] };
  }
  const done = importedSet();
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

  const items = [];
  let scanned = 0;
  for (const d of dirs) {
    // cotas: no recorrer un pool de seeding enorme entero en una petición
    if (items.length >= 60 || scanned >= 300) break;
    if (done.has(d.full)) continue;
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
    items.push({ source_dir: d.full, name: d.name, tracks: audio.length, ...tags });
  }
  return { configured: true, enabled, items };
}

// Hardlinkea una descarga a media/music/<Artista>/<Álbum (Año)>. `override` permite
// corregir artista/álbum/año desde la UI. Devuelve el destino y cuántos ficheros
// enlazó. NUNCA borra el origen.
export async function importFolder(sourceDir, override = {}) {
  const { enabled, source, dest } = importConfig();
  if (!enabled) throw new Error('La importación está desactivada. Actívala en Ajustes → Importar descargas.');
  if (!source || !dest) throw new Error('Configura las carpetas de descargas y de biblioteca en Ajustes.');
  const norm = path.resolve(sourceDir);
  if (!norm.startsWith(path.resolve(source))) throw new Error('La carpeta de origen está fuera de la carpeta de descargas.');
  if (!fs.existsSync(norm)) throw new Error('La carpeta de origen ya no existe.');

  const files = walkKeep(norm);
  const audio = files.filter((r) => AUDIO_EXT.has(path.extname(r).toLowerCase())).sort();
  if (!audio.length) throw new Error('La carpeta no tiene ficheros de audio que importar.');
  const tags = await readTags(path.join(norm, audio[0]));
  const meta = { ...tags, ...override };
  const destDir = path.join(
    dest,
    renderPath(getSetting('import_naming'), {
      artist: meta.artist || 'Artista desconocido',
      album: meta.album || path.basename(norm),
      year: meta.year || null,
    })
  );

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
  recordImport.run(norm, destDir, Date.now());
  return { dest: destDir, linked, method, errors, artist: meta.artist, album: meta.album, year: meta.year };
}
