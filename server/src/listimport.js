import { addChallenge } from './challenges.js';
import { rosyList } from './rosyoverdrive.js';

// Importar una lista de un agregador (AlbumOfTheYear, etc.) por URL y crear un reto.
// Muchos están tras Cloudflare (challenge JS): una petición normal del servidor recibe
// 403. Por eso se pasa por un LECTOR que ejecuta JS (r.jina.ai). AOTY funciona así;
// RateYourMusic bloquea incluso al lector (403), y se avisa. AOTY carga por scroll pero
// pagina con ?p=N (50 por página): se encadenan páginas para traer la lista completa.

const READER = 'https://r.jina.ai/';
const UA = 'Mozilla/5.0 (compatible; Liderarrr list importer)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'ese sitio';
  }
};

// Lee una URL a través del lector (r.jina.ai). El lector es algo inestable con sitios tras
// Cloudflare: a veces devuelve un 404/429/5xx TEMPORAL (rate-limit del propio lector) aunque
// la página exista. Por eso se REINTENTA en esos códigos; solo un 403/401 persistente se
// trata como bloqueo real de bots (RYM), que no tiene arreglo reintentando.
async function fetchViaReader(url, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(1200 * attempt); // backoff creciente entre intentos
    let res;
    let text;
    try {
      res = await fetch(READER + url, {
        headers: { 'User-Agent': UA, Accept: 'text/plain', 'X-Return-Format': 'markdown', 'X-No-Cache': 'true' },
        signal: AbortSignal.timeout(60000),
      });
      text = await res.text();
    } catch (err) {
      const why = err?.name === 'TimeoutError' ? 'tardó demasiado' : String(err?.message || err);
      lastErr = new Error(`No se pudo leer la URL (${why})`);
      continue; // error de red/timeout: reintenta
    }
    if (!res.ok) {
      lastErr = new Error(`El lector devolvió ${res.status} para esa URL`);
      continue; // el propio lector falló: reintenta
    }
    // el lector responde 200 pero avisa dentro si el destino lo bloqueó
    const blocked = text.match(/Target URL returned error (\d+)/i);
    if (blocked) {
      const code = Number(blocked[1]);
      // 401/403 = bloqueo real de bots (p. ej. RateYourMusic): no tiene sentido reintentar.
      if (code === 401 || code === 403) {
        throw new Error(
          `${hostOf(url)} bloqueó la descarga (${code}), incluso a través del lector. No se puede importar por URL desde ahí (RateYourMusic, por ejemplo, bloquea los bots).`
        );
      }
      // 404/429/5xx suelen ser temporales (rate-limit del lector): reintenta.
      lastErr = new Error(`${hostOf(url)} devolvió ${code} a través del lector (puede ser temporal).`);
      continue;
    }
    return text; // ok
  }
  throw lastErr || new Error(`No se pudo leer ${hostOf(url)}`);
}

const clean = (tx) => String(tx || '').trim();
const isEntry = (tx) => /\s[-–—]\s/.test(tx) && !tx.startsWith('!') && !/\bImage\b/i.test(tx) && !/\bLists?\b/i.test(tx) && tx.length < 200;
const listTitleOf = (md) => (md.match(/^Title:\s*(.+)$/m) || [])[1]?.trim() || null;

// AOTY: cada entrada es un enlace [Artista - Álbum](…/album/…) precedido de su ranking
// "## N.". Devuelve pares {rank, entry} de UNA página.
function extractAotyPage(md) {
  const pairs = [];
  const parts = md.split(/##\s*(\d+)\.\s*/); // [pre, rank, seg, rank, seg, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const rank = Number(parts[i]);
    const seg = parts[i + 1] || '';
    const lre = /\[([^\]]+)\]\((https?:\/\/[^)]*\/album\/[^)]+)\)/g;
    let mm;
    while ((mm = lre.exec(seg))) {
      const tx = clean(mm[1]);
      if (isEntry(tx)) {
        pairs.push({ rank, entry: tx });
        break;
      }
    }
  }
  return pairs;
}

// AOTY pagina de DOS formas según el tipo de lista:
//  · «ratings»/«genre» (…/2000s/1, …/2000s/2): por el número FINAL del path.
//  · listas de usuario (…/list/…): por ?p=N.
const withPage = (url, p) => {
  const u = new URL(url);
  if (/\/ratings\//i.test(u.pathname) || /\/genre\//i.test(u.pathname)) {
    u.pathname = /\/\d+$/.test(u.pathname)
      ? u.pathname.replace(/\/\d+$/, `/${p}`) // …/2000s/1 → …/2000s/N
      : `${u.pathname.replace(/\/$/, '')}/${p}`; // …/2000s → …/2000s/N
    return u.toString();
  }
  u.searchParams.set('p', String(p));
  return u.toString();
};

// AOTY con paginación. Encadena hasta que una página no aporta nada nuevo. Ordena por
// ranking ascendente (el #1 primero), para que el reto vaya de mejor a peor. Un fallo en la
// PRIMERA página aborta (no hay nada); en páginas siguientes se asume fin de lista / hipo
// temporal del lector y se para con lo que se lleva (partial), en vez de tirar todo.
async function importAoty(url, name) {
  const byRank = new Map();
  let listTitle = null;
  let partial = false;
  const MAX_PAGES = 20; // tope de seguridad (hasta ~1000 álbumes)
  for (let p = 1; p <= MAX_PAGES; p++) {
    let md;
    try {
      md = await fetchViaReader(p === 1 ? url : withPage(url, p));
    } catch (err) {
      if (p === 1) throw err; // sin la primera página no hay lista que importar
      partial = true;
      break; // fin de lista o fallo temporal en páginas siguientes: paramos con lo que hay
    }
    if (!listTitle) listTitle = listTitleOf(md);
    const pairs = extractAotyPage(md);
    let added = 0;
    for (const { rank, entry } of pairs) if (!byRank.has(rank)) { byRank.set(rank, entry); added++; }
    if (!pairs.length || added === 0) break; // sin novedades: fin de la lista
  }
  const lines = [...byRank.keys()].sort((a, b) => a - b).map((r) => byRank.get(r));
  return { lines, listTitle, partial };
}

