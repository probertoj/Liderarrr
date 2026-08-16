import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting } from './db.js';
import { qbCompletedTorrents } from './qbittorrent.js';
import { importFolder, importConfig } from './importer.js';
import { matchRequest, setDownloadStatus, reconcileAgainstLibrary, pruneDownloads } from './downloads.js';
import { runScan } from './scanner.js';

// AUTO-IMPORT: cierra el bucle de descargas sin Lidarr. Sondea qBittorrent, y por cada
// torrent COMPLETADO cuyo contenido cuelgue de la carpeta de torrents configurada y no
// se haya importado ya, lo enlaza (hardlink) a la biblioteca organizada {artist}/{album}
// (reusa importFolder, que NUNCA borra ni copia el origen: sigues sembrando). Si casa con
// una petición del registro de descargas, usa su artista/álbum para el destino; si no,
// lee las etiquetas. Al terminar, relanza el escaneo para que el álbum aparezca.

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
const within = (p, root) => {
  const np = norm(p);
  const r = norm(root);
  return !!np && !!r && (np === r || np.startsWith(r + '/'));
};

export const autoImportStatus = {
  running: false,
  lastRun: null,
  imported: 0,
  checked: 0,
  errors: [],
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
  Object.assign(autoImportStatus, { running: true, imported: 0, checked: 0, errors: [] });
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
    let importedAny = false;
    for (const t of torrents) {
      const cp = norm(t.contentPath);
      if (!cp || !within(cp, source)) continue; // solo lo que cuelga de la carpeta de torrents
      let isDir = false;
      try {
        isDir = fs.statSync(cp).isDirectory();
      } catch {
        continue; // el contenido no es accesible desde aquí
      }
      if (!isDir) continue; // MVP: solo carpetas (los álbumes vienen en carpeta)
      if (isImported.get(path.resolve(cp))) {
        // ya importada (a mano o en una pasada anterior): si aún tenía un pedido abierto,
        // ciérralo — así el backlog deja de mostrarse como "pedido" eternamente.
        const done = matchRequest(t);
        if (done && done.status !== 'imported') setDownloadStatus(done.id, 'imported');
        continue;
      }
      autoImportStatus.checked++;

      const req = matchRequest(t);
      const override = req ? { artist: req.artist, album: req.album, year: req.year } : {};
      if (req) setDownloadStatus(req.id, 'importing');
      try {
        const r = await importFolder(cp, override);
        importedAny = true;
        autoImportStatus.imported++;
        if (req) setDownloadStatus(req.id, 'imported', r.dest);
        console.log(`[autoimport] ✓ ${t.name} → ${r.dest} (${r.linked} ficheros)`);
      } catch (e) {
        const msg = String(e.message || e);
        autoImportStatus.errors.push(`${t.name}: ${msg}`);
        if (req) setDownloadStatus(req.id, 'error');
        console.warn(`[autoimport] ✗ ${t.name} — ${msg}`);
      }
    }
    if (importedAny) {
      try {
        await runScan();
      } catch (e) {
        console.warn('[autoimport] rescan tras importar falló:', String(e.message || e));
      }
    }
  } finally {
    running = false;
    autoImportStatus.running = false;
    autoImportStatus.lastRun = Date.now();
  }
  return autoImportStatus;
}
