import { db } from './db.js';
import { matchKey, normName } from './matchkey.js';
import { spotifyNewReleases, spotifyConfigured } from './spotify.js';

// RADAR DE DESCUBRIMIENTO («otros grupos»): novedades GLOBALES del feed editorial de Spotify,
// de cualquier artista, ordenadas por AFINIDAD contigo. No es un firehose: resalta primero lo
// de artistas que ya tienes/sigues y lo PARECIDO a lo que te gusta (similares de Last.fm), y
// deja el resto (descubrimiento puro) al final o escondido. La afinidad se calcula EN VIVO al
// leer (tu colección y tus similares cambian), no se guarda; en la tabla solo va el crudo.

const STORE_TYPES = new Set(['album', 'ep', 'single']); // fuera 'compilation' y demás
const RETENTION_DAYS = 45; // el feed editorial es reciente; poda lo más viejo que esto

const upsert = db.prepare(
  `INSERT INTO global_releases
     (source, artist, artists_json, title, match_key, release_date, record_type, cover, url, first_seen)
   VALUES (@source, @artist, @artists_json, @title, @match_key, @release_date, @record_type, @cover, @url, @now)
   ON CONFLICT(source, match_key) DO UPDATE SET
     release_date = excluded.release_date,
     record_type = excluded.record_type,
     cover = COALESCE(excluded.cover, global_releases.cover),
     url = COALESCE(excluded.url, global_releases.url),
     artists_json = excluded.artists_json
   WHERE global_releases.dismissed = 0`
);

// Trae y guarda el feed de novedades globales de Spotify. Devuelve cuántas hay tras la pasada.
export async function refreshGlobalReleases({ pages = 5 } = {}) {
  if (!spotifyConfigured()) return { count: 0, added: 0, skipped: 'Spotify no configurado' };
  const items = await spotifyNewReleases({ pages });
  const now = Date.now();
  let added = 0;
  for (const it of items) {
    const type = String(it.record_type || 'album').toLowerCase();
    if (!STORE_TYPES.has(type)) continue;
    const artist = (it.artists && it.artists[0]) || it.artist || '';
    if (!artist) continue;
    const date = (it.release_date || '').slice(0, 10);
    if (!date || date.length < 10) continue; // sin fecha completa no sirve para «hoy/ayer»
    const mk = matchKey(artist, it.title);
    const info = upsert.run({
      source: 'spotify',
      artist,
      artists_json: JSON.stringify(it.artists || [artist]),
      title: it.title,
      match_key: mk,
      release_date: date,
      record_type: type,
      cover: it.cover || null,
      url: it.url || null,
      now,
    });
    if (info.changes) added++;
  }
  // poda lo más viejo que la ventana de retención
  const cutoff = new Date(now - RETENTION_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  db.prepare('DELETE FROM global_releases WHERE release_date < ?').run(cutoff);
  const count = db.prepare('SELECT COUNT(*) n FROM global_releases WHERE dismissed = 0').get().n;
  return { count, added };
}

// Índices de afinidad (en vivo): artistas tuyos (seguidos/en colección) y parecidos (Last.fm).
function buildAffinity() {
  const mine = new Map(); // normName -> { name, followed:boolean }
  const rows = db
    .prepare(
      `SELECT ar.name AS name,
              EXISTS(SELECT 1 FROM tracked_artists t WHERE t.artist_id = ar.id AND t.facet='artist') AS followed
         FROM artists ar
        WHERE ar.name IS NOT NULL AND ar.name != '' AND (
          EXISTS(SELECT 1 FROM tracked_artists t WHERE t.artist_id = ar.id AND t.facet='artist')
          OR EXISTS(SELECT 1 FROM albums al WHERE al.artist_id = ar.id AND al.match_state != 'dismissed')
        )`
    )
    .all();
  for (const r of rows) {
    const k = normName(r.name);
    const prev = mine.get(k);
    // si aparece como seguido en alguna fila, que gane «followed»
    if (!prev || (r.followed && !prev.followed)) mine.set(k, { name: r.name, followed: !!r.followed });
  }

  const similar = new Map(); // normName -> reasons[] (artistas tuyos a los que se parece)
  try {
    for (const r of db.prepare('SELECT key, reasons FROM artist_suggestions WHERE dismissed = 0').all()) {
      let reasons = [];
      try {
        reasons = JSON.parse(r.reasons || '[]');
      } catch {
        reasons = [];
      }
      similar.set(r.key, reasons);
    }
  } catch {
    /* sin sugerencias todavía */
  }

  // ¿ya lo tienes? (para poder ocultar lo que ya está en tu disco)
  const ownedKeys = new Set(
    db
      .prepare("SELECT album_artist, title FROM albums WHERE match_state != 'dismissed'")
      .all()
      .map((r) => matchKey(r.album_artist, r.title))
  );

  return { mine, similar, ownedKeys };
}

// Puntúa una novedad por afinidad. 100 sigues · 90 la tienes · 50 parecido · 0 sin relación.
function scoreRelease(artists, aff) {
  let best = { score: 0, reason: null };
  for (const name of artists) {
    const k = normName(name);
    const m = aff.mine.get(k);
    if (m?.followed && best.score < 100) best = { score: 100, reason: `Sigues a ${m.name}` };
    else if (m && best.score < 90) best = { score: 90, reason: `Tienes a ${m.name} en tu colección` };
    else if (aff.similar.has(k) && best.score < 50) {
      const reasons = aff.similar.get(k) || [];
      best = { score: 50, reason: reasons.length ? `Parecido a ${reasons[0]}` : 'Parecido a lo que escuchas' };
    }
  }
  return best;
}

// Novedades globales para la UI, ordenadas por afinidad y fecha. Por defecto solo las que
// tienen relación contigo (score>0) y que NO tienes ya; con includeAll se muestra el feed
// entero (descubrimiento puro incluido) y con includeOwned también lo que ya está en tu disco.
export function globalReleases({ days = 14, includeAll = false, includeOwned = false, limit = 300 } = {}) {
  const since = new Date(Date.now() - Math.max(0, Number(days) || 0) * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const aff = buildAffinity();
  const rows = db
    .prepare(
      `SELECT id, source, artist, artists_json, title, release_date, record_type, cover, url
         FROM global_releases
        WHERE dismissed = 0 AND release_date >= @since
        ORDER BY release_date DESC`
    )
    .all({ since });
  const out = [];
  for (const r of rows) {
    let artists = [r.artist];
    try {
      const a = JSON.parse(r.artists_json || '[]');
      if (Array.isArray(a) && a.length) artists = a;
    } catch {
      /* usa el principal */
    }
    const owned = aff.ownedKeys.has(matchKey(r.artist, r.title));
    if (owned && !includeOwned) continue;
    const { score, reason } = scoreRelease(artists, aff);
    if (score === 0 && !includeAll) continue;
    out.push({
      id: r.id,
      source: r.source,
      artist: r.artist,
      artists,
      title: r.title,
      release_date: r.release_date,
      record_type: r.record_type,
      cover: r.cover,
      url: r.url,
      affinity: score,
      reason,
      owned,
    });
  }
  // afinidad primero, luego fecha (ya venía ordenado por fecha, orden estable)
  out.sort((a, b) => b.affinity - a.affinity);
  return out.slice(0, limit);
}

export function dismissGlobalRelease(id) {
  db.prepare('UPDATE global_releases SET dismissed = 1 WHERE id = ?').run(Number(id));
  return { ok: true };
}
