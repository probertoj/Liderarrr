import { db, getSetting } from './db.js';
import { matchKey } from './matchkey.js';

// Registro nativo de descargas/pedidos (independencia de Lidarr). Cuando Liderarr
// agarra una release apunta el pedido aquí con el contexto del álbum; el auto-import
// casa el torrent terminado con su petición para llevarlo a la carpeta correcta y
// marcar el estado. Sustituye al snapshot de Lidarr para pintar "pedido/descargando".

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Extrae el infohash (btih) de un magnet. Los .torrent por URL no lo traen: para esos
// el emparejamiento cae al nombre del torrent (ver matchRequest).
export function magnetHash(url) {
  const m = String(url || '').match(/xt=urn:btih:([a-z0-9]+)/i);
  return m ? m[1].toLowerCase() : null;
}

const ins = db.prepare(
  `INSERT INTO downloads (album_id, rg_mbid, artist, album, year, release_title, infohash, source, status, requested_at, updated_at)
   VALUES (@album_id, @rg_mbid, @artist, @album, @year, @release_title, @infohash, @source, 'requested', @now, @now)`
);

export function recordGrab({ album_id, rg_mbid, artist, album, year, release_title, infohash, source } = {}) {
  const now = Date.now();
  ins.run({
    album_id: album_id || null,
    rg_mbid: rg_mbid || null,
    artist: artist || null,
    album: album || null,
    year: year ? Number(year) || null : null,
    release_title: release_title || null,
    infohash: infohash ? String(infohash).toLowerCase() : null,
    source: source || null,
    now,
  });
  return { ok: true };
}

// Casa un torrent completado con una petición pendiente: primero por infohash, luego
// por nombre normalizado contra el release_title guardado. Null si no hay match (se
// importará leyendo las etiquetas del fichero).
export function matchRequest(torrent) {
  if (torrent?.hash) {
    const byHash = db
      .prepare("SELECT * FROM downloads WHERE infohash = ? AND status != 'imported' ORDER BY requested_at DESC LIMIT 1")
      .get(String(torrent.hash).toLowerCase());
    if (byHash) return byHash;
  }
  const n = norm(torrent?.name);
  if (!n) return null;
  const rows = db.prepare("SELECT * FROM downloads WHERE release_title IS NOT NULL AND status != 'imported'").all();
  return rows.find((r) => {
    const rn = norm(r.release_title);
    return rn && (rn === n || rn.includes(n) || n.includes(rn));
  }) || null;
}

export function setDownloadStatus(id, status, dest) {
  db.prepare('UPDATE downloads SET status = ?, dest = COALESCE(?, dest), updated_at = ? WHERE id = ?').run(
    status,
    dest || null,
    Date.now(),
    id
  );
}

// Cierra el pedido que corresponde a una carpeta recién importada, venga del auto-import
// o de la importación MANUAL (que antes no tocaba el registro, dejando el pedido en
// 'requested' para siempre aunque el disco ya estuviera enlazado). Casa por artista+álbum
// y, si no, por el nombre de la descarga contra el release_title guardado. Devuelve el id
// casado o null. Es best-effort: no debe tumbar la importación si algo falla.
export function reconcileImported({ sourceName, artist, album, dest } = {}) {
  const rows = db
    .prepare("SELECT * FROM downloads WHERE status != 'imported' ORDER BY requested_at DESC")
    .all();
  if (!rows.length) return null;
  const sn = norm(sourceName);
  const ar = norm(artist);
  const al = norm(album);
  const hit = rows.find((r) => {
    if (ar && al && norm(r.artist) === ar && norm(r.album) === al) return true;
    const rt = norm(r.release_title);
    return !!(rt && sn && (rt === sn || rt.includes(sn) || sn.includes(rt)));
  });
  if (hit) setDownloadStatus(hit.id, 'imported', dest);
  return hit ? hit.id : null;
}

// Días que un pedido ya cerrado (imported/error) sigue visible/guardado antes de podarse.
const keepDays = () => Number(getSetting('downloads_keep_days')) || 3;

