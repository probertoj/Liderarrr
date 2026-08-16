// Rosy Overdrive (rosyoverdrive.com) es un blog WordPress plano (sin Cloudflare) que
// reseña discos con una estructura MUY consistente: cada disco es un encabezado
// «<h2><strong>Artista – Álbum</strong></h2>» seguido de un párrafo con
// «Release date:», «Record label:» y «Genre:». De ahí sacamos artista, título, fecha y
// sello sin API ni lector. Lo usan igual sus listas (Top 40…) y su columna «Pressing
// Concerns», así que un solo parser alimenta tanto los retos como el radar.

const UA = 'Mozilla/5.0 (compatible; Liderarrr/0.8; +https://github.com/probertoj/Liderarrr)';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// HTML → texto plano: quita etiquetas y decodifica las entidades que salen aquí.
const stripTags = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/\s+/g, ' ')
    .trim();

// «June 5th» + año → «2026-06-05». null si no reconoce el mes.
function parseDate(s, year) {
  const m = String(s || '').match(/([A-Za-z]+)\s+(\d{1,2})/);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo || !year) return null;
  return `${year}-${String(mo).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

// El año del post va en la ruta: /2026/06/16/…
export function yearFromUrl(url) {
  const m = String(url || '').match(/\/(\d{4})\/\d{2}\/\d{2}\//);
  return m ? Number(m[1]) : new Date().getFullYear();
}

export async function fetchRosy(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
  } catch (err) {
    const why = err?.name === 'TimeoutError' ? 'tardó demasiado' : String(err?.message || err);
    throw new Error(`No se pudo leer Rosy Overdrive (${why})`);
  }
  if (!res.ok) throw new Error(`Rosy Overdrive respondió ${res.status}`);
  return res.text();
}

// Extrae las entradas de disco de un post: [{ artist, title, label, release_date }].
// Cada entrada es un encabezado con « – » cuyo bloque siguiente contiene «Release date:»
// (así se descartan encabezados de sección que no son discos).
export function parseRosyPost(html, year) {
  const out = [];
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>([\s\S]*?)(?=<h[23][^>]*>|$)/g;
  let m;
  while ((m = re.exec(html))) {
    const head = stripTags(m[1]);
    const dash = head.match(/\s[–—]\s/); // en/em dash con espacios: separa artista de álbum
    if (!dash) continue;
    const chunk = m[2];
    if (!/Release date:/i.test(chunk)) continue; // no es una ficha de disco
    const i = head.indexOf(dash[0]);
    const artist = head.slice(0, i).trim();
    const title = head.slice(i + dash[0].length).trim();
    if (!artist || !title) continue;
    const rd = stripTags((chunk.match(/Release date:\s*<\/strong>([\s\S]*?)<strong>/i) || [])[1] || '');
    const label = stripTags((chunk.match(/Record label:\s*<\/strong>([\s\S]*?)(?:<strong>|<br)/i) || [])[1] || '');
    out.push({ artist, title, label: label || null, release_date: parseDate(rd, year) });
  }
  return out;
}

const PC_TAG = 'https://rosyoverdrive.com/tag/pressing-concerns/';

// URLs de los posts recientes de la columna «Pressing Concerns» (de más nuevo a más
// viejo, tal como los lista la página de la etiqueta).
export async function pressingConcernsPostUrls(limit = 12) {
  const html = await fetchRosy(PC_TAG);
  const re = /https:\/\/rosyoverdrive\.com\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]*pressing-concerns[a-z0-9-]*\//gi;
  const urls = [...new Set(html.match(re) || [])];
  return urls.slice(0, limit);
}

// Título del post ya decodificado (entidades HTML) y sin el sufijo « – Rosy Overdrive».
export function postTitle(html) {
  const raw = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  if (!raw) return null;
  return stripTags(raw).replace(/\s*[|–—-]\s*Rosy Overdrive.*$/i, '').trim() || null;
}

// Posts de «Pressing Concerns» normalizados a la MISMA forma que las listas de
// buymusic.club (`{ slug, title, published_at, ListItems:[{artist,title,label,releaseDate,url}] }`),
// para que el `ingest` del radar los trague sin cambios. Cada post = una «lista».
export async function pressingConcernsLists(limit = 12) {
  const urls = await pressingConcernsPostUrls(limit);
  const lists = [];
  for (const url of urls) {
    let html;
    try {
      html = await fetchRosy(url); // eslint-disable-line no-await-in-loop
    } catch {
      continue; // un post que falle no tumba al resto
    }
    const entries = parseRosyPost(html, yearFromUrl(url));
    if (!entries.length) continue;
    const slug = (() => { try { return new URL(url).pathname; } catch { return url; } })();
    const dm = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
    const published = dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : null;
    lists.push({
      id: slug,
      slug,
      title: postTitle(html) || 'Pressing Concerns',
      published_at: published,
      ListItems: entries.map((e, i) => ({
        id: `${slug}#${i}`,
        artist: e.artist,
        title: e.title,
        label: e.label,
        releaseDate: e.release_date,
        url,
        order: i,
      })),
    });
  }
  return lists;
}

// Para importar como reto: entradas «Artista - Álbum» de un post-lista (Top N…) + el
// título del post (para nombrar el reto). Una sola descarga.
export async function rosyList(url) {
  const html = await fetchRosy(url);
  const lines = parseRosyPost(html, yearFromUrl(url)).map((e) => `${e.artist} - ${e.title}`);
  return { lines, listTitle: postTitle(html) };
}
