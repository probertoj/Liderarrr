import { db } from './db.js';
import * as lastfm from './lastfm.js';
import { matchKey } from './matchkey.js';

// GÉNEROS (1.1) — explorar la colección por género, al estilo del árbol de Roon.
//
// El problema de partida, medido sobre la colección real: los géneros salen de las ETIQUETAS
// de tus ficheros, y ahí hay **1.081 cadenas distintas** para 33.000 discos. Con duplicados en
// dos idiomas («Electrónica» / «Electronic»), variantes de caja («rock» / «Rock»), compuestos
// («Hip-Hop/Rap», «Punk - New Wave») y una cola infinita de una sola aparición. Listar eso tal
// cual no es explorar nada.
//
// Así que aquí se normaliza: cada etiqueta cruda se parte en piezas, se limpia y se busca en un
// diccionario de SINÓNIMOS que la lleva a un género canónico; cada canónico cuelga de un género
// de primer nivel. Un disco puede caer en varios géneros a la vez (como en Roon: puede ser Jazz,
// Bop y Vocal Jazz al mismo tiempo).
//
// Principio: no inventar. Si una etiqueta no se reconoce, NO se fuerza a ningún sitio — se queda
// como género «sin clasificar» con su nombre tal cual, visible y contado. Preferimos un cajón de
// sastre honesto a colocar un disco en un género que no es.

// --- taxonomía ---------------------------------------------------------------
// Primer nivel → subgéneros. El primer nivel se elige por lo que de verdad hay en una colección
// de música popular: separar «Rock», «Pop» e «Indie» —que Roon funde en «Pop/Rock»— es más útil
// aquí, donde son el 60% del total.
export const TAXONOMY = [
  {
    slug: 'rock',
    name: 'Rock',
    children: [
      'Rock clásico', 'Hard rock', 'Rock psicodélico', 'Rock progresivo', 'Garage', 'Glam',
      'Rock and roll', 'Southern rock', 'Rock instrumental', 'Surf',
    ],
  },
  {
    slug: 'indie',
    name: 'Indie y alternativa',
    children: [
      'Indie rock', 'Indie pop', 'Rock alternativo', 'Shoegaze', 'Dream pop', 'Post-rock',
      'Noise pop', 'Lo-fi', 'Math rock', 'Slowcore', 'Britpop', 'Grunge', 'Post-punk',
      'New wave', 'Emo', 'Twee',
    ],
  },
  {
    slug: 'pop',
    name: 'Pop',
    children: ['Synth pop', 'Power pop', 'Pop barroco', 'Dance pop', 'Pop vocal', 'Chanson', 'Yé-yé'],
  },
  {
    slug: 'electronica',
    name: 'Electrónica',
    children: [
      'Techno', 'House', 'Ambient', 'IDM', 'Drum and bass', 'Dubstep', 'Trip-hop', 'Downtempo',
      'Synthwave', 'Electropop', 'EBM e industrial', 'Breakbeat', 'Trance', 'Krautrock',
    ],
  },
  {
    slug: 'hiphop',
    name: 'Hip-hop y rap',
    children: ['Rap', 'Boom bap', 'Trap', 'Hip-hop alternativo', 'Gangsta rap', 'Rap en español'],
  },
  {
    slug: 'soul',
    name: 'Soul, funk y R&B',
    children: ['Soul', 'Funk', 'R&B', 'Motown', 'Neo soul', 'Disco', 'Gospel'],
  },
  {
    slug: 'jazz',
    name: 'Jazz',
    children: ['Bebop', 'Jazz modal', 'Free jazz', 'Jazz fusión', 'Jazz vocal', 'Cool jazz', 'Big band', 'Latin jazz'],
  },
  {
    slug: 'folk',
    name: 'Folk',
    children: ['Folk rock', 'Cantautor', 'Americana', 'Freak folk', 'Folk tradicional', 'Bluegrass'],
  },
  {
    slug: 'metal',
    name: 'Metal',
    children: [
      'Heavy metal', 'Death metal', 'Black metal', 'Doom', 'Thrash', 'Metal progresivo',
      'Sludge', 'Metalcore', 'Stoner',
    ],
  },
  {
    slug: 'punk',
    name: 'Punk y hardcore',
    children: ['Punk rock', 'Hardcore', 'Post-hardcore', 'Ska punk', 'Oi!', 'Anarcopunk'],
  },
  {
    slug: 'blues',
    name: 'Blues',
    children: ['Blues eléctrico', 'Delta blues', 'Blues rock'],
  },
  {
    slug: 'country',
    name: 'Country y americana',
    children: ['Country clásico', 'Alt-country', 'Outlaw country', 'Honky tonk'],
  },
  {
    slug: 'reggae',
    name: 'Reggae y dub',
    children: ['Dub', 'Ska', 'Rocksteady', 'Dancehall'],
  },
  {
    slug: 'latina',
    name: 'Música latina',
    children: ['Salsa', 'Cumbia', 'Bossa nova', 'Tango', 'Flamenco', 'Rock latino', 'Bolero'],
  },
  {
    slug: 'clasica',
    name: 'Clásica',
    children: ['Ópera', 'Música de cámara', 'Orquestal', 'Barroco', 'Contemporánea', 'Piano solo'],
  },
  {
    slug: 'bso',
    name: 'Bandas sonoras',
    children: ['Cine', 'Televisión', 'Videojuegos', 'Musicales'],
  },
  {
    slug: 'experimental',
    name: 'Experimental',
    children: ['Avant-garde', 'Drone', 'Musique concrète', 'Noise', 'Spoken word'],
  },
  {
    slug: 'mundo',
    name: 'Música del mundo',
    children: ['Afrobeat', 'Highlife', 'Raï', 'Música celta', 'Klezmer', 'Bollywood'],
  },
];

