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
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${url}/api/v1${path}`, {
      method,
      headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    const ms = Date.now() - t0;
    // el aviso más útil: distinguir un timeout (Lidarr lento) de un fallo de red
    const why = err?.name === 'TimeoutError' || /aborted/i.test(String(err?.message)) ? `timeout tras ${ms}ms` : String(err?.message || err);
    console.warn(`[lidarr] ✗ ${method} ${path} — ${why}`);
    throw new Error(`No se pudo contactar con Lidarr (${method} ${path}): ${why}`);
  }
  const ms = Date.now() - t0;
  // las búsquedas de metadatos de Lidarr (/lookup) son su punto flojo: si tardan,
  // dejamos rastro para diagnosticar la "inestabilidad" desde los logs
  if (ms > 3000) console.warn(`[lidarr] ⏱ ${method} ${path} tardó ${ms}ms (${res.status})`);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Caché breve del listado de artistas de Lidarr. GET /artist devuelve TODA la
// biblioteca; pedirlo en cada álbum (sobre todo en "enviar todos") es lento y es
// una de las causas de que la integración se sienta inestable. Se cachea 30s.
let artistCache = { at: 0, byId: new Map() };
async function lidarrArtists({ fresh = false } = {}) {
  if (!fresh && Date.now() - artistCache.at < 30000) return artistCache.byId;
  const all = await lidarrFetch('/artist');
  const byId = new Map();
  for (const a of all || []) if (a.foreignArtistId) byId.set(a.foreignArtistId, a);
  artistCache = { at: Date.now(), byId };
  return byId;
}

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
  const t0 = Date.now();
  const quality = Number(getSetting('lidarr_quality_profile')) || 1;
  const metadata = Number(getSetting('lidarr_metadata_profile')) || 1;
  const folder = getSetting('lidarr_root_folder') || '';
  if (!folder) throw new Error('Falta la carpeta raíz de Lidarr. Ve a Ajustes → Lidarr → «Cargar perfiles» y elige carpeta y perfiles.');

  // ¿está ya el artista en la biblioteca de Lidarr? (lista cacheada)
  let byId = await lidarrArtists();
  let artist = artistMbid ? byId.get(artistMbid) : null;

  // CAMINO RÁPIDO: artista ya presente → monitorizar el álbum de su discografía
  if (artist) {
    const done = await monitorFromLibrary(artist.id, rgMbid);
    if (done) {
      console.log(`[lidarr] ✓ monitorizado "${done.title}" (${Date.now() - t0}ms)`);
      return done;
    }
    await lidarrFetch('/command', { method: 'POST', body: { name: 'RefreshArtist', artistId: artist.id } }).catch(() => {});
    console.warn(`[lidarr] … artista presente pero álbum ${rgMbid} sin importar; refresco pedido`);
    return { ok: true, pending: true, note: 'El artista está en Lidarr pero ese álbum aún no aparece; se ha pedido un refresco. Reinténtalo en unos segundos.' };
  }

  // El artista NO está: buscarlo (consulta la BD de metadatos de Lidarr, su punto
  // flojo) y añadirlo sin monitorizar toda su obra.
  let lookupArtist = null;
  if (artistMbid) {
    const r = await lidarrFetch(`/artist/lookup?term=mbid:${encodeURIComponent(artistMbid)}`).catch(() => []);
    lookupArtist = (r || []).find((a) => a.foreignArtistId === artistMbid) || (r || [])[0];
  } else {
    const al = await lidarrFetch(`/album/lookup?term=lidarr:${encodeURIComponent(rgMbid)}`).catch(() => []);
    lookupArtist = (al || [])[0]?.artist;
  }
  if (!lookupArtist) throw new Error('Lidarr no encuentra al artista en MusicBrainz (su servidor de metadatos puede estar lento; reinténtalo).');

  const created = await lidarrFetch('/artist', {
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
  artistCache.at = 0; // invalidar caché: hay un artista nuevo
  console.log(`[lidarr] + artista "${lookupArtist.artistName || ''}" añadido; esperando a que importe su discografía…`);

  // Sondeo corto (async, no bloquea el bucle de eventos): a menudo Lidarr importa
  // la discografía en pocos segundos y así el álbum se monitoriza en el mismo clic.
  if (created?.id) {
    for (let i = 0; i < 6; i++) {
      await sleep(2500);
      const done = await monitorFromLibrary(created.id, rgMbid).catch(() => null);
      if (done) {
        console.log(`[lidarr] ✓ monitorizado "${done.title}" tras crear artista (${Date.now() - t0}ms)`);
        return done;
      }
    }
  }
  console.warn(`[lidarr] … artista añadido pero discografía aún importándose (${Date.now() - t0}ms)`);
  return { ok: true, pending: true, note: 'Artista añadido a Lidarr; está importando su discografía. Si el álbum no se monitorizó solo, vuelve a pulsarlo en unos segundos.' };
}
