import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting } from './db.js';
import { qbCompletedTorrents } from './qbittorrent.js';
import { importFolder, importFile, importConfig, isIgnoredImport } from './importer.js';
import { matchRequest, setDownloadStatus, reconcileAgainstLibrary, pruneDownloads } from './downloads.js';
import { runScan } from './scanner.js';
import { runIdentify } from './identify.js';
import { norm, within, pathMappings, remapPath } from './pathmap.js';
import { sendNotification } from './notify.js';

// AUTO-IMPORT: cierra el bucle de descargas sin Lidarr. Sondea qBittorrent, y por cada
// torrent COMPLETADO cuyo contenido cuelgue de la carpeta de torrents configurada y no
// se haya importado ya, lo enlaza (hardlink) a la biblioteca organizada {artist}/{album}
// (reusa importFolder, que NUNCA borra ni copia el origen: sigues sembrando). Si casa con
// una petición del registro de descargas, usa su artista/álbum para el destino; si no,
// lee las etiquetas. Al terminar, relanza el escaneo para que el álbum aparezca.

export const autoImportStatus = {
  running: false,
  lastRun: null,
  imported: 0,
  checked: 0,
  errors: [],
  // diagnóstico: por qué el automático (no) importa
  torrents: 0, // completados que devolvió qBittorrent (tras el filtro de categoría)
  underSource: 0, // de esos, cuántos cuelgan de tu carpeta de torrents configurada
  alreadyImported: 0, // ya enlazados en una pasada anterior
  source: null, // carpeta de torrents con la que se comparó
  samplePaths: [], // rutas de ejemplo que qB reporta cuando NADA casa (para el remapeo)
};

let running = false;

// ¿ya importada esta carpeta? importFolder registra el origen resuelto en `imports`.
const isImported = db.prepare('SELECT 1 FROM imports WHERE source_dir = ?');

export function autoImportEnabled() {
  const { enabled, source, dest } = importConfig();
  return getSetting('auto_import') === '1' && enabled && !!source && !!dest;
}

