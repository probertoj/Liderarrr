import { AsyncLocalStorage } from 'node:async_hooks';
import { cacheRead, cacheWrite } from './db.js';
import { CACHE_MAX_AGE } from './cache-versions.js';

// MusicBrainz exige: (1) máximo 1 petición por segundo y (2) un User-Agent que
// te identifique. Incumplir cualquiera de las dos te gana un bloqueo. Aquí se
// serializan TODAS las llamadas por una cola con hueco de 1100 ms, y todo
// lo que vuelve se cachea en SQLite (ext_cache, prefijo mb:) para no repetir.
//
// La cola tiene DOS carriles sobre ese mismo límite de 1,1 s: uno rápido para
// las peticiones interactivas (tus clics) y uno lento para el barrido de
// identificación en segundo plano. Sin esto, un clic quedaba encolado detrás de
// miles de llamadas del barrido y tardaba ~10 s. Con esto, lo interactivo
// adelanta al fondo; MB nunca se salta (el hueco global se respeta siempre).
const UA = 'Liderarrr/0.1.0 ( https://github.com/probertoj/Liderarrr )';
const BASE = 'https://musicbrainz.org/ws/2';
const GAP_MS = 1100;

// Contexto de prioridad: lo que corra dentro de runBackground() usa el carril
// lento. Se propaga a través de los await, así que basta envolver el bucle de
// identificación una vez (no hay que tocar cada sitio de llamada).
const priorityCtx = new AsyncLocalStorage();
export function runBackground(fn) {
  return priorityCtx.run({ background: true }, fn);
}

const fastQ = [];
const slowQ = [];
let lastAt = 0;
let pumping = false;

