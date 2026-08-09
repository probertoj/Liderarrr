import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Aviso de nueva versión: compara la versión que corre con el último tag publicado en
// GitHub, para que el usuario sepa que toca actualizar y pueda ver las novedades. Si el
// repo es privado o no hay conexión, falla en silencio (sin aviso). Se cachea 12 h.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const REPO = 'probertoj/Liderarrr';
const TTL = 12 * 60 * 60 * 1000;

const parse = (v) => String(v || '').replace(/^v/, '').split('.').map((n) => Number(n) || 0);
const cmp = (a, b) => {
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

let cache = { at: 0, data: null };

export async function updateCheck() {
  const current = pkg.version;
  if (cache.data && Date.now() - cache.at < TTL) return { ...cache.data, current };
  let latest = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/tags?per_page=50`, {
      headers: { 'User-Agent': 'Liderarrr', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const tags = await res.json();
      const versions = (tags || []).map((t) => t.name).filter((n) => /^v?\d+\.\d+\.\d+$/.test(n));
      versions.sort((a, b) => cmp(b, a));
      latest = versions[0] ? versions[0].replace(/^v/, '') : null;
    }
  } catch {
    /* sin conexión o repo privado: no molestamos con avisos */
  }
  const data = {
    latest,
    updateAvailable: latest ? cmp(latest, current) > 0 : false,
    url: `https://github.com/${REPO}/blob/main/CHANGELOG.md`,
  };
  cache = { at: Date.now(), data };
  return { ...data, current };
}
