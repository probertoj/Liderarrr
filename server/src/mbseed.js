import { db } from './db.js';
import * as mb from './musicbrainz.js';

// Sembrado del editor de releases de MusicBrainz (release editor seeding).
//
// MusicBrainz NO tiene API de escritura para crear releases: la única vía soportada
// es un POST de formulario a https://musicbrainz.org/release/add con los campos
// rellenos, que el usuario revisa y confirma en SU navegador (MB exige revisión
// humana). Es lo mismo que hacen los userscripts importadores. Docs:
//   https://musicbrainz.org/doc/Development/Seeding/Release_Editor
//
// Aquí construimos ese conjunto de campos a partir del disco tal y como YA vive en la
// colección (tracklist, duraciones, artista(s), año, sello): no hace falta scrapear
// ninguna fuente externa. El POST lo hace el cliente (openMbReleaseEditor en web/src/
// mb.js) para usar la sesión de MB del navegador; `redirect_uri` lo añade el cliente.
//
// Nombres de campo y notación de índice verificados contra la doc de MB: índices
// 0-based y consecutivos (mediums.0.track.0.name), `status` en minúscula, `type` por
// su nombre en inglés (repetible: primario + secundarios), `length` acepta ms enteros.

// Nexos de crédito de artista de un álbum, en orden. Siempre devuelve ≥1 (albumCredits
// hace fallback al artista principal). Forma: { name, credit_name, mbid, join_phrase }.
function seedArtistCredit(prefix, credits, seed) {
  credits.forEach((c, i) => {
    const base = `${prefix}.names.${i}`;
    const credited = c.credit_name || c.name || '';
    seed[`${base}.name`] = credited; // nombre TAL COMO se acredita
    // Si conocemos el MBID, MB enlaza directo; si no, `artist.name` guía su búsqueda.
    if (c.mbid) seed[`${base}.mbid`] = c.mbid;
    else if (c.name) seed[`${base}.artist.name`] = c.name;
    // El nexo (join phrase) solo si lo hay (el último crédito no lleva).
    if (c.join_phrase) seed[`${base}.join_phrase`] = c.join_phrase;
  });
}

// Sellos con nº de catálogo desde album_labels (la fuente con catálogo); si esa tabla
// está vacía, cae a los nombres de sello de las etiquetas (album.labels). MB resuelve
// el sello por nombre cuando no damos MBID.
function seedLabels(album, seed) {
  const rows = db
    .prepare(
      `SELECT l.name AS name, l.mbid AS mbid, al.catalog_no AS catno
       FROM album_labels al JOIN labels l ON l.id = al.label_id WHERE al.album_id = ?`
    )
    .all(album.id);
  const list = rows.length
    ? rows.map((r) => ({ name: r.name, mbid: r.mbid, catno: r.catno }))
    : (album.labels || []).map((name) => ({ name, mbid: null, catno: null }));
  list.forEach((l, i) => {
    if (l.name) seed[`labels.${i}.name`] = l.name;
    if (l.mbid) seed[`labels.${i}.mbid`] = l.mbid;
    if (l.catno) seed[`labels.${i}.catalog_number`] = l.catno;
  });
}

// Pistas agrupadas por disco → mediums 0-based consecutivos, cada uno con sus pistas
// 0-based consecutivas. `format` por defecto "Digital Media" (la colección es digital).
// Se añade artista POR PISTA solo cuando difiere del artista del álbum (recopilatorios
// / Various Artists), que es justo cuando MB lo necesita.
function seedMediums(album, seed) {
  const albumArtist = String(album.album_artist || '').trim().toLowerCase();
  const byDisc = new Map();
  for (const t of album.tracks || []) {
    const d = t.disc || 1;
    if (!byDisc.has(d)) byDisc.set(d, []);
    byDisc.get(d).push(t);
  }
  const discs = [...byDisc.keys()].sort((a, b) => a - b);
  discs.forEach((disc, mi) => {
    const tracks = byDisc.get(disc).sort((a, b) => (a.num || 0) - (b.num || 0));
    seed[`mediums.${mi}.format`] = 'Digital Media';
    tracks.forEach((t, ti) => {
      const base = `mediums.${mi}.track.${ti}`;
      seed[`${base}.number`] = String(t.num || ti + 1);
      seed[`${base}.name`] = t.title || '';
      if (t.duration_ms) seed[`${base}.length`] = String(t.duration_ms); // ms enteros
      const ta = String(t.artist || '').trim();
      if (ta && ta.toLowerCase() !== albumArtist) {
        seed[`${base}.artist_credit.names.0.name`] = ta;
        seed[`${base}.artist_credit.names.0.artist.name`] = ta;
      }
    });
  });
}

// Construye el dict plano de campos del editor de releases a partir del objeto de
// queries.albumDetail(id). Sync y puro (salvo la lectura de album_labels). No incluye
// redirect_uri: lo pone el cliente con su location.origin.
export function buildReleaseSeed(album) {
  const seed = {};
  seed.name = album.title || '';

  // artista(s): créditos completos (splits/colaboraciones) o el principal
  const credits = album.artists && album.artists.length
    ? album.artists
    : [{ name: album.album_artist, credit_name: album.album_artist, mbid: album.artist?.mbid || null, join_phrase: '' }];
  seedArtistCredit('artist_credit', credits, seed);

  // tipo de release group: primario (por defecto Album) + secundarios (repetible)
  const types = [album.primary_type || 'Album', ...(album.secondary_types || [])].filter(Boolean);
  seed.type = types;

  seed.status = 'official';

  // fecha: solo tenemos el año fiable en la colección
  if (album.year) seed['events.0.date.year'] = String(album.year);

  seedLabels(album, seed);
  seedMediums(album, seed);

  seed.edit_note =
    'Seeded from my personal collection using Liderarrr ' +
    '(https://github.com/probertoj/Liderarrr). Tracklist and track lengths ' +
    'taken from the actual audio files.';

  return seed;
}

// Aviso de posible duplicado ANTES de sembrar: reutiliza la búsqueda por texto de MB
// (carril rápido, cacheada). Si hay una coincidencia muy fuerte, casi seguro que el
// disco YA existe en MB y no hay que crearlo. Devuelve null si no hay nada convincente.
export async function findPossibleDuplicate(album) {
  try {
    const rg = await mb.searchReleaseGroup(album.album_artist, album.title, album.artist?.mbid || null);
    if (rg && rg.score >= 90) {
      return { rg_mbid: rg.rg_mbid, title: rg.title, artist: rg.artist, score: rg.score };
    }
  } catch {
    /* si MB falla, seguimos sin aviso: el editor de MB detecta duplicados igualmente */
  }
  return null;
}
