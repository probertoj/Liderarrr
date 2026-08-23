import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// mbseed.js importa db.js, que abre una base SQLite en DATA_DIR al cargarse. Apuntamos
// DATA_DIR a un directorio temporal ANTES del import dinámico para no tocar la base real
// (y para que la consulta de album_labels salga vacía → prueba el fallback a etiquetas).
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-test-${Date.now()}`);
const { buildReleaseSeed } = await import('../src/mbseed.js');

const sampleAlbum = {
  id: -1, // sin filas en album_labels → fuerza el fallback a album.labels
  title: 'Test Album',
  album_artist: 'Main Artist',
  year: 2001,
  primary_type: 'Album',
  secondary_types: ['Live'],
  labels: ['Cool Label'],
  artist: { mbid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
  artists: [
    { name: 'Main Artist', credit_name: 'Main Artist', mbid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', join_phrase: ' & ' },
    { name: 'Second Artist', credit_name: 'Second', mbid: null, join_phrase: '' },
  ],
  tracks: [
    { disc: 1, num: 1, title: 'One', duration_ms: 200000, artist: 'Main Artist' },
    { disc: 1, num: 2, title: 'Two', duration_ms: 210000, artist: 'Guest Person' },
    { disc: 2, num: 1, title: 'Three', duration_ms: 190000, artist: '' },
  ],
};

test('buildReleaseSeed mapea los campos básicos', () => {
  const s = buildReleaseSeed(sampleAlbum);
  assert.equal(s.name, 'Test Album');
  assert.equal(s.status, 'official');
  assert.equal(s['events.0.date.year'], '2001');
  assert.match(s.edit_note, /Liderarrr/);
});

test('buildReleaseSeed incluye tipo primario y secundarios', () => {
  const s = buildReleaseSeed(sampleAlbum);
  assert.deepEqual(s.type, ['Album', 'Live']);
});

test('buildReleaseSeed mapea el crédito de artista con MBID y nexo', () => {
  const s = buildReleaseSeed(sampleAlbum);
  assert.equal(s['artist_credit.names.0.name'], 'Main Artist');
  assert.equal(s['artist_credit.names.0.mbid'], 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.equal(s['artist_credit.names.0.join_phrase'], ' & ');
  // El segundo crédito no tiene MBID → debe llevar artist.name para que MB lo busque
  assert.equal(s['artist_credit.names.1.name'], 'Second');
  assert.equal(s['artist_credit.names.1.artist.name'], 'Second Artist');
  assert.equal(s['artist_credit.names.1.mbid'], undefined);
});

test('buildReleaseSeed agrupa pistas por disco en mediums 0-based', () => {
  const s = buildReleaseSeed(sampleAlbum);
  assert.equal(s['mediums.0.format'], 'Digital Media');
  assert.equal(s['mediums.0.track.0.number'], '1');
  assert.equal(s['mediums.0.track.0.name'], 'One');
  assert.equal(s['mediums.0.track.0.length'], '200000');
  // segundo disco → segundo medium
  assert.equal(s['mediums.1.track.0.name'], 'Three');
});

test('buildReleaseSeed añade artista por pista solo cuando difiere del álbum', () => {
  const s = buildReleaseSeed(sampleAlbum);
  // pista 1: artista == artista del álbum → sin crédito por pista
  assert.equal(s['mediums.0.track.0.artist_credit.names.0.name'], undefined);
  // pista 2: artista distinto (invitado) → crédito por pista
  assert.equal(s['mediums.0.track.1.artist_credit.names.0.name'], 'Guest Person');
});

test('buildReleaseSeed cae a los sellos de las etiquetas cuando no hay album_labels', () => {
  const s = buildReleaseSeed(sampleAlbum);
  assert.equal(s['labels.0.name'], 'Cool Label');
});
