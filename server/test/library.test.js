import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// queries.js arrastra db.js (abre SQLite en DATA_DIR). Temporal antes del import dinámico.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-library-${Date.now()}`);
const { db } = await import('../src/db.js');
const { library } = await import('../src/queries.js');

// Doce discos con artista y título distintos: sin duplicados que colapsar, así la lista
// que devuelve la Discoteca tiene exactamente estas doce filas.
const ins = db.prepare(
  `INSERT INTO albums (local_key, path, album_artist, title, year, match_state, added_at)
   VALUES (@k, @p, @artista, @titulo, @anio, 'matched', @added)`
);
const discos = [
  ['Ángela', 'Zarzuela'],
  ['angel olsen', 'burn your fire'],
  ['Bach', 'Variaciones'],
  ['Can', 'Tago Mago'],
  ['Dylan', 'Blonde on Blonde'],
  ['Eno', 'Another Green World'],
  ['Fugazi', 'Repeater'],
  ['Gong', 'Camembert'],
  ['Hendrix', 'Axis'],
  ['Ídolos', 'Primero'],
  ['Jarre', 'Oxygène'],
  ['Kraftwerk', 'Autobahn'],
];
db.transaction(() => {
  discos.forEach(([artista, titulo], i) =>
    ins.run({ k: `k${i}`, p: `/data/${i}`, artista, titulo, anio: 1970 + i, added: 1000 + i })
  );
})();

const ids = (r) => r.albums.map((a) => a.id);

test('las páginas no se solapan ni se dejan nada', () => {
  const todos = library({ limit: 100 });
  assert.equal(todos.total, 12);
  assert.equal(todos.albums.length, 12);

  const p1 = library({ limit: 5, offset: 0 });
  const p2 = library({ limit: 5, offset: 5 });
  const p3 = library({ limit: 5, offset: 10 });
  assert.deepEqual([p1.albums.length, p2.albums.length, p3.albums.length], [5, 5, 2]);
  assert.deepEqual([...ids(p1), ...ids(p2), ...ids(p3)], ids(todos));
  assert.equal(new Set([...ids(p1), ...ids(p2), ...ids(p3)]).size, 12);
});

test('los parámetros del query llegan como TEXTO y aun así paginan bien', () => {
  // Este es el fallo que tenía: `offset + limit` con textos concatenaba («5» + 5 = «55»),
  // así que una página devolvía desde su principio hasta el final de la lista.
  const p2 = library({ limit: '5', offset: '5' });
  assert.equal(p2.albums.length, 5);
  assert.deepEqual(ids(p2), ids(library({ limit: 5, offset: 5 })));
  assert.equal(library({ limit: '3', offset: '0' }).albums.length, 3);
});

test('un limit absurdo no se lleva la biblioteca entera por delante', () => {
  assert.equal(library({ limit: '999999' }).albums.length, 12); // hay 12, pero el tope es 2000
  assert.equal(library({ limit: 0 }).albums.length, 12); // 0 no significa «ninguno», significa «el de siempre»
  assert.equal(library({ limit: 'hola' }).albums.length, 12);
  assert.equal(library({ offset: -5, limit: 3 }).albums.length, 3);
});

test('el orden por título respeta acentos y mayúsculas', () => {
  const t = library({ sort: 'title', limit: 100 }).albums.map((a) => a.title);
  assert.deepEqual(t.slice(0, 4), ['Another Green World', 'Autobahn', 'Axis', 'Blonde on Blonde']);
  // «burn your fire» en minúsculas va donde le toca, no al final
  assert.ok(t.indexOf('burn your fire') < t.indexOf('Camembert'));
});

test('el orden por artista también, y Ángela no se va al final', () => {
  const a = library({ sort: 'artist', limit: 100 }).albums.map((x) => x.album_artist);
  assert.deepEqual(a.slice(0, 3), ['angel olsen', 'Ángela', 'Bach']);
});

test('el orden aleatorio es el mismo entre páginas con la misma semilla', () => {
  const p1 = ids(library({ sort: 'random', seed: 42, limit: 6, offset: 0 }));
  const p2 = ids(library({ sort: 'random', seed: 42, limit: 6, offset: 6 }));
  assert.equal(new Set([...p1, ...p2]).size, 12, 'ningún disco repetido ni perdido entre páginas');
  // y repetir la misma petición da lo mismo
  assert.deepEqual(ids(library({ sort: 'random', seed: 42, limit: 6, offset: 0 })), p1);
  // con otra semilla, otro orden (12 discos: la probabilidad de coincidir es ínfima)
  assert.notDeepEqual(ids(library({ sort: 'random', seed: 7, limit: 12 })), ids(library({ sort: 'random', seed: 42, limit: 12 })));
});
