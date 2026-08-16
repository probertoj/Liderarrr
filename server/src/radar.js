import { db } from './db.js';
import * as mb from './musicbrainz.js';
import { normName, matchKey } from './matchkey.js';
import { pressingConcernsLists } from './rosyoverdrive.js';
import { reviewsLists } from './ravensingstheblues.js';

// Radar de novedades curadas (0.6 fase 3). Sigues a curadores de buymusic.club
// (usuarios que publican semanalmente lo mejor de Bandcamp) y sus selecciones
// alimentan un radar afín a tu gusto. La página del curador es Next.js con SSR: el
// modelo completo (listas + ítems) viaja embebido en <script id="__NEXT_DATA__">, así
// que una sola descarga trae todo, sin API-key, sin reader, sin paginar.

const UA = 'Mozilla/5.0 (compatible; Liderarrr/0.6; +https://github.com/probertoj/Liderarrr)';
const BMC = 'https://www.buymusic.club';

// El "artista" de Bandcamp puede venir como "Artista, Various" o "A & B": para cruzar
// nos quedamos con el primer nombre (el principal), que es como está en tu biblioteca.
const primaryArtist = (s) => String(s || '').split(/,|&|\bfeat\.?\b|\bwith\b/i)[0].trim();

// --- ingesta ---------------------------------------------------------------

