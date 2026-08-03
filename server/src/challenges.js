import { db } from './db.js';

// Retos: listas de álbumes "que hay que tener/oír" (1001 Albums, Rolling Stone
// 500, o cualquier lista que pegues). Se cruzan con tu biblioteca (lo que tienes)
// y con tus escuchas de Last.fm (lo que has oído), con anillos de progreso. Mismo
// mecanismo que custom_canons + retos de Letterboxd de PowaFlex.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Parsea texto pegado a una lista de {artist, album, year}. Acepta formatos
// habituales: "Artista - Álbum", "Artista – Álbum (1997)", "1. Artista — Álbum",
// y opcionalmente una cabecera. Ignora líneas vacías.
export function parseList(text) {
  const items = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(/^\s*\d+[.)]\s*/, ''); // numeración inicial
    let year = null;
    const ym = line.match(/\((\d{4})\)\s*$/);
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

// Resuelve cada ítem de un reto contra tu biblioteca (owned_album_id).
function resolveItems(challengeId) {
  const owned = db
    .prepare("SELECT id, album_artist, title FROM albums WHERE match_state != 'dismissed'")
    .all()
    .map((a) => ({ id: a.id, key: norm(a.album_artist) + '::' + norm(a.title) }));
  const ownedMap = new Map(owned.map((o) => [o.key, o.id]));

  const items = db.prepare('SELECT rowid, * FROM challenge_items WHERE challenge_id = ?').all(challengeId);
  const upd = db.prepare('UPDATE challenge_items SET owned_album_id = ? WHERE challenge_id = ? AND position = ?');
  const tx = db.transaction(() => {
    for (const it of items) {
      const key = norm(it.artist) + '::' + norm(it.album);
      upd.run(ownedMap.get(key) ?? null, challengeId, it.position);
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
  const items = db
    .prepare(
      `SELECT ci.*,
        (SELECT COUNT(*) FROM listens l WHERE l.source='lastfm'
          AND l.artist = ci.artist COLLATE NOCASE AND l.album = ci.album COLLATE NOCASE) AS plays
       FROM challenge_items ci WHERE ci.challenge_id = ? ORDER BY ci.position`
    )
    .all(id)
    .map((it) => ({
      position: it.position,
      artist: it.artist,
      album: it.album,
      year: it.year,
      owned: !!it.owned_album_id,
      owned_album_id: it.owned_album_id,
      listened: it.plays > 0,
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
