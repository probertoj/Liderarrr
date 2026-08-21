import { db, getSetting } from './db.js';
import * as mb from './musicbrainz.js';
import * as acoustid from './acoustid.js';
import * as discogs from './discogs.js';
import * as lastfm from './lastfm.js';
import { clearNone } from './covers.js';
import { syncAlbumCreditsFromMb } from './credits.js';
import { cleanTitleForMatch } from './matchkey.js';

// La cadena de identificación, en orden de fiabilidad decreciente (es el flujo
// del segundo diagrama). Cada álbum sin resolver pasa por:
//   1. MBID ya embebido en las etiquetas (Picard) — exacto, gratis
//   2. AcoustID: huella del audio real de una pista representativa
//   3. MusicBrainz: búsqueda por texto artista+título
//   4. Discogs: red de seguridad para ediciones raras
//   5. Last.fm: resolver el nombre (cola larga)
// Si nada coincide, queda 'unmatched' y decide el usuario (orphan / manual).
//
// NUNCA borra ni oculta un álbum: lo peor que le pasa es quedarse sin MBID.

export const identifyStatus = {
  running: false,
  total: 0,
  done: 0,
  matched: 0,
  unmatched: 0,
  current: null,
  startedAt: null,
  finishedAt: null,
  error: null,
};

const setArtistFromMb = db.prepare(
  `UPDATE artists SET mbid=COALESCE(mbid,@mbid), type=COALESCE(type,@type), country=COALESCE(country,@country),
     began=COALESCE(began,@began), ended=COALESCE(ended,@ended),
     disambiguation=COALESCE(NULLIF(disambiguation,''),@disambiguation), details_fetched_at=@now
   WHERE id=@id`
);
const artistNeedsMbid = db.prepare('SELECT id, name, mbid FROM artists WHERE id = ?');
const findArtistByMbid = db.prepare('SELECT id FROM artists WHERE mbid = ? LIMIT 1');

const applyMatch = db.prepare(`
UPDATE albums SET rg_mbid=@rg_mbid, primary_type=@primary_type, secondary_types=@secondary_types,
  year=COALESCE(year,@year), match_state='matched', match_source=@source,
  match_confidence=@confidence, matched_at=@now WHERE id=@id
`);
const markUnmatched = db.prepare(
  "UPDATE albums SET match_state='unmatched', matched_at=@now WHERE id=@id AND match_state='pending'"
);

// Ancla el MBID de artista que devuelva MusicBrainz a la fila local del álbum.
async function anchorArtist(albumId, artistMbid) {
  if (!artistMbid) return;
  const album = db.prepare('SELECT artist_id FROM albums WHERE id = ?').get(albumId);
  if (!album) return;
  const cur = artistNeedsMbid.get(album.artist_id);
  if (!cur || cur.mbid) return;
  // si ya existe otra fila con ese MBID, no dupliques: apunta el álbum a ella
  const owner = findArtistByMbid.get(artistMbid);
  if (owner && owner.id !== album.artist_id) {
    db.prepare('UPDATE albums SET artist_id = ? WHERE id = ?').run(owner.id, albumId);
    return;
  }
  try {
    const info = await mb.artistByMbid(artistMbid);
    if (info) setArtistFromMb.run({ ...info, id: album.artist_id, now: Date.now() });
  } catch {
    db.prepare('UPDATE artists SET mbid = ? WHERE id = ? AND mbid IS NULL').run(artistMbid, album.artist_id);
  }
}

function commitMatch(album, rg, source, confidence) {
  applyMatch.run({
    id: album.id,
    rg_mbid: rg.rg_mbid,
    primary_type: rg.primary_type || null,
    secondary_types: JSON.stringify(rg.secondary_types || []),
    year: rg.first_release ? Number(String(rg.first_release).slice(0, 4)) : null,
    source,
    confidence,
    now: Date.now(),
  });
  // ya tiene MBID: el Cover Art Archive puede tener su portada → que se reintente
  clearNone(album.id);
}

