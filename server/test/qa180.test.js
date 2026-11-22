import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Lo añadido tras el QA de la 1.7.3: pedidos que caducan, carpetas que ya no están,
// carátulas de antemano y fichas de artista repetidas.
const RAIZ = path.join(os.tmpdir(), `liderarr-qa180-${Date.now()}`);
const MUSICA = path.join(RAIZ, 'musica');
fs.mkdirSync(MUSICA, { recursive: true });
process.env.DATA_DIR = RAIZ;

const { db, setSetting } = await import('../src/db.js');
const { app } = await import('../src/index.js');
app.log.level = 'silent';
const { expireStaleDownloads, activeRequestRgs, caducaDias } = await import('../src/downloads.js');
const { reabrirPedidosViejos } = await import('../src/wanted.js');
const { marcarDesaparecidos, discosDesaparecidos, olvidarDisco, olvidarTodos } = await import('../src/missing.js');
const { coversPendientes } = await import('../src/covers.js');
const q = await import('../src/queries.js');

setSetting('music_dirs', MUSICA);
const DIA = 86400000;
const p = (x) => x.split(path.sep).join('/');

// --- pedidos que caducan -------------------------------------------------------------
test('un pedido que lleva semanas sin llegar caduca y deja de bloquear ese disco', () => {
  const ahora = Date.now();
  const ins = db.prepare("INSERT INTO downloads (rg_mbid, artist, album, status, requested_at) VALUES (?, 'A', ?, 'requested', ?)");
  ins.run('rg-viejo', 'Viejo', ahora - 20 * DIA);
  ins.run('rg-reciente', 'Reciente', ahora - 2 * DIA);
  assert.equal(caducaDias(), 14);
  assert.ok(activeRequestRgs().has('rg-viejo'));
  assert.equal(expireStaleDownloads(ahora), 1);
  assert.ok(!activeRequestRgs().has('rg-viejo'), 'ya se puede volver a pedir');
  assert.ok(activeRequestRgs().has('rg-reciente'), 'el reciente sigue en curso');
  assert.equal(db.prepare("SELECT status FROM downloads WHERE rg_mbid = 'rg-viejo'").get().status, 'expired');
  // 0 = no caducar nunca
  setSetting('downloads_expire_days', '0');
  ins.run('rg-eterno', 'Eterno', ahora - 400 * DIA);
  assert.equal(expireStaleDownloads(ahora), 0);
  setSetting('downloads_expire_days', null);
});

test('un deseo «pedido» que no llegó vuelve a la búsqueda', () => {
  const ahora = Date.now();
  const ins = db.prepare(
    `INSERT INTO wanted_albums (match_key, artist, title, origin, status, tries, added_at, updated_at)
     VALUES (?, 'A', ?, 'manual', ?, 1, ?, ?)`
  );
  ins.run('a::viejo', 'Viejo', 'grabbed', ahora - 30 * DIA, ahora - 30 * DIA);
  ins.run('a::reciente', 'Reciente', 'grabbed', ahora - 3 * DIA, ahora - 3 * DIA);
  ins.run('a::tuyo', 'Tuyo', 'owned', ahora - 30 * DIA, ahora - 30 * DIA);
  assert.equal(reabrirPedidosViejos(ahora), 1);
  const estado = (k) => db.prepare('SELECT status, last_reason FROM wanted_albums WHERE match_key = ?').get(k);
  assert.equal(estado('a::viejo').status, 'watching');
  assert.match(estado('a::viejo').last_reason, /no llegó/);
  assert.equal(estado('a::reciente').status, 'grabbed');
  assert.equal(estado('a::tuyo').status, 'owned', 'lo que ya tienes no se reabre');
});

