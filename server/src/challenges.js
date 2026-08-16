import { db } from './db.js';
import { matchKey } from './matchkey.js';

// Retos: listas de álbumes "que hay que tener/oír" (1001 Albums, Rolling Stone
// 500, o cualquier lista que pegues). Se cruzan con tu biblioteca (lo que tienes)
// y con tus escuchas de Last.fm (lo que has oído), con anillos de progreso. Mismo
// mecanismo que custom_canons + retos de Letterboxd de PowaFlex.

// Parsea texto pegado a una lista de {artist, album, year}. Acepta formatos
// habituales: "Artista - Álbum", "Artista – Álbum (1997)", "1. Artista — Álbum",
// y opcionalmente una cabecera. Ignora líneas vacías.
export function parseList(text) {
  const src = String(text || '');
  // RateYourMusic (copiar-pegar del chart): cada entrada trae la línea del alt de la
  // carátula «Artista - Álbum, Cover art». Es el ancla limpia; si la hay, parseamos solo
  // esas (el resto del bloque —fecha, géneros, nota, nº de valoraciones— es ruido).
  const rym = [...src.matchAll(/^(.+?)\s+[-–—]\s+(.+?),\s*Cover art\s*$/gim)];
  if (rym.length) {
    const items = [];
    const seen = new Set();
    for (const m of rym) {
      const artist = m[1].trim();
      const album = m[2].trim();
      const k = `${artist}::${album}`.toLowerCase();
      if (artist && album && !seen.has(k)) {
        seen.add(k);
        items.push({ artist, album, year: null });
      }
    }
    return items;
  }

  const items = [];
  for (const raw of src.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(/^\s*\d+[.)]\s*/, ''); // numeración inicial
    let year = null;
    // año final en "(1977)" o como sufijo " - 1977" / " – 1977" (formato de muchas listas)
    const ym = line.match(/\((\d{4})\)\s*$/) || line.match(/\s[-–—]\s*(\d{4})\s*$/);
    if (ym) {
      year = Number(ym[1]);
      line = line.slice(0, ym.index).trim();
    }
    const parts = line.split(/\s+[-–—]\s+/); // guion, en-dash o em-dash
    if (parts.length < 2) continue; // sin separador no sabemos artista/álbum
    const artist = parts[0].trim();
    const album = parts.slice(1).join(' - ').trim();
    if (artist && album) items.push({ artist, album, year });
  }
  return items;
}

// Índices caros (biblioteca y escuchas) cacheados con TTL corto y COMPARTIDOS por todos
// los retos: reconstruirlos al abrir cada reto era el grueso de la lentitud. La
// biblioteca y los scrobbles cambian poco entre navegaciones; 10 s de frescura bastan.
const CACHE_TTL = 10_000;
let ownedCache = { at: 0, map: null };
let playsCache = { at: 0, map: null };

// matchKey(artista/álbum) → id del álbum que TIENES. Cruza por album_artist Y por el
// artista canónico (el tag albumartist a veces difiere del nombre resuelto).
function ownedIndex() {
  if (ownedCache.map && Date.now() - ownedCache.at < CACHE_TTL) return ownedCache.map;
  const map = new Map();
  for (const a of db
    .prepare(
      `SELECT a.id, a.album_artist, ar.name AS artist_name, a.title
       FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id
       WHERE a.match_state != 'dismissed'`
    )
    .all()) {
    map.set(matchKey(a.album_artist, a.title), a.id);
    if (a.artist_name) map.set(matchKey(a.artist_name, a.title), a.id);
  }
  ownedCache = { at: Date.now(), map };
  return map;
}

const playKey = (artist, album) => `${String(artist || '').toLowerCase()}${String(album || '').toLowerCase()}`;

// (artista+álbum en minúsculas) → nº de escuchas de Last.fm, en UNA sola pasada agrupada.
// Antes se hacía una subconsulta COUNT por CADA ítem del reto, y como `listens` no tiene
// índice por (artista, álbum) era un barrido completo por ítem: en listas largas con
// muchos scrobbles se disparaba. El plegado a minúsculas se hace en JS (consistente con
// la búsqueda) sumando colisiones.
function playsIndex() {
  if (playsCache.map && Date.now() - playsCache.at < CACHE_TTL) return playsCache.map;
  const map = new Map();
  for (const r of db
    .prepare("SELECT artist, album, COUNT(*) AS n FROM listens WHERE source='lastfm' AND album IS NOT NULL AND album <> '' GROUP BY artist, album")
    .all()) {
    const k = playKey(r.artist, r.album);
    map.set(k, (map.get(k) || 0) + r.n);
  }
  playsCache = { at: Date.now(), map };
  return map;
}

