import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// Lo traído del fork de tinker-net (github.com/tinker-net/Liderarrr): carátula con cualquier
// nombre de fichero y listados de calidad por álbum.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-fork-${Date.now()}`);
const { db } = await import('../src/db.js');
const { app } = await import('../src/index.js');
app.log.level = 'silent';
const { findCover } = await import('../src/scanner.js');
const { qualityListsSummary, albumsAtSampleRate, albumsWithoutReplaygain, albumsWithoutCover } = await import('../src/qualitylists.js');
const q = await import('../src/queries.js');

test('la carátula es la imagen con nombre de portada y, si no hay, la primera que haya', () => {
  const en = (...nombres) => {
    const c = findCover('/m/disco', nombres);
    return c ? path.basename(c) : null;
  };
  assert.equal(en('back.jpg', 'Cover.JPG', 'booklet-01.png'), 'Cover.JPG');
  assert.equal(en('zz.jpg', 'folder.png'), 'folder.png');
  // antes esto contaba como «sin imagen»: ningún nombre de los de siempre
  assert.equal(en('scan.jpg'), 'scan.jpg');
  assert.equal(en('portada.png', 'contra.png'), 'contra.png', 'sin nombre preferido, la primera por orden');
  assert.equal(en(), null);
  // no cambia la lista que le pasan (scanTree la reutiliza)
  const lista = ['b.jpg', 'a.jpg'];
  findCover('/m', lista);
  assert.deepEqual(lista, ['b.jpg', 'a.jpg']);
});

const alb = db.prepare('INSERT INTO albums (id, local_key, path, album_artist, title, year, cover, match_state, track_file_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const pista = db.prepare('INSERT INTO tracks (album_id, title, path, sample_rate, lossless, has_replaygain) VALUES (?, ?, ?, ?, ?, ?)');
alb.run(1, 'a', '/m/Can/Tago Mago', 'Can', 'Tago Mago', 1971, '/m/Can/Tago Mago/cover.jpg', 'matched', 2);
pista.run(1, 'uno', '/1a', 44100, 1, 1);
pista.run(1, 'dos', '/1b', 44100, 1, 1);
alb.run(2, 'b', '/m/Neu!/Neu! 75', 'Neu!', 'Neu! 75', 1975, null, 'matched', 2);
pista.run(2, 'uno', '/2a', 44100, 1, 0);
pista.run(2, 'dos', '/2b', 48000, 0, 1); // mezcla frecuencias y formatos
alb.run(3, 'c', '/m/Eno/Discreet Music', 'Eno', 'Discreet Music', 1975, '', 'matched', 1);
pista.run(3, 'uno', '/3a', 96000, 1, 0);
alb.run(4, 'd', '/m/Descartado', 'X', 'Descartado', 2000, null, 'dismissed', 1);
pista.run(4, 'uno', '/4a', 44100, 0, 0);

test('los listados cuentan ÁLBUMES, y lo descartado no sale', () => {
  const s = qualityListsSummary();
  const por = Object.fromEntries(s.sampleRates.map((r) => [r.rate, r.albums]));
  assert.deepEqual(por, { 44100: 2, 48000: 1, 96000: 1 });
  assert.equal(s.noReplaygain, 2);
  assert.equal(s.noCover, 2);
});

test('un álbum que mezcla frecuencias sale en las dos listas y lo dice', () => {
  const a441 = albumsAtSampleRate(44100);
  assert.deepEqual(a441.map((a) => a.title), ['Tago Mago', 'Neu! 75']);
  assert.deepEqual(a441[1].rates, [44100, 48000]);
  assert.equal(a441[1].at_rate, 1);
  assert.deepEqual(albumsAtSampleRate('48000').map((a) => a.title), ['Neu! 75']);
  assert.throws(() => albumsAtSampleRate('muchos'), /no válida/);
});

test('sin ReplayGain y sin imagen dan los nombres, con cuántas pistas', () => {
  assert.deepEqual(
    albumsWithoutReplaygain().map((a) => [a.title, a.without, a.total]),
    [
      ['Discreet Music', 1, 1],
      ['Neu! 75', 1, 2],
    ]
  );
  assert.deepEqual(albumsWithoutCover().map((a) => a.title), ['Discreet Music', 'Neu! 75']);
});

test('la vista de Calidad trae los recuentos por álbum junto a los de pistas', () => {
  const ac = q.qualityOverview().albumCounts;
  assert.equal(ac.lossless, 3);
  assert.equal(ac.lossy, 1, 'el descartado no cuenta; «Neu! 75» sí, por su pista con pérdida');
  assert.equal(ac.losslessTracks, 4);
  assert.equal(ac.noReplaygain, 2);
  assert.equal(ac.noReplaygainTracks, 2);
});

test('por HTTP: los listados contestan y una lista que no existe lo dice', async () => {
  const resumen = await app.inject({ method: 'GET', url: '/api/quality/lists' });
  assert.equal(resumen.statusCode, 200);
  assert.equal(resumen.json().noCover, 2);
  const lista = await app.inject({ method: 'GET', url: '/api/quality/list?kind=samplerate&rate=44100' });
  assert.equal(lista.json().total, 2);
  const mala = await app.inject({ method: 'GET', url: '/api/quality/list?kind=inventada' });
  assert.equal(mala.statusCode, 400);
  assert.match(mala.json().error, /desconocida/);
});