// Identifica un solo álbum recorriendo la cadena. Devuelve la fuente que acertó
// o null. Respeta un MBID ya presente (source 'tags').
async function identifyAlbum(album) {
  // 1. etiquetas
  if (album.rg_mbid) {
    try {
      // enriquece tipos si no los tenemos aún
      const rgList = album.artist_mbid ? [] : [];
      commitMatch(album, { rg_mbid: album.rg_mbid, primary_type: album.primary_type, secondary_types: [], first_release: null }, 'tags', 1);
    } catch {
      /* noop */
    }
    await anchorArtist(album.id, album.artist_mbid);
    return 'tags';
  }

  // 1.5 DISCOGRAFÍA CONOCIDA del artista: si el artista ya está identificado (tiene MBID)
  //     y su discografía está cruzada (release_groups), casa el álbum por título contra
  //     ella. Es OFFLINE, exacto e inmune a la búsqueda de texto de MB —que falla con
  //     artistas de caracteres raros («Florence + The Machine»)—; el rg_mbid ya lo
  //     conocemos, solo hay que escribirlo. Entre coincidencias exactas prefiere el álbum
  //     de estudio (no un single/EP homónimo).
  if (album.artist_mbid) {
    const target = cleanTitleForMatch(album.title);
    if (target) {
      const rgs = db
        .prepare('SELECT rg_mbid, title, primary_type, secondary_types, first_release FROM release_groups WHERE artist_mbid = ?')
        .all(album.artist_mbid);
      const secs = (r) => {
        try {
          return r.secondary_types ? JSON.parse(r.secondary_types) : [];
        } catch {
          return [];
        }
      };
      const isStudio = (r) => r.primary_type === 'Album' && !secs(r).length;
      const exact = rgs.filter((r) => cleanTitleForMatch(r.title) === target);
      const hit =
        exact.find(isStudio) ||
        exact[0] ||
        rgs.find((r) => {
          const t = cleanTitleForMatch(r.title);
          return t && (t.includes(target) || target.includes(t));
        });
      if (hit) {
        commitMatch(
          album,
          { rg_mbid: hit.rg_mbid, primary_type: hit.primary_type, secondary_types: secs(hit), first_release: hit.first_release },
          'discography',
          0.95
        );
        return 'discography';
      }
    }
  }

  // 2. MusicBrainz por texto (BARATO: 1 pet/s y cacheado). Es lo primero porque
  //    resuelve la mayoría de los álbumes bien etiquetados sin tocar el fichero.
  try {
    const rg = await mb.searchReleaseGroup(album.album_artist, album.title, album.artist_mbid || null);
    if (rg && rg.score >= 80) {
      commitMatch(album, rg, 'musicbrainz', rg.score / 100);
      await anchorArtist(album.id, rg.artist_mbid);
      // splits/colaboraciones: si el credit trae 2+ artistas, se poblan automáticamente
      syncAlbumCreditsFromMb(album.id, rg.credits);
      return 'musicbrainz';
    }
  } catch {
    /* sigue la cadena */
  }

  // 3. Last.fm puede tener el MBID de release; si lo da, se vuelve a MB
  try {
    const info = await lastfm.albumInfo(album.album_artist, album.title);
    if (info?.mbid) {
      const { artist_mbid, releaseGroups } = await mb.recordingReleaseGroups(info.mbid).catch(() => ({}));
      const rg = pickBest(releaseGroups || [], album.title) || null;
      if (rg) {
        commitMatch(album, rg, 'lastfm', 0.6);
        await anchorArtist(album.id, artist_mbid);
        return 'lastfm';
      }
    }
  } catch {
    /* sigue la cadena */
  }

  // 4. AcoustID (huella del audio) — ÚLTIMO recurso: fpcalc LEE EL FICHERO ENTERO y
  //    calcula la huella (caro por red y CPU). Solo se hace si lo anterior falló y
  //    está activado; si no, en una biblioteca enorme ahogaría toda la app.
  if (getSetting('identify_acoustid') !== '0') {
    const rep = db
      .prepare('SELECT path FROM tracks WHERE album_id = ? AND path IS NOT NULL ORDER BY duration_ms DESC LIMIT 1')
      .get(album.id);
    if (rep) {
      try {
        const hit = await acoustid.lookup(rep.path);
        if (hit?.mb_recording_id && hit.score >= 0.5) {
          const { artist_mbid, releaseGroups } = await mb.recordingReleaseGroups(hit.mb_recording_id);
          const rg = pickBest(releaseGroups, album.title);
          if (rg) {
            commitMatch(album, rg, 'acoustid', hit.score);
            await anchorArtist(album.id, artist_mbid);
            return 'acoustid';
          }
        }
      } catch {
        /* sigue */
      }
    }
  }

  markUnmatched.run({ id: album.id, now: Date.now() });
  return null;
}