// --- normalización -----------------------------------------------------------

// Separadores que parten una etiqueta compuesta en varias: «Hip-Hop/Rap» son dos géneros,
// «Punk - New Wave» también. OJO: el guion SIN espacios NO separa, o partiría «Hip-Hop»,
// «Post-punk» o «Trip-hop» por la mitad.
const SPLIT_RE = /\s*[/;,|]\s*|\s+&\s+|\s+-\s+|\s+[yo]\s+/i;

// Texto de etiqueta → forma comparable: minúsculas, sin acentos ni signos, sin espacios.
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Etiquetas que no dicen nada: no son un género ni merecen salir en «sin clasificar». Casi
// siempre las mete el ripeador cuando el campo venía vacío.
const VACIAS = new Set(['varios', 'various', 'other', 'otros', 'unknown', 'desconocido', 'miscellaneous', 'misc', 'general', 'music', 'musica', 'none', 'singenero']);

// Diccionario: forma normalizada de la etiqueta → [slug del primer nivel, subgénero canónico].
// El subgénero puede ser null = «encaja en el primer nivel pero sin más detalle».
// Se construye a partir de la propia taxonomía (cada nombre canónico se reconoce a sí mismo) y
// luego se amplía a mano con lo que de verdad aparece en las etiquetas: inglés, español, y las
// grafías raras que trae cada ripeo.
const SYN = new Map();
const put = (raw, slug, sub = null) => {
  const k = norm(raw);
  if (k && !SYN.has(k)) SYN.set(k, [slug, sub]);
};
for (const top of TAXONOMY) {
  put(top.name, top.slug, null);
  put(top.slug, top.slug, null);
  for (const sub of top.children) put(sub, top.slug, sub);
}

