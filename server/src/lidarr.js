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
  if (!res.ok) {
    // Lidarr devuelve el motivo (errores de validación) en el cuerpo; sin esto
    // solo veíamos "400" y a adivinar.
    let detail = '';
    try {
      const t = await res.text();
      if (t) {
        try {
          const j = JSON.parse(t);
          const msg = Array.isArray(j) ? j.map((e) => e.errorMessage || e.message).filter(Boolean).join('; ') : j.message || j.error;
          detail = msg ? ` — ${msg}` : ` — ${t.slice(0, 300)}`;
        } catch {
          detail = ` — ${t.slice(0, 300)}`;
        }
      }
    } catch {
      /* sin cuerpo */
    }
    throw new Error(`Lidarr ${res.status} en ${path}${detail}`);
  }
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

// Añade un álbum a Lidarr por su release-group MBID. En Lidarr los álbumes NO
// existen sueltos: cuelgan de un artista. El flujo correcto es:
//   1. resolver el álbum (y su artista) en MusicBrainz vía Lidarr,
//   2. asegurar que el artista está en la biblioteca (crearlo sin monitorizar
//      toda su obra si no está),
//   3. localizar el álbum bajo ese artista (Lidarr puede tardar en refrescar su
//      discografía tras crear el artista),
//   4. monitorizar solo ese álbum y lanzar la búsqueda.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function lidarrAdd(rgMbid, artistMbid) {
  const quality = Number(getSetting('lidarr_quality_profile')) || 1;
  const metadata = Number(getSetting('lidarr_metadata_profile')) || 1;
  const folder = getSetting('lidarr_root_folder') || '';
  if (!folder) throw new Error('Falta la carpeta raíz de Lidarr. Ve a Ajustes → Lidarr → «Cargar perfiles» y elige carpeta y perfiles.');

  // 1. resolver el álbum en MusicBrainz a través de Lidarr (trae también el artista)
  const albumLookup = await lidarrFetch(`/album/lookup?term=lidarr:${encodeURIComponent(rgMbid)}`);
  const target = (albumLookup || []).find((a) => a.foreignAlbumId === rgMbid) || (albumLookup || [])[0];
  if (!target) throw new Error('Lidarr no encuentra ese álbum en MusicBrainz.');
  const artistForeignId = artistMbid || target.artist?.foreignArtistId;
  if (!artistForeignId) throw new Error('No se pudo determinar el artista del álbum.');

  // 2. ¿está ya el artista en la biblioteca de Lidarr?
  const allArtists = await lidarrFetch('/artist');
  let artist = (allArtists || []).find((a) => a.foreignArtistId === artistForeignId);

  // 3. si no, añadirlo SIN monitorizar toda su discografía (solo para poder colgar el álbum)
  if (!artist) {
    let lookupArtist = target.artist;
    if (!lookupArtist) {
      const r = await lidarrFetch(`/artist/lookup?term=mbid:${encodeURIComponent(artistForeignId)}`).catch(() => []);
      lookupArtist = (r || [])[0];
    }
    if (!lookupArtist) throw new Error('Lidarr no encuentra al artista en MusicBrainz.');
    artist = await lidarrFetch('/artist', {
      method: 'POST',
      body: {
        ...lookupArtist,
        qualityProfileId: quality,
        metadataProfileId: metadata,
        rootFolderPath: folder,
        monitored: true,
        addOptions: { monitor: 'none', searchForMissingAlbums: false },
      },
    });
  }

  // 4. localizar el álbum bajo el artista (esperando al refresco si acaba de crearse)
  let album = null;
  for (let i = 0; i < 8; i++) {
    const albums = await lidarrFetch(`/album?artistId=${artist.id}`).catch(() => []);
    album = (albums || []).find((a) => a.foreignAlbumId === rgMbid);
    if (album) break;
    await sleep(1500);
  }
  if (!album) {
    // el artista se acaba de añadir y Lidarr aún está trayendo su discografía;
    // no es un error: el álbum aparecerá y podrá monitorizarse en unos segundos
    return { ok: true, pending: true, title: target.title, note: 'Artista añadido a Lidarr; su discografía se está importando. Reintenta el álbum en un momento.' };
  }

  // 5. monitorizar solo ese álbum y lanzar la búsqueda
  await lidarrFetch('/album/monitor', { method: 'PUT', body: { albumIds: [album.id], monitored: true } });
  await lidarrFetch('/command', { method: 'POST', body: { name: 'AlbumSearch', albumIds: [album.id] } });
  return { ok: true, title: album.title };
}
