import { db } from './db.js';
import { similarArtists, lastfmConfigured } from './lastfm.js';
import { normName } from './matchkey.js';
import { searchArtists } from './musicbrainz.js';
import { followByMbid } from './tracked.js';
import { deezerFindArtist } from './artistpix.js';

// «Quizá quieras seguir a…»: sugerencias de artistas para SEGUIR que aún no tienes ni
// sigues, a partir de artist.getSimilar de Last.fm sobre tus «semillas» (los que sigues;
// si no sigues a nadie, tus artistas con más álbumes). Se agregan por cuántas semillas
// los recomiendan y por la puntuación de Last.fm. Se recalculan en el refresco; las
// descartadas no vuelven. Seguir una sugerencia la resuelve a MBID y usa followByMbid.

const upsert = db.prepare(
  `INSERT INTO artist_suggestions (key, name, mbid, score, reasons, image, updated_at, dismissed)
   VALUES (@key, @name, @mbid, @score, @reasons, @image, @now, 0)
   ON CONFLICT(key) DO UPDATE SET
     name = excluded.name,
     mbid = COALESCE(excluded.mbid, artist_suggestions.mbid),
     score = excluded.score,
     reasons = excluded.reasons,
     image = COALESCE(excluded.image, artist_suggestions.image),
     updated_at = excluded.updated_at
   WHERE artist_suggestions.dismissed = 0`
);

// Recalcula las sugerencias. maxSeeds acota las llamadas a Last.fm; withImages resuelve
// una foto de Deezer para las mejores (best-effort, no bloquea si falla).
export async function refreshArtistSuggestions({ maxSeeds = 40, perSeed = 15, top = 60, withImages = 30 } = {}) {
  if (!lastfmConfigured()) return { skipped: 'Last.fm no configurado' };

  // semillas: artistas seguidos; si no hay, los tuyos con más álbumes
  let seeds = db
    .prepare(
      `SELECT ar.id, ar.name FROM tracked_artists t JOIN artists ar ON ar.id = t.artist_id
       WHERE t.facet = 'artist' AND ar.name IS NOT NULL ORDER BY ar.name COLLATE NOCASE`
    )
    .all();
  if (!seeds.length) {
    seeds = db
      .prepare(
        `SELECT ar.id, ar.name, COUNT(a.id) c FROM artists ar
         JOIN albums a ON a.artist_id = ar.id AND a.match_state != 'dismissed'
         WHERE ar.name IS NOT NULL GROUP BY ar.id ORDER BY c DESC LIMIT ?`
      )
      .all(maxSeeds);
  }
  seeds = seeds.slice(0, maxSeeds);
  if (!seeds.length) return { count: 0 };

  // lo que ya conoces (tuyo o seguido): todo lo que hay en la tabla artists
  const known = new Set(db.prepare('SELECT name FROM artists WHERE name IS NOT NULL').all().map((r) => normName(r.name)));
  // sugerencias ya descartadas: no reproponerlas
  const dismissed = new Set(
    db.prepare('SELECT key FROM artist_suggestions WHERE dismissed = 1').all().map((r) => r.key)
  );

  const agg = new Map(); // key -> { name, mbid, score, reasons:Set }
  for (const s of seeds) {
    // eslint-disable-next-line no-await-in-loop
    const sims = await similarArtists(s.name, perSeed);
    for (const sim of sims) {
      const k = normName(sim.name);
      if (!k || known.has(k) || dismissed.has(k)) continue;
      if (!agg.has(k)) agg.set(k, { key: k, name: sim.name, mbid: sim.mbid || null, score: 0, reasons: new Set() });
      const e = agg.get(k);
      e.score += sim.match || 0;
      e.reasons.add(s.name);
      if (!e.mbid && sim.mbid) e.mbid = sim.mbid;
    }
  }

  // ranking: primero por nº de semillas que lo recomiendan, luego por puntuación
  const list = [...agg.values()]
    .sort((a, b) => b.reasons.size - a.reasons.size || b.score - a.score)
    .slice(0, top);

  // fotos de Deezer para los mejores (best-effort)
  for (let i = 0; i < Math.min(withImages, list.length); i++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const d = await deezerFindArtist(list[i].name);
      if (d?.image) list[i].image = d.image;
    } catch {
      /* sin foto, no pasa nada */
    }
  }

  const now = Date.now();
  const tx = db.transaction(() => {
    // limpia las vigentes (no las descartadas) y reinserta el nuevo ranking
    db.prepare('DELETE FROM artist_suggestions WHERE dismissed = 0').run();
    for (const e of list) {
      upsert.run({
        key: e.key,
        name: e.name,
        mbid: e.mbid,
        score: e.score,
        reasons: JSON.stringify([...e.reasons].slice(0, 5)),
        image: e.image || null,
        now,
      });
    }
  });
  tx();
  return { count: list.length, seeds: seeds.length };
}

export function similarSuggestions(limit = 40) {
  return db
    .prepare('SELECT name, mbid, score, reasons, image FROM artist_suggestions WHERE dismissed = 0 ORDER BY score DESC LIMIT ?')
    .all(limit)
    .map((r) => ({ ...r, reasons: JSON.parse(r.reasons || '[]') }));
}

export function dismissSuggestion(name) {
  const key = normName(name);
  // marca descartada (crea la fila si hiciera falta, para que no vuelva a proponerse)
  db.prepare(
    `INSERT INTO artist_suggestions (key, name, dismissed, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET dismissed = 1`
  ).run(key, name, Date.now());
  return { ok: true };
}

// Seguir una sugerencia: si trae MBID, directo; si no, se resuelve por búsqueda en MB.
// Al seguir, se descarta de la lista (ya la sigues).
export async function followSuggestion({ name, mbid } = {}) {
  let id = mbid || null;
  if (!id) {
    if (!name) throw new Error('Falta el artista');
    const hits = await searchArtists(name, 3);
    id = hits?.[0]?.mbid || null;
    if (!id) throw new Error('MusicBrainz no encontró ese artista');
  }
  const r = await followByMbid(id, 'artist');
  if (name) dismissSuggestion(name);
  return r;
}