// Sinónimos observados en las etiquetas reales (inglés/español y variantes).
const ALIASES = {
  rock: [
    ['rock', null], ['classic rock', 'Rock clásico'], ['hard rock', 'Hard rock'],
    ['psychedelic rock', 'Rock psicodélico'], ['psychedelic', 'Rock psicodélico'], ['psicodelia', 'Rock psicodélico'],
    ['progressive rock', 'Rock progresivo'], ['prog rock', 'Rock progresivo'],
    ['garage rock', 'Garage'], ['glam rock', 'Glam'], ['rock n roll', 'Rock and roll'],
    ['rock and roll', 'Rock and roll'], ["rock 'n' roll", 'Rock and roll'], ['rockabilly', 'Rock and roll'],
    ['surf rock', 'Surf'], ['arena rock', 'Rock clásico'], ['album rock', 'Rock clásico'],
    ['rock espanol', null], ['rock en espanol', null],
  ],
  indie: [
    ['alternativa e indie', null], ['alternativa indie', null], ['alternativo e indie', null],
    ['alternative indie', null], ['alternative', 'Rock alternativo'], ['alternativa', 'Rock alternativo'],
    ['alternativo', 'Rock alternativo'], ['alternative rock', 'Rock alternativo'],
    ['indie', 'Indie rock'], ['indie rock', 'Indie rock'], ['indie pop', 'Indie pop'],
    ['indietronica', 'Indie pop'], ['shoegaze', 'Shoegaze'], ['shoegazing', 'Shoegaze'],
    ['dream pop', 'Dream pop'], ['post rock', 'Post-rock'], ['postrock', 'Post-rock'],
    ['noise pop', 'Noise pop'], ['lofi', 'Lo-fi'], ['math rock', 'Math rock'],
    ['slowcore', 'Slowcore'], ['sadcore', 'Slowcore'], ['britpop', 'Britpop'],
    ['grunge', 'Grunge'], ['post punk', 'Post-punk'], ['postpunk', 'Post-punk'],
    ['new wave', 'New wave'], ['emo', 'Emo'], ['twee pop', 'Twee'], ['c86', 'Twee'],
    ['college rock', 'Rock alternativo'], ['jangle pop', 'Indie pop'],
  ],
  pop: [
    ['pop', null], ['pop rock', null], ['synthpop', 'Synth pop'], ['synth pop', 'Synth pop'],
    ['power pop', 'Power pop'], ['baroque pop', 'Pop barroco'], ['dance pop', 'Dance pop'],
    ['vocal pop', 'Pop vocal'], ['chanson', 'Chanson'], ['chanson francaise', 'Chanson'],
    ['ye ye', 'Yé-yé'], ['yeye', 'Yé-yé'], ['pop espanol', null], ['cancion melodica', 'Pop vocal'],
    ['art pop', 'Pop barroco'], ['sunshine pop', 'Pop barroco'],
  ],
  electronica: [
    ['electronic', null], ['electronica', null], ['electro', null], ['dance', null],
    ['electronic dance music', null], ['edm', null], ['techno', 'Techno'], ['house', 'House'],
    ['deep house', 'House'], ['acid house', 'House'], ['ambient', 'Ambient'], ['ambientes', 'Ambient'],
    ['idm', 'IDM'], ['drum and bass', 'Drum and bass'], ['drum n bass', 'Drum and bass'],
    ['dnb', 'Drum and bass'], ['jungle', 'Drum and bass'], ['dubstep', 'Dubstep'],
    ['trip hop', 'Trip-hop'], ['triphop', 'Trip-hop'], ['downtempo', 'Downtempo'],
    ['chillout', 'Downtempo'], ['synthwave', 'Synthwave'], ['electropop', 'Electropop'],
    ['industrial', 'EBM e industrial'], ['ebm', 'EBM e industrial'], ['breakbeat', 'Breakbeat'],
    ['big beat', 'Breakbeat'], ['trance', 'Trance'], ['krautrock', 'Krautrock'],
    ['minimal', 'Techno'], ['electronic rock', null],
  ],
  hiphop: [
    ['hip hop', null], ['hiphop', null], ['hip hop rap', null], ['rap', 'Rap'],
    ['boom bap', 'Boom bap'], ['trap', 'Trap'], ['abstract hip hop', 'Hip-hop alternativo'],
    ['alternative hip hop', 'Hip-hop alternativo'], ['gangsta rap', 'Gangsta rap'],
    ['hardcore hip hop', 'Boom bap'], ['rap espanol', 'Rap en español'], ['hip hop espanol', 'Rap en español'],
    ['turntablism', 'Hip-hop alternativo'],
  ],
  soul: [
    ['soul', 'Soul'], ['funk', 'Funk'], ['rnb', 'R&B'], ['r b', 'R&B'], ['rhythm and blues', 'R&B'],
    ['contemporary r b', 'R&B'], ['motown', 'Motown'], ['neo soul', 'Neo soul'],
    ['northern soul', 'Soul'], ['southern soul', 'Soul'], ['disco', 'Disco'], ['gospel', 'Gospel'],
    ['soul funk', 'Funk'], ['funk soul', 'Funk'], ['boogie', 'Disco'],
  ],
  jazz: [
    ['jazz', null], ['bebop', 'Bebop'], ['bop', 'Bebop'], ['hard bop', 'Bebop'],
    ['modal jazz', 'Jazz modal'], ['modal music', 'Jazz modal'], ['free jazz', 'Free jazz'],
    ['jazz fusion', 'Jazz fusión'], ['fusion', 'Jazz fusión'], ['vocal jazz', 'Jazz vocal'],
    ['cool jazz', 'Cool jazz'], ['big band', 'Big band'], ['swing', 'Big band'],
    ['latin jazz', 'Latin jazz'], ['smooth jazz', 'Jazz fusión'], ['nu jazz', 'Jazz fusión'],
    ['spiritual jazz', 'Jazz modal'], ['avant garde jazz', 'Free jazz'],
  ],
  folk: [
    ['folk', null], ['folk rock', 'Folk rock'], ['singer songwriter', 'Cantautor'],
    ['cantautor', 'Cantautor'], ['cantautores', 'Cantautor'], ['americana', 'Americana'],
    ['freak folk', 'Freak folk'], ['psych folk', 'Freak folk'], ['traditional folk', 'Folk tradicional'],
    ['folklore', 'Folk tradicional'], ['bluegrass', 'Bluegrass'], ['indie folk', 'Folk rock'],
    ['contemporary folk', 'Cantautor'],
  ],
  metal: [
    ['metal', null], ['heavy metal', 'Heavy metal'], ['death metal', 'Death metal'],
    ['black metal', 'Black metal'], ['doom metal', 'Doom'], ['doom', 'Doom'],
    ['thrash metal', 'Thrash'], ['thrash', 'Thrash'], ['progressive metal', 'Metal progresivo'],
    ['sludge metal', 'Sludge'], ['sludge', 'Sludge'], ['metalcore', 'Metalcore'],
    ['stoner rock', 'Stoner'], ['stoner metal', 'Stoner'], ['nu metal', 'Metalcore'],
    ['power metal', 'Heavy metal'], ['speed metal', 'Thrash'],
  ],
  punk: [
    ['punk', 'Punk rock'], ['punk rock', 'Punk rock'], ['hardcore', 'Hardcore'],
    ['hardcore punk', 'Hardcore'], ['post hardcore', 'Post-hardcore'], ['ska punk', 'Ska punk'],
    ['oi', 'Oi!'], ['street punk', 'Oi!'], ['crust punk', 'Anarcopunk'], ['anarcopunk', 'Anarcopunk'],
    ['pop punk', 'Punk rock'], ['proto punk', 'Punk rock'], ['punk espanol', 'Punk rock'],
  ],
  blues: [
    ['blues', null], ['electric blues', 'Blues eléctrico'], ['chicago blues', 'Blues eléctrico'],
    ['delta blues', 'Delta blues'], ['country blues', 'Delta blues'], ['blues rock', 'Blues rock'],
  ],
  country: [
    ['country', null], ['classic country', 'Country clásico'], ['alt country', 'Alt-country'],
    ['alternative country', 'Alt-country'], ['outlaw country', 'Outlaw country'],
    ['honky tonk', 'Honky tonk'], ['country rock', 'Alt-country'],
  ],
  reggae: [
    ['reggae', null], ['dub', 'Dub'], ['ska', 'Ska'], ['rocksteady', 'Rocksteady'],
    ['dancehall', 'Dancehall'], ['roots reggae', null],
  ],
  latina: [
    ['latin', null], ['latino', null], ['musica latina', null], ['salsa', 'Salsa'],
    ['cumbia', 'Cumbia'], ['bossa nova', 'Bossa nova'], ['mpb', 'Bossa nova'], ['tango', 'Tango'],
    ['flamenco', 'Flamenco'], ['rumba', 'Flamenco'], ['rock latino', 'Rock latino'],
    ['bolero', 'Bolero'], ['ranchera', 'Bolero'], ['samba', 'Bossa nova'],
  ],
  clasica: [
    ['classical', null], ['clasica', null], ['musica clasica', null], ['opera', 'Ópera'],
    ['chamber music', 'Música de cámara'], ['musica de camara', 'Música de cámara'],
    ['orchestral', 'Orquestal'], ['symphony', 'Orquestal'], ['baroque', 'Barroco'],
    ['contemporary classical', 'Contemporánea'], ['modern classical', 'Contemporánea'],
    ['neoclassical', 'Contemporánea'], ['solo piano', 'Piano solo'], ['piano', 'Piano solo'],
  ],
  bso: [
    ['soundtrack', null], ['soundtracks', null], ['banda sonora', null], ['bandas sonoras', null],
    ['bandas sonoras de cine', 'Cine'], ['bso', null], ['ost', null], ['score', 'Cine'],
    ['film score', 'Cine'], ['tv soundtrack', 'Televisión'], ['video game music', 'Videojuegos'],
    ['musical', 'Musicales'], ['musicals', 'Musicales'], ['stage screen', null],
  ],
  experimental: [
    ['experimental', null], ['avant garde', 'Avant-garde'], ['avantgarde', 'Avant-garde'],
    ['drone', 'Drone'], ['musique concrete', 'Musique concrète'], ['noise', 'Noise'],
    ['spoken word', 'Spoken word'], ['sound collage', 'Musique concrète'], ['field recording', 'Musique concrète'],
  ],
  mundo: [
    ['world', null], ['world music', null], ['musica del mundo', null], ['afrobeat', 'Afrobeat'],
    ['afro beat', 'Afrobeat'], ['highlife', 'Highlife'], ['rai', 'Raï'], ['celtic', 'Música celta'],
    ['celtic folk', 'Música celta'], ['klezmer', 'Klezmer'], ['bollywood', 'Bollywood'],
    ['african', null], ['etiopia', null], ['ethio jazz', null],
  ],
};
// Ampliación a partir de la COLA REAL medida sobre la colección: iTunes/Apple Music escriben
// el género en el idioma del sistema, así que la misma música aparece como «Alternatif et Indé»,
// «Musica alternativa e indie» u «オルタナティヴ＆インディー».
const ALIASES_MEDIDOS = {
  indie: [
    ['alternatif et inde', null], ['alternatif indie', null], ['musica alternativa e indie', null],
    ['alternativa e indie', null], ['オルタナティヴ＆インディー', null], ['alt rock', 'Rock alternativo'],
    ['alternrock', 'Rock alternativo'], ['altern rock', 'Rock alternativo'], ['indie espanol', 'Indie rock'],
    ['gothic rock', 'Post-punk'], ['goth rock', 'Post-punk'], ['chamber pop', 'Indie pop'],
    ['neo psychedelia', 'Dream pop'], ['art rock', 'Rock alternativo'],
  ],
  rock: [['experimental rock', null], ['noise rock', null], ['rock experimental', null]],
  pop: [['contemporary pop', null], ['ポップス', null], ['pop contemporaneo', null]],
  electronica: [
    ['electronique', null], ['musica electronica', null], ['electronica o musique concrete', null],
    ['drum bass', 'Drum and bass'], ['new age', 'Ambient'],
  ],
  latina: [['america latina', null], ['latinoamerica', null]],
};
for (const [slug, pares] of Object.entries(ALIASES_MEDIDOS)) {
  for (const [raw, sub] of pares) put(raw, slug, sub);
}

