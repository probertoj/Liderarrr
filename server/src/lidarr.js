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
    signal: AbortSignal.timeout(60000),
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
INSERT INTO lidarr_albums (rg_mbid, title, artist, monitored, has_file, added, synced_at)
VALUES (@rg_mbid, @title, @artist, @monitored, @has_file, @added, @synced_at)
ON CONFLICT(rg_mbid) DO UPDATE SET title=excluded.title, artist=excluded.artist,
  monitored=excluded.monitored, has_file=excluded.has_file, added=excluded.added, synced_at=excluded.synced_at
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
        added: a.added || null,
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
// Monitoriza un álbum que YA está en la biblioteca de Lidarr (lee su BD local,
// sin tocar MusicBrainz: instantáneo) y lanza la búsqueda. Devuelve null si el
// álbum aún no aparece en la discografía importada del artista.
async function monitorFromLibrary(artistId, rgMbid) {
  const albums = await lidarrFetch(`/album?artistId=${artistId}`).catch(() => []);
  const album = (albums || []).find((a) => a.foreignAlbumId === rgMbid);
  if (!album) return null;
  await lidarrFetch('/album/monitor', { method: 'PUT', body: { albumIds: [album.id], monitored: true } });
  await lidarrFetch('/command', { method: 'POST', body: { name: 'AlbumSearch', albumIds: [album.id] } });
  return { ok: true, title: album.title };
}

export async function lidarrAdd(rgMbid, artistMbid) {
  const quality = Number(getSetting('lidarr_quality_profile')) || 1;
  const metadata = Number(getSetting('lidarr_metadata_profile')) || 1;
  const folder = getSetting('lidarr_root_folder') || '';
  if (!folder) throw new Error('Falta la carpeta raíz de Lidarr. Ve a Ajustes → Lidarr → «Cargar perfiles» y elige carpeta y perfiles.');

  // ¿está ya el artista en la biblioteca de Lidarr? (rápido, lee su BD)
  const allArtists = await lidarrFetch('/artist');
  const artist = artistMbid ? (allArtists || []).find((a) => a.foreignArtistId === artistMbid) : null;

  // CAMINO RÁPIDO: artista ya presente → monitorizar el álbum de su discografía
  if (artist) {
    const done = await monitorFromLibrary(artist.id, rgMbid);
    if (done) return done;
    // el artista está pero ese álbum aún no está importado: pedir refresco y que reintente
    await lidarrFetch('/command', { method: 'POST', body: { name: 'RefreshArtist', artistId: artist.id } }).catch(() => {});
    return { ok: true, pending: true, note: 'El artista está en Lidarr pero ese álbum aún no aparece; se ha pedido un refresco. Reinténtalo en unos segundos.' };
  }

  // El artista NO está: buscarlo (esto sí consulta MusicBrainz) y añadirlo SIN
  // monitorizar toda su obra. Se devuelve "pendiente" al momento, sin esperar a
  // que importe su discografía (eso es lo que antes reventaba el timeout).
  let lookupArtist = null;
  if (artistMbid) {
    const r = await lidarrFetch(`/artist/lookup?term=mbid:${encodeURIComponent(artistMbid)}`).catch(() => []);
    lookupArtist = (r || []).find((a) => a.foreignArtistId === artistMbid) || (r || [])[0];
  } else {
    const al = await lidarrFetch(`/album/lookup?term=lidarr:${encodeURIComponent(rgMbid)}`).catch(() => []);
    lookupArtist = (al || [])[0]?.artist;
  }
  if (!lookupArtist) throw new Error('Lidarr no encuentra al artista en MusicBrainz.');

  await lidarrFetch('/artist', {
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
  return { ok: true, pending: true, note: 'Artista añadido a Lidarr; está importando su discografía. Vuelve a pulsar el álbum en unos segundos para monitorizarlo.' };
}
