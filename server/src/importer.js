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

// sanea un componente de ruta para el sistema de ficheros
function safe(name) {
  return (
    String(name || '')
      .replace(/[/\\:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Desconocido'
  );
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

// lee artista/álbum/año de la primera pista con etiquetas de una carpeta
async function readMeta(dir) {
  const audio = walkKeep(dir).filter((r) => AUDIO_EXT.has(path.extname(r).toLowerCase())).sort();
  if (!audio.length) return null;
  try {
    const mm = await Promise.race([
      parseFile(path.join(dir, audio[0]), { duration: false }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
    ]);
    const c = mm.common || {};
    return {
      artist: c.albumartist || c.artist || null,
      album: c.album || null,
      year: c.year || (c.originalyear ? Number(c.originalyear) : null),
      tracks: audio.length,
    };
  } catch {
    return { artist: null, album: null, year: null, tracks: audio.length };
  }
}

// Lista las descargas de la carpeta origen que aún no se han importado, con lo que
// sabemos de cada una (artista/álbum por etiquetas) para confirmar antes de enlazar.
export async function pendingImports() {
  const { source, dest, enabled } = importConfig();
  if (!source || !dest) return { configured: false, enabled, items: [] };
  let dirs;
  try {
    dirs = fs.readdirSync(source, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (e) {
    return { configured: true, enabled, error: `No se puede leer ${source}: ${e.message}`, items: [] };
  }
  const done = importedSet();
  const items = [];
  for (const d of dirs) {
    const full = path.join(source, d.name);
    if (done.has(full)) continue;
    const meta = await readMeta(full);
    if (!meta) continue; // sin audio: no es una descarga de música
    items.push({ source_dir: full, name: d.name, ...meta });
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

  const meta = { ...(await readMeta(norm)), ...override };
  const artist = safe(meta.artist);
  const albumBase = safe(meta.album || path.basename(norm));
  const destDir = path.join(dest, artist, meta.year ? `${albumBase} (${meta.year})` : albumBase);

  const files = walkKeep(norm);
  if (!files.length) throw new Error('La carpeta no tiene ficheros de audio que importar.');

  let linked = 0;
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
        throw new Error(
          'El origen y la biblioteca están en sistemas de ficheros distintos: el hardlink no es posible. Monta /data como un único volumen (guía TRaSH) para que ambos compartan sistema de ficheros.'
        );
      }
      errors.push(`${rel}: ${e.message}`);
    }
  }
  recordImport.run(norm, destDir, Date.now());
  return { dest: destDir, linked, errors, artist: meta.artist, album: meta.album, year: meta.year };
}