// --- carpetas que ya no están ----------------------------------------------------------
const carpeta = (n) => path.join(MUSICA, 'Artista', `Disco ${String(n).padStart(2, '0')}`);
test('un disco cuya carpeta ya no existe se marca, y se desmarca si vuelve', () => {
  const ins = db.prepare("INSERT INTO albums (id, local_key, path, album_artist, title, match_state) VALUES (?, ?, ?, 'Artista', ?, 'matched')");
  for (let n = 1; n <= 40; n++) {
    fs.mkdirSync(carpeta(n), { recursive: true });
    ins.run(1000 + n, `k${n}`, p(carpeta(n)), `Disco ${n}`);
  }
  db.prepare("INSERT INTO tracks (album_id, title, path) VALUES (1001, 'pista', ?)").run(p(path.join(carpeta(1), '01.flac')));
  assert.deepEqual(marcarDesaparecidos().faltan, 0);

  fs.rmSync(carpeta(1), { recursive: true });
  fs.rmSync(carpeta(2), { recursive: true });
  const r = marcarDesaparecidos();
  assert.equal(r.nuevos, 2);
  assert.deepEqual(discosDesaparecidos().map((d) => d.id), [1001, 1002]);

  fs.mkdirSync(carpeta(2), { recursive: true }); // la renombraste y la has devuelto
  const r2 = marcarDesaparecidos();
  assert.equal(r2.recuperados, 1);
  assert.deepEqual(discosDesaparecidos().map((d) => d.id), [1001]);
});

