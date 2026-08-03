import { db } from './db.js';
import * as mb from './musicbrainz.js';

// El grafo de relaciones de un artista, cruzado con TU colección. Convierte
// "completismo por artista" en algo más rico: «tienes 8 discos de la órbita de
// Thom Yorke pero te falta Atoms for Peace». Para cada artista relacionado se
// mira si lo tienes en local (por MBID), cuántos álbumes suyos tienes y si lo
// sigues, para poder saltar o seguirlo de un clic.

// Agrupa los tipos de relación de MusicBrainz en categorías legibles.
function bucketOf(rel) {
  const t = (rel.type || '').toLowerCase();
  if (t === 'member of band') return rel.direction === 'backward' ? 'members' : 'bands';
  if (t === 'collaboration') return 'collaborations';
  if (/founder|conductor|subgroup|is person|artistic director|supporting musician|tribute|voice/.test(t))
    return 'related';
  return 'related';
}

const BUCKET_LABEL = {
  members: 'Miembros',
  bands: 'Bandas y proyectos',
  collaborations: 'Colaboraciones',
  related: 'Relacionados',
};

export async function artistRelations(artistId) {
  const artist = db.prepare('SELECT id, name, mbid FROM artists WHERE id = ?').get(artistId);
  if (!artist) throw new Error('Artista no encontrado');
  if (!artist.mbid) return { hasMbid: false, groups: [] };

  const rels = await mb.artistRelations(artist.mbid);

  // dedup por MBID relacionado, quedándonos con la primera relación de cada uno
  const seen = new Map();
  for (const r of rels) {
    if (!seen.has(r.mbid)) seen.set(r.mbid, r);
  }

  const localByMbid = new Map(
    db.prepare('SELECT id, mbid FROM artists WHERE mbid IS NOT NULL').all().map((a) => [a.mbid, a.id])
  );
  const trackedIds = new Set(db.prepare('SELECT DISTINCT artist_id FROM tracked_artists').all().map((r) => r.artist_id));

  const buckets = {};
  for (const r of seen.values()) {
    const localId = localByMbid.get(r.mbid) || null;
    const owned = localId
      ? db.prepare("SELECT COUNT(*) AS n FROM albums WHERE artist_id = ? AND match_state != 'dismissed'").get(localId).n
      : 0;
    const entry = {
      mbid: r.mbid,
      name: r.name,
      relation: r.type,
      attributes: r.attributes,
      begin: r.begin,
      end: r.end,
      artist_id: localId,
      owned_albums: owned,
      tracked: localId ? trackedIds.has(localId) : false,
    };
    const b = bucketOf(r);
    (buckets[b] ||= []).push(entry);
  }

  // orden de secciones y de miembros (los que tienes primero)
  const order = ['members', 'bands', 'collaborations', 'related'];
  const groups = order
    .filter((k) => buckets[k]?.length)
    .map((k) => ({
      key: k,
      label: BUCKET_LABEL[k],
      artists: buckets[k].sort((a, b) => b.owned_albums - a.owned_albums || a.name.localeCompare(b.name)),
    }));

  return { hasMbid: true, artist: { name: artist.name }, groups };
}
