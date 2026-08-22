// Limpieza de la consulta antes de mandarla a los indexers (Torznab/Prowlarr). Los
// trackers casan por TOKENS, y ciertos caracteres —sobre todo el «&»— rompen el match:
// un mismo disco aparece escrito con «&» y con «and» según el release, así que buscar con
// «&» no casa con los «and» (ni a veces con los «&»). Los pasamos a espacio para dejar
// solo tokens de texto, que es lo que el tracker compara. NO se toca lo que ve el usuario;
// solo la cadena que se envía a buscar.
export function cleanSearchQuery(q) {
  return String(q || '')
    .replace(/\s*[&/\\]+\s*/g, ' ') // & / \  → espacio (rompen el match por tokens)
    .replace(/\s+/g, ' ')
    .trim();
}