function pickBest(list, title) {
  if (!list || !list.length) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const target = norm(title);
  const isStudio = (r) => r.primary_type === 'Album' && !(r.secondary_types || []).length;
  // Entre coincidencias EXACTAS de título, prioriza el álbum de estudio sobre el single/EP
  // homónimo (p. ej. el álbum vs el single "Heaven or Las Vegas"). Si no hay exactas, el
  // mejor álbum de estudio; si no, el primero.
  const exact = list.filter((r) => norm(r.title) === target);
  return exact.find(isStudio) || exact[0] || list.find(isStudio) || list[0];
}

// Procesa todos los álbumes pendientes (o unmatched si force). Trabajo lento en
// segundo plano: NUNCA en la petición del usuario (respeta el límite de MB).
export async function runIdentify({ force = false, limit = 0 } = {}) {
  if (identifyStatus.running) return identifyStatus;
  const states = force ? "('pending','unmatched')" : "('pending')";
  let rows = db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.rg_mbid, a.primary_type, ar.mbid AS artist_mbid
       FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id
       WHERE a.match_state IN ${states} ORDER BY a.added_at DESC`
    )
    .all();
  if (limit > 0) rows = rows.slice(0, limit);

  Object.assign(identifyStatus, {
    running: true,
    total: rows.length,
    done: 0,
    matched: 0,
    unmatched: 0,
    current: null,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  });
  try {
    // Todo el barrido corre en el carril LENTO de MusicBrainz: cede el paso a las
    // llamadas interactivas (ver runBackground/schedule en musicbrainz.js).
    await mb.runBackground(async () => {
      for (const album of rows) {
        identifyStatus.current = `${album.album_artist} — ${album.title}`;
        const source = await identifyAlbum(album);
        if (source) identifyStatus.matched++;
        else identifyStatus.unmatched++;
        identifyStatus.done++;
      }
    });
  } catch (err) {
    identifyStatus.error = String(err.message || err);
  } finally {
    identifyStatus.running = false;
    identifyStatus.finishedAt = Date.now();
    identifyStatus.current = null;
  }
  return identifyStatus;
}

// Identifica UN álbum bajo demanda (tu clic desde la página del disco). Corre por
// el carril RÁPIDO de MusicBrainz (no es runBackground) y NO toca los contadores
// del barrido. Devuelve la fuente que acertó, o null si nada casó.
export async function identifyOne(albumId) {
  const album = db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, a.rg_mbid, a.primary_type, ar.mbid AS artist_mbid
       FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id WHERE a.id = ?`
    )
    .get(albumId);
  if (!album) throw new Error('Álbum no encontrado');
  const source = await identifyAlbum(album);
  return { matched: !!source, source: source || null };
}