// Resuelve cada ítem de un reto contra tu biblioteca (owned_album_id).
function resolveItems(challengeId) {
  const ownedMap = ownedIndex();
  const items = db.prepare('SELECT position, artist, album FROM challenge_items WHERE challenge_id = ?').all(challengeId);
  const upd = db.prepare('UPDATE challenge_items SET owned_album_id = ? WHERE challenge_id = ? AND position = ?');
  const tx = db.transaction(() => {
    for (const it of items) {
      upd.run(ownedMap.get(matchKey(it.artist, it.album)) ?? null, challengeId, it.position);
    }
  });
  tx();
}

export function addChallenge(name, text) {
  const items = parseList(text);
  if (!items.length) throw new Error('No se ha reconocido ningún "Artista - Álbum" en la lista');
  const res = db
    .prepare("INSERT INTO challenges (name, source, item_count, added_at) VALUES (?, 'paste', ?, ?)")
    .run(name || 'Reto sin título', items.length, Date.now());
  const id = Number(res.lastInsertRowid);
  const ins = db.prepare(
    'INSERT INTO challenge_items (challenge_id, position, artist, album, year) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    items.forEach((it, i) => ins.run(id, i, it.artist, it.album, it.year));
  });
  tx();
  resolveItems(id);
  return { id, item_count: items.length };
}

export function listChallenges() {
  return db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM challenge_items ci WHERE ci.challenge_id=c.id AND ci.owned_album_id IS NOT NULL) AS owned
       FROM challenges c WHERE hidden = 0 ORDER BY c.added_at DESC`
    )
    .all()
    .map((c) => ({ ...c, pct: c.item_count ? Math.round((c.owned / c.item_count) * 100) : 0 }));
}

export function challengeDetail(id) {
  const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
  if (!c) return null;
  resolveItems(id); // re-resuelve por si la biblioteca cambió
  const plays = playsIndex();
  const items = db
    .prepare('SELECT position, artist, album, year, owned_album_id FROM challenge_items WHERE challenge_id = ? ORDER BY position')
    .all(id)
    .map((it) => ({
      position: it.position,
      artist: it.artist,
      album: it.album,
      year: it.year,
      owned: !!it.owned_album_id,
      owned_album_id: it.owned_album_id,
      listened: (plays.get(playKey(it.artist, it.album)) || 0) > 0,
    }));
  const owned = items.filter((i) => i.owned).length;
  const listened = items.filter((i) => i.listened).length;
  return {
    ...c,
    owned,
    listened,
    pct: c.item_count ? Math.round((owned / c.item_count) * 100) : 0,
    listenedPct: c.item_count ? Math.round((listened / c.item_count) * 100) : 0,
    items,
  };
}

export function deleteChallenge(id) {
  db.prepare('DELETE FROM challenge_items WHERE challenge_id = ?').run(id);
  db.prepare('DELETE FROM challenges WHERE id = ?').run(id);
  return { ok: true };
}

// «¿Cuál es el siguiente disco por escuchar de tus retos?» para el dashboard: discos de
// tus retos que TIENES (puedes ponerlos ya) y aún NO has escuchado en Last.fm. Ordena por
// reto más reciente y su posición, así sugiere lo primero pendiente de tu último reto.
// Usa los índices cacheados (biblioteca + escuchas), sin depender de owned_album_id
// guardado (que puede estar sin resolver si no abriste ese reto tras importar).
export function nextChallengeListens(limit = 5) {
  const owned = ownedIndex();
  const plays = playsIndex();
  const rows = db
    .prepare(
      `SELECT ci.artist, ci.album, ci.year, c.id AS challenge_id, c.name AS challenge
       FROM challenge_items ci JOIN challenges c ON c.id = ci.challenge_id
       WHERE c.hidden = 0 ORDER BY c.added_at DESC, ci.position ASC`
    )
    .all();
  const out = [];
  for (const r of rows) {
    const ownedId = owned.get(matchKey(r.artist, r.album));
    if (!ownedId) continue; // solo lo que tienes (para poder escucharlo ya)
    if ((plays.get(playKey(r.artist, r.album)) || 0) > 0) continue; // y aún no oído
    out.push({ artist: r.artist, album: r.album, year: r.year, owned_album_id: ownedId, challenge_id: r.challenge_id, challenge: r.challenge });
    if (out.length >= limit) break;
  }
  return out;
}

// Los álbumes de un reto que NO tienes, para resolver a MusicBrainz y mandarlos a
// Lidarr (se hace en la ruta, aquí solo la lista de textos a buscar).
export function challengeMissing(id) {
  return db
    .prepare(
      `SELECT position, artist, album, year FROM challenge_items
       WHERE challenge_id = ? AND owned_album_id IS NULL ORDER BY position`
    )
    .all(id);
}
