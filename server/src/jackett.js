import { getSetting } from './db.js';

// Jackett es la ALTERNATIVA a Prowlarr para la busqueda manual (Prowlarr resulta mas
// inestable). Diferencia clave: Jackett expone Torznab y SOLO BUSCA; no empuja al
// cliente de descarga. El "descargar" lo resuelve qbittorrent.js empujando el
// magnet/.torrent a qBittorrent. Aqui solo se busca y se devuelve el enlace de descarga.

export function jackettConfig() {
  const url = (getSetting('jackett_url') || '').replace(/\/+$/, '');
  const key = getSetting('jackett_key') || '';
  return { url, key };
}

const enc = encodeURIComponent;
// Endpoint Torznab del indexer agregado "all": busca en todos tus indexers de Jackett.
function torznabUrl(url, key, params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${enc(v)}`).join('&');
  return `${url}/api/v2.0/indexers/all/results/torznab/api?apikey=${enc(key)}&${qs}`;
}

async function torznabFetch(params) {
  const { url, key } = jackettConfig();
  if (!url || !key) throw new Error('Jackett no configurado (URL o API key vacios)');
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(torznabUrl(url, key, params), { signal: AbortSignal.timeout(90000) });
  } catch (err) {
    const ms = Date.now() - t0;
    const why =
      err?.name === 'TimeoutError' || /aborted/i.test(String(err?.message)) ? `timeout tras ${ms}ms` : String(err?.message || err);
    console.warn(`[jackett] x ${params.t} - ${why}`);
    throw new Error(`No se pudo contactar con Jackett: ${why}`);
  }
  const ms = Date.now() - t0;
  if (ms > 5000) console.warn(`[jackett] tardo ${ms}ms (${res.status})`);
  const text = await res.text();
  if (!res.ok) {
    // Jackett devuelve el error dentro de <error code=".." description=".."/>
    const m = text.match(/<error[^>]*description="([^"]*)"/i);
    throw new Error(`Jackett ${res.status}${m ? ` - ${m[1]}` : ''}`);
  }
  return text;
}

// --- parseo Torznab (RSS): formato acotado, se parsea a mano sin dependencias ------
function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
const tagOf = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return null;
  return decodeEntities(m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim());
};
const attrOf = (block, name) => {
  const m = block.match(new RegExp(`<torznab:attr[^>]*name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i'));
  return m ? decodeEntities(m[1]) : null;
};
const enclosureUrl = (block) => {
  const m = block.match(/<enclosure[^>]*url=["']([^"']*)["']/i);
  return m ? decodeEntities(m[1]) : null;
};

function parseTorznab(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const magnet = attrOf(b, 'magneturl');
    const link = tagOf(b, 'link');
    const encl = enclosureUrl(b);
    // preferimos magnet; si no, el .torrent (link/enclosure, que Jackett sirve/proxya)
    const downloadUrl = magnet || encl || link || null;
    if (!downloadUrl) continue;
    const size = Number(tagOf(b, 'size') || attrOf(b, 'size') || 0) || 0;
    const seedersRaw = attrOf(b, 'seeders') ?? attrOf(b, 'seeds');
    const peersRaw = attrOf(b, 'peers') ?? attrOf(b, 'leechers');
    // freeleech: downloadvolumefactor=0 → la descarga no cuenta para el ratio. null si el
    // indexer no informa el atributo (se trata como "no freeleech" al filtrar).
    const dvfRaw = attrOf(b, 'downloadvolumefactor');
    const downloadFactor = dvfRaw != null ? Number(dvfRaw) : null;
    items.push({
      engine: 'jackett',
      guid: tagOf(b, 'guid') || downloadUrl,
      indexer: tagOf(b, 'jackettindexer') || attrOf(b, 'jackettindexer') || 'Jackett',
      title: tagOf(b, 'title') || '(sin titulo)',
      size,
      seeders: seedersRaw != null ? Number(seedersRaw) : null,
      leechers: peersRaw != null ? Number(peersRaw) : null,
      protocol: 'torrent',
      publishDate: tagOf(b, 'pubDate'),
      infoUrl: tagOf(b, 'comments') || null,
      downloadFactor,
      freeleech: downloadFactor != null ? downloadFactor === 0 : null,
      downloadUrl,
    });
  }
  return items;
}

export async function jackettTest() {
  // t=caps no requiere query y valida url+apikey de una
  const xml = await torznabFetch({ t: 'caps' });
  if (!/<caps/i.test(xml)) throw new Error('Respuesta inesperada de Jackett (sin <caps>)');
  return { ok: true, name: 'Jackett' };
}

// Busca musica (categoria Audio = 3000) en todos los indexers. Consulta en vivo: lento.
export async function jackettSearch(query, { limit = 100 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  // Categoría configurable. Por defecto 3000 (Audio). Algunos indexers (p. ej. Orpheus)
  // no declaran esa categoría exacta en sus caps de Jackett y el filtro cat=3000 los
  // EXCLUYE del agregado «all»; dejando el ajuste VACÍO se busca sin filtro (todas las
  // categorías) y esos trackers vuelven a aparecer.
  const cats = (getSetting('jackett_categories') ?? '3000').trim();
  const params = { t: 'search', q };
  if (cats) params.cat = cats;
  const xml = await torznabFetch(params);
  const list = parseTorznab(xml);
  list.sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1));
  return list.slice(0, limit);
}
