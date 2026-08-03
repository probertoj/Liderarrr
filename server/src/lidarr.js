import { db, getSetting } from './db.js';

// Lidarr es el ACTUADOR, no el catálogo (igual que Radarr en PowaFlex). Solo dos
// cosas: le mandamos álbumes a monitorizar desde los huecos, y le pedimos un
// snapshot de lo que ya tiene para pintar "ya encargado" sin machacar su API.

export function lidarrConfig() {
  const url = (getSetting('lidarr_url') || '').replace(/\/+$/, '');
  const key = getSetting('lidarr_key') || '';
  return { url, key };
}

async function lidarrFetch(path, { method = 'GET', body } = {}) {
  const { url, key } = lidarrConfig();
  if (!url || !key) throw new Error('Lidarr no configurado (URL o API key vacíos)');
  const res = await fetch(`${url}/api/v1${path}`, {
    method,
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Lidarr ${res.status} en ${path}`);
  return res.status === 204 ? null : res.json();
}

export async function lidarrTest() {
  const status = await lidarrFetch('/system/status');
  return { ok: true, version: status.version, name: status.instanceName || 'Lidarr' };
}

export async function lidarrProfiles() {
  const [quality, metadata, folders] = await Promise.all([
    lidarrFetch('/qualityprofile'),
    lidarrFetch('/metadataprofile'),
    lidarrFetch('/rootfolder'),
  ]);
  return {
    quality: quality.map((p) => ({ id: p.id, name: p.name })),
    metadata: metadata.map((p) => ({ id: p.id, name: p.name })),
    folders: folders.map((f) => ({ path: f.path, freeSpace: f.freeSpace })),
  };
}

// Refresca el snapshot local de lo que Lidarr tiene monitorizado.
const upsertLidarr = db.prepare(`
INSERT INTO lidarr_albums (rg_mbid, title, artist, monitored, has_file, synced_at)
VALUES (@rg_mbid, @title, @artist, @monitored, @has_file, @synced_at)
ON CONFLICT(rg_mbid) DO UPDATE SET title=excluded.title, artist=excluded.artist,
  monitored=excluded.monitored, has_file=excluded.has_file, synced_at=excluded.synced_at
`);

export async function lidarrSync() {
  const albums = await lidarrFetch('/album');
  const now = Date.now();
  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM lidarr_albums').run();
    for (const a of rows) {
      if (!a.foreignAlbumId) continue;
      upsertLidarr.run({
        rg_mbid: a.foreignAlbumId,
        title: a.title,
        artist: a.artist?.artistName || null,
        monitored: a.monitored ? 1 : 0,
        has_file: a.statistics?.trackFileCount > 0 ? 1 : 0,
        synced_at: now,
      });
    }
  });
  tx(albums || []);
  return { count: (albums || []).length };
}

export function lidarrOwnedIds() {
  return new Set(db.prepare('SELECT rg_mbid FROM lidarr_albums').all().map((r) => r.rg_mbid));
}

// Añade (monitoriza + busca) un álbum en Lidarr por su release-group MBID. Lidarr
// exige que el artista exista primero; si no está, lo crea con los perfiles
// guardados en Ajustes.
export async function lidarrAdd(rgMbid, artistMbid) {
  const { quality, metadata, folder } = {
    quality: Number(getSetting('lidarr_quality_profile')) || 1,
    metadata: Number(getSetting('lidarr_metadata_profile')) || 1,
    folder: getSetting('lidarr_root_folder') || '',
  };
  // ¿ya está el artista?
  let artist = null;
  if (artistMbid) {
    const existing = await lidarrFetch(`/artist?mbId=${encodeURIComponent(artistMbid)}`).catch(() => []);
    artist = Array.isArray(existing) ? existing.find((a) => a.foreignArtistId === artistMbid) : null;
    if (!artist && folder) {
      const lookup = await lidarrFetch(`/artist/lookup?term=mbid:${encodeURIComponent(artistMbid)}`).catch(() => []);
      const found = (lookup || [])[0];
      if (found) {
        artist = await lidarrFetch('/artist', {
          method: 'POST',
          body: {
            ...found,
            qualityProfileId: quality,
            metadataProfileId: metadata,
            rootFolderPath: folder,
            monitored: true,
            addOptions: { monitor: 'none', searchForMissingAlbums: false },
          },
        });
      }
    }
  }
  // monitoriza el álbum concreto
  const albumLookup = await lidarrFetch(`/album/lookup?term=lidarr:${encodeURIComponent(rgMbid)}`).catch(() => []);
  const target = (albumLookup || []).find((a) => a.foreignAlbumId === rgMbid) || (albumLookup || [])[0];
  if (!target) throw new Error('Lidarr no encuentra ese álbum');
  const added = await lidarrFetch('/album', {
    method: 'POST',
    body: {
      ...target,
      monitored: true,
      addOptions: { searchForNewAlbum: true },
      artist: artist || target.artist,
    },
  });
  return { ok: true, title: added?.title || target.title };
}