export function downloadsList(limit = 100) {
  // Pendientes (requested/importing) SIEMPRE; los cerrados solo mientras son recientes,
  // así lo importado desaparece del panel pasado el plazo aunque aún no se haya podado.
  const cutoff = Date.now() - keepDays() * 86400000;
  return db
    .prepare(
      `SELECT * FROM downloads
       WHERE status IN ('requested','importing') OR COALESCE(updated_at, requested_at) >= ?
       ORDER BY requested_at DESC LIMIT ?`
    )
    .all(cutoff, limit);
}

// Limpieza MANUAL: borra ya del registro los pedidos cerrados (imported/error), sin
// esperar a la poda automática. Para el botón «Limpiar importadas». Devuelve cuántos.
export function clearImported() {
  return db.prepare("DELETE FROM downloads WHERE status IN ('imported','error')").run().changes;
}

// Poda la cola: borra los pedidos ya cerrados (imported/error) más viejos que el plazo, y
// la basura (requested sin rg_mbid, sin artista y sin título: grabs fallidos o de prueba
// que nunca podrán casar). El historial real de importaciones vive en la tabla `imports`,
// así que borrar pedidos cerrados no pierde nada. Devuelve cuántos borró de cada tipo.
export function pruneDownloads() {
  const cutoff = Date.now() - keepDays() * 86400000;
  const closed = db
    .prepare("DELETE FROM downloads WHERE status IN ('imported','error') AND COALESCE(updated_at, requested_at) < ?")
    .run(cutoff).changes;
  const junk = db
    .prepare(
      "DELETE FROM downloads WHERE status = 'requested' AND rg_mbid IS NULL AND (artist IS NULL OR artist = '') AND (release_title IS NULL OR release_title = '')"
    )
    .run().changes;
  return { closed, junk };
}

// rg_mbids con pedido en curso (requested/importing) para pintar "pedido/descargando"
// y evitar re-pedir. Equivalente nativo de lidarrOwnedIds para el flujo sin Lidarr.
export function activeRequestRgs() {
  return new Set(
    db
      .prepare("SELECT DISTINCT rg_mbid FROM downloads WHERE rg_mbid IS NOT NULL AND status IN ('requested','importing')")
      .all()
      .map((r) => r.rg_mbid)
  );
}

// "Artista - Álbum" de un release_title de scene ("The Delgados - Domestiques [1996]
// [Album] FLAC…"): corta en el primer corchete/paréntesis y parte por " - ". Best-effort
// para los pedidos que solo guardaron el título de la release (sin artista/álbum).
function parseReleaseTitle(rt) {
  const s = String(rt || '').split(/\s[[(]/)[0].trim();
  const i = s.indexOf(' - ');
  if (i === -1) return null;
  return { artist: s.slice(0, i).trim(), album: s.slice(i + 3).trim() };
}

// Cierra los pedidos cuyo álbum YA ESTÁ en tu biblioteca. Es la fuente de verdad real:
// un pedido está "importado" si su disco aparece en la colección. Independiente de
// qBittorrent (categoría/ruta/sesión), que es donde el auto-import se caía en silencio y
// dejaba todo en "pedido". Casa por rg_mbid, por artista+álbum (matchKey) y, en último
// recurso, parseando el release_title. Devuelve cuántos pedidos cerró.
export function reconcileAgainstLibrary() {
  const pending = db
    .prepare("SELECT id, rg_mbid, artist, album, release_title FROM downloads WHERE status IN ('requested','importing')")
    .all();
  if (!pending.length) return 0;
  const libRg = new Set(
    db.prepare("SELECT DISTINCT rg_mbid FROM albums WHERE rg_mbid IS NOT NULL AND match_state != 'dismissed'").all().map((r) => r.rg_mbid)
  );
  const libKey = new Set(
    db.prepare("SELECT album_artist, title FROM albums WHERE match_state != 'dismissed'").all().map((r) => matchKey(r.album_artist, r.title))
  );
  let closed = 0;
  for (const d of pending) {
    let hit = (d.rg_mbid && libRg.has(d.rg_mbid)) || (d.artist && d.album && libKey.has(matchKey(d.artist, d.album)));
    if (!hit && d.release_title) {
      const p = parseReleaseTitle(d.release_title);
      if (p && p.album && libKey.has(matchKey(p.artist, p.album))) hit = true;
    }
    if (hit) {
      setDownloadStatus(d.id, 'imported');
      closed++;
    }
  }
  return closed;
}
