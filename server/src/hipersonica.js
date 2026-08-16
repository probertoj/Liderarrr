// Hipersónica (Substack DE PAGO) publica cada martes una «tier list» con las críticas de
// los discos de la semana ordenados por nivel. El contenido está tras el muro y atado a
// la sesión del navegador del suscriptor, así que NO se puede leer server-side (probado:
// la URL secreta redirige a sign-in desde el servidor). La vía es que el usuario PEGUE el
// texto de la tier list; este parser lo convierte en ítems para el radar.
//
// Formato del texto: cabeceras de nivel en MAYÚSCULAS (DIRECTO AL EXCEL, DISCOS QUE SÍ,
// DISCOS QUE OK, DISCOS QUE MEH, DISCOS QUE NO) y, bajo cada una, entradas «Artista –
// Álbum» seguidas de una línea «género:/Género:» (ancla fiable) y la reseña.

const TIERS = [
  { re: /^directo al excel/i, tier: 'Directo al Excel', rank: 0 },
  { re: /^discos que s[íi]/i, tier: 'Sí', rank: 1 },
  { re: /^discos que ok/i, tier: 'OK', rank: 2 },
  { re: /^discos que meh/i, tier: 'Meh', rank: 3 },
  { re: /^discos que no/i, tier: 'No', rank: 4 },
];

// Convierte el texto pegado en [{ artist, album, tier, tierRank, genre }].
export function parseTierList(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim());
  const items = [];
  let tier = null;
  let tierRank = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const th = TIERS.find((t) => t.re.test(line));
    if (th) {
      tier = th.tier;
      tierRank = th.rank;
      continue;
    }
    const dash = line.match(/\s[–—-]\s/); // en/em dash o guion con espacios: artista – álbum
    if (!dash) continue;
    // la línea de disco va seguida (saltando vacías) de una línea «género:/Género:»
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    if (j >= lines.length || !/^g[eé]nero\s*:/i.test(lines[j])) continue;
    const idx = line.indexOf(dash[0]);
    const artist = line.slice(0, idx).trim();
    const album = line.slice(idx + dash[0].length).trim();
    if (!artist || !album) continue;
    const genre = lines[j].replace(/^g[eé]nero\s*:\s*/i, '').trim();
    items.push({ artist, album, tier, tierRank, genre: genre || null });
  }
  return items;
}

// Normaliza a la forma de las listas de buymusic.club (una «lista» = una tier list), para
// que el `ingest` del radar la trague. El nivel va en `type` y el género en `label`. La
// fecha (para que caiga en la ventana del radar) es la que pase el usuario o hoy.
export function tierListToLists(text, { date, title } = {}) {
  const day = (date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null) || new Date().toISOString().slice(0, 10);
  const items = parseTierList(text);
  const ListItems = items.map((it, i) => ({
    id: `hs:${day}#${i}`,
    artist: it.artist,
    title: it.album,
    label: it.genre,
    type: it.tier,
    releaseDate: day,
    order: i,
  }));
  return { items: ListItems.length, lists: [{ id: day, slug: day, title: title || `Tier List · ${day}`, published_at: day, ListItems }] };
}
