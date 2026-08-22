import { getSetting } from './db.js';

// Notificaciones por webhook: avisa de novedades de tus artistas y de descargas importadas
// sin tener que abrir la app. Autodetecta el destino por la URL: Discord (webhook), Slack
// (webhook), o genérico/ntfy (POST del texto plano — ntfy usa el body como mensaje y una
// cabecera Title). Todo opcional y best-effort: si falla, nunca tumba el proceso que lo llama.

export function notifyConfigured() {
  return getSetting('notify_enabled') === '1' && !!getSetting('notify_url');
}

function detectKind(url) {
  if (/discord(app)?\.com\/api\/webhooks/i.test(url)) return 'discord';
  if (/hooks\.slack\.com/i.test(url)) return 'slack';
  return 'plain'; // ntfy y genéricos: texto plano
}

// Título ASCII-safe (ntfy exige ASCII en la cabecera Title; el cuerpo va en UTF-8).
const asciiTitle = (t) => String(t || 'Liderarr').normalize('NFD').replace(/[^\x20-\x7E]/g, '').trim() || 'Liderarr';

export async function sendNotification(title, message, { force = false } = {}) {
  const url = getSetting('notify_url');
  if (!url) return { skipped: 'sin URL' };
  if (!force && getSetting('notify_enabled') !== '1') return { skipped: 'desactivado' };
  const kind = detectKind(url);
  let headers = {};
  let body;
  if (kind === 'discord') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ content: `**${title}** ${message}`.slice(0, 1900) });
  } else if (kind === 'slack') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ text: `*${title}* ${message}` });
  } else {
    headers['Content-Type'] = 'text/plain; charset=utf-8';
    headers.Title = asciiTitle(title); // ntfy: título de la notificación
    headers.Tags = 'musical_note';
    body = message;
  }
  const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`El webhook devolvió ${res.status}`);
  return { ok: true, kind };
}

export async function notifyTest() {
  await sendNotification('Liderarr', 'Notificación de prueba: si ves esto, ya está conectado. 🎵', { force: true });
  return { ok: true, name: 'Notificación de prueba enviada' };
}
