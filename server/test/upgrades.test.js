import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// «Candidatos a upgrade»: una copia en MP3 de un disco que ya tienes en FLAC no es un candidato.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-upgrades-${Date.now()}`);
const { db } = await import('../src/db.js');
const { upgradeCandidates } = await import('../src/editions.js');

const RG = '5dfac852-0000-4000-8000-000000000001';
const alb = db.prepare(
  "INSERT INTO albums (id, local_key, album_artist, title, year, rg_mbid, match_state, track_file_count, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
);
const pistas = (albumId, n, lossless) => {
  const ins = db.prepare('INSERT INTO tracks (album_id, title, path, format, lossless, bitrate) VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 1; i <= n; i++) ins.run(albumId, `t${i}`, `/${albumId}/${i}`, lossless ? 'FLAC' : 'MP3', lossless ? 1 : 0, lossless ? 900000 : 320000);
};

// El caso real: «69 Love Songs» entero en MP3 (71 pistas) y, al lado, los tres volúmenes en FLAC
alb.run(1, 'a', 'The Magnetic Fields', '69 Love Songs', 1999, RG, 'matched', 71, 300);
pistas(1, 71, false);
alb.run(2, 'b', 'The Magnetic Fields', '69 Love Songs Vol. 1', 1999, RG, 'matched', 23, 500);
pistas(2, 23, true);
alb.run(3, 'c', 'The Magnetic Fields', '69 Love Songs Vol. 2', 1999, RG, 'matched', 23, 500);
pistas(3, 23, true);
alb.run(4, 'd', 'The Magnetic Fields', '69 Love Songs Vol. 3', 1999, RG, 'matched', 25, 500);
pistas(4, 25, true);
// Solo en MP3, sin ninguna otra copia: candidato de verdad
alb.run(5, 'e', 'Oasis', 'Definitely Maybe', 1994, '11111111-0000-4000-8000-000000000002', 'matched', 11, 200);
pistas(5, 11, false);
// Caja de 30 pistas en MP3 de la que solo tienes un disco (10 pistas) en FLAC: sigue siendo candidato
alb.run(6, 'f', 'The Cure', 'Wish (30th Anniversary Edition)', 2022, '22222222-0000-4000-8000-000000000003', 'matched', 30, 400);
pistas(6, 30, false);
alb.run(7, 'g', 'The Cure', 'Wish (30th Anniversary Edition)', 2022, '22222222-0000-4000-8000-000000000003', 'matched', 10, 300);
pistas(7, 10, true);
// Sin identificar (sin rg_mbid): se reconoce por artista y título de fondo, edición aparte
alb.run(8, 'h', 'Faust', 'So Far', 1972, null, 'pending', 9, 90);
pistas(8, 9, false);
alb.run(9, 'i', 'faust', 'So Far (Remastered)', 2010, null, 'pending', 9, 250);
pistas(9, 9, true);
// La copia en FLAC está DESCARTADA (en la papelera): no cuenta como tenerlo
alb.run(10, 'j', 'Can', 'Tago Mago', 1971, '33333333-0000-4000-8000-000000000004', 'matched', 7, 80);
pistas(10, 7, false);
alb.run(11, 'k', 'Can', 'Tago Mago', 1971, '33333333-0000-4000-8000-000000000004', 'dismissed', 7, 300);
pistas(11, 7, true);

const filas = Object.fromEntries(upgradeCandidates().map((r) => [r.id, r]));

test('solo salen las copias con pérdida', () => {
  assert.deepEqual(Object.keys(filas).map(Number).sort((a, b) => a - b), [1, 5, 6, 8, 10]);
});

test('el disco que ya tienes en FLAC en otras carpetas deja de ser candidato', () => {
  assert.equal(filas[1].tiene_sin_perdida, true);
  assert.equal(filas[1].parcial, false);
  assert.equal(filas[1].lossless_copy_id, 4, 'enseña la copia sin pérdida con más pistas');
});

test('el que solo tienes con pérdida sigue siéndolo', () => {
  assert.equal(filas[5].tiene_sin_perdida, false);
  assert.equal(filas[5].lossless_copy_id, null);
  assert.equal(filas[5].parcial, false);
});

test('tener una parte sin pérdida no cubre el disco entero: candidato, marcado como parcial', () => {
  assert.equal(filas[6].tiene_sin_perdida, false);
  assert.equal(filas[6].parcial, true);
  assert.equal(filas[6].lossless_copy_id, 7);
});

test('sin identificar, se reconoce por artista y título aunque cambie la edición', () => {
  assert.equal(filas[8].tiene_sin_perdida, true);
  assert.equal(filas[8].lossless_copy_id, 9);
});

test('una copia en FLAC que está en la papelera no cuenta', () => {
  assert.equal(filas[10].tiene_sin_perdida, false);
  assert.equal(filas[10].lossless_copy_id, null);
});
