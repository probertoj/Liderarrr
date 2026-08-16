// Raven Sings the Blues (ravensingstheblues.com) es un blog WordPress de reseñas: un
// post = un disco. El RSS de la categoría «reviews» trae en UNA petición título, enlace,
// fecha y cuerpo de cada reseña. El artista y el álbum salen limpios del enlace a
// Bandcamp que incrusta cada review, con el formato canónico «{Álbum} by {Artista}»;
// si faltara, se cae al <title>. Alimenta el radar como una fuente más.

const UA = 'Mozilla/5.0 (compatible; Liderarrr/0.8; +https://github.com/probertoj/Liderarrr)';
const FEED = 'https://ravensingstheblues.com/category/reviews/feed/';

// Decodifica CDATA + las entidades HTML que aparecen en el feed, y quita etiquetas.
const decode = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '–')
    .replace(/&#38;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

// Del enlace Bandcamp «{Álbum} by {Artista}» saca ambos (el « by » de más a la derecha
// separa: el álbum puede contener « by », el artista no). Si no hay Bandcamp, cae al
// título: «Artista – Álbum» o, en su defecto, solo el artista (sin álbum → se descarta).
function albumArtist(bcText, title) {
  const bc = decode(bcText);
  const m = bc.match(/^(.*) by (.+)$/);
  if (m && m[1].trim()) return { album: m[1].trim(), artist: m[2].trim() };
  const t = decode(title).replace(/\s*[–—-]\s*Raven Sings The Blues.*$/i, '').trim();
  const dash = t.match(/\s[–—]\s/);
  if (dash) {
    const i = t.indexOf(dash[0]);
    return { artist: t.slice(0, i).trim(), album: t.slice(i + dash[0].length).trim() };
  }
  return { artist: t, album: null };
}

const day = (s) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

async function fetchFeed() {
  let res;
  try {
    res = await fetch(FEED, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, text/xml' }, signal: AbortSignal.timeout(30000) });
  } catch (err) {
    const why = err?.name === 'TimeoutError' ? 'tardó demasiado' : String(err?.message || err);
    throw new Error(`No se pudo leer Raven Sings the Blues (${why})`);
  }
  if (!res.ok) throw new Error(`Raven Sings the Blues respondió ${res.status}`);
  return res.text();
}

// Reseñas recientes normalizadas a la forma de las listas de buymusic.club (una sola
// «lista» con todas las reseñas como ítems), para que el `ingest` del radar las trague.
export async function reviewsLists(limit = 30) {
  const xml = await fetchFeed();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit);
  const ListItems = [];
  let i = 0;
  for (const [, it] of items) {
    const title = (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const link = decode((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '');
    const pub = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const bc = (it.match(/bandcamp\.com\/album\/[^"'<>]*["'][^>]*>([^<]+)<\/a>/i) || [])[1] || '';
    const { artist, album } = albumArtist(bc, title);
    if (!artist || !album) continue; // sin álbum no sirve para el radar
    ListItems.push({ id: link || `rstb#${i}`, artist, title: album, releaseDate: day(pub), url: link, order: i });
    i += 1;
  }
  return [{ id: 'reviews', slug: 'reviews', title: 'Raven Sings the Blues · Reseñas', published_at: null, ListItems }];
}
