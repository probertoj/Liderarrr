import { getSetting } from './db.js';

// Normalización y remapeo de rutas qBittorrent → contenedor, compartido por el auto-import
// (autoimport.js) y por el diagnóstico de la lista manual (importer.js pendingImports).
// qBittorrent reporta la ruta del contenido tal como la ve ÉL (p. ej. /downloads/music),
// que puede no coincidir con la que Liderarr tiene montada (p. ej. /library/torrents/music).
// El ajuste `import_qb_path_map` traduce prefijos, una regla por línea: «rutaQB => rutaLocal».

export const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

export const within = (p, root) => {
  const np = norm(p);
  const r = norm(root);
  return !!np && !!r && (np === r || np.startsWith(r + '/'));
};

export function pathMappings() {
  return String(getSetting('import_qb_path_map') || '')
    .split(/[\n;]+/)
    .map((line) => {
      const parts = line.split(/\s*(?:=>|->|\|)\s*/);
      return parts.length === 2 && parts[0].trim() && parts[1].trim() ? { from: norm(parts[0]), to: norm(parts[1]) } : null;
    })
    .filter(Boolean);
}

export function remapPath(p, maps) {
  const np = norm(p);
  for (const m of maps) {
    if (np === m.from || np.startsWith(m.from + '/')) return m.to + np.slice(m.from.length);
  }
  return np;
}
