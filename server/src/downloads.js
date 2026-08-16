import { db } from './db.js';

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

export function downloadsList(limit = 100) {
  return db.prepare('SELECT * FROM downloads ORDER BY requested_at DESC LIMIT ?').all(limit);
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