// Marca un álbum como rareza (orphan) o lo devuelve a pendiente. El estado
// orphan es de primera clase: cuenta en todo lo descriptivo, no en lo comparativo.
export function setMatchState(albumId, state) {
  const valid = ['orphan', 'pending', 'unmatched', 'dismissed'];
  if (!valid.includes(state)) throw new Error(`Estado inválido: ${state}`);
  db.prepare('UPDATE albums SET match_state = ?, matched_at = ? WHERE id = ?').run(state, Date.now(), albumId);
  return db.prepare('SELECT id, title, match_state FROM albums WHERE id = ?').get(albumId);
}

// Restaura un álbum descartado (papelera / deshacer): lo devuelve a su estado
// natural — 'matched' si conserva su MBID, 'pending' si no. Deshace un "Descartar"
// de la limpieza de duplicados.
export function restoreAlbum(albumId) {
  const a = db.prepare('SELECT id, rg_mbid FROM albums WHERE id = ?').get(albumId);
  if (!a) throw new Error('Álbum no encontrado');
  const state = a.rg_mbid ? 'matched' : 'pending';
  db.prepare('UPDATE albums SET match_state = ?, matched_at = ? WHERE id = ?').run(state, Date.now(), albumId);
  return db.prepare('SELECT id, title, match_state FROM albums WHERE id = ?').get(albumId);
}

// Fija manualmente un release group de MusicBrainz sobre un álbum (desde la
// página "Sin identificar", tras elegir un candidato).
export async function manualMatch(albumId, rgMbid) {
  const album = db.prepare('SELECT id, title, artist_id FROM albums WHERE id = ?').get(albumId);
  if (!album) throw new Error('Álbum no encontrado');
  // Trae el RELEASE GROUP EXACTO que eligió el usuario (por su MBID), no una búsqueda
  // por título: así el tipo (Álbum/Single/EP), los tipos secundarios y el año son los
  // de esa referencia. Antes se re-buscaba por título y podía re-fijar el tipo malo
  // (p. ej. seguir marcándolo "Single" al corregirlo a "Álbum").
  const rg = await mb.releaseGroupById(rgMbid).catch(() => null);
  applyMatch.run({
    id: albumId,
    rg_mbid: rgMbid,
    primary_type: rg?.primary_type || null,
    secondary_types: JSON.stringify(rg?.secondary_types || []),
    year: rg?.first_release ? Number(String(rg.first_release).slice(0, 4)) || null : null,
    source: 'manual',
    confidence: 1,
    now: Date.now(),
  });
  // splits/colaboraciones: puebla el artist-credit desde MB si trae 2+ artistas
  if (rg?.credits) syncAlbumCreditsFromMb(albumId, rg.credits);
  return db.prepare('SELECT id, title, match_state, rg_mbid, primary_type FROM albums WHERE id = ?').get(albumId);
}

// Salvaguarda final: fija el álbum a partir de un ENLACE de MusicBrainz pegado por el
// usuario. Acepta la URL de un release-group (…/release-group/{mbid}), la de un release
// (…/release/{mbid}, que se resuelve a su grupo) o el MBID pelado. Reutiliza manualMatch
// (que trae el tipo/año reales del grupo).
export async function matchByMbUrl(albumId, url) {
  const s = String(url || '').trim();
  const U = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const rg = s.match(new RegExp(`release-group/(${U})`, 'i'));
  if (rg) return manualMatch(albumId, rg[1].toLowerCase());
  const rel = s.match(new RegExp(`/release/(${U})`, 'i'));
  if (rel) {
    const rgMbid = await mb.releaseGroupOfRelease(rel[1].toLowerCase());
    if (!rgMbid) throw new Error('Ese enlace es de un «release» y no encontré su release-group en MusicBrainz.');
    return manualMatch(albumId, rgMbid);
  }
  const bare = s.match(new RegExp(`^(${U})$`, 'i'));
  if (bare) return manualMatch(albumId, bare[1].toLowerCase());
  throw new Error('Enlace de MusicBrainz no reconocido. Pega la URL de un release-group (o de un release), o su MBID.');
}