for (const [slug, pares] of Object.entries(ALIASES)) {
  for (const [raw, sub] of pares) put(raw, slug, sub);
}

const TOP_BY_SLUG = new Map(TAXONOMY.map((t) => [t.slug, t]));

// Una etiqueta cruda → lista de {top, sub} canónicos. Devuelve [] si no se reconoce nada:
// quien llama decide qué hacer con lo no clasificado (aquí, mostrarlo aparte, nunca inventar).
export function canonicalize(raw) {
  const out = [];
  const seen = new Set();
  if (VACIAS.has(norm(raw))) return [];
  // La etiqueta ENTERA manda: «Alternativa & Indie» o «Hip-Hop/Rap» son un género en sí mismos
  // en muchos ripeos. Si se reconoce entera NO se parte además en trozos, porque eso metía el
  // disco en subgéneros que la etiqueta no dice (un «Alternativa & Indie» acababa contando
  // como «Rock alternativo» Y «Indie rock» a la vez, inflando ambos).
  const entera = SYN.get(norm(raw));
  if (entera) return [{ top: entera[0], sub: entera[1] }];
  const piezas = String(raw || '').split(SPLIT_RE);
  for (const cand of piezas) {
    if (VACIAS.has(norm(cand))) continue;
    const hit = SYN.get(norm(cand));
    if (!hit) continue;
    const [slug, sub] = hit;
    const key = `${slug}::${sub || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ top: slug, sub });
  }
  return out;
}

// --- consulta ----------------------------------------------------------------

// Índice álbum → géneros canónicos, construido en vivo a partir de las etiquetas. No se guarda
// en una tabla a propósito: el diccionario evoluciona con cada versión y una tabla obligaría a
// reescanear para ver las mejoras. Sobre 33.000 discos tarda milisegundos.
function buildIndex() {
  const rows = db
    .prepare(
      `SELECT at.album_id, t.name
         FROM album_tags at
         JOIN tags t ON t.id = at.tag_id AND t.type = 'genre'
         JOIN albums a ON a.id = at.album_id AND a.match_state != 'dismissed'`
    )
    .all();
  const porAlbum = new Map(); // album_id → Set('slug' | 'slug::sub')
  const sinClasificar = new Map(); // etiqueta cruda → nº de álbumes
  const cache = new Map();
  for (const r of rows) {
    const etiqueta = String(r.name || '').trim();
    if (!etiqueta) continue;
    let hits = cache.get(etiqueta);
    if (!hits) {
      hits = canonicalize(etiqueta);
      cache.set(etiqueta, hits);
    }
    if (!hits.length) {
      sinClasificar.set(etiqueta, (sinClasificar.get(etiqueta) || 0) + 1);
      continue;
    }
    let set = porAlbum.get(r.album_id);
    if (!set) porAlbum.set(r.album_id, (set = new Set()));
    for (const h of hits) {
      set.add(h.top);
      if (h.sub) set.add(`${h.top}::${h.sub}`);
    }
  }
  return { porAlbum, sinClasificar };
}

// Árbol de géneros con el nº de álbumes tuyos en cada uno. Es la portada de la sección.
export function genreTree() {
  const { porAlbum, sinClasificar } = buildIndex();
  const cuenta = new Map();
  for (const set of porAlbum.values()) for (const k of set) cuenta.set(k, (cuenta.get(k) || 0) + 1);

  const tops = TAXONOMY.map((t) => ({
    slug: t.slug,
    name: t.name,
    count: cuenta.get(t.slug) || 0,
    children: t.children
      .map((sub) => ({ sub, count: cuenta.get(`${t.slug}::${sub}`) || 0 }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count),
  }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  const otros = [...sinClasificar.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const totalAlbums = db.prepare("SELECT COUNT(*) c FROM albums WHERE match_state != 'dismissed'").get().c;
  return {
    genres: tops,
    unclassified: otros.slice(0, 60),
    stats: {
      albums: totalAlbums,
      classified: porAlbum.size,
      unclassifiedTags: otros.length,
      unclassifiedAlbums: otros.reduce((n, o) => n + o.count, 0),
    },
  };
}

// Ids de los álbumes de un género (o de un subgénero concreto).
export function albumIdsInGenre(slug, sub = null) {
  const { porAlbum } = buildIndex();
  const clave = sub ? `${slug}::${sub}` : slug;
  const ids = [];
  for (const [id, set] of porAlbum) if (set.has(clave)) ids.push(id);
  return ids;
}

export function genreName(slug, sub = null) {
  const top = TOP_BY_SLUG.get(slug);
  if (!top) return null;
  return sub ? `${top.name} · ${sub}` : top.name;
}

export function isGenre(slug) {
  return TOP_BY_SLUG.has(slug);
}

// --- detalle de un género -----------------------------------------------------

// Lo que hace falta para pintar una tarjeta de disco (mismo trato que la Discoteca).
const ALBUM_COLS = `a.id, a.title, a.album_artist, a.year, a.artist_id, a.match_state,
  a.disc_count AS discs,
  (SELECT COUNT(*) FROM tracks t WHERE t.album_id = a.id) AS track_count,
  (SELECT COUNT(*) FROM tracks t WHERE t.album_id = a.id AND t.path IS NOT NULL) AS track_file_count`;

// Tus discos de un género, con sus artistas y subgéneros. `sort`: recientes | antiguos | titulo.
export function genreDetail(slug, { sub = null, sort = 'recientes', limit = 120, offset = 0 } = {}) {
  const top = TOP_BY_SLUG.get(slug);
  if (!top) return null;
  const { porAlbum } = buildIndex();
  const clave = sub ? `${slug}::${sub}` : slug;

  const ids = [];
  const cuentaSub = new Map();
  for (const [id, set] of porAlbum) {
    if (!set.has(clave)) continue;
    ids.push(id);
    // Los subgéneros se cuentan SOBRE el recorte actual: al entrar en uno ves cómo se reparte
    // lo que estás mirando, no la colección entera.
    for (const k of set) {
      if (!k.startsWith(`${slug}::`)) continue;
      const nombre = k.slice(slug.length + 2);
      cuentaSub.set(nombre, (cuentaSub.get(nombre) || 0) + 1);
    }
  }
  const total = ids.length;
  if (!total) return { slug, name: top.name, sub, total, albums: [], artists: [], decades: [], subgenres: [] };

  const orden =
    sort === 'antiguos'
      ? 'COALESCE(a.year, 9999) ASC, a.title COLLATE NOCASE'
      : sort === 'titulo'
        ? 'a.title COLLATE NOCASE'
        : 'COALESCE(a.year, 0) DESC, a.title COLLATE NOCASE';

  // SQLite tiene tope de variables por consulta, así que los ids van a una tabla temporal en
  // vez de a un IN (?,?,…) de miles de huecos.
  db.exec('CREATE TEMP TABLE IF NOT EXISTS _genre_ids (id INTEGER PRIMARY KEY)');
  db.exec('DELETE FROM _genre_ids');
  const ins = db.prepare('INSERT OR IGNORE INTO _genre_ids (id) VALUES (?)');
  db.transaction((arr) => arr.forEach((i) => ins.run(i)))(ids);

  const albums = db
    .prepare(`SELECT ${ALBUM_COLS} FROM albums a JOIN _genre_ids g ON g.id = a.id ORDER BY ${orden} LIMIT ? OFFSET ?`)
    .all(limit, offset);
  const artists = db
    .prepare(
      `SELECT ar.id, ar.name, COUNT(*) AS albums
         FROM albums a JOIN _genre_ids g ON g.id = a.id
         JOIN artists ar ON ar.id = a.artist_id
        GROUP BY ar.id ORDER BY albums DESC, ar.name COLLATE NOCASE LIMIT 30`
    )
    .all();
  const decadas = db
    .prepare(
      `SELECT (a.year / 10) * 10 AS decada, COUNT(*) AS n
         FROM albums a JOIN _genre_ids g ON g.id = a.id
        WHERE a.year IS NOT NULL GROUP BY decada ORDER BY decada`
    )
    .all();

  const subgenres = [...cuentaSub.entries()]
    .map(([name, count]) => ({ sub: name, count }))
    .sort((a, b) => b.count - a.count);

  return { slug, name: top.name, sub, total, albums, artists, decades: decadas, subgenres };
}

// «Los buenos de este género que aún no tienes». La lista sale de Last.fm (tag.getTopAlbums: lo
// más escuchado del género por millones de personas, mejor juez de lo canónico que cualquier
// heurística propia) y se cruza con tu colección por matchKey para dejar solo lo que te falta.
// Los tags de Last.fm son en inglés y en minúsculas, así que cada género declara el suyo.
const LASTFM_TAG = {
  rock: 'rock',
  indie: 'indie',
  pop: 'pop',
  electronica: 'electronic',
  hiphop: 'hip-hop',
  soul: 'soul',
  jazz: 'jazz',
  folk: 'folk',
  metal: 'metal',
  punk: 'punk',
  blues: 'blues',
  country: 'country',
  reggae: 'reggae',
  latina: 'latin',
  clasica: 'classical',
  bso: 'soundtrack',
  experimental: 'experimental',
  mundo: 'world',
};

// Subgénero canónico → tag de Last.fm. Lo que no esté aquí cae al tag del primer nivel.
const SUB_TAG = {
  'Rock psicodélico': 'psychedelic rock',
  'Rock progresivo': 'progressive rock',
  'Hard rock': 'hard rock',
  'Rock clásico': 'classic rock',
  'Rock and roll': 'rock and roll',
  'Indie rock': 'indie rock',
  'Indie pop': 'indie pop',
  'Rock alternativo': 'alternative rock',
  Shoegaze: 'shoegaze',
  'Dream pop': 'dream pop',
  'Post-rock': 'post-rock',
  'Post-punk': 'post-punk',
  'New wave': 'new wave',
  Britpop: 'britpop',
  Grunge: 'grunge',
  'Synth pop': 'synthpop',
  'Power pop': 'power pop',
  Techno: 'techno',
  House: 'house',
  Ambient: 'ambient',
  IDM: 'idm',
  'Drum and bass': 'drum and bass',
  'Trip-hop': 'trip-hop',
  Krautrock: 'krautrock',
  Rap: 'rap',
  'Boom bap': 'boom bap',
  Soul: 'soul',
  Funk: 'funk',
  'R&B': 'rnb',
  Disco: 'disco',
  Bebop: 'bebop',
  'Free jazz': 'free jazz',
  'Jazz fusión': 'jazz fusion',
  'Folk rock': 'folk rock',
  Cantautor: 'singer-songwriter',
  Americana: 'americana',
  'Heavy metal': 'heavy metal',
  'Death metal': 'death metal',
  'Black metal': 'black metal',
  Doom: 'doom metal',
  'Punk rock': 'punk rock',
  Hardcore: 'hardcore',
  'Blues rock': 'blues rock',
  'Alt-country': 'alt-country',
  Dub: 'dub',
  Ska: 'ska',
  Flamenco: 'flamenco',
  'Bossa nova': 'bossa nova',
  Cine: 'soundtrack',
  Noise: 'noise',
  Drone: 'drone',
  Afrobeat: 'afrobeat',
};

export async function genreRecommendations(slug, { sub = null, limit = 40 } = {}) {
  const top = TOP_BY_SLUG.get(slug);
  if (!top) return null;
  const tag = (sub && SUB_TAG[sub]) || LASTFM_TAG[slug] || top.name;
  if (!lastfm.lastfmConfigured()) return { tag, configured: false, items: [] };

  const populares = await lastfm.tagTopAlbums(tag, Math.max(limit * 2, 60));
  // lo que ya tienes, por matchKey (la misma vara que retos, radar y «Lo quiero»)
  const tuyos = new Set(
    db
      .prepare("SELECT album_artist, title FROM albums WHERE match_state != 'dismissed'")
      .all()
      .map((r) => matchKey(r.album_artist, r.title))
  );
  const items = [];
  const vistos = new Set();
  for (const p of populares) {
    const k = matchKey(p.artist, p.album);
    if (tuyos.has(k) || vistos.has(k)) continue;
    vistos.add(k);
    items.push(p);
    if (items.length >= limit) break;
  }
  return { tag, configured: true, items, considered: populares.length };
}
