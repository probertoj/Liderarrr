import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// Con LIDERARRR_SECRET definida (va en su propio fichero: db.js la lee al cargarse).
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-secrets-${Date.now()}`);
process.env.LIDERARRR_SECRET = 'una-frase-de-paso-de-prueba';
const { db, getSetting, setSetting, cifrarPendientes } = await import('../src/db.js');

const crudo = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
const ponerCrudo = (k, v) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

test('una credencial que estaba en claro se cifra al arrancar', () => {
  // así estaba la clave de Prowlarr en la base real: guardada antes de que hubiera cifrado
  ponerCrudo('prowlarr_key', 'clave-en-claro');
  ponerCrudo('lastfm_user', 'no-es-secreto');
  assert.equal(cifrarPendientes(), 1);
  assert.match(crudo('prowlarr_key'), /^enc:v1:/);
  assert.equal(getSetting('prowlarr_key'), 'clave-en-claro', 'y se sigue leyendo igual');
  assert.equal(crudo('lastfm_user'), 'no-es-secreto', 'lo que no es secreto no se toca');
  assert.equal(cifrarPendientes(), 0, 'no cifra dos veces');
});

test('lo que se guarda desde Ajustes va cifrado', () => {
  setSetting('jackett_key', 'otra-clave');
  assert.match(crudo('jackett_key'), /^enc:v1:/);
  assert.equal(getSetting('jackett_key'), 'otra-clave');
});

test('un valor cifrado con OTRA frase de paso no se entrega como si fuera la credencial', () => {
  // antes devolvía el texto cifrado y la app lo mandaba a Last.fm o Spotify como clave
  ponerCrudo('discogs_token', 'enc:v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:c2VjcmV0bw==');
  assert.equal(getSetting('discogs_token'), null);
  assert.equal(getSetting('discogs_token', 'por-defecto'), null);
});