test('quitar de la app pide confirmación, no borra lo que ha vuelto y solo toca filas', () => {
  assert.throws(() => olvidarDisco(1001), /Sin confirmar/);
  assert.throws(() => olvidarDisco(1005, { confirm: true }), /no está marcado/);
  const r = olvidarDisco(1001, { confirm: true });
  assert.equal(r.ok, true);
  assert.equal(db.prepare('SELECT count(*) n FROM albums WHERE id = 1001').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM tracks WHERE album_id = 1001').get().n, 0);

  // marcado, pero la carpeta reaparece antes de confirmar: se queda
  fs.rmSync(carpeta(3), { recursive: true });
  marcarDesaparecidos();
  fs.mkdirSync(carpeta(3), { recursive: true });
  assert.throws(() => olvidarDisco(1003, { confirm: true }), /ha vuelto a aparecer/);
  assert.equal(db.prepare('SELECT missing_since FROM albums WHERE id = 1003').get().missing_since, null);
});

test('si de golpe falta media biblioteca, lo raro es el volumen: no se marca nada', () => {
  // 39 discos quedan; desaparecen 30 a la vez (un volumen que no ha montado bien)
  for (let n = 4; n <= 33; n++) fs.rmSync(carpeta(n), { recursive: true });
  const r = marcarDesaparecidos();
  assert.equal(r.nuevos, 0);
  assert.equal(r.dudosas.length, 1);
  assert.equal(discosDesaparecidos().length, 0);
  assert.throws(() => olvidarTodos(), /Sin confirmar/);
  assert.deepEqual(olvidarTodos({ confirm: true }), { ok: true, quitados: 0, vueltos: 0 });
  // y con la raíz vacía del todo, tampoco
  fs.rmSync(path.join(MUSICA, 'Artista'), { recursive: true });
  assert.equal(marcarDesaparecidos().nuevos, 0);
  fs.mkdirSync(path.join(MUSICA, 'Artista'), { recursive: true });
});

// --- carátulas de antemano -------------------------------------------------------------
test('solo quedan pendientes los discos sin imagen, sin caché y sin marca de «no hay»', () => {
  const img = path.join(RAIZ, 'img', 'art');
  fs.mkdirSync(img, { recursive: true });
  db.prepare("UPDATE albums SET cover = '/algo/cover.jpg' WHERE id = 1034").run(); // tiene imagen en su carpeta
  fs.writeFileSync(path.join(img, '1035'), 'jpg'); // ya está en caché
  fs.writeFileSync(path.join(img, '1036.none'), ''); // ya se buscó y no hay
  const pendientes = coversPendientes();
  for (const id of [1034, 1035, 1036]) assert.ok(!pendientes.includes(id), `el ${id} no está pendiente`);
  assert.ok(pendientes.includes(1037));
  assert.equal(coversPendientes(2).length, 2, 'respeta el tope de la tanda');
});

// --- fichas de artista repetidas ---------------------------------------------------------
test('dos fichas con el mismo nombre se proponen; dos artistas distintos que se llaman igual, no', () => {
  const art = db.prepare('INSERT INTO artists (id, name, mbid) VALUES (?, ?, ?)');
  art.run(1, 'Damon Albarn', '7d7a5fdd-0d04-4c36-8bee-906feeae239c');
  art.run(2, 'damon albarn', null);
  art.run(3, 'Nirvana', '5b11f4ce-a62d-471e-81fc-a69a8278c7da'); // los de Seattle
  art.run(4, 'Nirvana', '9282c8b4-ca0b-4c6b-b7e3-4f7762dfc4d6'); // los británicos de los 60
  art.run(5, 'Stik Figa', null);
  art.run(6, 'Stik Figa', null);
  const alb = db.prepare("INSERT INTO albums (id, local_key, artist_id, album_artist, title, match_state) VALUES (?, ?, ?, ?, ?, 'matched')");
  alb.run(2001, 'd1', 1, 'Damon Albarn', 'Everyday Robots');
  alb.run(2002, 'd2', 2, 'damon albarn', 'Dr Dee');
  db.prepare("INSERT INTO tracked_artists (artist_id, facet) VALUES (2, 'artist')").run();

  const grupos = q.duplicateArtists().map((g) => g.name.toLowerCase());
  assert.deepEqual(grupos.sort(), ['damon albarn', 'stik figa']);
});

test('fundir pide confirmación, se lleva los discos y el seguimiento, y conserva el MBID', () => {
  assert.throws(() => q.mergeArtists(1, 2), /Sin confirmar/);
  assert.throws(() => q.mergeArtists(3, 4, { confirm: true }), /MBID distinto/);
  assert.throws(() => q.mergeArtists(2, 2, { confirm: true }), /dos fichas distintas/);
  // se funde la que TIENE MBID dentro de la que no: el MBID tiene que sobrevivir
  const r = q.mergeArtists(1, 2, { confirm: true });
  assert.equal(r.ok, true);
  assert.equal(db.prepare('SELECT count(*) n FROM artists WHERE id = 1').get().n, 0);
  assert.equal(db.prepare('SELECT mbid FROM artists WHERE id = 2').get().mbid, '7d7a5fdd-0d04-4c36-8bee-906feeae239c');
  assert.equal(db.prepare('SELECT count(*) n FROM albums WHERE artist_id = 2').get().n, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM tracked_artists WHERE artist_id = 2').get().n, 1);
  assert.deepEqual(q.duplicateArtists().map((g) => g.name), ['Stik Figa']);
});

// --- por HTTP --------------------------------------------------------------------------
test('las rutas nuevas contestan, y las que borran no hacen nada sin confirmación', async () => {
  const dup = await app.inject({ method: 'GET', url: '/api/artists/duplicates' });
  assert.equal(dup.statusCode, 200);
  assert.ok(Array.isArray(dup.json()), 'no la confunde con /api/artists/:id');

  const falta = await app.inject({ method: 'GET', url: '/api/missing' });
  assert.equal(falta.statusCode, 200);
  assert.ok(Array.isArray(falta.json()));

  for (const [url, payload] of [
    ['/api/missing/forget-all', {}],
    ['/api/missing/1037/forget', {}],
    ['/api/artists/merge', { from: 5, into: 6 }],
  ]) {
    const r = await app.inject({ method: 'POST', url, payload });
    assert.equal(r.statusCode, 400, url);
    assert.match(r.json().error, /Sin confirmar/);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM artists WHERE id IN (5, 6)').get().n, 2);

  const car = await app.inject({ method: 'GET', url: '/api/covers/warm' });
  assert.equal(car.statusCode, 200);
  assert.equal(car.json().running, false);
  assert.equal(typeof car.json().pendientes, 'number');
});
