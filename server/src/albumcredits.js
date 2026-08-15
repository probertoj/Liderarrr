import { db } from './db.js';
import * as mb from './musicbrainz.js';
import { albumCredits } from './credits.js';

// Créditos ricos de un álbum (estilo Roon): personal con sus roles/instrumentos, sacado
// de las relaciones de MusicBrainz (nivel release + grabación + obra). Cada persona se
// cruza con TU biblioteca por MBID para enlazar a su ficha si la tienes. Bajo demanda
// desde la ficha del álbum (varias peticiones a MB, cacheadas). No toca ficheros.

export async function albumPersonnel(albumId) {
  const a = db.prepare('SELECT id, rg_mbid, release_mbid FROM albums WHERE id = ?').get(albumId);
  if (!a) throw new Error('Álbum no encontrado');
  if (!a.rg_mbid) return { found: false, reason: 'El álbum no está identificado en MusicBrainz.' };

  const res = await mb.releaseGroupCredits(a.rg_mbid, a.release_mbid);
  const people = res.found ? res.people : [];

  // artistas PRINCIPALES del álbum (artist-credit): van primero con rol "Artista principal"
  const primary = albumCredits(albumId).filter((c) => c.mbid);
  const merged = new Map();
  for (const c of primary) {
    merged.set(c.mbid, { mbid: c.mbid, name: c.name, roles: ['Artista principal'], all_tracks: true, track_count: res.total_tracks || 0, primary: true });
  }
  for (const p of people) {
    const ex = merged.get(p.mbid);
    if (ex) {
      // ya está como principal: añade sus roles adicionales sin duplicar
      for (const r of p.roles) if (!ex.roles.includes(r)) ex.roles.push(r);
    } else {
      merged.set(p.mbid, { ...p, primary: false });
    }
  }

  // cruce con la biblioteca local por MBID (para enlazar a la ficha del artista)
  const byMbid = new Map(db.prepare('SELECT id, mbid FROM artists WHERE mbid IS NOT NULL').all().map((r) => [r.mbid, r.id]));
  const out = [...merged.values()].map((p) => ({
    mbid: p.mbid,
    name: p.name,
    roles: p.roles,
    role_text: p.roles.join(' · '),
    all_tracks: !!p.all_tracks,
    track_count: p.track_count || 0,
    artist_id: byMbid.get(p.mbid) || null,
  }));
  // principales primero, luego por nº de pistas
  out.sort((x, y) => Number(y.roles.includes('Artista principal')) - Number(x.roles.includes('Artista principal')) || (y.track_count - x.track_count));
  return { found: out.length > 0, release_mbid: res.release_mbid || null, total_tracks: res.total_tracks || null, people: out };
}
