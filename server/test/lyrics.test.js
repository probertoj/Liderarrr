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