function schedule(fn) {
  const background = priorityCtx.getStore()?.background === true;
  return new Promise((resolve, reject) => {
    (background ? slowQ : fastQ).push({ fn, resolve, reject });
    pump();
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (fastQ.length || slowQ.length) {
      const wait = Math.max(0, lastAt + GAP_MS - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      // Reevaluar DESPUÉS de esperar: si llegó una interactiva mientras dormíamos
      // el hueco, sale ella primero. Así el fondo cede el paso hasta a mitad de gap.
      const item = fastQ.shift() || slowQ.shift();
      lastAt = Date.now();
      try {
        item.resolve(await item.fn());
      } catch (err) {
        item.reject(err);
      }
    }
  } finally {
    pumping = false;
  }
}

// MusicBrainz devuelve 503 cuando SU servicio está saturado (no por incumplir el
// 1 req/s: eso ya lo respeta la cola). Es transitorio; una operación con decenas de
// páginas no debe abortar por un 503 fugaz. Reintentamos con backoff, respetando la
// cabecera Retry-After si viene. El sleep ocurre dentro de la cola (pump serializa),
// así que el hueco global de 1,1 s se sigue respetando durante los reintentos.
const MB_RETRIES = 3;
async function mbFetch(pathAndQuery) {
  const url = `${BASE}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}fmt=json`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 503 && attempt < MB_RETRIES) {
      const ra = Number(res.headers.get('retry-after'));
      const backoff = ra > 0 ? Math.min(ra * 1000, 10000) : GAP_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    if (res.status === 503) throw new Error('MusicBrainz saturado (503), reintenta luego');
    if (!res.ok) throw new Error(`MusicBrainz ${res.status} en ${pathAndQuery}`);
    return res.json();
  }
}

// Petición cacheada. `key` es la clave de caché (sin prefijo); se le antepone
// mb: para el versionado. maxAge por defecto el del servicio.
async function mbCached(key, pathAndQuery, maxAge = CACHE_MAX_AGE.mb) {
  const cacheKey = `mb:${key}`;
  const hit = cacheRead(cacheKey, maxAge);
  if (hit) return hit;
  const data = await schedule(() => mbFetch(pathAndQuery));
  cacheWrite(cacheKey, data);
  return data;
}

const enc = encodeURIComponent;
// Escapa lo que rompe la sintaxis Lucene del buscador de MusicBrainz.
function lucene(s) {
  return String(s || '').replace(/[+\-!(){}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Palabras de edición que, entre paréntesis al final del título, son decoración y
// estorban la búsqueda (no forman parte del nombre real del álbum en MusicBrainz).
const EDITION_RE = /\b(remaster(ed)?|deluxe|expanded|anniversary|edition|reissue|mono|stereo|bonus|disc\s*\d+|cd\s*\d+)\b/i;

// Limpia el título para buscarlo en MusicBrainz. Dos ruidos de etiquetado rompen
// la búsqueda: (1) el nombre del artista repetido al principio ("Neil Young Archives
// Vol. II" en vez de "Archives Vol. II"), y (2) paréntesis/corchetes finales con
// año o edición ("(1972 - 1976)", "(Remastered)"). Ambos se quitan; se conservan
// subtítulos con significado como "(Live)". Si limpiar lo deja vacío, usa el original.
// Quita el nombre del artista repetido al principio del título ("Neil Young Archives
// Vol. II" -> "Archives Vol. II"), tolerando un separador (- – — :). Si quitarlo lo
// deja casi vacío, devuelve el original.
function stripLeadingArtist(t, artist) {
  const a = String(artist || '').trim();
  if (!a) return t;
  const re = new RegExp('^' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—:]?\\s*', 'i');
  const s = t.replace(re, '').trim();
  return s.length >= 2 ? s : t;
}

export function cleanAlbumTitle(title, artist) {
  let t = String(title || '').trim();
  if (!t) return t;
  t = stripLeadingArtist(t, artist);
  // quita paréntesis/corchetes finales que sean año o edición (repetido: puede haber
  // varios, p. ej. "Album (Deluxe) (2009)")
  for (;;) {
    const m = t.match(/[([]([^)\]]*)[)\]]\s*$/);
    if (!m || (!/\d{4}/.test(m[1]) && !EDITION_RE.test(m[1]))) break;
    t = t.slice(0, m.index).trim();
  }
  return t || String(title || '').trim();
}

// Busca un release group por artista + título. Devuelve el mejor candidato con
// su score (0-100), tipos y artista, o null.
export async function searchReleaseGroup(artist, title, artistMbid = null) {
  if (!title) return null;
  const clean = cleanAlbumTitle(title, artist);
  // Si conocemos el MBID del artista, acotamos por `arid:` (preciso e inmune a nombres con
  // caracteres raros como «Florence + The Machine», que rompen el filtro por nombre).
  const scope = artistMbid ? `arid:${artistMbid}` : artist ? `artist:"${lucene(artist)}"` : null;
  const q = scope ? `releasegroup:"${lucene(clean)}" AND ${scope}` : `releasegroup:"${lucene(clean)}"`;
  const data = await mbCached(`rg-search:${artistMbid || artist || ''}:${clean}`.toLowerCase(), `/release-group?query=${enc(q)}&limit=5`);
  const list = data['release-groups'] || [];
  if (!list.length) return null;
  const nrm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const target = nrm(clean);
  const isStudio = (r) => r['primary-type'] === 'Album' && !((r['secondary-types'] || []).length);
  // Entre coincidencias EXACTAS de título, prioriza el álbum de estudio sobre el single/EP
  // homónimo: MB puede devolver primero el single "Heaven or Las Vegas" en vez del álbum,
  // y coger el [0] a ciegas lo archivaba como Single (oculto en la sección plegada). Si no
  // hay exactas, se respeta el mejor por score de MB.
  const rg = list.filter((r) => nrm(r.title) === target).find(isStudio) || list[0];
  if (!rg) return null;
  return {
    rg_mbid: rg.id,
    title: rg.title,
    primary_type: rg['primary-type'] || null,
    secondary_types: rg['secondary-types'] || [],
    first_release: rg['first-release-date'] || null,
    artist: (rg['artist-credit'] || []).map((a) => a.name).join(''),
    artist_mbid: (rg['artist-credit'] || [])[0]?.artist?.id || null,
    credits: mapCredits(rg),
    score: Number(rg.score) || 0,
  };
}

// Artist-credit completo (para álbumes acreditados a varios: splits, colaboraciones).
// Cada entrada: nombre canónico + MBID + el nombre tal como aparece + el nexo posterior.
function mapCredits(rg) {
  return (rg['artist-credit'] || []).map((c) => ({
    name: c.artist?.name || c.name || '',
    mbid: c.artist?.id || null,
    credit_name: c.name || c.artist?.name || '',
    joinphrase: c.joinphrase || '',
  }));
}

// Búsqueda LIBRE de release groups para la resolución manual ("Elegir a mano"):
// devuelve una LISTA de candidatos (no solo el mejor). El usuario elige, así que
// no se filtra por score. Si se pasa `artist`, acota a su catálogo (más preciso).
export async function searchReleaseGroups(query, artist, limit = 8, artistMbid = null) {
  let text = String(query || '').trim();
  if (!text) return [];
  // quita el artista repetido al principio (evita que "Neil Young ..." infle álbumes
  // ajenos); NO quita los años, que aquí ayudan a distinguir Vol. I/II/III.
  text = stripLeadingArtist(text, artist);
  // Con MBID del artista, acota por `arid:` (preciso; el filtro por nombre falla con
  // caracteres raros como «Florence + The Machine»).
  const scope = artistMbid ? `arid:${artistMbid}` : artist ? `artist:"${lucene(artist)}"` : null;
  const q = scope ? `releasegroup:(${lucene(text)}) AND ${scope}` : lucene(text);
  const data = await mbCached(`rg-list:${artistMbid || artist || ''}:${text}`.toLowerCase(), `/release-group?query=${enc(q)}&limit=${limit}`);
  return (data['release-groups'] || []).map((rg) => ({
    rg_mbid: rg.id,
    title: rg.title,
    primary_type: rg['primary-type'] || null,
    secondary_types: rg['secondary-types'] || [],
    artist: (rg['artist-credit'] || []).map((a) => a.name).join(''),
    year: rg['first-release-date'] ? Number(String(rg['first-release-date']).slice(0, 4)) || null : null,
    score: Number(rg.score) || 0,
  }));
}

// Ficha de artista por MBID (país, tipo, fechas).
export async function artistByMbid(mbid) {
  if (!mbid) return null;
  const data = await mbCached(`artist:${mbid}`, `/artist/${enc(mbid)}`);
  return {
    mbid: data.id,
    name: data.name,
    sort_name: data['sort-name'],
    type: data.type || null,
    country: data.country || null,
    began: data['life-span']?.begin || null,
    ended: data['life-span']?.end || null,
    disambiguation: data.disambiguation || '',
  };
}

// Discografía completa (release groups) de un artista. Pagina de 100 en 100.
export async function artistReleaseGroups(mbid) {
  if (!mbid) return [];
  const out = [];
  let offset = 0;
  for (;;) {
    const data = await mbCached(
      `artist-rgs:${mbid}:${offset}`,
      `/release-group?artist=${enc(mbid)}&limit=100&offset=${offset}`
    );
    const page = data['release-groups'] || [];
    for (const rg of page) {
      out.push({
        rg_mbid: rg.id,
        title: rg.title,
        primary_type: rg['primary-type'] || null,
        secondary_types: rg['secondary-types'] || [],
        first_release: rg['first-release-date'] || null,
      });
    }
    offset += page.length;
    if (page.length < 100 || offset >= (data['release-group-count'] || 0)) break;
  }
  return out;
}

// Recording -> release groups en los que aparece (para resolver un AcoustID).
export async function recordingReleaseGroups(recordingMbid) {
  if (!recordingMbid) return [];
  const data = await mbCached(
    `rec-rgs:${recordingMbid}`,
    `/recording/${enc(recordingMbid)}?inc=release-groups+artist-credits`
  );
  const artist = (data['artist-credit'] || []).map((a) => a.name).join('');
  const rgs = [];
  for (const rel of data.releases || []) {
    const rg = rel['release-group'];
    if (rg && !rgs.some((x) => x.rg_mbid === rg.id)) {
      rgs.push({
        rg_mbid: rg.id,
        title: rg.title,
        primary_type: rg['primary-type'] || null,
        secondary_types: rg['secondary-types'] || [],
        first_release: rg['first-release-date'] || null,
      });
    }
  }
  return { artist, artist_mbid: (data['artist-credit'] || [])[0]?.artist?.id || null, releaseGroups: rgs };
}

// Grafo de relaciones de un artista: miembros de banda, bandas de las que forma
// parte, proyectos paralelos y colaboraciones. Esto es lo que la música gana al
// cine: MusicBrainz sabe quién toca con quién, no solo quién publicó qué.
export async function artistRelations(mbid) {
  if (!mbid) return [];
  const data = await mbCached(`artist-rels:${mbid}`, `/artist/${enc(mbid)}?inc=artist-rels`);
  const out = [];
  for (const rel of data.relations || []) {
    if (rel['target-type'] !== 'artist' || !rel.artist) continue;
    out.push({
      mbid: rel.artist.id,
      name: rel.artist.name,
      type: rel.type, // member of band | collaboration | founder | supporting musician...
      direction: rel.direction, // forward | backward
      attributes: rel.attributes || [], // p. ej. instrumentos
      begin: rel.begin || null,
      end: rel.end || null,
      ended: !!rel.ended,
    });
  }
  return out;
}

// Busca un SELLO por nombre. Devuelve el mejor candidato (los sellos de Liderarr son
// texto de la etiqueta, no MBID: hay que resolverlos). null si no hay nada decente.
export async function searchLabel(name) {
  if (!name) return null;
  const data = await mbCached(`label-search:${name}`.toLowerCase(), `/label?query=${enc(lucene(name))}&limit=3`);
  const l = (data.labels || [])[0];
  if (!l) return null;
  return {
    mbid: l.id,
    name: l.name,
    disambiguation: l.disambiguation || '',
    country: l.country || null,
    score: Number(l.score) || 0,
  };
}

// Lista de sellos candidatos por nombre (para elegir a cuál seguir, 0.6 fase 2).
export async function searchLabels(name, limit = 6) {
  if (!name) return [];
  const data = await mbCached(`labels-search:${name}:${limit}`.toLowerCase(), `/label?query=${enc(lucene(name))}&limit=${limit}`);
  return (data.labels || []).map((l) => ({
    mbid: l.id,
    name: l.name,
    disambiguation: l.disambiguation || '',
    type: l.type || null,
    country: l.country || null,
    score: Number(l.score) || 0,
  }));
}

// Sello(s) que editan una RELEASE concreta (MB pone los sellos en las releases, no en
// los release-groups). Devuelve nombres únicos, sin el placeholder "[no label]".
export async function releaseLabels(releaseMbid) {
  if (!releaseMbid) return [];
  const data = await mbCached(`release-labels:${releaseMbid}`, `/release/${enc(releaseMbid)}?inc=labels`);
  return [...new Set((data['label-info'] || []).map((li) => li.label?.name).filter(Boolean))].filter(
    (n) => !/^\[no label\]$/i.test(n)
  );
}

// Sello(s) del primer release de un release-group (cuando no tenemos el MBID de release
// exacto). Aproximación razonable para mostrar el sello en la ficha de un álbum.
export async function releaseGroupLabels(rgMbid) {
  if (!rgMbid) return [];
  const data = await mbCached(`rg-labels:${rgMbid}`, `/release?release-group=${enc(rgMbid)}&inc=labels&limit=1`);
  const rel = (data.releases || [])[0];
  return [...new Set((rel?.['label-info'] || []).map((li) => li.label?.name).filter(Boolean))].filter(
    (n) => !/^\[no label\]$/i.test(n)
  );
}

// Un release-group por su MBID (para fijar un emparejamiento manual con el tipo y el
// año REALES de la referencia elegida, no los de una búsqueda por título).
export async function releaseGroupById(mbid) {
  if (!mbid) return null;
  const rg = await mbCached(`rg:${mbid}`, `/release-group/${enc(mbid)}?inc=artist-credits`);
  if (!rg || !rg.id) return null;
  return {
    rg_mbid: rg.id,
    title: rg.title,
    primary_type: rg['primary-type'] || null,
    secondary_types: rg['secondary-types'] || [],
    first_release: rg['first-release-date'] || null,
    artist: (rg['artist-credit'] || []).map((a) => a.name).join(''),
    artist_mbid: (rg['artist-credit'] || [])[0]?.artist?.id || null,
    credits: mapCredits(rg),
  };
}

// Créditos/personal de un álbum (estilo Roon): relaciones de artista a nivel de RELEASE
// (productor, ingeniero, mezcla…) + a nivel de GRABACIÓN (intérpretes con su instrumento
// por pista) + obras (compositor/letrista). Los créditos cuelgan de una RELEASE concreta,
// no del release-group; se toma una release representativa del RG. Devuelve el personal
// agrupado por persona con sus roles y en qué pistas aparece. Cacheado en MB.
export async function releaseGroupCredits(rgMbid, releaseMbid) {
  let relId = releaseMbid || null;
  if (!relId) {
    const list = await mbCached(`rg-rel-any:${rgMbid}`, `/release?release-group=${enc(rgMbid)}&limit=1`);
    relId = (list.releases || [])[0]?.id || null;
  }
  if (!relId) return { found: false };
  const rel = await mbCached(
    `rel-credits:${relId}`,
    `/release/${enc(relId)}?inc=artist-rels+recordings+recording-level-rels+work-rels+work-level-rels`
  );
  if (!rel || !rel.id) return { found: false };

  // acumulador por persona (MBID); guarda nombre, roles (Set) y pistas donde aparece
  const people = new Map();
  const add = (artist, role, trackKey) => {
    if (!artist?.id) return;
    let p = people.get(artist.id);
    if (!p) {
      p = { mbid: artist.id, name: artist.name || '', roles: new Set(), tracks: new Set(), releaseWide: false };
      people.set(artist.id, p);
    }
    if (role) p.roles.add(role);
    if (trackKey == null) p.releaseWide = true;
    else p.tracks.add(trackKey);
  };
  // etiqueta legible de una relación: los instrumentos/atributos si los hay, si no el tipo
  const label = (r) => {
    const attrs = (r.attributes || []).filter(Boolean);
    if (attrs.length) return attrs.map(cap).join(', ');
    return cap(r.type || '');
  };

  // 1) créditos a nivel de release (aplican a todo el álbum)
  for (const r of rel.relations || []) if (r.artist) add(r.artist, label(r), null);

  // 2) créditos a nivel de grabación (por pista) + obras (compositor/letrista)
  let trackNo = 0;
  for (const medium of rel.media || []) {
    for (const t of medium.tracks || []) {
      trackNo++;
      const key = `${trackNo}: ${t.title || t.recording?.title || ''}`;
      const rec = t.recording;
      for (const r of rec?.relations || []) {
        if (r.artist) add(r.artist, label(r), key);
        // obras enlazadas a la grabación → compositor/letrista
        for (const wr of r.work?.relations || []) if (wr.artist) add(wr.artist, cap(wr.type || ''), key);
      }
    }
  }

  const total = trackNo || 1;
  const list = [...people.values()].map((p) => ({
    mbid: p.mbid,
    name: p.name,
    roles: [...p.roles],
    track_count: p.releaseWide ? total : p.tracks.size,
    all_tracks: p.releaseWide || p.tracks.size >= total,
    tracks: [...p.tracks],
  }));
  // ordena: quien aparece en más pistas primero
  list.sort((a, b) => b.track_count - a.track_count || a.name.localeCompare(b.name));
  return { found: true, release_mbid: relId, total_tracks: total, people: list };
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Todas las RELEASES (ediciones oficiales) de un release-group: fecha, país, formato,
// sello, nº de pistas y estado. La lista canónica de «versiones» de un disco en MB.
export async function releaseGroupReleases(rgMbid) {
  if (!rgMbid) return [];
  const data = await mbCached(`rg-releases:${rgMbid}`, `/release?release-group=${enc(rgMbid)}&inc=media+labels&limit=100`);
  return (data.releases || [])
    .map((r) => ({
      mbid: r.id,
      title: r.title,
      date: r.date || null,
      year: r.date ? Number(String(r.date).slice(0, 4)) || null : null,
      country: r.country || r['release-events']?.[0]?.area?.['iso-3166-1-codes']?.[0] || null,
      status: r.status || null,
      disambiguation: r.disambiguation || '',
      formats: [...new Set((r.media || []).map((m) => m.format).filter(Boolean))],
      tracks: (r.media || []).reduce((n, m) => n + (m['track-count'] || 0), 0),
      label: (r['label-info'] || []).map((li) => li.label?.name).filter(Boolean)[0] || null,
      catno: (r['label-info'] || [])[0]?.['catalog-number'] || null,
    }))
    .sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
}

// Catálogo de ÁLBUMES DE ESTUDIO de un sello (primary Album, sin secundarios). Los
// sellos cuelgan de RELEASES en MusicBrainz, no de release-groups: se recorren las
// releases del sello y se deduplican a RG. Tope `maxReleases` para no traer miles de
// un major (ahí el completismo no aplica): si se supera, devuelve {tooBig, total}.
//
// OJO: el tope mide RELEASES BRUTAS (todas las ediciones/formatos/reediciones/
// singles/EPs/comps), no álbumes de estudio. Un indie consagrado tiene cientos de
// álbumes escondidos tras miles de releases (Sub Pop ~3200, Merge ~1800), justo el
// caso de uso. Por eso el tope es alto: solo debe excluir majors de verdad (decenas
// de miles). Coste: hasta maxReleases/100 páginas a 1,1 s c/u (~55 s el peor caso,
// cacheado después). Sube el tope si un indie legítimo aún salta como "demasiado grande".
export async function labelReleaseGroups(labelMbid, { maxReleases = 5000 } = {}) {
  if (!labelMbid) return { tooBig: false, total: 0, releaseGroups: [] };
  const rgs = new Map();
  let offset = 0;
  let total = 0;
  for (;;) {
    const data = await mbCached(
      `label-rels:${labelMbid}:${offset}`,
      `/release?label=${enc(labelMbid)}&inc=release-groups+artist-credits&limit=100&offset=${offset}`
    );
    total = data['release-count'] || 0;
    if (total > maxReleases) return { tooBig: true, total, releaseGroups: [] };
    const page = data.releases || [];
    for (const rel of page) {
      const rg = rel['release-group'];
      if (!rg || rgs.has(rg.id)) continue;
      if ((rg['primary-type'] || null) !== 'Album') continue;
      if ((rg['secondary-types'] || []).length) continue;
      const credit = rel['artist-credit'] || [];
      rgs.set(rg.id, {
        rg_mbid: rg.id,
        title: rg.title,
        artist: credit.map((a) => a.name).join(''),
        artist_mbid: credit[0]?.artist?.id || null,
        first_release: rg['first-release-date'] || null,
        year: rg['first-release-date'] ? Number(String(rg['first-release-date']).slice(0, 4)) || null : null,
      });
    }
    offset += page.length;
    if (!page.length || offset >= total) break;
  }
  return { tooBig: false, total, releaseGroups: [...rgs.values()] };
}

// Busca artistas por nombre (para seguir a alguien que aún no tienes en disco:
// artistas emergentes, justo para los que existe el auto-Lidarr).
export async function searchArtists(name, limit = 8) {
  if (!name) return [];
  const data = await mbCached(`artist-search:${name}`.toLowerCase(), `/artist?query=${enc(lucene(name))}&limit=${limit}`);
  return (data.artists || []).map((a) => ({
    mbid: a.id,
    name: a.name,
    sort_name: a['sort-name'],
    type: a.type || null,
    country: a.country || null,
    disambiguation: a.disambiguation || '',
    began: a['life-span']?.begin || null,
    ended: a['life-span']?.end || null,
    score: Number(a.score) || 0,
  }));
}

export async function mbTest() {
  const data = await schedule(() => mbFetch('/artist/83d91898-7763-47d7-b03b-b92132375c47')); // Pink Floyd
  return { ok: true, name: data.name };
}