export async function runAutoImport() {
  if (running) return autoImportStatus;
  if (!autoImportEnabled()) return { ...autoImportStatus, skipped: 'desactivado o sin configurar' };
  const { source } = importConfig();
  running = true;
  Object.assign(autoImportStatus, {
    running: true,
    imported: 0,
    importedItems: [],
    checked: 0,
    errors: [],
    torrents: 0,
    underSource: 0,
    alreadyImported: 0,
    skippedNonMusic: 0,
    source,
    samplePaths: [],
  });
  try {
    // Primero, cierra los pedidos cuyo álbum ya está en la biblioteca — independiente de
    // qBittorrent. Esto arregla el caso en que todo se quedaba en "pedido" pese a estar ya
    // importado (infohash vacío, categoría/ruta que no casaban, o importación manual).
    try {
      const closed = reconcileAgainstLibrary();
      if (closed) console.log(`[autoimport] ${closed} pedido(s) cerrados por cruce con la biblioteca`);
    } catch (e) {
      autoImportStatus.errors.push(`reconcile: ${String(e.message || e)}`);
    }
    // poda la cola: fuera lo importado viejo y la basura, para que no crezca sin fin
    try {
      const pruned = pruneDownloads();
      if (pruned.closed || pruned.junk)
        console.log(`[autoimport] poda de la cola: ${pruned.closed} cerrados viejos, ${pruned.junk} basura`);
    } catch (e) {
      autoImportStatus.errors.push(`prune: ${String(e.message || e)}`);
    }
    let torrents;
    try {
      torrents = await qbCompletedTorrents();
    } catch (e) {
      autoImportStatus.errors.push(`qBittorrent: ${String(e.message || e)}`);
      return autoImportStatus;
    }
    autoImportStatus.torrents = torrents.length;
    const maps = pathMappings();
    const misses = []; // rutas que NO cuelgan de la carpeta (muestra para configurar el remapeo)
    let importedAny = false;
    const importedItems = []; // qué se importó en ESTA pasada (para el aviso detallado)
    for (const t of torrents) {
      const cp = remapPath(t.contentPath, maps); // aplica el remapeo qB→contenedor
      if (!cp || !within(cp, source)) {
        if (t.contentPath && misses.length < 40) misses.push(String(t.contentPath));
        continue; // solo lo que cuelga de la carpeta de torrents
      }
      autoImportStatus.underSource++;
      let isDir = false;
      try {
        isDir = fs.statSync(cp).isDirectory();
      } catch {
        continue; // el contenido no es accesible desde aquí
      }
      // Carpeta (álbum) o fichero suelto (single/remix): ambos se importan. Un no-audio
      // suelto lanzará «no es de audio» y se salta en silencio abajo, como las carpetas vacías.
      if (isImported.get(path.resolve(cp))) {
        // ya importada (a mano o en una pasada anterior): si aún tenía un pedido abierto,
        // ciérralo — así el backlog deja de mostrarse como "pedido" eternamente.
        autoImportStatus.alreadyImported++;
        const done = matchRequest(t);
        if (done && done.status !== 'imported') setDownloadStatus(done.id, 'imported');
        continue;
      }
      if (isIgnoredImport(cp)) {
        // el usuario la ocultó de la lista («ya la tengo»): no la importamos automáticamente.
        autoImportStatus.alreadyImported++;
        continue;
      }
      autoImportStatus.checked++;

      const req = matchRequest(t);
      const override = req ? { artist: req.artist, album: req.album, year: req.year } : {};
      if (req) setDownloadStatus(req.id, 'importing');
      try {
        const r = isDir ? await importFolder(cp, override) : await importFile(cp, override);
        importedAny = true;
        autoImportStatus.imported++;
        importedItems.push({ artist: r.artist || override.artist || null, album: r.album || override.album || t.name });
        if (req) setDownloadStatus(req.id, 'imported', r.dest);
        console.log(`[autoimport] ✓ ${t.name} → ${r.dest} (${r.linked} ficheros)`);
      } catch (e) {
        const msg = String(e.message || e);
        // no-música (software, ebooks… en carpeta, o fichero suelto no-audio): NO es un error
        // real, simplemente no hay nada que importar. Se salta en silencio.
        if (/no (tiene ficheros de audio|es de audio)/i.test(msg)) {
          autoImportStatus.checked--; // no era un candidato real de importación
          autoImportStatus.skippedNonMusic++;
          continue;
        }
        autoImportStatus.errors.push(`${t.name}: ${msg}`);
        if (req) setDownloadStatus(req.id, 'error');
        console.warn(`[autoimport] ✗ ${t.name} — ${msg}`);
      }
    }
    // si NADA cayó bajo la carpeta, guarda una muestra de las rutas que reporta qB
    // (preferiendo las de música) para que el panel te diga qué remapear.
    if (autoImportStatus.underSource === 0 && misses.length) {
      const music = misses.filter((p) => /music/i.test(p));
      autoImportStatus.samplePaths = [...new Set(music.length ? music : misses)].slice(0, 4);
    }
    if (importedAny) {
      try {
        await runScan();
      } catch (e) {
        console.warn('[autoimport] rescan tras importar falló:', String(e.message || e));
      }
      // identify LIGERO: solo los álbumes 'pending' (los recién importados), para que lo
      // que baja no espere al refresco nocturno para aparecer identificado. runIdentify
      // tiene su propio guard y respeta el límite de MusicBrainz.
      try {
        await runIdentify({ force: false });
      } catch (e) {
        console.warn('[autoimport] identify tras importar falló:', String(e.message || e));
      }
      // aviso «tu descarga está lista» DETALLADO: enumera qué discos entraron (best-effort;
      // no notifica si no está configurado). Cada línea «Artista — Álbum»; si son muchos, se
      // recorta con «…y N más» para no pasarse del límite de los webhooks (Discord ~1900).
      autoImportStatus.importedItems = importedItems;
      if (importedItems.length > 0) {
        const n = importedItems.length;
        const fmt = (it) => (it.artist ? `${it.artist} — ${it.album}` : it.album);
        const MAX = 15;
        const lines = importedItems.slice(0, MAX).map((it) => `• ${fmt(it)}`);
        if (n > MAX) lines.push(`…y ${n - MAX} más`);
        const header = n === 1 ? 'Disco importado a tu biblioteca:' : `${n} discos importados a tu biblioteca:`;
        sendNotification('Liderarr', `${header}\n${lines.join('\n')}`).catch(() => {});
      }
    }
  } finally {
    running = false;
    autoImportStatus.running = false;
    autoImportStatus.lastRun = Date.now();
  }
  return autoImportStatus;
}