// Genérico: textos de enlaces markdown con forma "Artista - Álbum"; si no, líneas planas.
function importGeneric(md) {
  const lines = [];
  const lre = /\[([^\]]+)\]\([^)]+\)/g;
  let mm;
  while ((mm = lre.exec(md))) {
    const tx = clean(mm[1]);
    if (isEntry(tx)) lines.push(tx);
  }
  if (!lines.length) {
    for (const raw of md.split(/\r?\n/)) {
      const tx = clean(raw.replace(/^\s*\d+[.)]\s*/, ''));
      if (isEntry(tx)) lines.push(tx);
    }
  }
  const seen = new Set();
  const uniq = lines.filter((l) => { const k = l.toLowerCase(); return seen.has(k) ? false : seen.add(k); });
  return { lines: uniq, listTitle: listTitleOf(md), partial: false };
}

// record.club: app Nuxt tras Cloudflare (el blob __NUXT__ está minificado; no se parsea a
// mano). El LECTOR la renderiza bien. Cada disco es un enlace de release con el TÍTULO
// seguido de uno o varios enlaces de artista → "Artista - Álbum" (varios con &). Ignora
// las carátulas (apuntan a cdn.rcrd.club) y el sidebar de "más listas" (enlaces /lists/).
function extractRecordClub(md) {
  const out = [];
  const seen = new Set();
  for (const raw of String(md || '').split(/\r?\n/)) {
    if (!/record\.club\/releases\//.test(raw)) continue;
    const alb = raw.match(/\[([^\]]+)\]\(https:\/\/record\.club\/releases\/[^)]+\)/);
    if (!alb) continue;
    const artists = [...raw.matchAll(/\[([^\]]+)\]\(https:\/\/record\.club\/artists\/[^)]+\)/g)].map((m) => m[1].trim());
    if (!artists.length) continue;
    const line = `${artists.join(' & ')} - ${alb[1].trim()}`;
    const k = line.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(line);
    }
  }
  return out;
}

// Decodifica entidades HTML comunes y quita etiquetas: para leer texto de encabezados HTML.
function decodeEntities(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// hiphopgoldenage.com (WordPress): cada disco es un encabezado «<h2>/<h3> Artista - Álbum»,
// y la lista va rankeada por orden de aparición. Se lee DIRECTO (sin r.jina.ai, que a veces
// da 403), extrayendo esos encabezados en orden. isEntry descarta títulos de sección (sin
// el separador «Artista - Álbum»).
async function fetchHhga(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Liderarrr list importer)', Accept: 'text/html' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const why = err?.name === 'TimeoutError' ? 'tardó demasiado' : String(err?.message || err);
    throw new Error(`No se pudo leer la URL (${why})`);
  }
  if (!res.ok) throw new Error(`hiphopgoldenage devolvió ${res.status} para esa URL`);
  return res.text();
}
function extractHhga(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || '').matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
    const tx = decodeEntities(m[1]);
    if (!isEntry(tx)) continue;
    const k = tx.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(tx);
    }
  }
  return out;
}
function hhgaTitle(html) {
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!t) return null;
  return (
    decodeEntities(t[1])
      .replace(/\s*[-|–—]?\s*Hip[ -]?Hop[ -]?Golden[ -]?Age/gi, '') // quita el nombre del sitio (repetido)
      .replace(/\s*[-|–—]\s*$/, '') // separador colgante
      .trim() || null
  );
}

export async function importListFromUrl(url, name) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Pon una URL válida (http/https)');
  url = url.trim();
  const isAoty = /albumoftheyear\.org/i.test(url);
  const isRosy = /rosyoverdrive\.com/i.test(url);
  const isRecordClub = /record\.club/i.test(url);
  const isHhga = /hiphopgoldenage\.com/i.test(url);
  let lines;
  let listTitle = null;
  let partial = false;
  if (isHhga) {
    const html = await fetchHhga(url);
    lines = extractHhga(html);
    listTitle = hhgaTitle(html);
  } else if (isRosy) {
    // Rosy Overdrive: parseo directo del HTML (encabezados «Artista – Álbum»), fiable y
    // sin depender del lector. El título del post nombra el reto si no se dio nombre.
    ({ lines, listTitle } = await rosyList(url));
  } else if (isRecordClub) {
    const md = await fetchViaReader(url);
    lines = extractRecordClub(md);
    listTitle = (listTitleOf(md) || '').replace(/,\s*a list by .*$/i, '').trim() || null;
  } else {
    ({ lines, listTitle, partial } = isAoty ? await importAoty(url, name) : importGeneric(await fetchViaReader(url)));
  }
  if (!lines.length) {
    throw new Error('No reconocí ninguna lista de álbumes en esa URL. Prueba a abrirla, copiar el texto y usar «pegar la lista».');
  }
  const ch = addChallenge(name?.trim() || listTitle || 'Lista importada', lines.join('\n'));
  return { id: ch.id, count: ch.item_count, partial };
}
