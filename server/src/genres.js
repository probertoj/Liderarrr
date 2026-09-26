import { db } from './db.js';
import * as lastfm from './lastfm.js';
import { matchKey } from './matchkey.js';
import { library } from './queries.js';

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
    // 67 discos en una colección real: es un género de verdad, aunque sea uno al que solo se
    // entra en diciembre.
    slug: 'navidad',
    name: 'Navidad',
    children: ['Villancicos', 'Navidad pop'],
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
    .replace(/[\u0300-\u036f]/g, '') // fuera los acentos: «Electrónica» = «Electronica»
    .toLowerCase()
    // Se quita la PUNTUACIÓN, no las letras. Con [^a-z0-9] los géneros que iTunes escribe en
    // japonés («ロック», «ポップス») se quedaban en cadena vacía y no casaban nunca, por muchos
    // sinónimos que se añadieran: \p{L} respeta cualquier alfabeto.
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

// Etiquetas que no dicen nada: no son un género ni merecen salir en «sin clasificar». Casi
// siempre las mete el ripeador cuando el campo venía vacío.
const VACIAS = new Set([
  'varios', 'various', 'other', 'otros', 'unknown', 'desconocido', 'miscellaneous', 'misc',
  'general', 'music', 'musica', 'none', 'singenero',
  // la misma idea en otros idiomas, tal cual sale de iTunes
  'altrigeneri', 'その他', 'autres', 'sonstige', 'otrosgeneros',
]);

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
// Segunda pasada sobre la cola real, ya con el normalizador arreglado para alfabetos no
// latinos. Sale de mirar la lista de «sin clasificar» de una colección de 33.000 discos.
const ALIASES_COLA = {
  indie: [
    ['オルタナティヴ＆インディー', null], ['alternative en indie', null], ['alternativ und indie', null],
    ['slacker rock', 'Rock alternativo'], ['pop indie', 'Indie pop'], ['indie1', 'Indie rock'],
    ['flacindie', 'Indie rock'], ['british alternative rock', 'Rock alternativo'],
    ['alternative rb', 'Rock alternativo'], ['twee', 'Twee'],
  ],
  rock: [
    ['ロック', null], ['space rock', 'Rock psicodélico'], ['psychedelic pop', 'Rock psicodélico'],
    ['beat', 'Rock and roll'], ['mod', 'Rock and roll'], ['rock clasico', 'Rock clásico'],
  ],
  pop: [
    ['ポップス', null], ['jpop', null], ['j pop', null], ['english pop', null],
    ['variete internacional', 'Pop vocal'], ['chanson francesa', 'Chanson'],
  ],
  electronica: [
    ['elettronica', null], ['electronique', null], ['breakcore', 'Drum and bass'],
    ['digital hardcore', 'Breakbeat'], ['tech house', 'House'], ['garage house', 'House'],
    ['dub techno', 'Techno'], ['electroclash', 'Electropop'], ['club', 'House'],
    ['lounge', 'Downtempo'], ['minimalism', 'Ambient'],
  ],
  jazz: [['jazz contemporaneo', null], ['acid jazz', 'Jazz fusión'], ['contemporary jazz', null]],
  punk: [['garage punk', 'Punk rock'], ['acid punk', 'Punk rock'], ['punk blues', 'Punk rock']],
  country: [['alt country rock', 'Alt-country'], ['country rock', 'Alt-country']],
  blues: [['desert blues', null]],
  bso: [
    ['bandes originales de films', 'Cine'], ['film soundtracks', 'Cine'],
    ['bandas originales de peliculas', 'Cine'],
  ],
  mundo: [['africa', null], ['asia', null]],
  navidad: [
    ['musicas navidenas', null], ['musica navidena', null], ['christmas', null],
    ['navidad', null], ['villancicos', 'Villancicos'], ['holiday', null],
  ],
};
for (const [slug, pares] of Object.entries(ALIASES_COLA)) {
  for (const [raw, sub] of pares) put(raw, slug, sub);
}

for (const [slug, pares] of Object.entries(ALIASES_MEDIDOS)) {
  for (const [raw, sub] of pares) put(raw, slug, sub);
}

