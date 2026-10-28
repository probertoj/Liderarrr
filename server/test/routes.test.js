import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Las rutas DE VERDAD, por donde entran de verdad: con app.inject() no hace falta abrir un
// puerto. Importar index.js ya no arranca nada (eso vive en start()), así que esto es barato.
const RAIZ = path.join(os.tmpdir(), `liderarr-routes-${Date.now()}`);
const MUSICA = path.join(RAIZ, 'musica');
fs.mkdirSync(MUSICA, { recursive: true });
process.env.DATA_DIR = RAIZ;

const { db, setSetting } = await import('../src/db.js');
const { app } = await import('../src/index.js');
app.log.level = 'silent'; // una línea de log por petición no aporta nada aquí

setSetting('music_dirs', MUSICA);

// Seis discos, uno por año, para poder comprobar el troceado y el orden.
const ins = db.prepare(
  `INSERT INTO albums (id, local_key, path, album_artist, title, year, match_state, added_at)
   VALUES (@id, @k, @p, @artista, @titulo, @anio, 'matched', @added)`
);
const discos = [
  [1, 'Bowie', 'Low', 1977],
  [2, 'Can', 'Tago Mago', 1971],
  [3, 'Neu!', 'Neu! 75', 1975],
  [4, 'Eno', 'Discreet Music', 1975],
  [5, 'Cluster', 'Zuckerzeit', 1974],
  [6, 'Faust', 'IV', 1973],
];
db.transaction(() => {
  for (const [id, artista, titulo, anio] of discos) {
    const carpeta = path.join(MUSICA, `${artista} - ${titulo}`);
    fs.mkdirSync(carpeta, { recursive: true });
    ins.run({ id, k: `k${id}`, p: carpeta, artista, titulo, anio, added: 1000 + id });
  }
})();

const pedir = (url, opciones = {}) => app.inject({ method: 'GET', url, ...opciones });
const json = (res) => JSON.parse(res.body);

test('la raíz de la API contesta quién es', async () => {
  const res = await pedir('/api/version');
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).name, 'Liderarrr');
  assert.ok(json(res).version);
});

test('la Discoteca trocea de verdad cuando los parámetros llegan por la URL', async () => {
  // Este es el camino donde vivía el fallo: por HTTP, limit y offset llegan como TEXTO.
  // Llamando a library(2, 2) con números desde un test, todo parecía correcto.
  const todos = json(await pedir('/api/library?limit=100'));
  assert.equal(todos.total, 6);

  const p1 = json(await pedir('/api/library?limit=2&offset=0'));
  const p2 = json(await pedir('/api/library?limit=2&offset=2'));
  const p3 = json(await pedir('/api/library?limit=2&offset=4'));
  assert.deepEqual([p1.albums.length, p2.albums.length, p3.albums.length], [2, 2, 2]);

  const ids = [p1, p2, p3].flatMap((p) => p.albums.map((a) => a.id));
  assert.equal(new Set(ids).size, 6, 'ni repetidos ni perdidos entre páginas');
  assert.deepEqual(ids, todos.albums.map((a) => a.id));
});

test('los filtros de la Discoteca llegan enteros', async () => {
  assert.equal(json(await pedir('/api/library?q=Tago')).total, 1);
  assert.equal(json(await pedir('/api/library?year=1975')).total, 2);
  assert.equal(json(await pedir('/api/library?decade=1970')).total, 6);
  assert.equal(json(await pedir('/api/library?q=nohayna')).total, 0);
  const porTitulo = json(await pedir('/api/library?sort=title&limit=2')).albums.map((a) => a.title);
  assert.deepEqual(porTitulo, ['Discreet Music', 'IV']);
});

test('una ficha que no existe da 404 con un motivo, no un cuadro en blanco', async () => {
  const ok = await pedir('/api/albums/1');
  assert.equal(ok.statusCode, 200);
  assert.equal(json(ok).title, 'Low');

  const no = await pedir('/api/albums/99999');
  assert.equal(no.statusCode, 404);
  assert.ok(json(no).error, 'el cuerpo trae `error`, que es lo que lee la interfaz');
});

test('una ruta de la API que no existe no devuelve la página web', async () => {
  const res = await pedir('/api/estonoexiste');
  assert.equal(res.statusCode, 404);
  assert.ok(json(res).error);
});

test('un cuerpo ilegible se explica, no se queda en «Bad Request»', async () => {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { 'content-type': 'application/json' },
    payload: '{roto',
  });
  assert.equal(res.statusCode, 400);
  assert.notEqual(json(res).error, 'Bad Request');
  assert.match(json(res).error, /JSON/i);
});

test('borrar del disco NO borra nada sin confirmación expresa', async () => {
  const carpeta = path.join(MUSICA, 'Bowie - Low');
  const res = await app.inject({ method: 'POST', url: '/api/albums/1/delete', payload: {} });
  assert.equal(res.statusCode, 400);
  assert.match(json(res).error, /no confirmado/i);
  assert.ok(fs.existsSync(carpeta), 'la carpeta sigue ahí');
});

test('borrar del disco se niega si la carpeta está FUERA de tu biblioteca', async () => {
  // El guardarraíl que importa: aunque confirmes, nada que esté fuera de music_dirs se toca.
  const fuera = path.join(RAIZ, 'fuera-de-la-biblioteca');
  fs.mkdirSync(fuera, { recursive: true });
  const testigo = path.join(fuera, 'no-me-borres.flac');
  fs.writeFileSync(testigo, 'audio');
  db.prepare(
    "INSERT INTO albums (id, local_key, path, album_artist, title, match_state) VALUES (7, 'k7', ?, 'X', 'Fuera', 'matched')"
  ).run(fuera);
  db.prepare("INSERT INTO tracks (id, album_id, title, path) VALUES (70, 7, 'a', ?)").run(testigo);

  const res = await app.inject({ method: 'POST', url: '/api/albums/7/delete', payload: { confirm: true } });
  assert.equal(res.statusCode, 400);
  assert.match(json(res).error, /fuera de la biblioteca/i);
  assert.ok(fs.existsSync(testigo), 'el fichero de fuera sigue intacto');
});

test('restaurar la base pide el fichero y no se come una petición vacía', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/restore/database', payload: {} });
  assert.equal(res.statusCode, 400);
  assert.match(json(res).error, /multipart|fichero/i);
});

test('ordenar en su carpeta tampoco se mueve sin confirmación', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/albums/1/refile', payload: {} });
  assert.equal(res.statusCode, 400);
  assert.match(json(res).error, /no confirmado/i);
});
