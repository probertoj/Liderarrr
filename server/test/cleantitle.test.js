import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// musicbrainz.js importa db.js (abre SQLite en DATA_DIR). Apuntamos a un temporal antes
// del import dinámico para no tocar la base real.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-clean-${Date.now()}`);
const { cleanAlbumTitle } = await import('../src/musicbrainz.js');

test('quita sufijos de edición de la misma obra (incl. español)', () => {
  assert.equal(cleanAlbumTitle('Mas de Cien Lobos (Remasterizado)', '091'), 'Mas de Cien Lobos');
  assert.equal(cleanAlbumTitle('Rumours (Deluxe Edition)', 'Fleetwood Mac'), 'Rumours');
  assert.equal(cleanAlbumTitle('OK Computer (2017 Remaster)', 'Radiohead'), 'OK Computer');
});

test('quita bandas sonoras entre paréntesis y palabra de edición suelta al final', () => {
  assert.equal(cleanAlbumTitle('Crestone (Original Score)', 'Animal Collective'), 'Crestone');
  assert.equal(cleanAlbumTitle('Apollo Remastered (Atmospheres & Soundtracks)', 'Brian Eno'), 'Apollo');
});

test('quita prefijos de listas/rippers («2021 - », «1. »)', () => {
  assert.equal(cleanAlbumTitle('2021 - Pasión de Sábado', '1. Cuchillas'), 'Pasión de Sábado');
});

test('CONSERVADOR: NO toca (Live)/(Remix) ni signos con significado', () => {
  // dejar directos/remixes evita casar con la versión de estudio equivocada
  assert.equal(cleanAlbumTitle('Bodys (Live at Brooklyn Steel)', ''), 'Bodys (Live at Brooklyn Steel)');
  assert.equal(cleanAlbumTitle('Pink Stuff (Ariel Pink Remix)', ''), 'Pink Stuff (Ariel Pink Remix)');
  assert.equal(cleanAlbumTitle('Where Is My Mind?', 'Pixies'), 'Where Is My Mind?');
});

test('si limpiar lo dejaría vacío, devuelve el original', () => {
  assert.equal(cleanAlbumTitle('(Remastered)', 'X'), '(Remastered)');
});
