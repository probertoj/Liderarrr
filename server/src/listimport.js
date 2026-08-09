import { addChallenge } from './challenges.js';

// Importar una lista de un agregador (AlbumOfTheYear, etc.) por URL y crear un reto.
// Muchos están tras Cloudflare (challenge JS): una petición normal del servidor recibe
// 403. Por eso se pasa por un LECTOR que ejecuta JS (r.jina.ai). AOTY funciona así;
// RateYourMusic bloquea incluso al lector (403), y se avisa. AOTY carga por scroll pero
// pagina con ?p=N (50 por página): se encadenan páginas para traer la lista completa.

const READER = 'https://r.jina.ai/';
const UA = 'Mozilla/5.0 (compatible; Liderarrr list importer)';

async function fetchViaReader(url) {
  let res;
  try {
    res = await fetch(READER + url, {
      headers: { 'User-Agent': UA, Accept: 'text/plain', 'X-Return-Format': 'markdown', 'X-No-Cache': 'true' },
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    const why = err?.name === 'TimeoutError' ? 'tardó demasiado' : String(err?.message || err);
    throw new Error(`No se pudo leer la URL (${why})`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`El lector devolvió ${res.status} para esa URL`);
  // el lector responde 200 pero avisa dentro si el destino lo bloqueó (RYM: 403)
  const blocked = text.match(/Target URL returned error (\d+)/i);
  if (blocked) {
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'ese sitio'; } })();
    throw new Error(
      `${host} bloqueó la descarga (${blocked[1]}), incluso a través del lector. No se puede importar por URL desde ahí (RateYourMusic, por ejemplo, bloquea los bots).`
    );
  }
  return text;
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

const withPage = (url, p) => {
  const u = new URL(url);
  u.searchParams.set('p', String(p));
  return u.toString();
};

// AOTY con paginación (?p=N). Encadena hasta que una página no aporta nada nuevo.
// Ordena por ranking ascendente (el #1 primero), para que el reto vaya de mejor a peor.
async function importAoty(url, name) {
  const byRank = new Map();
  let listTitle = null;
  const MAX_PAGES = 20; // tope de seguridad (hasta ~1000 álbumes)
  for (let p = 1; p <= MAX_PAGES; p++) {
    const md = await fetchViaReader(p === 1 ? url : withPage(url, p));
    if (!listTitle) listTitle = listTitleOf(md);
    const pairs = extractAotyPage(md);
    let added = 0;
    for (const { rank, entry } of pairs) if (!byRank.has(rank)) { byRank.set(rank, entry); added++; }
    if (!pairs.length || added === 0) break; // sin novedades: fin de la lista
  }
  const lines = [...byRank.keys()].sort((a, b) => a - b).map((r) => byRank.get(r));
  return { lines, listTitle, partial: false };
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

export async function importListFromUrl(url, name) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Pon una URL válida (http/https)');
  url = url.trim();
  const isAoty = /albumoftheyear\.org/i.test(url);
  const { lines, listTitle, partial } = isAoty ? await importAoty(url, name) : importGeneric(await fetchViaReader(url));
  if (!lines.length) {
    throw new Error('No reconocí ninguna lista de álbumes en esa URL. Prueba a abrirla, copiar el texto y usar «pegar la lista».');
  }
  const ch = addChallenge(name?.trim() || listTitle || 'Lista importada', lines.join('\n'));
  return { id: ch.id, count: ch.item_count, partial };
}