for (const [slug, pares] of Object.entries(ALIASES)) {
  for (const [raw, sub] of pares) put(raw, slug, sub);
}

const TOP_BY_SLUG = new Map(TAXONOMY.map((t) => [t.slug, t]));

// Reglas del usuario (tabla genre_tag_map): mandan SOBRE el diccionario. Se leen en cada
// pasada porque cambian desde la UI y el efecto tiene que verse al instante.
function reglasUsuario() {
  const map = new Map();
  for (const r of db.prepare('SELECT tag, slug, sub, ignored FROM genre_tag_map').all()) {
    map.set(norm(r.tag), r);
  }
  return map;
}

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
  const reglas = reglasUsuario();
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
      const n = norm(etiqueta);
      const regla = reglas.get(n);
      // una regla tuya gana siempre: o la manda a un género, o la marca como ruido
      hits = regla ? (regla.ignored || !regla.slug ? [] : [{ top: regla.slug, sub: regla.sub || null }]) : canonicalize(etiqueta);
      cache.set(etiqueta, hits);
      cache.set(`norm:${etiqueta}`, regla?.ignored ? 'varios' : n); // las ignoradas, fuera de «sin clasificar»
    }
    if (!hits.length) {
      // «Varios», «Other», «その他»… no son un género: no clasifican, pero tampoco merecen
      // ensuciar la lista de «sin clasificar», que es para lo que SÍ es un género y no
      // reconocemos todavía.
      if (!VACIAS.has(cache.get(`norm:${etiqueta}`))) sinClasificar.set(etiqueta, (sinClasificar.get(etiqueta) || 0) + 1);
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

  const ocultos = new Set(db.prepare('SELECT slug FROM genre_hidden').all().map((r) => r.slug));
  const tops = TAXONOMY.map((t) => ({
    slug: t.slug,
    name: t.name,
    count: cuenta.get(t.slug) || 0,
    children: t.children
      .map((sub) => ({ sub, count: cuenta.get(`${t.slug}::${sub}`) || 0 }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count),
  }))
    .filter((t) => t.count > 0 && !ocultos.has(t.slug))
    .sort((a, b) => b.count - a.count);

  const otros = [...sinClasificar.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const totalAlbums = db.prepare("SELECT COUNT(*) c FROM albums WHERE match_state != 'dismissed'").get().c;
  return {
    genres: tops,
    hidden: [...ocultos].map((slug) => ({ slug, name: TOP_BY_SLUG.get(slug)?.name || slug })).filter((h) => h.name),
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

// --- géneros de UN disco o de UN artista ---------------------------------------
// Para poder saltar a la sección desde donde estás mirando: «esto es dream pop, ¿qué más
// tengo de dream pop?». No usan buildIndex (que recorre la colección entera): canonizan solo
// las etiquetas que hagan falta.

const tagsDe = db.prepare(
  `SELECT t.name FROM album_tags at JOIN tags t ON t.id = at.tag_id AND t.type = 'genre' WHERE at.album_id = ?`
);

function aGeneros(nombres) {
  const fuera = new Map(); // clave → {slug, sub, name}
  for (const raw of nombres) {
    for (const h of canonicalize(raw)) {
      const top = TOP_BY_SLUG.get(h.top);
      if (!top) continue;
      const clave = `${h.top}::${h.sub || ''}`;
      if (!fuera.has(clave)) fuera.set(clave, { slug: h.top, sub: h.sub, name: h.sub || top.name });
    }
  }
  // el género de primer nivel sobra si ya está su subgénero en la lista (más concreto manda)
  const conSub = new Set([...fuera.values()].filter((g) => g.sub).map((g) => g.slug));
  return [...fuera.values()].filter((g) => g.sub || !conSub.has(g.slug));
}

export function albumGenres(albumId) {
  return aGeneros(tagsDe.all(albumId).map((r) => r.name));
}

// Los géneros de un artista salen de sus discos, con cuántos hay de cada uno: así en su ficha
// se ve de qué va, y no solo lo que dijera la etiqueta de un disco suelto.
export function artistGenres(artistId, limit = 8) {
  const rows = db
    .prepare(
      `SELECT at.album_id, t.name
         FROM albums a
         JOIN album_tags at ON at.album_id = a.id
         JOIN tags t ON t.id = at.tag_id AND t.type = 'genre'
        WHERE a.match_state != 'dismissed'
          AND (a.artist_id = @id OR a.id IN (SELECT album_id FROM album_artists WHERE artist_id = @id))`
    )
    .all({ id: artistId });
  const porAlbum = new Map();
  for (const r of rows) {
    if (!porAlbum.has(r.album_id)) porAlbum.set(r.album_id, []);
    porAlbum.get(r.album_id).push(r.name);
  }
  const cuenta = new Map();
  for (const nombres of porAlbum.values()) {
    for (const g of aGeneros(nombres)) {
      const clave = `${g.slug}::${g.sub || ''}`;
      const e = cuenta.get(clave) || { ...g, count: 0 };
      e.count++;
      cuenta.set(clave, e);
    }
  }
  return [...cuenta.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

// --- detalle de un género -----------------------------------------------------

// Tus discos de un género, con sus artistas y subgéneros. `sort`: recientes | antiguos | titulo.
export function genreDetail(slug, { sub = null, sort = 'recientes', limit = 120, offset = 0, decade = null } = {}) {
  const top = TOP_BY_SLUG.get(slug);
  if (!top) return null;
  const { porAlbum } = buildIndex();
  const clave = sub ? `${slug}::${sub}` : slug;

  const ids = new Set();
  const cuentaSub = new Map();
  for (const [id, set] of porAlbum) {
    if (!set.has(clave)) continue;
    ids.add(id);
    // Los subgéneros se cuentan SOBRE el recorte actual: al entrar en uno ves cómo se reparte
    // lo que estás mirando, no la colección entera.
    for (const k of set) {
      if (!k.startsWith(`${slug}::`)) continue;
      const nombre = k.slice(slug.length + 2);
      cuentaSub.set(nombre, (cuentaSub.get(nombre) || 0) + 1);
    }
  }
  const subgenres = [...cuentaSub.entries()]
    .map(([name, count]) => ({ sub: name, count }))
    .sort((a, b) => b.count - a.count);
  if (!ids.size) return { slug, name: top.name, sub, decade: null, total: 0, albums: [], artists: [], decades: [], subgenres };

  // Los discos los sirve library(), NO una consulta propia: así el género cuenta lo mismo que
  // la Discoteca. Con una consulta cruda, las copias del mismo disco (dos rips, una caja en
  // varias carpetas) salían repetidas una y otra vez en la parrilla — y además inflaban los
  // contadores de artista. library() ya sabe colapsar ediciones, copias y cajas.
  const { albums: colapsados } = library({ ids, limit: 100000 });
  const porTitulo = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base' });
  colapsados.sort(
    sort === 'antiguos'
      ? (a, b) => (a.year || 9999) - (b.year || 9999) || porTitulo(a, b)
      : sort === 'titulo'
        ? porTitulo
        : (a, b) => (b.year || 0) - (a.year || 0) || porTitulo(a, b)
  );

  // Reparto por décadas ANTES de filtrar por década: los botones tienen que seguir ahí
  // cuando ya has elegido una.
  const porDecada = new Map();
  for (const a of colapsados) {
    if (!a.year) continue;
    const d = Math.floor(a.year / 10) * 10;
    porDecada.set(d, (porDecada.get(d) || 0) + 1);
  }
  const decades = [...porDecada.entries()].map(([decada, n]) => ({ decada, n })).sort((a, b) => a.decada - b.decada);

  const filtrados = decade ? colapsados.filter((a) => a.year && Math.floor(a.year / 10) * 10 === Number(decade)) : colapsados;

  // Artistas del recorte, contados sobre los discos YA colapsados (si no, un artista con
  // tres copias del mismo disco parecía tener tres discos).
  const porArtista = new Map();
  for (const a of filtrados) {
    if (!a.artist_id) continue;
    const e = porArtista.get(a.artist_id) || { id: a.artist_id, name: a.album_artist, albums: 0 };
    e.albums++;
    porArtista.set(a.artist_id, e);
  }
  const artists = [...porArtista.values()].sort((x, y) => y.albums - x.albums || String(x.name).localeCompare(String(y.name), 'es')).slice(0, 40);

  return {
    slug,
    name: top.name,
    sub,
    decade: decade ? Number(decade) : null,
    total: filtrados.length,
    albums: filtrados.slice(offset, offset + limit),
    artists,
    decades,
    subgenres,
  };
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

// Nombre de subgénero → tag de Last.fm cuando no está en SUB_TAG. Sus tags son libres y casi
// todo subgénero tiene el suyo («slowcore», «twee», «noise pop»), así que el propio nombre en
// minúsculas y sin acentos acierta mucho más que rendirse al género padre.
function tagDeSubgenero(sub) {
  return String(sub)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export async function genreRecommendations(slug, { sub = null, limit = 40 } = {}) {
  const top = TOP_BY_SLUG.get(slug);
  if (!top) return null;
  const tagPadre = LASTFM_TAG[slug] || top.name;
  const tagSub = sub ? SUB_TAG[sub] || tagDeSubgenero(sub) : null;
  let tag = tagSub || tagPadre;
  if (!lastfm.lastfmConfigured()) return { tag, configured: false, items: [] };

  let populares = await lastfm.tagTopAlbums(tag, Math.max(limit * 2, 60));
  // Si el subgénero no da nada en Last.fm se tira del género padre, pero se DICE: antes caía
  // al padre en silencio y la pantalla prometía «lo mejor de Slowcore» mientras enseñaba lo
  // mejor de «indie».
  let desde = null;
  if (tagSub && populares.length === 0) {
    desde = tagSub;
    tag = tagPadre;
    populares = await lastfm.tagTopAlbums(tag, Math.max(limit * 2, 60));
  }
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
  return { tag, fallbackFrom: desde, configured: true, items, considered: populares.length };
}

// --- géneros a la carta -------------------------------------------------------

// Manda una etiqueta cruda a un género (o la marca como ruido). Es lo que hace accionable la
// lista de «sin clasificar»: la ves, dices qué es, y cuenta desde ese momento.
export function mapGenreTag(tag, { slug = null, sub = null, ignored = false } = {}) {
  const t = String(tag || '').trim();
  if (!t) throw new Error('Falta la etiqueta');
  if (!ignored && !TOP_BY_SLUG.has(slug)) throw new Error('Género desconocido');
  if (!ignored && sub && !TOP_BY_SLUG.get(slug).children.includes(sub)) throw new Error('Subgénero desconocido');
  db.prepare(
    `INSERT INTO genre_tag_map (tag, slug, sub, ignored, created_at) VALUES (@tag, @slug, @sub, @ignored, @now)
     ON CONFLICT(tag) DO UPDATE SET slug = excluded.slug, sub = excluded.sub, ignored = excluded.ignored`
  ).run({ tag: t, slug: ignored ? null : slug, sub: ignored ? null : sub || null, ignored: ignored ? 1 : 0, now: Date.now() });
  return { ok: true };
}

export function unmapGenreTag(tag) {
  return { removed: db.prepare('DELETE FROM genre_tag_map WHERE tag = ?').run(String(tag || '')).changes };
}

export function mappedTags() {
  return db.prepare('SELECT tag, slug, sub, ignored FROM genre_tag_map ORDER BY tag COLLATE NOCASE').all();
}

// Esconder un género de primer nivel de la portada. No borra nada: sus discos siguen ahí y
// vuelve con un clic.
export function hideGenre(slug, hidden = true) {
  if (!TOP_BY_SLUG.has(slug)) throw new Error('Género desconocido');
  if (hidden) db.prepare('INSERT OR IGNORE INTO genre_hidden (slug) VALUES (?)').run(slug);
  else db.prepare('DELETE FROM genre_hidden WHERE slug = ?').run(slug);
  return { ok: true, slug, hidden };
}

// La taxonomía entera, para que la UI pueda ofrecer a qué género mandar una etiqueta.
export function taxonomy() {
  return TAXONOMY.map((t) => ({ slug: t.slug, name: t.name, children: t.children }));
}
