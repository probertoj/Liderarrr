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
const { qualityListsSummary, albumsHiRes, albumsBelowCd, albumsMixedRates, albumsWithoutReplaygain, albumsWithoutCover } = await import('../src/qualitylists.js');
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
const pista = db.prepare('INSERT INTO tracks (album_id, title, path, sample_rate, bit_depth, format, lossless, has_replaygain) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
// 1 · CD de toda la vida: 16 bits, 44,1 kHz. No sale en ninguna lista de calidad.
alb.run(1, 'a', '/m/Can/Tago Mago', 'Can', 'Tago Mago', 1971, '/m/Can/Tago Mago/cover.jpg', 'matched', 2);
pista.run(1, 'uno', '/1a', 44100, 16, 'FLAC', 1, 1);
pista.run(1, 'dos', '/1b', 44100, 16, 'FLAC', 1, 1);
// 2 · mezcla frecuencias (y formatos): una pista sin pérdida a 44,1 y otra con pérdida a 48
alb.run(2, 'b', '/m/Neu!/Neu! 75', 'Neu!', 'Neu! 75', 1975, null, 'matched', 2);
pista.run(2, 'uno', '/2a', 44100, 16, 'FLAC', 1, 0);
pista.run(2, 'dos', '/2b', 48000, null, 'MP3', 0, 1);
// 3 · alta resolución por frecuencia: 24 bits, 96 kHz
alb.run(3, 'c', '/m/Eno/Discreet Music', 'Eno', 'Discreet Music', 1975, '', 'matched', 1);
pista.run(3, 'uno', '/3a', 96000, 24, 'FLAC', 1, 0);
// 4 · descartado: no cuenta en nada
alb.run(4, 'd', '/m/Descartado', 'X', 'Descartado', 2000, null, 'dismissed', 1);
pista.run(4, 'uno', '/4a', 22050, null, 'MP3', 0, 0);
// 5 · alta resolución SOLO por los bits: 24 bits a 44,1 kHz (antes quedaba escondido en «44,1 kHz»)
alb.run(5, 'e', '/m/Cluster/Zuckerzeit', 'Cluster', 'Zuckerzeit', 1974, '/m/c.jpg', 'matched', 1);
pista.run(5, 'uno', '/5a', 44100, 24, 'FLAC', 1, 1);
// 6 · por debajo de CD: un M4A a 22 kHz
alb.run(6, 'f', '/m/Faust/So Far', 'Faust', 'So Far', 1972, '/m/f.jpg', 'matched', 1);
pista.run(6, 'uno', '/6a', 22050, null, 'M4A', 0, 1);
// 7 · un MP3 a 96 kHz no es alta resolución: tiene pérdida
alb.run(7, 'g', '/m/Harmonia/Deluxe', 'Harmonia', 'Deluxe', 1975, '/m/h.jpg', 'matched', 1);
pista.run(7, 'uno', '/7a', 96000, null, 'MP3', 0, 1);

test('los listados cuentan ÁLBUMES por lo que importa, y lo descartado no sale', () => {
  assert.deepEqual(qualityListsSummary(), { hiRes: 2, belowCd: 1, mixed: 1, noReplaygain: 2, noCover: 2 });
});

test('alta resolución es más de 16 bits O más de 48 kHz, y solo si no tiene pérdida', () => {
  const alta = albumsHiRes();
  assert.deepEqual(alta.map((a) => a.title), ['Zuckerzeit', 'Discreet Music']);
  assert.deepEqual(alta[0].bits, [24]);
  assert.deepEqual(alta[0].rates, [44100], '24 bits a 44,1 kHz también es alta resolución');
  assert.deepEqual(alta[1].rates, [96000]);
  assert.ok(!alta.some((a) => a.title === 'Deluxe'), 'un MP3 a 96 kHz no lo es');
});

test('por debajo de CD y los que mezclan frecuencias dan sus datos', () => {
  const baja = albumsBelowCd();
  assert.deepEqual(baja.map((a) => [a.title, a.rates, a.formats]), [['So Far', [22050], ['M4A']]]);
  const mezcla = albumsMixedRates();
  assert.deepEqual(mezcla.map((a) => [a.title, a.rates, a.formats]), [['Neu! 75', [44100, 48000], ['FLAC', 'MP3']]]);
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
  assert.equal(ac.lossless, 4);
  assert.equal(ac.lossy, 3, 'el descartado no cuenta; «Neu! 75» sí, por su pista con pérdida');
  assert.equal(ac.losslessTracks, 5);
  assert.equal(ac.noReplaygain, 2);
  assert.equal(ac.noReplaygainTracks, 2);
});

test('por HTTP: los listados contestan y una lista que no existe lo dice', async () => {
  const resumen = await app.inject({ method: 'GET', url: '/api/quality/lists' });
  assert.equal(resumen.statusCode, 200);
  assert.equal(resumen.json().noCover, 2);
  const lista = await app.inject({ method: 'GET', url: '/api/quality/list?kind=hires' });
  assert.equal(lista.json().total, 2);
  // la lista por frecuencia exacta ya no existe: una pestaña por cada una no decía nada
  const vieja = await app.inject({ method: 'GET', url: '/api/quality/list?kind=samplerate&rate=44100' });
  assert.equal(vieja.statusCode, 400);
  const mala = await app.inject({ method: 'GET', url: '/api/quality/list?kind=inventada' });
  assert.equal(mala.statusCode, 400);
  assert.match(mala.json().error, /desconocida/);
});
