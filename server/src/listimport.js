import { addChallenge } from './challenges.js';

// Importar una lista de un agregador (AlbumOfTheYear, etc.) por URL y crear un reto.
// Muchos de estos sitios están tras Cloudflare (challenge de JS): una petición normal
// del servidor recibe 403. Por eso se pasa por un LECTOR que ejecuta JS (r.jina.ai),
// que devuelve la página en markdown. De ahí se extraen las entradas «Artista - Álbum».
//
// Limitación conocida: listas largas con carga por scroll (p. ej. AOTY de 100) pueden
// venir a la mitad; se detecta y se marca `partial` (la vía de PEGAR es la completa).

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
  if (!res.ok) throw new Error(`El lector devolvió ${res.status} para esa URL`);
  return res.text();
}

const clean = (tx) => String(tx || '').trim();
// una entrada válida es "Artista - Álbum": tiene separador, no es imagen ni ruido de AOTY.
const isEntry = (tx) => /\s[-–—]\s/.test(tx) && !tx.startsWith('!') && !/\bImage\b/i.test(tx) && !/\bLists?\b/i.test(tx) && tx.length < 200;

// Extrae líneas "Artista - Álbum" del markdown. En AOTY ancla en el ranking "## N." para
// coger solo la lista (no recomendaciones ni comentarios). Devuelve también si es parcial.
function extractLines(md, url) {
  const isAoty = /albumoftheyear\.org/i.test(url);
  const lines = [];
  const ranks = [];

  if (isAoty) {
    const parts = md.split(/##\s*(\d+)\.\s*/); // [pre, rank, seg, rank, seg, ...]
    for (let i = 1; i < parts.length; i += 2) {
      ranks.push(Number(parts[i]));
      const seg = parts[i + 1] || '';
      const lre = /\[([^\]]+)\]\((https?:\/\/[^)]*\/album\/[^)]+)\)/g;
      let mm;
      while ((mm = lre.exec(seg))) {
        const tx = clean(mm[1]);
        if (isEntry(tx)) {
          lines.push(tx);
          break;
        }
      }
    }
  }

  if (!lines.length) {
    // genérico: textos de enlaces markdown con forma "Artista - Álbum"
    const lre = /\[([^\]]+)\]\([^)]+\)/g;
    let mm;
    while ((mm = lre.exec(md))) {
      const tx = clean(mm[1]);
      if (isEntry(tx)) lines.push(tx);
    }
  }
  if (!lines.length) {
    // último recurso: líneas de texto plano con separador
    for (const raw of md.split(/\r?\n/)) {
      const tx = clean(raw.replace(/^\s*\d+[.)]\s*/, ''));
      if (isEntry(tx)) lines.push(tx);
    }
  }

  // dedup preservando orden
  const seen = new Set();
  const uniq = [];
  for (const l of lines) {
    const k = l.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(l);
    }
  }
  // AOTY se muestra de N a 1; si el ranking más bajo capturado es > 1, falta la cola (scroll)
  const partial = ranks.length > 0 && Math.min(...ranks) > 1;
  const listTitle = (md.match(/^Title:\s*(.+)$/m) || [])[1]?.trim() || null;
  return { lines: uniq, partial, listTitle };
}

export async function importListFromUrl(url, name) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Pon una URL válida (http/https)');
  const md = await fetchViaReader(url.trim());
  const { lines, partial, listTitle } = extractLines(md, url);
  if (!lines.length) {
    throw new Error('No reconocí ninguna lista de álbumes en esa URL. Prueba a abrirla, copiar el texto y usar «pegar la lista».');
  }
  const ch = addChallenge(name?.trim() || listTitle || 'Lista importada', lines.join('\n'));
  return { id: ch.id, count: ch.item_count, partial };
}