// Extrae y parsea el __NEXT_DATA__ de una página de usuario de buymusic.club.
export function parseBuyMusicClub(html) {
  const m = String(html || '').match(
    /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error('No se encontró __NEXT_DATA__ (¿cambió la página o el usuario no existe?)');
  const data = JSON.parse(m[1]);
  const pp = data?.props?.pageProps || {};
  if (!pp.user) throw new Error('El usuario no existe en buymusic.club');
  return { user: pp.user, lists: pp.lists || [] };
}

async function fetchCuratorPage(username) {
  const res = await fetch(`${BMC}/user/${encodeURIComponent(username)}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (res.status === 404) throw new Error('Ese usuario no existe en buymusic.club');
  if (!res.ok) throw new Error(`buymusic.club respondió ${res.status}`);
  return res.text();
}

const upsertItem = db.prepare(
  `INSERT INTO radar_items
     (curator_id, source, external_id, list_slug, list_title, list_date, artist, title, label,
      release_date, url, image, type, first_seen)
   VALUES (@curator_id, @source, @external_id, @list_slug, @list_title, @list_date, @artist, @title, @label,
      @release_date, @url, @image, @type, @first_seen)
   ON CONFLICT(curator_id, external_id) DO UPDATE SET
     list_slug=excluded.list_slug, list_title=excluded.list_title, list_date=excluded.list_date,
     artist=excluded.artist, title=excluded.title, label=excluded.label,
     release_date=excluded.release_date, url=excluded.url, image=excluded.image, type=excluded.type`
);

const day = (s) => (s ? String(s).slice(0, 10) : null);

// Vuelca las listas del curador a radar_items. Devuelve cuántos ítems nuevos.
function ingest(curatorId, lists, source = 'buymusicclub') {
  const now = Date.now();
  const before = db.prepare('SELECT COUNT(*) AS n FROM radar_items WHERE curator_id = ?').get(curatorId).n;
  const tx = db.transaction(() => {
    for (const l of lists) {
      for (const it of l.ListItems || []) {
        const extId = String(it.id ?? it.externalId ?? `${l.id}:${it.order}`);
        upsertItem.run({
          curator_id: curatorId,
          source,
          external_id: extId,
          list_slug: l.slug || null,
          list_title: l.title || l.description || null,
          list_date: day(l.published_at || l.timestamp),
          artist: it.artist || null,
          title: it.title || it.releaseTitle || null,
          label: it.label || null,
          release_date: day(it.releaseDate) || day(l.published_at),
          url: it.url || null,
          image: it.image || null,
          type: it.type || null,
          first_seen: now,
        });
      }
    }
  });
  tx();
  const after = db.prepare('SELECT COUNT(*) AS n FROM radar_items WHERE curator_id = ?').get(curatorId).n;
  return after - before;
}

// Obtiene {user, lists} según la fuente. buymusic.club: página del usuario (Next.js).
// rosyoverdrive: la columna «Pressing Concerns» (un curador fijo, sin usuario variable).
async function fetchSource(source, username) {
  if (source === 'rosyoverdrive') {
    return { user: { username: 'pressing-concerns', name: 'Rosy Overdrive · Pressing Concerns' }, lists: await pressingConcernsLists() };
  }
  if (source === 'ravensingstheblues') {
    return { user: { username: 'reviews', name: 'Raven Sings the Blues · Reseñas' }, lists: await reviewsLists() };
  }
  const u = String(username || '').trim().replace(/^@/, '');
  if (!u) throw new Error('Falta el nombre de usuario');
  return parseBuyMusicClub(await fetchCuratorPage(u));
}

export async function followCurator(username, source = 'buymusicclub') {
  const { user, lists } = await fetchSource(source, username);
  const uname = user.username || String(username || '').trim().replace(/^@/, '');
  db.prepare(
    `INSERT INTO curators (source, username, name, added_at, refreshed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source, username) DO UPDATE SET name=excluded.name, refreshed_at=excluded.refreshed_at`
  ).run(source, uname, user.name || uname, Date.now(), Date.now());
  const row = db.prepare('SELECT id FROM curators WHERE source = ? AND username = ?').get(source, uname);
  const added = ingest(row.id, lists, source);
  return { ok: true, curator_id: row.id, lists: lists.length, added };
}

export function unfollowCurator(id) {
  db.prepare('DELETE FROM radar_items WHERE curator_id = ?').run(id);
  db.prepare('DELETE FROM curators WHERE id = ?').run(id);
  return { ok: true };
}

export async function refreshCurator(id) {
  const c = db.prepare('SELECT id, source, username FROM curators WHERE id = ?').get(id);
  if (!c) throw new Error('Curador no encontrado');
  const { lists } = await fetchSource(c.source, c.username);
  const added = ingest(c.id, lists, c.source);
  db.prepare('UPDATE curators SET refreshed_at = ? WHERE id = ?').run(Date.now(), c.id);
  return { ok: true, lists: lists.length, added };
}

export async function refreshAllCurators() {
  const rows = db.prepare('SELECT id FROM curators').all();
  let done = 0;
  let added = 0;
  for (const r of rows) {
    try {
      const res = await refreshCurator(r.id);
      added += res.added;
      done++;
    } catch {
      /* un curador que tropieza no tumba a los demás */
    }
  }
  return { total: rows.length, done, added };
}

export function curatorsList() {
  return db
    .prepare(
      `SELECT c.id, c.source, c.username, c.name, c.added_at, c.refreshed_at,
        (SELECT COUNT(*) FROM radar_items ri WHERE ri.curator_id = c.id) AS items
       FROM curators c ORDER BY c.name COLLATE NOCASE`
    )
    .all();
}

// --- consulta / cruce con tu biblioteca ------------------------------------

// Índices en memoria (Sets/Maps, como manda el diseño) para marcar cada ítem sin
// consultas pesadas por fila: lo que tienes, a quién sigues, qué sellos sigues.
function libraryIndex() {
  // owned: clave matchKey(artista, título). Se indexa por el artista canónico y por
  // el album_artist del tag (pueden diferir), para casar por cualquiera de los dos.
  const owned = new Map();
  for (const a of db
    .prepare(
      `SELECT a.id, a.title, a.album_artist, ar.name AS artist_name
       FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id
       WHERE a.match_state != 'dismissed'`
    )
    .all()) {
    if (a.artist_name) owned.set(matchKey(a.artist_name, a.title), a.id);
    owned.set(matchKey(a.album_artist, a.title), a.id);
  }
  const trackedArtists = new Set(
    db
      .prepare('SELECT ar.name FROM tracked_artists t JOIN artists ar ON ar.id = t.artist_id')
      .all()
      .map((r) => normName(r.name))
  );
  const trackedLabels = new Set(db.prepare('SELECT name FROM tracked_labels').all().map((r) => normName(r.name)));
  return { owned, trackedArtists, trackedLabels };
}

// Ítems del radar dentro de la ventana [since, ...], agrupados por curador en la UI.
// unownedOnly oculta lo que ya tienes.
export function radarFeed({ since = null, unownedOnly = false } = {}) {
  const cutoff = since || `${new Date().getFullYear()}-01-01`;
  const today = new Date().toISOString().slice(0, 10);
  const idx = libraryIndex();
  const rows = db
    .prepare(
      `SELECT ri.*, c.name AS curator, c.username AS curator_username
       FROM radar_items ri JOIN curators c ON c.id = ri.curator_id
       WHERE ri.dismissed = 0 AND ri.release_date IS NOT NULL AND ri.release_date >= @cutoff
       ORDER BY ri.release_date DESC, ri.artist COLLATE NOCASE`
    )
    .all({ cutoff });
  const out = [];
  for (const r of rows) {
    const pa = normName(primaryArtist(r.artist));
    const is_owned = idx.owned.has(matchKey(primaryArtist(r.artist), r.title));
    if (unownedOnly && is_owned) continue;
    out.push({
      id: r.id,
      curator: r.curator,
      curator_username: r.curator_username,
      list_title: r.list_title,
      list_date: r.list_date,
      artist: r.artist,
      title: r.title,
      label: r.label,
      release_date: r.release_date,
      url: r.url,
      image: r.image,
      type: r.type,
      rg_mbid: r.rg_mbid,
      artist_mbid: r.artist_mbid,
      resolved: !!r.resolved_at,
      is_owned,
      is_upcoming: r.release_date > today,
      tracked_artist: idx.trackedArtists.has(pa),
      tracked_label: r.label ? idx.trackedLabels.has(normName(r.label)) : false,
    });
  }
  return out;
}

// Resuelve el MBID de un ítem contra MusicBrainz (artista + título) y lo cachea, para
// poder enviarlo a Lidarr o seguir al artista. Devuelve el match (o null si dudoso).
export async function resolveRadarItem(id) {
  const r = db.prepare('SELECT * FROM radar_items WHERE id = ?').get(id);
  if (!r) throw new Error('Ítem no encontrado');
  if (r.rg_mbid) return { rg_mbid: r.rg_mbid, artist_mbid: r.artist_mbid, cached: true };
  const match = await mb.searchReleaseGroup(primaryArtist(r.artist), r.title);
  if (!match || match.score < 80) {
    return { rg_mbid: null, artist_mbid: null, match: match || null, weak: !!match };
  }
  db.prepare('UPDATE radar_items SET rg_mbid = ?, artist_mbid = ?, resolved_at = ? WHERE id = ?').run(
    match.rg_mbid,
    match.artist_mbid || null,
    Date.now(),
    id
  );
  return { rg_mbid: match.rg_mbid, artist_mbid: match.artist_mbid, artist: match.artist, title: match.title, score: match.score };
}

export function dismissRadarItem(id) {
  db.prepare('UPDATE radar_items SET dismissed = 1 WHERE id = ?').run(id);
  return { ok: true };
}
