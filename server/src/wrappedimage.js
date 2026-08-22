import fs from 'node:fs';
import { wrapped } from './listening.js';
import { coverFast } from './covers.js';

// Imagen compartible del Resumen: un SVG con las portadas de tus discos más escuchados
// embebidas en base64 (sin refs externas, para que el cliente lo pueda rasterizar a PNG
// sin problemas de CORS). Las portadas locales se leen del disco; las de fuera, de la URL
// que ya trae `wrapped` (Deezer). Cuadrada 1080×1080, lista para compartir.

const UA = 'Liderarrr ( https://github.com/probertoj/Liderarrr )';
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => Number(n || 0).toLocaleString('es-ES');

async function coverDataUri(a) {
  try {
    if (a.album_id) {
      const r = coverFast(a.album_id);
      if (r.status === 'ok') return `data:${r.contentType};base64,${fs.readFileSync(r.path).toString('base64')}`;
    }
    if (a.cover) {
      const res = await fetch(a.cover, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const ct = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
        return `data:${ct};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
      }
    }
  } catch {
    /* sin portada: hueco */
  }
  return null;
}

export async function wrappedImageSvg({ since = null, until = null, label = '' } = {}) {
  const data = await wrapped({ since, until });
  const albums = (data.topAlbums || []).slice(0, 12);
  const uris = await Promise.all(albums.map(coverDataUri));

  const W = 1080;
  const H = 1080;
  const pad = 48;
  const gap = 14;
  const cols = 4;
  const cell = (W - pad * 2 - gap * (cols - 1)) / cols;
  const gridTop = 214;

  const cells = albums
    .map((a, i) => {
      const x = pad + (i % cols) * (cell + gap);
      const y = gridTop + Math.floor(i / cols) * (cell + gap);
      const img = uris[i]
        ? `<image x="${x}" y="${y}" width="${cell}" height="${cell}" href="${uris[i]}" preserveAspectRatio="xMidYMid slice"/>`
        : `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="#20202a"/>`;
      return img + `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="none" stroke="#2c2c39"/>`;
    })
    .join('');

  const t = data.totals || {};
  const sub = `${fmt(t.scrobbles)} escuchas · ${fmt(t.artists)} artistas · ${fmt(t.albums)} álbumes`;
  const FONT = 'Segoe UI, system-ui, -apple-system, sans-serif';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0d0d10"/>
  <text x="${pad}" y="98" fill="#e6e6ee" font-family="${FONT}" font-size="52" font-weight="700">Tu ${esc(label)} en música</text>
  <text x="${pad}" y="150" fill="#d4a24a" font-family="${FONT}" font-size="30">${esc(sub)}</text>
  ${cells}
  <text x="${pad}" y="${H - 38}" fill="#6f6e69" font-family="${FONT}" font-size="26">Liderarr · completismo musical</text>
</svg>`;
}
