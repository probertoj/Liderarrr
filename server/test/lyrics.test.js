import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// lyrics.js importa db.js, que abre una SQLite en DATA_DIR al cargarse.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-test-lyrics-${Date.now()}`);
const { pickLyricsCandidate } = await import('../src/lyrics.js');

// Elegir entre las versiones que devuelve LRCLIB es donde se cuela una letra equivocada:
// del mismo tema hay estudio, directo, remezcla y edición alargada, y lo único que las
// distingue es la duración. El criterio es el mismo de toda la app: antes no poner nada
// que poner algo que no es.

const estudio = { trackName: 'Sail to the Moon', duration: 258, plainLyrics: 'estudio' };
const directo = { trackName: 'Sail to the Moon', duration: 291, plainLyrics: 'directo' };
const remezcla = { trackName: 'Sail to the Moon', duration: 402, syncedLyrics: '[00:01.00] remezcla' };

test('elige la versión cuya duración cuadra con tu fichero', () => {
  const r = pickLyricsCandidate([directo, estudio, remezcla], 258);
  assert.equal(r.ok, true);
  assert.equal(r.data.plainLyrics, 'estudio');
});

test('acepta una diferencia pequeña (los rips no son exactos)', () => {
  const r = pickLyricsCandidate([estudio], 260); // 2 s de diferencia
  assert.equal(r.ok, true);
});

test('NO acepta una versión que se pasa del margen', () => {
  // 33 s de diferencia es otra versión, no un redondeo: mejor sin letra que con la del directo
  const r = pickLyricsCandidate([directo], 258);
  assert.equal(r.ok, false);
  assert.match(r.reason, /duración/i);
});

test('a igual cercanía, gana la que trae letra sincronizada', () => {
  const plana = { duration: 200, plainLyrics: 'plana' };
  const sincronizada = { duration: 200, syncedLyrics: '[00:01.00] sincronizada' };
  assert.equal(pickLyricsCandidate([plana, sincronizada], 200).data.syncedLyrics, '[00:01.00] sincronizada');
  // y el orden de llegada no debe cambiar el resultado
  assert.equal(pickLyricsCandidate([sincronizada, plana], 200).data.syncedLyrics, '[00:01.00] sincronizada');
});

test('sin duración solo vale si hay UNA candidata', () => {
  assert.equal(pickLyricsCandidate([estudio], null).ok, true);
  const varias = pickLyricsCandidate([estudio, directo], null);
  assert.equal(varias.ok, false, 'con varias versiones y sin duración no se elige a ciegas');
});

test('una entrada instrumental es una respuesta válida', () => {
  const r = pickLyricsCandidate([{ duration: 258, instrumental: true }], 258);
  assert.equal(r.ok, true);
  assert.equal(r.data.instrumental, true);
});

test('descarta las entradas sin letra ninguna', () => {
  const vacia = { duration: 258, plainLyrics: '', syncedLyrics: '' };
  assert.equal(pickLyricsCandidate([vacia], 258).ok, false);
});

test('tolera una respuesta vacía o rara', () => {
  assert.equal(pickLyricsCandidate([], 200).ok, false);
  assert.equal(pickLyricsCandidate(null, 200).ok, false);
  assert.equal(pickLyricsCandidate([null, undefined], 200).ok, false);
});

// --- escribir .lrc junto al audio ---------------------------------------------
// La promesa es fuerte y conviene tenerla clavada en un test: escribir la letra al lado NO
// puede tocar el audio, porque ese fichero comparte inodo con el que siembra el torrent.
// Si alguien cambiara esto por «escribir dentro de las etiquetas», este test lo cazaría.

import fs from 'node:fs';
const { writeLrcForAlbum } = await import('../src/lyrics.js');
const { db, setSetting } = await import('../src/db.js');

test('escribir el .lrc no rompe el hardlink del torrent', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'liderarr-lrc-'));
  const torrents = path.join(base, 'torrents');
  const media = path.join(base, 'media');
  fs.mkdirSync(torrents);
  fs.mkdirSync(media);

  // el escenario real: fichero descargado + hardlink en la biblioteca (lo que hace auto-import)
  const origen = path.join(torrents, 'cancion.flac');
  fs.writeFileSync(origen, 'AUDIO');
  const enlace = path.join(media, 'cancion.flac');
  fs.linkSync(origen, enlace);
  const antes = fs.statSync(enlace);

  db.prepare("INSERT INTO albums (id, album_artist, title, match_state) VALUES (900, 'A', 'B', 'matched')").run();
  db.prepare('INSERT INTO tracks (id, album_id, title, path) VALUES (900, 900, ?, ?)').run('Canción', enlace);
  db.prepare(
    "INSERT INTO lyrics (track_id, state, plain, synced, fetched_at) VALUES (900, 'found', 'plana', '[00:01.00] sincronizada', 0)"
  ).run();

  setSetting('lyrics_write_lrc', '1');
  const r = await writeLrcForAlbum(900);

  const despues = fs.statSync(enlace);
  assert.equal(r.written, 1);
  assert.ok(fs.existsSync(path.join(media, 'cancion.lrc')), 'escribe el .lrc al lado');
  assert.equal(fs.readFileSync(origen, 'utf8'), 'AUDIO', 'el audio del torrent no se toca');
  assert.equal(antes.ino, despues.ino, 'mismo inodo');
  assert.equal(despues.nlink, 2, 'el hardlink sigue en pie');
  assert.equal(antes.size, despues.size, 'el audio no cambia de tamaño');
  assert.equal(fs.readdirSync(torrents).join(), 'cancion.flac', 'en la carpeta del torrent no aparece nada nuevo');

  // no pisa un .lrc que ya exista (si tienes el tuyo, manda el tuyo)
  fs.writeFileSync(path.join(media, 'cancion.lrc'), 'MI LETRA');
  const r2 = await writeLrcForAlbum(900);
  assert.equal(r2.written, 0);
  assert.equal(r2.skipped, 1);
  assert.equal(fs.readFileSync(path.join(media, 'cancion.lrc'), 'utf8'), 'MI LETRA');

  fs.rmSync(base, { recursive: true, force: true });
});

test('no escribe nada si no lo has activado en Ajustes', async () => {
  setSetting('lyrics_write_lrc', '0');
  await assert.rejects(() => writeLrcForAlbum(900), /desactivado/i);
});
